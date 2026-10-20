import dotenv from 'dotenv';

dotenv.config();

const GRAPH_API_VERSION = 'v21.0';

/**
 * Meta WhatsApp Cloud API provider.
 *
 * Sends messages directly via graph.facebook.com using the
 * business's phone_number_id.
 *
 * Phone numbers are sent in full E.164 format (e.g. 919876543210).
 */
export function createMetaProvider(business) {
  const phoneNumberId = business.whatsapp_phone_id;

  if (!phoneNumberId) {
    throw new Error(
      `Meta provider: business "${business.name}" (ID: ${business.id}) has no whatsapp_phone_id.`
    );
  }

  // Tenant credential isolation:
  // Each Meta business must have its own meta_access_token stored on the business record.
  // In production, fallback to global process.env.META_ACCESS_TOKEN is strictly prohibited.
  const isDevOrTest = process.env.NODE_ENV !== 'production';
  const accessToken = business?.meta_access_token || (isDevOrTest ? process.env.META_ACCESS_TOKEN : null);

  const baseUrl =
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  return {
    name: 'meta',

    /**
     * Send a free-text message.
     * Returns { id, ...rest } on success, null on failure.
     */
    async sendMessage(toPhone, messageText) {
      if (!accessToken) {
        console.error(
          '❌ Meta Configuration Error: META_ACCESS_TOKEN is missing.'
        );
        return null;
      }

      const payload = {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body: messageText }
      };

      try {
        console.log(`📤 Sending WhatsApp message via Meta Cloud API to ${toPhone}...`);

        const response = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('❌ Meta Cloud API error:');
          console.error(JSON.stringify(data, null, 2));
          return null;
        }

        console.log('📨 Meta Cloud API response:', JSON.stringify(data, null, 2));
        console.log('✅ WhatsApp message successfully sent via Meta Cloud API!');

        // Normalize: put .id at top level for saveOutgoingFromContext compatibility.
        const messageWamid = data.messages?.[0]?.id || null;
        return { ...data, id: messageWamid };

      } catch (error) {
        console.error('❌ Network error sending Meta WhatsApp message:', error);
        return null;
      }
    },

    /**
     * Send an approved WhatsApp template message.
     *
     * @param {string}   toPhone       e.g. 919876543210
     * @param {string}   templateName  e.g. 'lead_welcome_v1'
     * @param {string[]} bodyValues    values for {{1}}, {{2}}, ...
     * @param {string}   languageCode  defaults to 'en'
     */
    async sendTemplate(toPhone, templateName, bodyValues = [], languageCode = 'en') {
      if (!accessToken) {
        console.error(
          '❌ Meta Configuration Error: META_ACCESS_TOKEN is missing.'
        );
        return null;
      }

      const components = bodyValues.length > 0
        ? [{
            type: 'body',
            parameters: bodyValues.map((value) => ({
              type: 'text',
              text: String(value)
            }))
          }]
        : [];

      const payload = {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components
        }
      };

      try {
        console.log(
          `📤 Sending template "${templateName}" via Meta Cloud API to ${toPhone}...`
        );

        const response = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
          console.error('❌ Meta Cloud API template error:');
          console.error(JSON.stringify(data, null, 2));
          return null;
        }

        console.log('📨 Meta template response:', JSON.stringify(data, null, 2));

        const messageWamid = data.messages?.[0]?.id || null;
        return { ...data, id: messageWamid };

      } catch (error) {
        console.error('❌ Network error sending Meta template message:', error);
        return null;
      }
    }
  };
}
