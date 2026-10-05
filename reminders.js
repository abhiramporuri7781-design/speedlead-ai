import { supabase } from './db.js';
import * as whatsapp from './whatsapp.js';

/*
====================================================
VISIT REMINDERS
Sends the approved templates:
  visit_reminder_24h_v1  -> about 24 hours before the visit
  visit_reminder_2h_v1   -> about 2 hours before the visit

Safe by default: it only LOGS what it would send (dry run)
until you set REMINDERS_DRY_RUN=false in the environment.

Nothing is ever sent twice: each visit is "claimed" in the
database (reminder_*_sent_at) BEFORE the message is sent.
====================================================
*/

const DRY_RUN = process.env.REMINDERS_DRY_RUN !== 'false';

const CHECK_EVERY_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_RUN = 50;
const HOUR = 60 * 60 * 1000;

function istDate(iso) {
    return new Date(iso).toLocaleDateString('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'long'
    });
}

function istTime(iso) {
    return new Date(iso)
        .toLocaleTimeString('en-IN', {
            timeZone: 'Asia/Kolkata',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        })
        .toUpperCase();
}

// Template values must not contain line breaks or long runs of spaces.
function cleanValue(value, fallback) {
    const cleaned = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return cleaned || fallback;
}

function firstName(lead) {
    return cleanValue(String(lead.name || '').split(' ')[0], 'there');
}

const REMINDERS = [
    {
        label: '24h',
        column: 'reminder_24h_sent_at',
        template: 'visit_reminder_24h_v1',
        fromMs: 23 * HOUR,
        toMs: 25 * HOUR,
        // {{1}} name, {{2}} property, {{3}} date and time
        values: (lead, tour) => [
            firstName(lead),
            cleanValue(lead.property_type, 'your property'),
            `${istDate(tour.slot_time)} at ${istTime(tour.slot_time)}`
        ]
    },
    {
        label: '2h',
        column: 'reminder_2h_sent_at',
        template: 'visit_reminder_2h_v1',
        fromMs: 1 * HOUR,
        toMs: 2.5 * HOUR,
        // {{1}} name, {{2}} time
        values: (lead, tour) => [firstName(lead), istTime(tour.slot_time)]
    }
];

export async function runReminders({ businessId = null } = {}) {
    const summary = {
        dryRun: DRY_RUN,
        checked: 0,
        sent: 0,
        wouldSend: 0,
        failed: 0
    };

    const now = Date.now();

    for (const reminder of REMINDERS) {
        if (summary.sent + summary.wouldSend >= MAX_SENDS_PER_RUN) {
            break;
        }

        const from = new Date(now + reminder.fromMs).toISOString();
        const to = new Date(now + reminder.toMs).toISOString();

        let query = supabase
            .from('site_tours')
            .select('id, lead_id, business_id, slot_time')
            .eq('status', 'CONFIRMED')
            .is(reminder.column, null)
            .gte('slot_time', from)
            .lte('slot_time', to)
            .limit(MAX_SENDS_PER_RUN);

        if (businessId) {
            query = query.eq('business_id', businessId);
        }

        const { data: tours, error } = await query;

        if (error) {
            console.error(`❌ Reminder query error (${reminder.label}):`, error.message);
            continue;
        }

        if (!tours || tours.length === 0) {
            continue;
        }

        const leadIds = [...new Set(tours.map((tour) => tour.lead_id))];

        const { data: leads, error: leadsError } = await supabase
            .from('leads')
            .select('id, name, phone, property_type')
            .in('id', leadIds);

        if (leadsError) {
            console.error('❌ Reminder lead lookup error:', leadsError.message);
            continue;
        }

        const leadById = new Map((leads || []).map((lead) => [lead.id, lead]));

        for (const tour of tours) {
            if (summary.sent + summary.wouldSend >= MAX_SENDS_PER_RUN) {
                break;
            }

            summary.checked += 1;

            const lead = leadById.get(tour.lead_id);

            if (!lead || !lead.phone) {
                continue;
            }

            const values = reminder.values(lead, tour);

            if (DRY_RUN) {
                console.log(
                    `🧪 [DRY RUN] Would send ${reminder.template} to ${lead.phone}:`,
                    values
                );
                summary.wouldSend += 1;
                continue;
            }

            // Claim this visit first. If another run already claimed it, skip.
            const { data: claimed } = await supabase
                .from('site_tours')
                .update({ [reminder.column]: new Date().toISOString() })
                .eq('id', tour.id)
                .is(reminder.column, null)
                .select('id');

            if (!claimed || claimed.length === 0) {
                continue;
            }

            const result = await whatsapp.sendTemplateMessage(
                lead.phone,
                reminder.template,
                values
            );

            if (result) {
                console.log(`✅ ${reminder.label} reminder accepted by Interakt for ${lead.phone}`);
                summary.sent += 1;
            } else {
                // Release the claim so the next run can try again.
                await supabase
                    .from('site_tours')
                    .update({ [reminder.column]: null })
                    .eq('id', tour.id);

                console.error(`❌ ${reminder.label} reminder NOT sent to ${lead.phone}. Will retry next run.`);
                summary.failed += 1;
            }
        }
    }

    return summary;
}

let running = false;

export function startReminderScheduler() {
    const tick = async () => {
        if (running) {
            return;
        }

        running = true;

        try {
            const summary = await runReminders();
            console.log('⏰ Reminder run finished:', summary);
        } catch (error) {
            console.error('❌ Reminder run crashed:', error);
        } finally {
            running = false;
        }
    };

    setTimeout(tick, 30 * 1000);
    setInterval(tick, CHECK_EVERY_MS);

    console.log(
        `⏰ Reminder scheduler started (every 15 minutes, dry run: ${DRY_RUN})`
    );
}