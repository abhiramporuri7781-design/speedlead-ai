import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// REPLAY TOOL (DEV ONLY). Sends fake Interakt webhooks to the DEV server and
// prints the bot's replies, read from the DEV database.
// Usage: node scripts/replay.js say "hi"
//        node scripts/replay.js run scripts/conversation.json [--out scripts/out/baseline.txt]
//        node scripts/replay.js reset
// Settings come from .env.dev (never commit that file).

dotenv.config({ path: '.env.dev' });

const BASE_URL = (process.env.DEV_URL || '').replace(/\/$/, '');
const TOKEN = process.env.WEBHOOK_TOKEN || '';
const BUSINESS_NUMBER = process.env.DEV_BUSINESS_NUMBER;
const TEST_PHONE = process.env.DEV_TEST_PHONE || '919000000001';

const PRODUCTION_HOST = 'speedlead-ai.onrender.com';

if (
  !BASE_URL ||
  !BUSINESS_NUMBER ||
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SECRET_KEY
) {
  console.error(
    'Missing settings. .env.dev needs DEV_URL, DEV_BUSINESS_NUMBER, SUPABASE_URL and SUPABASE_SECRET_KEY.'
  );
  process.exit(1);
}

if (new URL(BASE_URL).host === PRODUCTION_HOST) {
  console.error('Refusing to run against the PRODUCTION server. Use the dev URL.');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getLead() {
  const { data } = await supabase
    .from('leads')
    .select('id')
    .eq('phone', TEST_PHONE)
    .limit(1)
    .maybeSingle();

  return data;
}

async function getOutgoing(leadId) {
  const { data } = await supabase
    .from('messages')
    .select('id, body, sender')
    .eq('lead_id', leadId)
    .eq('direction', 'out')
    .order('created_at');

  return data || [];
}

async function resetLead() {
  const lead = await getLead();

  if (!lead) {
    return;
  }

  await supabase.from('site_tours').delete().eq('lead_id', lead.id);
  await supabase.from('leads').delete().eq('id', lead.id);
}

async function resumeBot() {
  await supabase.from('leads').update({ human: false }).eq('phone', TEST_PHONE);
}

async function sendText(text) {
  const payload = {
    type: 'message_received',
    data: {
      customer: {
        channel_phone_number: TEST_PHONE,
        traits: { name: 'Replay Tester' }
      },
      message: {
        id: `replay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message_content_type: 'Text',
        message: text,
        chat_message_type: 'CustomerMessage'
      },
      whatsapp_api_number: BUSINESS_NUMBER
    }
  };

  const url = `${BASE_URL}/webhook${TOKEN ? `?token=${TOKEN}` : ''}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`Webhook returned ${response.status}`);
  }
}

// Sends one message and returns the bot's new replies (waits up to 15 seconds).
async function say(text) {
  const beforeLead = await getLead();
  const knownIds = new Set(
    beforeLead ? (await getOutgoing(beforeLead.id)).map((m) => m.id) : []
  );

  await sendText(text);

  const deadline = Date.now() + 15000;

  while (Date.now() < deadline) {
    await sleep(1000);

    const lead = await getLead();

    if (!lead) {
      continue;
    }

    const fresh = (await getOutgoing(lead.id)).filter((m) => !knownIds.has(m.id));

    if (fresh.length > 0) {
      await sleep(1500); // allow a possible second message
      return (await getOutgoing(lead.id)).filter((m) => !knownIds.has(m.id));
    }
  }

  return [];
}

function format(text, replies) {
  const lines = [`> ${text}`];

  if (replies.length === 0) {
    lines.push('< (no reply)');
  }

  for (const reply of replies) {
    const body = String(reply.body || '').replace(/\n/g, '\n  ');
    lines.push(`< [${reply.sender}] ${body}`);
  }

  return lines.join('\n');
}

async function main() {
  const [command, arg, ...rest] = process.argv.slice(2);
  const outIndex = rest.indexOf('--out');
  const outFile = outIndex >= 0 ? rest[outIndex + 1] : null;

  if (command === 'reset') {
    await resetLead();
    console.log('Test lead removed.');
    return;
  }

  if (command === 'say') {
    const replies = await say(arg);
    console.log(format(arg, replies));
    return;
  }

  if (command === 'run') {
    const messages = JSON.parse(fs.readFileSync(arg, 'utf-8'));
    const output = [];

    for (const text of messages) {
      let block;

      if (text === '__RESET__') {
        await resetLead();
        block = '--- reset test lead ---';
      } else if (text === '__RESUME__') {
        await resumeBot();
        block = '--- bot resumed ---';
      } else {
        block = format(text, await say(text));
      }

      console.log(block + '\n');
      output.push(block);
    }

    if (outFile) {
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, output.join('\n\n') + '\n');
      console.log(`Saved transcript to ${outFile}`);
    }

    return;
  }

  console.log('Usage: node scripts/replay.js say "hi" | run <file.json> [--out <file>] | reset');
}

main().catch((error) => {
  console.error('Replay failed:', error.message);
  process.exit(1);
});
