import { AsyncLocalStorage } from 'node:async_hooks';

import { supabase } from './db.js';

// Holds { businessId, leadId, business, provider } for the conversation currently being handled,
// so replies sent anywhere in the code can be saved without changing every call.
export const messageContext = new AsyncLocalStorage();

/**
 * Atomically claims an inbound provider message ID in the messages table.
 * Returns:
 *   - { claimed: true, message: data } if this is the first time the message is received
 *   - { claimed: false, duplicate: true } if a unique constraint violation (duplicate key 23505) occurs
 *   - { claimed: false, error: err } if a real database error occurs (must abort processing)
 */
export async function claimInboundMessage({
  businessId,
  leadId = null,
  provider,
  providerMessageId,
  body = null,
  contentType = 'Text'
}) {
  if (!businessId) {
    return { claimed: false, error: new Error('claimInboundMessage requires businessId') };
  }

  // If the provider didn't assign an ID (e.g. status updates or non-traceable payloads),
  // we cannot claim a unique key, so allow processing to continue.
  if (!providerMessageId) {
    return { claimed: true, message: null };
  }

  try {
    const { data, error } = await supabase
      .from('messages')
      .insert([{
        business_id: businessId,
        lead_id: leadId,
        direction: 'in',
        sender: 'customer',
        content_type: contentType,
        body,
        provider,
        provider_message_id: providerMessageId,
        status: 'received'
      }])
      .select()
      .maybeSingle();

    if (error) {
      // 23505 = Postgres unique_violation
      if (error.code === '23505') {
        return { claimed: false, duplicate: true };
      }
      // If table doesn't exist yet (pre-migration dev fallback), log warning and allow dev testing
      if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
        console.warn('⚠️ messages table not found in schema cache. Falling back to in-memory idempotency.');
        return { claimed: true, fallback: true };
      }
      return { claimed: false, error };
    }

    return { claimed: true, message: data };
  } catch (err) {
    return { claimed: false, error: err };
  }
}

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
    status: 'sent',
    provider: context.provider || context.business?.whatsapp_provider || 'interakt'
  }).catch(() => {});
}