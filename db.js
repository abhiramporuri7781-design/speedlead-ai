import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables from the .env file into process.env
dotenv.config();

// Fetch credentials from process.env
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

// Check if environment variables are set
if (!supabaseUrl || !supabaseSecretKey) {
  console.warn(
    '⚠️ Warning: SUPABASE_URL or SUPABASE_SECRET_KEY is missing in process.env. Please check your .env file.'
  );
}

// Initialize and export the Supabase client instance
export const supabase = createClient(supabaseUrl, supabaseSecretKey);
