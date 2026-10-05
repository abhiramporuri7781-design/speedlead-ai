import dotenv from 'dotenv';

import { supabase } from './db.js';

dotenv.config();

/*
====================================================
OWNER ALERTS (Telegram)
Sends a short message to the business owner or agent when
something needs attention (booking, cancel, reschedule,
customer asks for a person).

Setup:
  - TELEGRAM_BOT_TOKEN   (environment variable, from @BotFather)
  - businesses.alert_chat_id  (the Telegram chat id for that business)

An alert can NEVER break the bot: every failure is caught and logged.
====================================================
*/

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function sendOwnerAlert(businessId, text) {
    try {
        if (!TELEGRAM_BOT_TOKEN) {
            console.log('ℹ️ Alerts are off: TELEGRAM_BOT_TOKEN is not set.');
            return false;
        }

        const { data: business, error } = await supabase
            .from('businesses')
            .select('alert_chat_id')
            .eq('id', businessId)
            .maybeSingle();

        if (error) {
            console.error('❌ Alert lookup error:', error.message);
            return false;
        }

        const chatId = business?.alert_chat_id;

        if (!chatId) {
            console.log('ℹ️ Alerts are off for this business: alert_chat_id is empty.');
            return false;
        }

        const response = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text,
                    disable_web_page_preview: true
                })
            }
        );

        if (!response.ok) {
            const details = await response.text();
            console.error('❌ Telegram alert failed:', response.status, details);
            return false;
        }

        console.log('🔔 Owner alert sent.');
        return true;

    } catch (err) {
        console.error('❌ Owner alert error:', err.message);
        return false;
    }
}