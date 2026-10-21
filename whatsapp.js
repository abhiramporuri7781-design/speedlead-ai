import dotenv from 'dotenv';
import { getProvider } from './providers/index.js';
import { messageContext, saveOutgoingFromContext } from './messages.js';

dotenv.config();

// DEV SAFETY: when WHATSAPP_SEND_MODE=log, nothing is sent to WhatsApp.
// Messages are only printed to the logs (and saved in the messages table).
// Set this on the dev server. NEVER set it on production.
function isLogOnly() {
  return process.env.WHATSAPP_SEND_MODE === 'log';
}

/**
 * Sends a text message through the provider configured for the business.
 *
 * @param {string} toPhone       e.g. '919876543210'
 * @param {string} messageText   text message to send
 * @param {object} [business]    business row from DB (falls back to messageContext store)
 * @returns {Promise<object|null>}
 */
export async function sendWhatsAppMessage(toPhone, messageText, business = null) {
  const effectiveBusiness = business || messageContext.getStore()?.business;

  if (!effectiveBusiness) {
    console.error(
      '❌ Cannot send WhatsApp message: no business context provided. ' +
      'A business object is required to select the provider and phone number.'
    );
    return null;
  }

  if (isLogOnly()) {
    console.log(`🧪 [LOG ONLY] Would send to ${toPhone}: ${messageText}`);
    const fake = { result: true, id: `log-${Date.now()}` };
    saveOutgoingFromContext(messageText, fake);
    return fake;
  }

  try {
    const provider = getProvider(effectiveBusiness);
    const data = await provider.sendMessage(toPhone, messageText);

    if (data) {
      saveOutgoingFromContext(messageText, data);
    }

    return data;
  } catch (error) {
    console.error('❌ Error sending WhatsApp message via provider:', error);
    return null;
  }
}

/**
 * Sends an approved WhatsApp template through the provider configured for the business.
 * Needed for any message sent outside the 24-hour customer window
 * (first message to a new lead, reminders, reports).
 *
 * @param {string}   toPhone       e.g. '919876543210'
 * @param {string}   templateName  e.g. 'lead_welcome_v1' (must be approved)
 * @param {string[]} bodyValues    values for {{1}}, {{2}}, ... in order
 * @param {string}   languageCode  defaults to 'en'
 * @param {object}   [business]    business row from DB (falls back to messageContext store)
 * @returns {Promise<object|null>}
 */
export async function sendTemplateMessage(
  toPhone,
  templateName,
  bodyValues = [],
  languageCode = 'en',
  business = null
) {
  const effectiveBusiness = business || messageContext.getStore()?.business;

  if (!effectiveBusiness) {
    console.error(
      '❌ Cannot send template message: no business context provided. ' +
      'A business object is required to select the provider and phone number.'
    );
    return null;
  }

  if (isLogOnly()) {
    console.log(`🧪 [LOG ONLY] Would send template "${templateName}" to ${toPhone}:`, bodyValues);
    return { result: true, id: `log-${Date.now()}` };
  }

  try {
    const provider = getProvider(effectiveBusiness);
    return await provider.sendTemplate(toPhone, templateName, bodyValues, languageCode);
  } catch (error) {
    console.error('❌ Error sending WhatsApp template via provider:', error);
    return null;
  }
}