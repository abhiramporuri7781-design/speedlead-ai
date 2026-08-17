// Set PORT to 0 to bind to a random free port and prevent EADDRINUSE conflicts with the running server
process.env.PORT = '0';

import { supabase } from './db.js';
import { processWhatsAppWebhook, processedMessageIds } from './server.js';

// Global variables for capturing mocked WhatsApp messages
let whatsAppMessagesSent = [];

// Intercept global fetch to mock Meta WhatsApp Cloud API and capture sent messages
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  if (url.includes('graph.facebook.com')) {
    const body = JSON.parse(options.body);
    whatsAppMessagesSent.push({
      to: body.to,
      message: body.text.body
    });
    
    return {
      ok: true,
      json: async () => ({
        messaging_product: 'whatsapp',
        contacts: [{ input: body.to, wa_id: body.to }],
        messages: [{ id: `wamid.mock_${Math.random().toString(36).substring(7)}` }]
      })
    };
  }
  return originalFetch(url, options);
};

// Helper to format date in Kolkata timezone (YYYY-MM-DD)
function getKolkataDate(offsetDays = 0) {
  const now = new Date();
  const kolkataNow = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  const targetDate = new Date(kolkataNow.getTime() + (offsetDays * 24 * 60 * 60 * 1000));
  
  const yyyy = targetDate.getUTCFullYear();
  const mm = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Helper to construct simulated webhook payload
function createMockWebhookPayload(phone, messageText, messageId) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '888888888888888',
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '16505553333',
                phone_number_id: '1276497992215398'
              },
              contacts: [
                {
                  profile: { name: 'Test User' },
                  wa_id: phone
                }
              ],
              messages: [
                {
                  from: phone,
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  text: { body: messageText },
                  type: 'text'
                }
              ]
            },
            field: 'messages'
          }
        ]
      }
    ]
  };
}

