import dotenv from 'dotenv';

dotenv.config();

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

const META_GRAPH_VERSION =
  process.env.META_GRAPH_VERSION || 'v19.0';

/**
 * Sends a text message through the WhatsApp Cloud API.
 */
export async function sendWhatsAppMessage(toPhone, messageText) {

  if (!META_ACCESS_TOKEN || !META_PHONE_NUMBER_ID) {
    console.error(
      '❌ WhatsApp Configuration Error: META_ACCESS_TOKEN or META_PHONE_NUMBER_ID is missing.'
    );

    return null;
  }

  const url =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${META_PHONE_NUMBER_ID}/messages`;

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

    console.log(`📤 Sending WhatsApp message to ${toPhone}...`);

    const response = await fetch(url, {
      method: 'POST',

      headers: {
        Authorization: `Bearer ${META_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      },

      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {

      console.error('❌ Meta WhatsApp API error:');

      console.error(
        JSON.stringify(data, null, 2)
      );

      return null;
    }

    console.log(
      '📨 Full Meta API response:',
      JSON.stringify(data, null, 2)
    );

    const messageId =
      data.messages?.[0]?.id;

    console.log(
      '✅ WhatsApp message successfully sent!'
    );

    console.log(
      `Message ID: ${messageId}`
    );

    return data;

  } catch (error) {

    console.error(
      '❌ Network error attempting to send WhatsApp message:',
      error
    );

    return null;
  }
}