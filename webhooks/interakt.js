/**
 * Normalizes an Interakt webhook payload into a standard message object.
 *
 * Returns null if the event should be ignored (non-customer message,
 * status update, missing phone, etc.).
 *
 * Returned shape:
 * {
 *   provider:           'interakt',
 *   fromPhone:          string,      // e.g. '919876543210'
 *   senderName:         string,
 *   messageContentType: string,      // 'Text', 'Image', 'Audio', etc.
 *   messageBody:        string|null, // trimmed text body, null for non-text
 *   messageId:          string|null, // Interakt's message id for dedup
 *   phoneNumberId:      string       // matches businesses.whatsapp_phone_id
 * }
 */
export function normalizeInteraktPayload(body) {
  // Only process incoming customer messages.
  if (body.type !== 'message_received') {
    console.log(`ℹ️ Ignoring Interakt webhook event type: ${body.type}`);
    return null;
  }

  // Ignore echo of our own outgoing messages.
  if (body.data?.message?.chat_message_type !== 'CustomerMessage') {
    console.log(
      `ℹ️ Ignoring non-customer Interakt message (type: ${body.data?.message?.chat_message_type}).`
    );
    return null;
  }

  const fromPhone = body.data?.customer?.channel_phone_number;

  if (!fromPhone) {
    console.error('❌ Interakt webhook payload missing customer phone number.');
    return null;
  }

  const phoneNumberId = body.data?.whatsapp_api_number;

  if (!phoneNumberId) {
    console.error(
      '❌ Interakt webhook payload missing whatsapp_api_number. Cannot identify business.'
    );
    return null;
  }

  return {
    provider: 'interakt',
    fromPhone,
    senderName: body.data?.customer?.traits?.name || 'Unknown Contact',
    messageContentType: body.data?.message?.message_content_type || 'Text',
    messageBody: body.data?.message?.message?.trim() || null,
    messageId: body.data?.message?.id || null,
    phoneNumberId
  };
}
