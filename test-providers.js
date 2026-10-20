import { getProvider } from './providers/index.js';
import { createInteraktProvider } from './providers/interakt.js';
import { createMetaProvider } from './providers/meta.js';
import { normalizeInteraktPayload } from './webhooks/interakt.js';
import { normalizeMetaPayload, verifyMetaSignature } from './webhooks/meta.js';
import { sendWhatsAppMessage, sendTemplateMessage } from './whatsapp.js';
import { messageContext } from './messages.js';
import { processedMessageIds, processIncomingWebhook } from './server.js';
import crypto from 'node:crypto';

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    testsFailed++;
    throw new Error(message);
  }
  console.log(`✅ PASSED: ${message}`);
  testsPassed++;
}

async function runAllTests() {
  console.log('🧪 Starting WhatsApp Provider & Webhook Unit Test Suite...\n');

  // ========================================================
  // GROUP 1: Provider Factory (getProvider)
  // ========================================================
  console.log('--- Group 1: Provider Factory ---');

  // U1: Returns Interakt provider when configured
  const interaktBus = { id: 'bus-1', name: 'Interakt Co', whatsapp_provider: 'interakt', whatsapp_phone_id: '919876543210' };
  const pInterakt = getProvider(interaktBus);
  assert(pInterakt.name === 'interakt', 'Factory returns Interakt provider when whatsapp_provider is "interakt"');

  // U2: Returns Meta provider when configured
  const metaBus = { id: 'bus-2', name: 'Meta Co', whatsapp_provider: 'meta', whatsapp_phone_id: '123456789012345' };
  const pMeta = getProvider(metaBus);
  assert(pMeta.name === 'meta', 'Factory returns Meta provider when whatsapp_provider is "meta"');

  // U3: Defaults to Interakt for backward compatibility when whatsapp_provider is absent
  const legacyBus = { id: 'bus-3', name: 'Legacy Co', whatsapp_phone_id: '919876543210' };
  const pLegacy = getProvider(legacyBus);
  assert(pLegacy.name === 'interakt', 'Factory defaults to Interakt when whatsapp_provider column is absent');

  // U4: Never silently falls back on unknown provider
  let unknownThrew = false;
  try {
    getProvider({ id: 'bus-4', name: 'Unknown Co', whatsapp_provider: 'twilio' });
  } catch (err) {
    unknownThrew = true;
    assert(err.message.includes('Unknown WhatsApp provider "twilio"'), 'Unknown provider throws descriptive error');
  }
  assert(unknownThrew, 'Unknown provider does not silently fall back');

  // U5: Meta provider throws if whatsapp_phone_id is missing
  let metaMissingPhoneThrew = false;
  try {
    createMetaProvider({ id: 'bus-5', name: 'NoPhone Co' });
  } catch (err) {
    metaMissingPhoneThrew = true;
    assert(err.message.includes('has no whatsapp_phone_id'), 'Meta provider requires whatsapp_phone_id');
  }
  assert(metaMissingPhoneThrew, 'Meta provider rejects business without whatsapp_phone_id');

  // ========================================================
  // GROUP 2: Webhook Normalizers
  // ========================================================
  console.log('\n--- Group 2: Webhook Normalizers ---');

  // N1: Interakt customer message normalized correctly
  const interaktPayload = {
    type: 'message_received',
    data: {
      customer: {
        channel_phone_number: '919876543210',
        traits: { name: 'Alice Interakt' }
      },
      message: {
        id: 'msg_interakt_001',
        chat_message_type: 'CustomerMessage',
        message_content_type: 'Text',
        message: 'Hello, looking for a villa'
      },
      whatsapp_api_number: '917842096308'
    }
  };
  const normInterakt = normalizeInteraktPayload(interaktPayload);
  assert(normInterakt !== null, 'Interakt payload returns normalized object');
  assert(normInterakt.provider === 'interakt', 'Interakt normalizer sets provider="interakt"');
  assert(normInterakt.fromPhone === '919876543210', 'Interakt normalizer extracts customer phone');
  assert(normInterakt.senderName === 'Alice Interakt', 'Interakt normalizer extracts customer name');
  assert(normInterakt.messageBody === 'Hello, looking for a villa', 'Interakt normalizer trims message body');
  assert(normInterakt.messageId === 'msg_interakt_001', 'Interakt normalizer extracts message ID');
  assert(normInterakt.phoneNumberId === '917842096308', 'Interakt normalizer extracts whatsapp_api_number');

  // N2: Interakt echo / agent messages ignored
  const interaktEcho = {
    type: 'message_received',
    data: {
      customer: { channel_phone_number: '919876543210' },
      message: { chat_message_type: 'AgentMessage', message: 'Our reply' },
      whatsapp_api_number: '917842096308'
    }
  };
  assert(normalizeInteraktPayload(interaktEcho) === null, 'Interakt normalizer ignores AgentMessage (echoes)');

  // N3: Interakt non-message events ignored
  const interaktStatus = { type: 'message_status_update', data: {} };
  assert(normalizeInteraktPayload(interaktStatus) === null, 'Interakt normalizer ignores status update events');

  // N4: Meta customer message normalized correctly
  const metaPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba_123',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '16505553333',
                phone_number_id: '1316920368168121'
              },
              contacts: [{ profile: { name: 'Bob Meta' }, wa_id: '919812345678' }],
              messages: [
                {
                  from: '919812345678',
                  id: 'wamid.HBgLOTE5OD',
                  timestamp: '1720000000',
                  text: { body: 'Schedule a visit please  ' },
                  type: 'text'
                }
              ]
            }
          }
        ]
      }
    ]
  };
  const normMeta = normalizeMetaPayload(metaPayload);
  assert(normMeta !== null, 'Meta payload returns normalized object');
  assert(normMeta.provider === 'meta', 'Meta normalizer sets provider="meta"');
  assert(normMeta.fromPhone === '919812345678', 'Meta normalizer extracts sender phone');
  assert(normMeta.senderName === 'Bob Meta', 'Meta normalizer extracts contact profile name');
  assert(normMeta.messageBody === 'Schedule a visit please', 'Meta normalizer trims text body');
  assert(normMeta.messageId === 'wamid.HBgLOTE5OD', 'Meta normalizer extracts wamid ID');
  assert(normMeta.phoneNumberId === '1316920368168121', 'Meta normalizer extracts phone_number_id');
  assert(normMeta.messageContentType === 'Text', 'Meta normalizer maps type="text" to "Text"');

  // N5: Meta status update ignored
  const metaStatusPayload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba_123',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: '1316920368168121' },
              statuses: [{ id: 'wamid.HBgLOTE5OD', status: 'delivered' }]
            }
          }
        ]
      }
    ]
  };
  assert(normalizeMetaPayload(metaStatusPayload) === null, 'Meta normalizer ignores status update event');

  // N6: Meta signature verification
  const secret = 'test_meta_app_secret_999';
  const bodyText = JSON.stringify(metaPayload);
  const correctHmac = crypto.createHmac('sha256', secret).update(bodyText).digest('hex');
  const validHeader = `sha256=${correctHmac}`;
  const invalidHeader = 'sha256=badbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadbadb';

  assert(verifyMetaSignature(bodyText, validHeader, secret) === true, 'verifyMetaSignature passes with correct signature');
  assert(verifyMetaSignature(bodyText, invalidHeader, secret) === false, 'verifyMetaSignature fails with invalid signature');
  assert(verifyMetaSignature(bodyText, validHeader, '') === false, 'verifyMetaSignature fails if secret is empty');

  // ========================================================
  // GROUP 3: Sending Layer & Provider Isolation
  // ========================================================
  console.log('\n--- Group 3: Sending Layer & Provider Isolation ---');

  // S1: sendWhatsAppMessage requires business context (never assumes global provider)
  const noContextResult = await sendWhatsAppMessage('919876543210', 'Hello without business');
  assert(noContextResult === null, 'sendWhatsAppMessage safely rejects call without business context');

  // S2: sendTemplateMessage requires business context
  const noContextTpl = await sendTemplateMessage('919876543210', 'lead_welcome_v1', ['Alice']);
  assert(noContextTpl === null, 'sendTemplateMessage safely rejects call without business context');

  // S3: Interakt provider strips leading 91 from phone number
  const originalFetch = global.fetch;
  let interceptedUrl = null;
  let interceptedBody = null;
  let interceptedHeaders = null;

  global.fetch = async (url, options) => {
    interceptedUrl = url;
    interceptedBody = JSON.parse(options.body);
    interceptedHeaders = options.headers;
    return {
      ok: true,
      json: async () => ({ result: true, id: 'mock_interakt_msg_id' })
    };
  };

  process.env.INTERAKT_API_KEY = 'mock_interakt_key';
  const interaktSender = createInteraktProvider(interaktBus);
  await interaktSender.sendMessage('919876543210', 'Test message to Interakt');

  assert(interceptedUrl === 'https://api.interakt.ai/v1/public/message/', 'Interakt provider calls Interakt endpoint');
  assert(interceptedBody.phoneNumber === '9876543210', 'Interakt provider strips leading 91 for local phone format');
  assert(interceptedBody.countryCode === '+91', 'Interakt provider includes +91 countryCode');
  assert(interceptedHeaders.Authorization === 'Basic mock_interakt_key', 'Interakt provider uses Basic auth with API key');

  // S4: Meta provider sends full E.164 phone without stripping
  process.env.META_ACCESS_TOKEN = 'mock_meta_bearer_token';
  const metaSender = createMetaProvider(metaBus);
  await metaSender.sendMessage('919876543210', 'Test message to Meta');

  assert(interceptedUrl === 'https://graph.facebook.com/v21.0/123456789012345/messages', 'Meta provider calls Graph API with phone_number_id');
  assert(interceptedBody.to === '919876543210', 'Meta provider preserves full E.164 phone number without stripping');
  assert(interceptedHeaders.Authorization === 'Bearer mock_meta_bearer_token', 'Meta provider uses Bearer token authorization');
  assert(interceptedBody.messaging_product === 'whatsapp', 'Meta payload includes messaging_product="whatsapp"');

  // S5: Meta provider sendTemplate builds proper components array
  await metaSender.sendTemplate('919876543210', 'lead_welcome_v1', ['Alice', 'Villa']);
  assert(interceptedBody.template.name === 'lead_welcome_v1', 'Meta template payload includes template name');
  assert(interceptedBody.template.components[0].type === 'body', 'Meta template components has type "body"');
  assert(interceptedBody.template.components[0].parameters.length === 2, 'Meta template parameters match body values count');
  assert(interceptedBody.template.components[0].parameters[0].text === 'Alice', 'Meta template parameter text is correct');

  // Restore global fetch
  global.fetch = originalFetch;

  // ========================================================
  // GROUP 4: Deduplication
  // ========================================================
  console.log('\n--- Group 4: Duplicate Webhook Protection ---');

  const testDedupeId = `test_dedupe_${Date.now()}`;
  assert(!processedMessageIds.has(testDedupeId), 'New message ID is not initially in processedMessageIds');
  processedMessageIds.add(testDedupeId);
  assert(processedMessageIds.has(testDedupeId), 'Message ID is successfully registered in processedMessageIds set');

  // ========================================================
  // SUMMARY
  // ========================================================
  console.log('\n====================================');
  console.log(`🎉 ALL UNIT TESTS COMPLETED!`);
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);
  console.log('====================================\n');

  process.exit(0);
}

runAllTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