async function runPhase5Tests() {
  console.log('🧪 Starting Phase 5 Conversational Booking Flow Verification Tests...\n');

  let business = null;
  let testAgent = null;
  
  // Track IDs for cleanup
  const createdLeadIds = [];
  const createdTourIds = [];
  let createdAgentId = null;

  try {
    // 0. Setup: Retrieve test business
    const { data: businesses } = await supabase.from('businesses').select('*').limit(1);
    if (!businesses || businesses.length === 0) {
      throw new Error('No business found in the database. Please insert a business first.');
    }
    business = businesses[0];
    console.log(`🏢 Test Business: "${business.name}" (ID: ${business.id})`);

    // Clean up existing tours, leads, and agents for this business to ensure a clean state
    console.log('🧹 Preparing clean test database state (deleting existing tours, leads, agents)...');
    await supabase.from('site_tours').delete().eq('business_id', business.id);
    await supabase.from('leads').delete().eq('business_id', business.id);
    await supabase.from('agents').delete().eq('business_id', business.id);

    // Create a dedicated test agent for our tests
    const { data: agent, error: agentErr } = await supabase
      .from('agents')
      .insert([
        {
          business_id: business.id,
          name: 'Phase5 Test Agent',
          notify_channel: 'WHATSAPP',
          notify_target: '919000000000'
        }
      ])
      .select()
      .single();

    if (agentErr) throw new Error(`Setup failed: agent creation failed: ${agentErr.message}`);
    testAgent = agent;
    createdAgentId = agent.id;
    console.log(`👤 Created Test Agent: "${testAgent.name}" (ID: ${testAgent.id})\n`);

    // -------------------------------------------------------------
    // Test 1 — New lead
    // -------------------------------------------------------------
    console.log('Test 1 — New lead: Sending message from a new phone number...');
    const phone1 = '919000000001';
    const msgId1 = `wamid.t1_${Date.now()}`;
    whatsAppMessagesSent = [];

    const payload1 = createMockWebhookPayload(phone1, 'Hi, I am interested in buying a home', msgId1);
    await processWhatsAppWebhook(payload1);

    // Verify lead created
    const { data: lead1 } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone1)
      .single();

    if (!lead1) throw new Error('Test 1 Failed: Lead was not created in the database.');
    createdLeadIds.push(lead1.id);
    console.log(`✅ Created exactly 1 lead with ID: ${lead1.id}`);
    
    // Assert response content (should ask qualification question)
    const reply1 = whatsAppMessagesSent.find(r => r.to === phone1);
    if (!reply1 || !reply1.message.includes('help you find the right property')) {
      throw new Error(`Test 1 Failed: Unexpected WhatsApp response: ${reply1?.message}`);
    }
    console.log('✅ Received appropriate qualification message response.');
    console.log('-------------------------------------------------------------\n');

    // -------------------------------------------------------------
    // Test 2 — Existing lead
    // -------------------------------------------------------------
    console.log('Test 2 — Existing lead: Sending another message from same phone number...');
    const msgId2 = `wamid.t2_${Date.now()}`;
    whatsAppMessagesSent = [];

    const payload2 = createMockWebhookPayload(phone1, 'Hello again', msgId2);
    await processWhatsAppWebhook(payload2);

    // Verify no duplicate lead was created
    const { data: leads1 } = await supabase
      .from('leads')
      .select('*')
      .eq('phone', phone1);

    if (leads1.length !== 1) throw new Error(`Test 2 Failed: Found ${leads1.length} leads instead of 1.`);
    console.log('✅ Verified that duplicate lead was not created.');
    console.log('-------------------------------------------------------------\n');

    // -------------------------------------------------------------
    // Test 3 — Qualification
    // -------------------------------------------------------------
    console.log('Test 3 — Qualification: Sending qualifying property type and budget details...');
    const phone3 = '919000000003';
    const msgId3 = `wamid.t3_${Date.now()}`;
    whatsAppMessagesSent = [];

    // Pre-create the lead in NEW state
    const { data: lead3 } = await supabase
      .from('leads')
      .insert([{ business_id: business.id, phone: phone3, name: 'Lead 3', conversation_state: 'NEW' }])
      .select()
      .single();
    createdLeadIds.push(lead3.id);

    const payload3 = createMockWebhookPayload(phone3, 'Looking for a 3BHK villa with 1.5 crore budget', msgId3);
    await processWhatsAppWebhook(payload3);

    // Fetch updated lead details
    const { data: lead3Updated } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead3.id)
      .single();

    console.log(`   Updated details: Property Type: "${lead3Updated.property_type}", Budget: "${lead3Updated.budget}", State: "${lead3Updated.conversation_state}"`);
    
    // Checks
    if (!lead3Updated.property_type) {
      throw new Error('Test 3 Failed: Property type was not extracted.');
    }
    if (lead3Updated.budget !== '15000000') {
      throw new Error(`Test 3 Failed: Expected budget to be "15000000", got "${lead3Updated.budget}"`);
    }
    if (lead3Updated.conversation_state !== 'READY_FOR_BOOKING') {
      throw new Error(`Test 3 Failed: Expected state "READY_FOR_BOOKING", got "${lead3Updated.conversation_state}"`);
    }
    
    console.log('✅ Lead details qualified and state updated to READY_FOR_BOOKING.');
    console.log('-------------------------------------------------------------\n');

    // -------------------------------------------------------------
    // Test 4 — Site visit intent
    // -------------------------------------------------------------
    console.log('Test 4 — Site visit intent: Sending message expressing intent to visit...');
    const phone4 = '919000000004';
    const msgId4 = `wamid.t4_${Date.now()}`;
    whatsAppMessagesSent = [];

    // Pre-create lead with details, but in QUALIFYING state
    const { data: lead4 } = await supabase
      .from('leads')
      .insert([{
        business_id: business.id,
        phone: phone4,
        name: 'Lead 4',
        property_type: '2BHK',
        budget: '8000000',
        conversation_state: 'QUALIFYING'
      }])
      .select()
      .single();
    createdLeadIds.push(lead4.id);

    const payload4 = createMockWebhookPayload(phone4, 'I want to visit the site tomorrow', msgId4);
    await processWhatsAppWebhook(payload4);

    // Fetch state
    const { data: lead4Updated } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead4.id)
      .single();

    console.log(`   Updated state: ${lead4Updated.conversation_state}`);
    const tomorrowDate = getKolkataDate(1);
    if (lead4Updated.conversation_state === `AWAITING_SLOT:${tomorrowDate}`) {
      console.log(`✅ Intent resolved directly with target date: ${tomorrowDate}. Presenting available slots.`);
    } else if (lead4Updated.conversation_state === 'READY_FOR_BOOKING') {
      console.log('✅ Intent recognized. Prompting user to select today/tomorrow date.');
    } else {
      throw new Error(`Test 4 Failed: Unexpected conversation state "${lead4Updated.conversation_state}"`);
    }
    console.log('-------------------------------------------------------------\n');

    // -------------------------------------------------------------
    // Test 5 — Slot generation
    // -------------------------------------------------------------
    console.log('Test 5 — Slot generation: Testing slot rendering & removal of booked slots...');
    const phone5 = '919000000005';
    const msgId5 = `wamid.t5_${Date.now()}`;
    whatsAppMessagesSent = [];
    const testDate = getKolkataDate(1); // tomorrow

    // 1. Pre-create lead in READY_FOR_BOOKING
    const { data: lead5 } = await supabase
      .from('leads')
      .insert([{
        business_id: business.id,
        phone: phone5,
        name: 'Lead 5',
        property_type: '3BHK',
        budget: '9000000',
        conversation_state: 'READY_FOR_BOOKING'
      }])
      .select()
      .single();
    createdLeadIds.push(lead5.id);

    // 2. Pre-book the 11:30 AM slot (index 2) to test slot exclusion
    const bookedSlotTime = `${testDate}T11:30:00+05:30`;
    const { data: bookedTour, error: tourErr } = await supabase
      .from('site_tours')
      .insert([{
        business_id: business.id,
        agent_id: testAgent.id,
        lead_id: lead5.id,
        slot_time: bookedSlotTime,
        status: 'CONFIRMED'
      }])
      .select()
      .single();

    if (tourErr) throw new Error(`Test 5 Setup Error: Could not pre-book slot: ${tourErr.message}`);
    createdTourIds.push(bookedTour.id);

    // Send date input "tomorrow"
    const payload5 = createMockWebhookPayload(phone5, 'Tomorrow', msgId5);
    await processWhatsAppWebhook(payload5);

    // Verify response
    const reply5 = whatsAppMessagesSent.find(r => r.to === phone5);
    if (!reply5) throw new Error('Test 5 Failed: No WhatsApp reply sent.');
    
    console.log('   Offered Slots Response:\n' + reply5.message);
    
    // Assert 11:30 AM is excluded
    if (reply5.message.includes('11:30 AM')) {
      throw new Error('Test 5 Failed: Omitted slot "11:30 AM" was displayed in available slots list.');
    }
    if (!reply5.message.includes('10:00 AM') || !reply5.message.includes('2:00 PM') || !reply5.message.includes('4:30 PM')) {
      throw new Error('Test 5 Failed: Available slots list did not include the expected free slots.');
    }
    console.log('✅ Omitted booked slot (11:30 AM) successfully. Available slots rendered correctly.');
    console.log('-------------------------------------------------------------\n');

    // -------------------------------------------------------------
    // Test 6 — Successful booking
    // -------------------------------------------------------------
    console.log('Test 6 — Successful booking: Booking the first available slot...');
    const phone6 = '919000000006';
    const msgId6 = `wamid.t6_${Date.now()}`;
    whatsAppMessagesSent = [];
    const bookingDate = getKolkataDate(1); // tomorrow

    // Pre-create lead in AWAITING_SLOT:<date>
    const { data: lead6 } = await supabase
      .from('leads')
      .insert([{
        business_id: business.id,
        phone: phone6,
        name: 'Lead 6',
        property_type: '2BHK',
        budget: '7500000',
        conversation_state: `AWAITING_SLOT:${bookingDate}`
      }])
      .select()
      .single();
    createdLeadIds.push(lead6.id);

    const payload6 = createMockWebhookPayload(phone6, '1', msgId6);
    await processWhatsAppWebhook(payload6);

    // Verify lead state updated to BOOKED
    const { data: lead6Updated } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead6.id)
      .single();

    if (lead6Updated.conversation_state !== 'BOOKED') {
      throw new Error(`Test 6 Failed: Expected conversation state "BOOKED", got "${lead6Updated.conversation_state}"`);
    }

    // Verify site tour created
    const { data: tours6 } = await supabase
      .from('site_tours')
      .select('*')
      .eq('lead_id', lead6.id)
      .eq('status', 'CONFIRMED');

    if (tours6.length !== 1) {
      throw new Error(`Test 6 Failed: Expected 1 confirmed tour booking, found ${tours6.length}`);
    }
    createdTourIds.push(tours6[0].id);

    console.log(`   Booking created in site_tours with ID: ${tours6[0].id}`);
    const reply6 = whatsAppMessagesSent.find(r => r.to === phone6);
    if (!reply6 || !reply6.message.includes('visit is confirmed')) {
      throw new Error(`Test 6 Failed: Unexpected reply message: ${reply6?.message}`);
    }
    console.log('✅ Received confirmation response on WhatsApp.');
    console.log('-------------------------------------------------------------\n');

    // -------------------------------------------------------------
    // Test 7 — Double booking
    // -------------------------------------------------------------
    console.log('Test 7 — Double booking: Attempting to book the SAME slot from another lead...');
    const phone7 = '919000000007';
    const msgId7 = `wamid.t7_${Date.now()}`;
    whatsAppMessagesSent = [];

    // Pre-create Lead 7 in AWAITING_SLOT:<date>
    const { data: lead7 } = await supabase
      .from('leads')
      .insert([{
        business_id: business.id,
        phone: phone7,
        name: 'Lead 7',
        property_type: '2BHK',
        budget: '7500000',
        conversation_state: `AWAITING_SLOT:${bookingDate}`
      }])
      .select()
      .single();
    createdLeadIds.push(lead7.id);

    // Send "10:00 AM" (which maps to 10:00 AM, but that slot was just booked by Lead 6!)
    const payload7 = createMockWebhookPayload(phone7, '10:00 AM', msgId7);
    await processWhatsAppWebhook(payload7);

    // Fetch Lead 7 state (should remain AWAITING_SLOT)
    const { data: lead7Updated } = await supabase
      .from('leads')
      .select('*')
      .eq('id', lead7.id)
      .single();

    if (!lead7Updated.conversation_state.startsWith('AWAITING_SLOT')) {
      throw new Error(`Test 7 Failed: Expected state to remain "AWAITING_SLOT", got "${lead7Updated.conversation_state}"`);
    }

    const reply7 = whatsAppMessagesSent.find(r => r.to === phone7);
    console.log('   Double Booking Failure Response:\n' + reply7?.message);

    if (!reply7 || !reply7.message.includes('slot was just taken')) {
      throw new Error(`Test 7 Failed: Unexpected double booking response: ${reply7?.message}`);
    }
    console.log('✅ Double booking blocked. Bot returned "slot was just taken" and prompted remaining times.');
    console.log('-------------------------------------------------------------\n');

    // -------------------------------------------------------------
    // Test 8 — Already booked lead
    // -------------------------------------------------------------
    console.log('Test 8 — Already booked lead: Sending message from a lead that already has a booking...');
    const phone8 = '919000000008';
    const msgId8 = `wamid.t8_${Date.now()}`;
    whatsAppMessagesSent = [];

    // Pre-create Lead 8 in BOOKED state
    const { data: lead8 } = await supabase
      .from('leads')
      .insert([{
        business_id: business.id,
        phone: phone8,
        name: 'Lead 8',
        property_type: '2BHK',
        budget: '7500000',
        conversation_state: 'BOOKED'
      }])
      .select()
      .single();
    createdLeadIds.push(lead8.id);

    const payload8 = createMockWebhookPayload(phone8, 'Can I visit now?', msgId8);
    await processWhatsAppWebhook(payload8);

    const reply8 = whatsAppMessagesSent.find(r => r.to === phone8);
    if (!reply8 || !reply8.message.includes('already confirmed')) {
      throw new Error(`Test 8 Failed: Expected confirmation reminder, got: ${reply8?.message}`);
    }
    
    // Verify no new tours were created
    const { data: tours8 } = await supabase
      .from('site_tours')
      .select('*')
      .eq('lead_id', lead8.id);
      
    if (tours8.length !== 0) {
      throw new Error(`Test 8 Failed: Accidentally created a new booking! Tours found: ${tours8.length}`);
    }
    
    console.log('✅ Confirmed that already-booked lead is reminded and duplicate booking is blocked.');
    console.log('-------------------------------------------------------------\n');

    console.log('🏆 All 8 Phase 5 Verification Tests Passed Successfully!');

  } catch (error) {
    console.error('\n❌ Test execution encountered an error:', error);
    process.exitCode = 1;
  } finally {
    console.log('\n🧹 Cleaning up test database records...');
    
    // 1. Delete tours
    if (createdTourIds.length > 0) {
      console.log(`   Deleting ${createdTourIds.length} test tours...`);
      const { error } = await supabase.from('site_tours').delete().in('id', createdTourIds);
      if (error) console.error('   ❌ Tour cleanup error:', error.message);
    }
    
    // 2. Delete leads
    if (createdLeadIds.length > 0) {
      console.log(`   Deleting ${createdLeadIds.length} test leads...`);
      const { error } = await supabase.from('leads').delete().in('id', createdLeadIds);
      if (error) console.error('   ❌ Lead cleanup error:', error.message);
    }

    // 3. Delete agent
    if (createdAgentId) {
      console.log(`   Deleting test agent (ID: ${createdAgentId})...`);
      const { error } = await supabase.from('agents').delete().eq('id', createdAgentId);
      if (error) console.error('   ❌ Agent cleanup error:', error.message);
    }

    console.log('\n🏁 Cleanup completed.\n');
  }
}

runPhase5Tests();
