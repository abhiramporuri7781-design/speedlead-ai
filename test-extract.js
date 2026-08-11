import { extractLeadInfo } from './extract.js';

// Define the 3 sample messages to test extraction
const testMessages = [
  "Hi I'm looking for a 3BHK around 80L, can I visit this weekend?",
  "just checking prices",
  "cancel my visit please"
];

/**
 * Runs the extraction tests sequentially and logs output.
 */
async function runTests() {
  console.log('🚀 Starting OpenAI structured extraction tests...\n');

  for (let i = 0; i < testMessages.length; i++) {
    const message = testMessages[i];
    console.log(`--- Test Case ${i + 1} ---`);
    console.log(`Input Message: "${message}"`);
    console.log('Extracting...');

    try {
      const result = await extractLeadInfo(message);
      console.log('Result JSON:');
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('Extraction failed for this test case:', error.message || error);
    }
    console.log('\n');
  }

  console.log('✅ Extraction tests complete.');
}

// Execute the tests
runTests();
