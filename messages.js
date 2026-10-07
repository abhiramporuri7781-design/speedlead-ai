import { AsyncLocalStorage } from 'node:async_hooks';

import { supabase } from './db.js';

// Holds { businessId, leadId } for the conversation currently being handled,
// so replies sent anywhere in the code can be saved without changing every call.
export const messageContext = new AsyncLocalStorage();

export async function saveMessage({
  businessId,
  leadId,
  direction,
  sender,
  contentType = 'Text',
  body = null,
  providerMessageId = null,
  status = null,
  provider = 'interakt'
}) {
  try {
    if (!businessId || !leadId) {
      return;
    }

    const { error } = await supabase.from('messages').insert([{
      business_id: businessId,
      lead_id: leadId,
      direction,
      sender,
      content_type: contentType,
      body,
      provider,
      provider_message_id: providerMessageId,
      status
    }]);

    if (error) {
      console.error('❌ Could not save message:', error.message);
    }
  } catch (err) {
    console.error('❌ Could not save message:', err.message);
  }
}

// Called by whatsapp.js after a text message is accepted by the provider.
export function saveOutgoingFromContext(text, providerResponse, sender = 'bot') {
  const context = messageContext.getStore();

  if (!context) {
    return;
  }

  saveMessage({
    businessId: context.businessId,
    leadId: context.leadId,
    direction: 'out',
    sender,
    body: text,
    providerMessageId: providerResponse?.id || null,
    status: 'sent'
  }).catch(() => {});
}