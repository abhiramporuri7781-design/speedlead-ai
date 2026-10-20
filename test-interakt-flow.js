// Set PORT to 0 to bind to a random free port and prevent EADDRINUSE conflicts with the running server
process.env.PORT = '0';
process.env.INTERAKT_API_KEY = process.env.INTERAKT_API_KEY || 'test_interakt_key';

import './guard-dev-db.js';
import { supabase } from './db.js';
import { processIncomingWebhook, processedMessageIds } from './server.js';

let whatsAppMessagesSent = [];

// Intercept global fetch to mock Interakt API and capture sent messages
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
  if (url.includes('api.interakt.ai')) {
    const body = JSON.parse(options.body);
    whatsAppMessagesSent.push({
      to: body.phoneNumber,
      message: body.data?.message || body.template?.name
    });

    return {
      ok: true,
      json: async () => ({
        result: true,
        id: `interakt_mock_${Math.random().toString(36).substring(7)}`
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

let testApiNumber = '917842096308';

// Helper to construct simulated Interakt webhook payload
function createInteraktWebhookPayload(phone, messageText, messageId) {
  return {
    type: 'message_received',
    data: {
      customer: {
        channel_phone_number: phone,
        traits: { name: 'Interakt Test User' }
      },
      message: {
        id: messageId,
        chat_message_type: 'CustomerMessage',
        message_content_type: 'Text',
        message: messageText
      },
      whatsapp_api_number: testApiNumber
    }
  };
}

async function runInteraktFlowTests() {
  console.log('🧪 Starting Interakt Conversational Flow Verification Tests...\n');

  let business = null;
  let testSuccess = false;
  const createdLeadIds = [];
  const createdTourIds = [];
  let createdAgentId = null;

  try {
    const { data: businesses } = await supabase.from('businesses').select('*').limit(1);
    if (!businesses || businesses.length === 0) {
      throw new Error('No business found in the database.');
    }
    business = businesses[0];
    testApiNumber = business.whatsapp_phone_id;
    console.log(`🏢 Test Business: "${business.name}" (ID: ${business.id}, API Number: ${testApiNumber})`);

    // Clean up existing tours, leads, agents for clean state
    await supabase.from('site_tours').delete().eq('business_id', business.id);
    await supabase.from('leads').delete().eq('business_id', business.id);
    await supabase.from('agents').delete().eq('business_id', business.id);

    const { data: agent, error: agentErr } = await supabase
      .from('agents')
      .insert([{
        business_id: business.id,
        name: 'Interakt Test Agent',
        notify_channel: 'WHATSAPP',
        notify_target: '919000000000'
      }])
      .select()
      .single();

    if (agentErr) throw new Error(`Agent creation failed: ${agentErr.message}`);
    createdAgentId = agent.id;

    // -------------------------------------------------------------
    // Test 1: New Lead via Interakt webhook
    // -------------------------------------------------------------
    console.log('Test 1 — New lead via Interakt: Sending message from new phone...');
    const phone1 = '919111111111';
    const msgId1 = `interakt_t1_${Date.now()}`;
    whatsAppMessagesSent = [];

    const payload1 = createInteraktWebhookPayload(phone1, 'Hi, I want to explore apartments in Hyderabad', msgId1);
    await processIncomingWebhook(payload1, 'interakt');

    const { data: lead1 } = await supabase.from('leads').select('*').eq('phone', phone1).single();
    if (!lead1) throw new Error('Test 1 Failed: Lead was not created in the database.');
    createdLeadIds.push(lead1.id);
    console.log(`✅ Created lead ID: ${lead1.id}`);

    // Verify sent reply via Interakt
    const reply1 = whatsAppMessagesSent.find(r => r.to === phone1.replace(/^91/, ''));
    if (!reply1) throw new Error('Test 1 Failed: No WhatsApp reply sent via Interakt');
    console.log('✅ Received appropriate response via Interakt.');
    console.log('-------------------------------------------------------------\n');

    // -------------------------------------------------------------
    // Test 2: Duplicate message protection via Interakt
    // -------------------------------------------------------------
    console.log('Test 2 — Deduplication via Interakt: Resending same message ID...');
    whatsAppMessagesSent = [];
    await processIncomingWebhook(payload1, 'interakt');

    if (whatsAppMessagesSent.length > 0) {
      throw new Error('Test 2 Failed: Duplicate webhook was processed and sent reply!');
    }
    console.log('✅ Duplicate message ID safely ignored.');
    console.log('-------------------------------------------------------------\n');

    // -------------------------------------------------------------
    // Test 3: Qualification flow
    // -------------------------------------------------------------
    console.log('Test 3 — Qualification via Interakt: Sending property specs and budget...');
    const phone3 = '919111111113';
    const msgId3 = `interakt_t3_${Date.now()}`;
    whatsAppMessagesSent = [];

    const { data: lead3 } = await supabase
      .from('leads')
      .insert([{ business_id: business.id, phone: phone3, name: 'Lead 3', conversation_state: 'NEW' }])
      .select()
      .single();
    createdLeadIds.push(lead3.id);

    const payload3 = createInteraktWebhookPayload(phone3, 'Looking for 3BHK villa with 1.5 crore budget', msgId3);
    await processIncomingWebhook(payload3, 'interakt');

    const { data: lead3Updated } = await supabase.from('leads').select('*').eq('id', lead3.id).single();
    if (!lead3Updated.property_type || lead3Updated.budget !== '15000000') {
      throw new Error(`Test 3 Failed: Extraction failed: type=${lead3Updated.property_type}, budget=${lead3Updated.budget}`);
    }
    console.log(`✅ Qualified lead: ${lead3Updated.property_type}, budget: ${lead3Updated.budget}`);
    console.log('-------------------------------------------------------------\n');

    testSuccess = true;
    console.log('🎉 All Interakt flow tests passed!\n');

  } finally {
    // Cleanup
    if (createdLeadIds.length > 0) {
      await supabase.from('leads').delete().in('id', createdLeadIds);
    }
    if (createdAgentId) {
      await supabase.from('agents').delete().eq('id', createdAgentId);
    }
    global.fetch = originalFetch;
    process.exit(testSuccess ? 0 : 1);
  }
}

runInteraktFlowTests().catch((err) => {
  console.error('Fatal Interakt test error:', err);
  process.exit(1);
});
