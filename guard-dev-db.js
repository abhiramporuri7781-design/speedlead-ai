// Import this FIRST in any test or script that touches the database.
// It stops the process unless SUPABASE_URL points at the one allowed DEV project.
import dotenv from 'dotenv';

dotenv.config();

if (process.env.NODE_ENV === 'production') {
  console.error('GUARD: refusing to run with NODE_ENV=production. Stopping.');
  process.exit(1);
}

const allowed = (process.env.ALLOWED_SUPABASE_HOST || '').trim().toLowerCase();

let host = '';

try {
  host = new URL(process.env.SUPABASE_URL || '').host.toLowerCase();
} catch {
  console.error('GUARD: SUPABASE_URL is missing or invalid. Stopping.');
  process.exit(1);
}

if (!allowed) {
  console.error('GUARD: ALLOWED_SUPABASE_HOST is not set in .env. Stopping.');
  process.exit(1);
}

if (host !== allowed) {
  console.error(`GUARD: database host "${host}" is not the allowed dev host "${allowed}". Stopping.`);
  process.exit(1);
}

console.log(`GUARD OK: using dev database ${host}`);
