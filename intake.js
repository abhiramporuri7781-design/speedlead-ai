import { supabase } from './db.js';
import * as whatsapp from './whatsapp.js';

/*
====================================================
LEAD INTAKE
POST /lead-intake
Header: x-api-key: <businesses.intake_api_key>
Body:   {
          "name": "Rahul",
          "phone": "9876543210",
          "source": "meta_ads",
          "consent": true,
          "property_interest": "3BHK flat in Gachibowli"   (optional)
        }

Creates the lead and sends the approved welcome template.
Safe by default: it only LOGS the message (dry run) until you
set INTAKE_DRY_RUN=false in the environment.
====================================================
*/

const WELCOME_TEMPLATE =
    process.env.WELCOME_TEMPLATE_NAME || 'lead_welcome_v1';

// Dry run unless explicitly turned off.
const DRY_RUN = process.env.INTAKE_DRY_RUN !== 'false';

const RATE_LIMIT_PER_MINUTE = 60;
const requestTimes = new Map();

function isRateLimited(key) {
    const now = Date.now();
    const recent = (requestTimes.get(key) || []).filter(
        (time) => time > now - 60000
    );

    recent.push(now);
    requestTimes.set(key, recent);

    return recent.length > RATE_LIMIT_PER_MINUTE;
}

// Indian numbers only for now. Returns 91XXXXXXXXXX or null.
function normalizePhone(raw) {
    const digits = String(raw || '').replace(/\D/g, '');

    if (digits.length === 10) {
        return `91${digits}`;
    }

    if (digits.length === 11 && digits.startsWith('0')) {
        return `91${digits.slice(1)}`;
    }

    if (digits.length === 12 && digits.startsWith('91')) {
        return digits;
    }

    return null;
}

// WhatsApp template values must not contain line breaks or long runs of spaces.
function cleanTemplateValue(value, fallback) {
    const cleaned = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return cleaned || fallback;
}

async function sendFirstMessage(phone, name, propertyInterest) {
    const firstName = cleanTemplateValue(String(name || '').split(' ')[0], 'there');
    const interest = cleanTemplateValue(propertyInterest, 'our properties');
    const bodyValues = [firstName, interest];

    if (DRY_RUN) {
        console.log(
            `🧪 [DRY RUN] Would send template "${WELCOME_TEMPLATE}" to ${phone} with values:`,
            bodyValues
        );
        return;
    }

    if (typeof whatsapp.sendTemplateMessage !== 'function') {
        console.error(
            '❌ sendTemplateMessage is missing in whatsapp.js. Cannot send the welcome template.'
        );
        return;
    }

    const result = await whatsapp.sendTemplateMessage(
        phone,
        WELCOME_TEMPLATE,
        bodyValues
    );

    if (result) {
        console.log(`✅ Welcome template accepted by Interakt for ${phone}`);
    } else {
        console.error(`❌ Welcome template was NOT sent to ${phone}. See the Interakt error above.`);
    }
}

export async function handleLeadIntake(req, res) {
    try {
        const apiKey = req.get('x-api-key');

        if (!apiKey) {
            return res.status(401).json({ error: 'Missing API key' });
        }

        const { data: business } = await supabase
            .from('businesses')
            .select('id, name')
            .eq('intake_api_key', apiKey)
            .maybeSingle();

        if (!business) {
            return res.status(401).json({ error: 'Invalid API key' });
        }

        if (isRateLimited(apiKey)) {
            return res.status(429).json({ error: 'Too many requests. Slow down.' });
        }

        const { name, phone, source, consent, property_interest } = req.body || {};

        const cleanPhone = normalizePhone(phone);

        if (!cleanPhone) {
            return res
                .status(400)
                .json({ error: 'A valid 10-digit Indian phone number is required' });
        }

        const leadName = String(name || '').trim().slice(0, 80) || 'Unknown Contact';
        const leadSource = String(source || 'unknown').trim().slice(0, 40);
        const hasConsent = consent === true || consent === 'true';

        // Duplicate protection: never create or message the same lead twice.
        const { data: existing } = await supabase
            .from('leads')
            .select('id')
            .eq('business_id', business.id)
            .eq('phone', cleanPhone)
            .maybeSingle();

        if (existing) {
            console.log(`♻️ Intake duplicate for ${cleanPhone}. Skipping.`);
            return res
                .status(200)
                .json({ ok: true, status: 'duplicate', lead_id: existing.id });
        }

        const { data: lead, error: insertError } = await supabase
            .from('leads')
            .insert([{
                business_id: business.id,
                phone: cleanPhone,
                name: leadName,
                conversation_state: 'NEW',
                source: leadSource,
                consent: hasConsent
            }])
            .select('id')
            .single();

        if (insertError) {
            // 23505 = unique violation (a parallel request created it first)
            if (insertError.code === '23505') {
                return res.status(200).json({ ok: true, status: 'duplicate' });
            }

            console.error('❌ Intake insert error:', insertError.message);
            return res.status(500).json({ error: 'Could not create lead' });
        }

        console.log(
            `📥 Intake: lead ${lead.id} created for ${business.name} (source: ${leadSource}, consent: ${hasConsent})`
        );

        // Reply to the caller right away, then do the messaging in the background.
        res.status(200).json({
            ok: true,
            status: hasConsent ? 'created' : 'created_no_message',
            lead_id: lead.id,
            dry_run: DRY_RUN
        });

        if (!hasConsent) {
            console.log(`ℹ️ No consent for ${cleanPhone}. First message not sent.`);
            return;
        }

        sendFirstMessage(cleanPhone, leadName, property_interest).catch((err) => {
            console.error('❌ Failed to send first message:', err.message);
        });

    } catch (err) {
        console.error('❌ /lead-intake error:', err);

        if (!res.headersSent) {
            return res.status(500).json({ error: 'Server error' });
        }
    }
}