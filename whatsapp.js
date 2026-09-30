import dotenv from 'dotenv';

dotenv.config();

const INTERAKT_API_KEY = process.env.INTERAKT_API_KEY;

/**
 * Sends a text message through Interakt's API.
 * Docs: https://www.interakt.shop/resource-center/
 */
export async function sendWhatsAppMessage(toPhone, messageText) {

  if (!INTERAKT_API_KEY) {
    console.error(
      '❌ Interakt Configuration Error: INTERAKT_API_KEY is missing.'
    );
    return null;
  }

  const url = 'https://api.interakt.ai/v1/public/message/';

  const payload = {
    countryCode: '+91',
    phoneNumber: toPhone.replace('91', ''), // strip leading 91 if present, Interakt wants just the 10-digit number
    type: 'Session',
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

    return data;

  } catch (error) {
    console.error('❌ Network error attempting to send WhatsApp message:', error);
    return null;
  }
}