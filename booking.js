import { supabase } from './db.js';

/**
 * Books a site tour slot for a lead with a specific agent.
 * 
 * DESIGN RATIONALE - WHY WE USE AN ATOMIC DB-LEVEL CHECK:
 * In a multi-user application, a naive approach would check slot availability first
 * (e.g., SELECT * FROM site_tours WHERE agent_id = X AND slot_time = Y) and then insert the
 * record if it's free. This pattern introduces a classic race condition:
 *   1. Lead A checks: Slot is available.
 *   2. Lead B checks: Slot is available (before Lead A commits the write).
 *   3. Lead A inserts the booking.
 *   4. Lead B inserts the booking, overwriting/violating the slot ownership (double booking).
 * 
 * By using a unique constraint on `(agent_id, slot_time)` at the database layer and attempting
 * to insert directly, Postgres guarantees atomicity. The check and write are bound together 
 * in a single transaction. If two processes attempt to insert the same slot, Postgres's engine 
 * will reject the second transaction with a unique violation error (code 23505). This approach 
 * is 100% thread-safe and immune to application-level race conditions.
 *
 * @param {object} params
 * @param {string} params.businessId - The UUID of the business
 * @param {string} params.agentId - The UUID of the agent
 * @param {string} params.leadId - The UUID of the lead
 * @param {string} params.slotTimeISO - ISO string representation of the slot time
 * @returns {Promise<object>} Result object: { success: true, tour } or { success: false, reason, error }
 */
export async function bookSlot({ businessId, agentId, leadId, slotTimeISO }) {
  try {
    const { data, error } = await supabase
      .from('site_tours')
      .insert([
        {
          business_id: businessId,
          agent_id: agentId,
          lead_id: leadId,
          slot_time: slotTimeISO,
          status: 'CONFIRMED'
        }
      ])
      .select()
      .single();

    if (error) {
      // 23505 is the PostgreSQL error code for unique_violation
      if (error.code === '23505') {
        return {
          success: false,
          reason: 'SLOT_TAKEN'
        };
      }
      return {
        success: false,
        reason: 'UNKNOWN_ERROR',
        error
      };
    }

    return {
      success: true,
      tour: data
    };
  } catch (err) {
    return {
      success: false,
      reason: 'UNKNOWN_ERROR',
      error: err
    };
  }
}
