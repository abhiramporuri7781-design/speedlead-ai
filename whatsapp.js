import dotenv from 'dotenv';
import { saveOutgoingFromContext } from './messages.js';

dotenv.config();

const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY;
// DEV SAFETY: when WHATSAPP_SEND_MODE=log, nothing is sent to WhatsApp.
// Messages are only printed to the logs (and saved in the messages table).
// Set this on the dev server. NEVER set it on production.
const LOG_ONLY = process.env.WHATSAPP_SEND_MODE === 'log';

/**
 * Sends a text message through Interakt's API.
 */
export async function sendWhatsAppMessage(toPhone, messageText) {
  if (LOG_ONLY) {
    console.log(`🧪 [LOG ONLY] Would send to ${toPhone}: ${messageText}`);
    const fake = { result: true, id: `log-${Date.now()}` };
    saveOutgoingFromContext(messageText, fake);
    return fake;
  }

  if (!INTERAKT_API_KEY) {
    console.error(
      '❌ Interakt Configuration Error: INTERAKT_API_KEY is missing.'
    );
    return null;
  }

  const url = 'https://api.interakt.ai/v1/public/message/';

  const payload = {
    countryCode: '+91',
    phoneNumber: toPhone.replace(/^91/, ''), // strip leading 91 if present
    type: 'Text',
    data: {
      message: messageText
    }
  };

  try {

    console.log(`📤 Sending WhatsApp message via Interakt to ${toPhone}...`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${INTERAKT_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Interakt API error:');
      console.error(JSON.stringify(data, null, 2));
      return null;
    }

    console.log('📨 Full Interakt API response:', JSON.stringify(data, null, 2));
    console.log('✅ WhatsApp message successfully sent via Interakt!');
    saveOutgoingFromContext(messageText, data);

    return data;

  } catch (error) {
    console.error('❌ Network error attempting to send WhatsApp message:', error);
    return null;
  }
}

/**
 * Sends an APPROVED WhatsApp template through Interakt's API.
 * Needed for any message sent outside the 24-hour customer window
 * (first message to a new lead, reminders, reports).
 *
 * @param {string}   toPhone      e.g. 919876543210
 * @param {string}   templateName e.g. 'lead_welcome_v1' (must be approved)
 * @param {string[]} bodyValues   values for {{1}}, {{2}}, ... in order
 * @param {string}   languageCode defaults to 'en'
 */
export async function sendTemplateMessage(
  toPhone,
  templateName,
  bodyValues = [],
  languageCode = 'en'
) {
  if (LOG_ONLY) {
    console.log(`🧪 [LOG ONLY] Would send template "${templateName}" to ${toPhone}:`, bodyValues);
    return { result: true, id: `log-${Date.now()}` };
  }

  if (!INTERAKT_API_KEY) {
    console.error(
      '❌ Interakt Configuration Error: INTERAKT_API_KEY is missing.'
    );
    return null;
  }

  const url = 'https://api.interakt.ai/v1/public/message/';

  const payload = {
    countryCode: '+91',
    phoneNumber: toPhone.replace(/^91/, ''), // strip leading 91 if present
    type: 'Template',
    template: {
      name: templateName,
      languageCode,
      bodyValues: bodyValues.map((value) => String(value))
    }
  };

  try {

    console.log(
      `📤 Sending template "${templateName}" via Interakt to ${toPhone}...`
    );

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${INTERAKT_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Interakt template API error:');
      console.error(JSON.stringify(data, null, 2));
      return null;
    }

    console.log('📨 Interakt template response:', JSON.stringify(data, null, 2));

    return data;

  } catch (error) {
    console.error('❌ Network error sending template message:', error);
    return null;
  }
}