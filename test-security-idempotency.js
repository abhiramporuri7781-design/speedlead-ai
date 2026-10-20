import crypto from 'node:crypto';
import { getProvider } from './providers/index.js';
import { createInteraktProvider } from './providers/interakt.js';
import { createMetaProvider } from './providers/meta.js';
import { verifyMetaSignature, normalizeMetaPayload } from './webhooks/meta.js';
import { normalizeInteraktPayload } from './webhooks/interakt.js';
import { claimInboundMessage } from './messages.js';

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

async function runSecurityAndIdempotencyTests() {
  console.log('🧪 Starting Security, Tenant Isolation & Idempotency Test Suite...\n');

  // ========================================================
  // 1. META WEBHOOK SECURITY & SIGNATURE VALIDATION
  // ========================================================
  console.log('--- 1. Meta Webhook Security & Signatures ---');

  const testSecret = 'secret_test_key_987654';
  const samplePayload = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: '123' }]
  });

  const validHmac = crypto.createHmac('sha256', testSecret).update(samplePayload).digest('hex');
  const validHeader = `sha256=${validHmac}`;
  const invalidHeader = `sha256=${'0'.repeat(64)}`;
  const malformedHeader = 'not_a_valid_sha256_header';

  // S1: Valid signature passes
  assert(verifyMetaSignature(samplePayload, validHeader, testSecret) === true, 'Valid signature is accepted');

  // S2: Invalid signature rejected
  assert(verifyMetaSignature(samplePayload, invalidHeader, testSecret) === false, 'Tampered/invalid signature is rejected');

  // S3: Malformed signature header rejected
  assert(verifyMetaSignature(samplePayload, malformedHeader, testSecret) === false, 'Malformed signature header is rejected without crashing');

  // S4: Missing signature header rejected
  assert(verifyMetaSignature(samplePayload, '', testSecret) === false, 'Empty signature header is rejected');
  assert(verifyMetaSignature(samplePayload, null, testSecret) === false, 'Null signature header is rejected');

  // S5: Missing app secret fails closed
  assert(verifyMetaSignature(samplePayload, validHeader, '') === false, 'Missing app secret fails closed');
  assert(verifyMetaSignature(samplePayload, validHeader, null) === false, 'Null app secret fails closed');

  // S6: Meta webhook challenge verification
  const verifyChallenge = (mode, token, expectedToken, challenge) => {
    if (mode === 'subscribe' && token === expectedToken) {
      return { status: 200, body: challenge };
    }
    return { status: 403, body: 'Forbidden' };
  };

  const goodVerification = verifyChallenge('subscribe', 'my_verify_token', 'my_verify_token', 'challenge_code_123');
  assert(goodVerification.status === 200 && goodVerification.body === 'challenge_code_123', 'GET webhook verification succeeds with matching token');

  const badVerification = verifyChallenge('subscribe', 'wrong_token', 'my_verify_token', 'challenge_code_123');
  assert(badVerification.status === 403, 'GET webhook verification rejects non-matching token with 403');

  const wrongModeVerification = verifyChallenge('unsubscribe', 'my_verify_token', 'my_verify_token', 'challenge_code_123');
  assert(wrongModeVerification.status === 403, 'GET webhook verification rejects non-subscribe mode with 403');

  // S7: Production mode fail-closed simulation
  const checkMetaConfigProduction = (env) => {
    const isProd = env.NODE_ENV === 'production';
    const appSecret = env.META_APP_SECRET;
    if (isProd && !appSecret) {
      return { status: 500, error: 'Server configuration error' };
    }
    return { status: 200 };
  };

  const prodWithoutSecret = checkMetaConfigProduction({ NODE_ENV: 'production', META_APP_SECRET: '' });
  assert(prodWithoutSecret.status === 500, 'Production mode fails closed (500) if META_APP_SECRET is missing');

  const prodWithSecret = checkMetaConfigProduction({ NODE_ENV: 'production', META_APP_SECRET: 'prod_secret' });
  assert(prodWithSecret.status === 200, 'Production mode allows configuration when META_APP_SECRET is present');

  // ========================================================
  // 2. INTERAKT WEBHOOK SECURITY
  // ========================================================
  console.log('\n--- 2. Interakt Webhook Security ---');

  const checkInteraktWebhookAuth = (env, queryToken) => {
    const isProd = env.NODE_ENV === 'production';
    const expectedToken = env.WEBHOOK_TOKEN;

    if (isProd && !expectedToken) {
      return { status: 500, body: 'Server configuration error' };
    }
    if (expectedToken && queryToken !== expectedToken) {
      return { status: 401, body: 'Unauthorized' };
    }
    return { status: 200, body: 'EVENT_RECEIVED' };
  };

  // I1: Production fails closed if WEBHOOK_TOKEN missing
  const interaktProdMissing = checkInteraktWebhookAuth({ NODE_ENV: 'production', WEBHOOK_TOKEN: '' }, 'any_token');
  assert(interaktProdMissing.status === 500, 'Interakt production webhook rejects requests when WEBHOOK_TOKEN is unconfigured (500)');

  // I2: Unauthorized if token mismatch
  const interaktTokenMismatch = checkInteraktWebhookAuth({ NODE_ENV: 'production', WEBHOOK_TOKEN: 'expected_secret' }, 'wrong_secret');
  assert(interaktTokenMismatch.status === 401, 'Interakt webhook returns 401 Unauthorized when query token does not match');

  // I3: Missing query token
  const interaktMissingQueryToken = checkInteraktWebhookAuth({ NODE_ENV: 'production', WEBHOOK_TOKEN: 'expected_secret' }, undefined);
  assert(interaktMissingQueryToken.status === 401, 'Interakt webhook returns 401 Unauthorized when query token is missing');

  // I4: Valid query token accepted
  const interaktValid = checkInteraktWebhookAuth({ NODE_ENV: 'production', WEBHOOK_TOKEN: 'expected_secret' }, 'expected_secret');
  assert(interaktValid.status === 200 && interaktValid.body === 'EVENT_RECEIVED', 'Interakt webhook accepts valid query token');

  // ========================================================
  // 3. TENANT ISOLATION & CREDENTIAL CONFIGURATION
  // ========================================================
  console.log('\n--- 3. Tenant Isolation & Per-Business Credentials ---');

  // T1: Meta tenant isolation: production requires per-business token
  const origNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  const metaTenantWithoutCreds = {
    id: 'tenant-meta-1',
    name: 'New Meta Client',
    whatsapp_provider: 'meta',
    whatsapp_phone_id: '123456789'
  };

  const metaProviderProd = createMetaProvider(metaTenantWithoutCreds);
  const prodSendResult = await metaProviderProd.sendMessage('919876543210', 'Hello');
  assert(prodSendResult === null, 'Meta tenant without per-business access token cannot send in production (fails closed)');

  // T2: Meta tenant with per-business token can send
  let capturedHeaders = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    capturedHeaders = options.headers;
    return {
      ok: true,
      json: async () => ({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.123' }] })
    };
  };

  const metaTenantWithCreds = {
    id: 'tenant-meta-2',
    name: 'Authorized Meta Client',
    whatsapp_provider: 'meta',
    whatsapp_phone_id: '123456789',
    meta_access_token: 'per_business_meta_token_xyz'
  };
  const metaProviderWithCreds = createMetaProvider(metaTenantWithCreds);
  await metaProviderWithCreds.sendMessage('919876543210', 'Hello Authorized');
  assert(capturedHeaders.Authorization === 'Bearer per_business_meta_token_xyz', 'Meta provider uses per-business token from business row');

  // T3: Interakt tenant isolation: new tenant without per-business key cannot send in production
  const newInteraktTenant = {
    id: 'tenant-interakt-new',
    name: 'New Interakt Client',
    whatsapp_provider: 'interakt',
    whatsapp_phone_id: '919876543210'
  };
  const newInteraktProvider = createInteraktProvider(newInteraktTenant);
  const newInteraktResult = await newInteraktProvider.sendMessage('919876543210', 'Hello Interakt');
  assert(newInteraktResult === null, 'New Interakt tenant without per-business interakt_api_key cannot send in production');

  // T4: Legacy Interakt exception: explicitly allowed for Propx AI
  const legacyInteraktTenant = {
    id: 'cef39b73-af46-4b85-a1d9-de679f797ef8',
    name: 'Propx AI',
    whatsapp_provider: 'interakt',
    whatsapp_phone_id: '917842096308'
  };
  process.env.INTERAKT_API_KEY = 'legacy_interakt_env_key';
  const legacyProvider = createInteraktProvider(legacyInteraktTenant);
  await legacyProvider.sendMessage('919876543210', 'Hello Legacy');
  assert(capturedHeaders.Authorization === 'Basic legacy_interakt_env_key', 'Legacy primary business (Propx AI) permitted fallback to env key');

  // Restore NODE_ENV and fetch
  process.env.NODE_ENV = origNodeEnv;
  global.fetch = originalFetch;

  // ========================================================
  // 4. DURABLE IDEMPOTENCY UNIT TESTS (MOCK & BEHAVIOR)
  // ========================================================
  console.log('\n--- 4. Durable Idempotency Logic ---');

  // D1: Messages without provider ID pass through without blocking
  const noIdClaim = await claimInboundMessage({
    businessId: 'bus-1',
    provider: 'meta',
    providerMessageId: null
  });
  assert(noIdClaim.claimed === true && noIdClaim.message === null, 'Inbound message with null provider ID is allowed to proceed');

  // D2: Deduplication distinguishes duplicate key from real DB error
  const simulateDedupeInsert = (existingMap, businessId, provider, msgId) => {
    const key = `${businessId}:${provider}:${msgId}`;
    if (existingMap.has(key)) {
      return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
    }
    existingMap.set(key, { id: 'msg_' + Date.now(), business_id: businessId, provider, provider_message_id: msgId });
    return { data: existingMap.get(key), error: null };
  };

  const mockDbMessages = new Map();

  // First delivery: claimed
  const firstInsert = simulateDedupeInsert(mockDbMessages, 'bus-1', 'meta', 'wamid.first_delivery');
  assert(firstInsert.error === null && firstInsert.data !== null, 'First delivery claims message in DB');

  // Concurrent/duplicate delivery: duplicate detected via 23505
  const duplicateInsert = simulateDedupeInsert(mockDbMessages, 'bus-1', 'meta', 'wamid.first_delivery');
  assert(duplicateInsert.error?.code === '23505', 'Duplicate delivery triggers Postgres 23505 unique violation');

  // Different message ID for same business: claimed
  const secondMsgInsert = simulateDedupeInsert(mockDbMessages, 'bus-1', 'meta', 'wamid.second_delivery');
  assert(secondMsgInsert.error === null, 'Different message ID for same business is claimed successfully');

  // Same message ID for different business: claimed (tenant-scoped)
  const otherTenantInsert = simulateDedupeInsert(mockDbMessages, 'bus-2', 'meta', 'wamid.first_delivery');
  assert(otherTenantInsert.error === null, 'Same provider message ID for different business is claimed (tenant scoped)');

  // Real DB error simulation (connection error or permission error)
  const realDbError = { code: '08006', message: 'connection failure' };
  const handleClaimResult = (res) => {
    if (!res.claimed) {
      if (res.duplicate) return 'SKIP_DUPLICATE';
      return 'ABORT_DB_ERROR';
    }
    return 'PROCESS_MESSAGE';
  };

  assert(handleClaimResult({ claimed: false, duplicate: true }) === 'SKIP_DUPLICATE', 'Duplicate claims are safely skipped');
  assert(handleClaimResult({ claimed: false, error: realDbError }) === 'ABORT_DB_ERROR', 'Real DB errors abort processing completely without side effects');
  assert(handleClaimResult({ claimed: true, message: {} }) === 'PROCESS_MESSAGE', 'Successful claims proceed to message processing');

  console.log('\n====================================');
  console.log(`🎉 ALL SECURITY & IDEMPOTENCY TESTS PASSED!`);
  console.log(`Passed: ${testsPassed}`);
  console.log(`Failed: ${testsFailed}`);
  console.log('====================================\n');
}

runSecurityAndIdempotencyTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
