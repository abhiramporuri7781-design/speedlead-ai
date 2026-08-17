import { supabase } from './db.js';
import { bookSlot } from './booking.js';

async function runTests() {
  console.log('🏁 Starting Slot Booking Module Verification Tests...\n');

  let testAgent = null;
  let testLead = null;
  let testTour = null;

  try {
    // 1. Fetch an existing business
    console.log('1️⃣ Fetching existing business...');
    const { data: businesses, error: busError } = await supabase
      .from('businesses')
      .select('*')
      .limit(1);

    if (busError || !businesses || businesses.length === 0) {
      throw new Error(`Could not find a test business. Error: ${busError?.message}`);
    }

    const business = businesses[0];
    console.log(`   Found business: "${business.name}" (ID: ${business.id})`);

    // 2. Create a temporary test agent
    console.log('\n2️⃣ Creating temporary test agent...');
    const { data: agentData, error: agentError } = await supabase
      .from('agents')
      .insert([
        {
          business_id: business.id,
          name: 'Verification Test Agent',
          notify_channel: 'WHATSAPP',
          notify_target: '919999999999'
        }
      ])
      .select()
      .single();

    if (agentError) {
      throw new Error(`Failed to create test agent: ${agentError.message}`);
    }

    testAgent = agentData;
    console.log(`   Test agent created: "${testAgent.name}" (ID: ${testAgent.id})`);

    // 3. Create a temporary test lead
    console.log('\n3️⃣ Creating temporary test lead...');
    const { data: leadData, error: leadError } = await supabase
      .from('leads')
      .insert([
        {
          business_id: business.id,
          name: 'Verification Test Lead',
          phone: '918888888888',
          conversation_state: 'NEW'
        }
      ])
      .select()
      .single();

    if (leadError) {
      throw new Error(`Failed to create test lead: ${leadError.message}`);
    }

    testLead = leadData;
    console.log(`   Test lead created: "${testLead.name}" (ID: ${testLead.id})`);

    // Define a slot time
    const slotTimeISO = '2026-09-01T10:00:00.000Z';
    console.log(`\n📅 Slot Time to test: ${slotTimeISO}`);

    // 4. Attempt 1: First booking (Should succeed)
    console.log('\n4️⃣ Attempting FIRST booking for the slot...');
    const attempt1 = await bookSlot({
      businessId: business.id,
      agentId: testAgent.id,
      leadId: testLead.id,
      slotTimeISO
    });

    console.log('   First Attempt Result:', attempt1);
    if (!attempt1.success) {
      throw new Error(`First booking failed unexpectedly: ${JSON.stringify(attempt1)}`);
    }
    testTour = attempt1.tour;
    console.log('   ✅ First booking succeeded as expected.');

    // 5. Attempt 2: Second booking (Should fail due to unique constraint)
    console.log('\n5️⃣ Attempting SECOND booking for the SAME agent and slot...');
    const attempt2 = await bookSlot({
      businessId: business.id,
      agentId: testAgent.id,
      leadId: testLead.id,
      slotTimeISO
    });

    console.log('   Second Attempt Result:', attempt2);
    if (attempt2.success) {
      throw new Error('❌ Test Failed: Second booking succeeded when it should have been blocked!');
    }

    if (attempt2.reason === 'SLOT_TAKEN') {
      console.log('   ✅ Second booking failed with "SLOT_TAKEN" as expected. Unique constraint verification PASSED!');
    } else {
      console.log(`   ❌ Unexpected fail reason: ${attempt2.reason}`);
    }

  } catch (error) {
    console.error('\n❌ Test execution encountered an error:', error);
  } finally {
    // 6. Cleanup
    console.log('\n🧹 Starting cleanup of test records...');

    if (testTour) {
      console.log(`   Deleting test tour booking (ID: ${testTour.id})...`);
      const { error } = await supabase.from('site_tours').delete().eq('id', testTour.id);
      if (error) console.error('   ❌ Failed to delete test tour:', error.message);
    }

    if (testLead) {
      console.log(`   Deleting test lead (ID: ${testLead.id})...`);
      const { error } = await supabase.from('leads').delete().eq('id', testLead.id);
      if (error) console.error('   ❌ Failed to delete test lead:', error.message);
    }

    if (testAgent) {
      console.log(`   Deleting test agent (ID: ${testAgent.id})...`);
      const { error } = await supabase.from('agents').delete().eq('id', testAgent.id);
      if (error) console.error('   ❌ Failed to delete test agent:', error.message);
    }

    console.log('\n🏁 Verification tests and cleanup finished.\n');
  }
}

runTests();
