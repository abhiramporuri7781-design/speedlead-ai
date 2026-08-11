import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

/**
 * Sends a text message to a specific WhatsApp phone number using the Meta Graph API.
 *
 * @param {string} toPhone - The recipient's phone number in international format (e.g. "919876543210").
 * @param {string} messageText - The body text of the message.
 * @returns {Promise<object|null>} The parsed response JSON on success, or null on failure.
 */
export async function sendWhatsAppMessage(toPhone, messageText) {
  if (!META_ACCESS_TOKEN || !META_PHONE_NUMBER_ID) {
    console.error('❌ WhatsApp Configuration Error: META_ACCESS_TOKEN or META_PHONE_NUMBER_ID is not configured in environment variables.');
    return null;
  }

  const url = `https://graph.facebook.com/v19.0/${META_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: toPhone,
    type: 'text',
    text: {
      preview_url: false,
      body: messageText
    }
  };

  try {
    console.log(`📤 Sending message to ${toPhone}...`);
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${META_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Failed to send WhatsApp message. Meta API error details:');
      console.error(JSON.stringify(data, null, 2));
      return null;
    }

    const messageId = data.messages?.[0]?.id;
    console.log(`✅ WhatsApp message successfully sent to ${toPhone}! Message ID: ${messageId}`);
    return data;
  } catch (error) {
    console.error('❌ Network error attempting to send WhatsApp message:', error);
    return null;
  }
}
