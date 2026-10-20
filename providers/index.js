import { createInteraktProvider } from './interakt.js';
import { createMetaProvider } from './meta.js';

/**
 * Returns a provider instance for the given business.
 *
 * The provider object exposes:
 *   - name:          'interakt' | 'meta'
 *   - sendMessage:   (toPhone, text) => Promise<object|null>
 *   - sendTemplate:  (toPhone, templateName, bodyValues, lang) => Promise<object|null>
 *
 * Selection is based on business.whatsapp_provider.
 * Defaults to 'interakt' when the column is absent (backward compat).
 *
 * Throws on unknown provider — never silently falls back.
 */
export function getProvider(business) {
  const providerName = business.whatsapp_provider || 'interakt';

  switch (providerName) {
    case 'interakt':
      return createInteraktProvider(business);

    case 'meta':
      return createMetaProvider(business);

    default:
      throw new Error(
        `Unknown WhatsApp provider "${providerName}" for business "${business.name}" (ID: ${business.id}).`
      );
  }
}
