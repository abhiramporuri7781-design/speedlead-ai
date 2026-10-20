import crypto from 'node:crypto';

/**
 * Verifies the X-Hub-Signature-256 header on a Meta webhook request.
 *
 * @param {string|Buffer} rawBody         The raw request body (before JSON parsing).
 * @param {string}        signatureHeader The value of the X-Hub-Signature-256 header.
 * @param {string}        appSecret       The Meta App Secret.
 * @returns {boolean}
 */
export function verifyMetaSignature(rawBody, signatureHeader, appSecret) {
  if (!appSecret || !signatureHeader) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const expectedHeader = `sha256=${expectedSignature}`;

  if (typeof signatureHeader !== 'string' || signatureHeader.length !== expectedHeader.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expectedHeader));
}

/**
 * Normalizes a Meta Cloud API webhook payload into a standard message object.
 *
 * Returns null if the event should be ignored (status update, non-message
 * field change, missing phone, etc.).
 *
 * Returned shape matches the Interakt normalizer:
 * {
 *   provider:           'meta',
 *   fromPhone:          string,
 *   senderName:         string,
 *   messageContentType: string,       // 'Text', 'Image', 'Audio', etc.
 *   messageBody:        string|null,
 *   messageId:          string|null,   // wamid.xxx
 *   phoneNumberId:      string         // matches businesses.whatsapp_phone_id
 * }
 */
export function normalizeMetaPayload(body) {
  if (body.object !== 'whatsapp_business_account') {
    console.log(`ℹ️ Ignoring Meta webhook: object is "${body.object}".`);
    return null;
  }

  const entry = body.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;

  if (!value || change?.field !== 'messages') {
    console.log('ℹ️ Ignoring Meta webhook: not a messages field change.');
    return null;
  }

  // Status updates have statuses[] but no messages[].
  const message = value.messages?.[0];

  if (!message) {
    console.log('ℹ️ Ignoring Meta webhook: no messages array (likely a status update).');
    return null;
  }

  const fromPhone = message.from;

  if (!fromPhone) {
    console.error('❌ Meta webhook payload missing message.from.');
    return null;
  }

  const phoneNumberId = value.metadata?.phone_number_id;

  if (!phoneNumberId) {
    console.error('❌ Meta webhook payload missing metadata.phone_number_id.');
    return null;
  }

  const contact = value.contacts?.[0];

  // Map Meta's message type string to the content type labels
  // used by the existing conversation engine.
  const messageType = message.type || 'text';
  const contentTypeMap = {
    text: 'Text',
    image: 'Image',
    video: 'Video',
    audio: 'Audio',
    document: 'Document',
    sticker: 'Sticker',
    reaction: 'Reaction',
    location: 'Location',
    contacts: 'Contacts'
  };

  return {
    provider: 'meta',
    fromPhone,
    senderName: contact?.profile?.name || 'Unknown Contact',
    messageContentType: contentTypeMap[messageType] || messageType,
    messageBody: message.text?.body?.trim() || null,
    messageId: message.id || null,
    phoneNumberId
  };
}
