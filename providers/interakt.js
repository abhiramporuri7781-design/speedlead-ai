import dotenv from 'dotenv';

dotenv.config();

const INTERAKT_API_URL = 'https://api.interakt.ai/v1/public/message/';

/**
 * Interakt WhatsApp provider.
 *
 * Sends messages via Interakt's BSP API (api.interakt.ai).
 * Phone numbers are sent in local format (without country code prefix).
 */
export function createInteraktProvider(business) {
  // Backward compatibility exception:
  // Legacy single tenant ('cef39b73-af46-4b85-a1d9-de679f797ef8' / 'Propx AI') or dev test runners
  // are permitted to fall back to process.env.INTERAKT_API_KEY until database credentials are populated.
  // Other tenants in production without interakt_api_key fail closed to maintain tenant isolation.
  const isLegacyOrDev =
    process.env.NODE_ENV !== 'production' ||
    business?.id === 'cef39b73-af46-4b85-a1d9-de679f797ef8' ||
    business?.name === 'Propx AI';

  const apiKey = business?.interakt_api_key || (isLegacyOrDev ? process.env.INTERAKT_API_KEY : null);

  return {
    name: 'interakt',

    /**
     * Send a free-text message.
     * Returns the parsed API response on success, null on failure.
     */
    async sendMessage(toPhone, messageText) {
      if (!apiKey) {
        console.error(
          '❌ Interakt Configuration Error: INTERAKT_API_KEY is missing.'
        );
        return null;
      }

      const payload = {
        countryCode: '+91',
        phoneNumber: toPhone.replace(/^91/, ''), // Interakt wants local format
        type: 'Text',
        data: {
          message: messageText
        }
      };

      try {
        console.log(`📤 Sending WhatsApp message via Interakt to ${toPhone}...`);

        const response = await fetch(INTERAKT_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${apiKey}`,
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
    },

    /**
     * Send an approved WhatsApp template message.
     * Returns the parsed API response on success, null on failure.
     *
     * @param {string}   toPhone       e.g. 919876543210
     * @param {string}   templateName  e.g. 'lead_welcome_v1' (must be approved)
     * @param {string[]} bodyValues    values for {{1}}, {{2}}, ... in order
     * @param {string}   languageCode  defaults to 'en'
     */
    async sendTemplate(toPhone, templateName, bodyValues = [], languageCode = 'en') {
      if (!apiKey) {
        console.error(
          '❌ Interakt Configuration Error: INTERAKT_API_KEY is missing.'
        );
        return null;
      }

      const payload = {
        countryCode: '+91',
        phoneNumber: toPhone.replace(/^91/, ''),
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

        const response = await fetch(INTERAKT_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${apiKey}`,
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
  };
}
