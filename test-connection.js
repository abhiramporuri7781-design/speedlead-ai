import { supabase } from './db.js';

/**
 * Helper function to test the connection to Supabase
 * by selecting up to 5 rows from the 'businesses' table.
 */
async function testConnection() {
  console.log('🔄 Attempting to connect to Supabase and query "businesses" table...\n');

  try {
    // Perform query on the 'businesses' table
    const { data, error } = await supabase
      .from('businesses')
      .select('*')
      .limit(5);

    // If Supabase returned an error (e.g. invalid credentials, table doesn't exist, network error)
    if (error) {
      console.error('❌ Supabase Query Error:');
      console.error(error.message);
      return;
    }

    // Success response
    console.log('✅ Connection successful!');
    console.log(`Retrieved ${data.length} row(s) from the "businesses" table:\n`);
    console.dir(data, { depth: null, colors: true });

  } catch (err) {
    // Unexpected error handling
    console.error('❌ Unexpected Error encountered:');
    console.error(err);
  }
}

// Run the connection test
testConnection();
