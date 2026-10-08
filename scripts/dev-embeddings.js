import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

// DEV ONLY. Creates search embeddings for properties that have none,
// in the database named in .env.dev (SUPABASE_URL / SUPABASE_SECRET_KEY).
// OPENAI_API_KEY is read from .env (this does not override .env.dev values).
//
// Usage:
//   node scripts/dev-embeddings.js         (shows which database it will use)
//   node scripts/dev-embeddings.js --yes   (actually creates the embeddings)

dotenv.config({ path: '.env.dev' });
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SECRET_KEY || '';

let host;

try {
  host = new URL(supabaseUrl).host;
} catch {
  console.error('SUPABASE_URL in .env.dev is missing or is not a valid web address.');
  process.exit(1);
}

if (!host.endsWith('.supabase.co')) {
  console.error(`SUPABASE_URL points to "${host}". It must be a Supabase address ending in .supabase.co`);
  process.exit(1);
}

if (!supabaseKey) {
  console.error('SUPABASE_SECRET_KEY in .env.dev is missing.');
  process.exit(1);
}

console.log(`Database: ${host}`);

if (!process.argv.includes('--yes')) {
  console.log('Check that this is your DEV project, then run again with --yes');
  process.exit(0);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
  const { data: properties, error } = await supabase
    .from('properties')
    .select('*')
    .is('embedding', null);

  if (error) {
    console.error('Failed to fetch properties:', error.message);
    process.exit(1);
  }

  if (!properties || properties.length === 0) {
    console.log('No properties need embeddings.');
    return;
  }

  console.log(`Found ${properties.length} properties without embeddings.`);

  for (const property of properties) {
    // Same text format as generate-embeddings.js, so search results match.
    const text = `
Title: ${property.title || ''}
Description: ${property.description || ''}
Property Type: ${property.property_type || ''}
Price: ${property.price || ''}
Location: ${property.location || ''}
BHK: ${property.bhk || ''}
Possession Status: ${property.possession_status || ''}
`.trim();

    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text
      });

      const { error: updateError } = await supabase
        .from('properties')
        .update({ embedding: response.data[0].embedding })
        .eq('id', property.id);

      if (updateError) {
        console.error(`Failed to save embedding for ${property.title}:`, updateError.message);
        continue;
      }

      console.log(`Saved embedding for: ${property.title}`);
    } catch (err) {
      console.error(`Error for ${property.title}:`, err.message);
    }
  }

  console.log('Done.');
}

main();
