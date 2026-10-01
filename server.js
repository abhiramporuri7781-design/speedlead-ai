import express from 'express';
import dotenv from 'dotenv';
import OpenAI from 'openai';

import { sendWhatsAppMessage } from './whatsapp.js';
import { extractLeadInfo } from './extract.js';
import { supabase } from './db.js';
import { bookSlot } from './booking.js';
import { searchKnowledge } from './rag.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(express.json());

app.get('/', (req, res) => {
  res
    .status(200)
    .send('WhatsApp Lead Automation Backend is active and running.');
});

/*
====================================================
INTERAKT WEBHOOK ENDPOINT
====================================================
*/

app.post('/webhook', (req, res) => {
  res.status(200).send('EVENT_RECEIVED');

  processWhatsAppWebhook(req.body).catch((error) => {
    console.error(
      '❌ Error processing WhatsApp webhook:',
      error
    );
  });
});

export const processedMessageIds = new Set();

function formatBudget(budgetVal) {
  const num = Number(budgetVal);

  if (isNaN(num)) {
    return budgetVal;
  }

  if (num >= 10000000) {
    return `${(num / 10000000)
      .toFixed(1)
      .replace('.0', '')} Cr`;
  }

  if (num >= 100000) {
    return `${(num / 100000)
      .toFixed(1)
      .replace('.0', '')} Lakhs`;
  }

  return `${num} INR`;
}

function formatDateForMessage(dateStr) {
  try {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const parts = dateStr.split('-');
    const year = parts[0];
    const monthIdx = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);

    return `${months[monthIdx]} ${day}, ${year}`;
  } catch (error) {
    return dateStr;
  }
}

function getSlotsForDate(dateStr) {
  return [
    { timeLabel: '10:00 AM', slotTimeISO: `${dateStr}T10:00:00+05:30` },
    { timeLabel: '11:30 AM', slotTimeISO: `${dateStr}T11:30:00+05:30` },
    { timeLabel: '2:00 PM', slotTimeISO: `${dateStr}T14:00:00+05:30` },
    { timeLabel: '4:30 PM', slotTimeISO: `${dateStr}T16:30:00+05:30` }
  ];
}

async function getAvailableSlots(businessId, agentId, dateStr) {
  const allSlots = getSlotsForDate(dateStr);

  const { data: bookedTours, error } = await supabase
    .from('site_tours')
    .select('slot_time')
    .eq('business_id', businessId)
    .eq('agent_id', agentId)
    .eq('status', 'CONFIRMED');

  if (error) {
    console.error('❌ Error fetching booked tours:', error.message);
    return allSlots;
  }

  const bookedTimes = new Set(
    bookedTours.map(tour => new Date(tour.slot_time).getTime())
  );

  return allSlots.filter(slot => {
    const slotTimeMs = new Date(slot.slotTimeISO).getTime();
    return !bookedTimes.has(slotTimeMs);
  });
}

function matchInputToSlot(inputText, availableSlots, allSlots) {
  const cleanInput = inputText.trim().toLowerCase();
  const index = parseInt(cleanInput, 10);

  if (!isNaN(index) && index >= 1 && index <= availableSlots.length) {
    return availableSlots[index - 1];
  }

  for (const slot of allSlots) {
    const timeStr = slot.timeLabel.toLowerCase();
    const noSpaces = timeStr.replace(/\s+/g, '');
    const shortTime = noSpaces.replace(':00', '');
    const rawTime = slot.timeLabel.split(' ')[0];
    const hour = rawTime.split(':')[0];
    const period = slot.timeLabel.split(' ')[1].toLowerCase();

    if (
      cleanInput === timeStr ||
      cleanInput === noSpaces ||
      cleanInput === shortTime ||
      cleanInput === rawTime ||
      cleanInput === `${hour}${period}` ||
      cleanInput === `${hour}:00${period}` ||
      cleanInput === `${hour} ${period}` ||
      (cleanInput === hour && allSlots.filter(s => s.timeLabel.startsWith(hour)).length === 1)
    ) {
      return slot;
    }
  }

  return null;
}

function parseDateChoice(text) {
  const clean = text.trim().toLowerCase();
  const now = new Date();
  const kolkataNow = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));

  const format = (d) => {
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const todayStr = format(kolkataNow);
  const tomorrow = new Date(kolkataNow.getTime() + (24 * 60 * 60 * 1000));
  const tomorrowStr = format(tomorrow);

  if (clean === '1' || clean === 'today') {
    return todayStr;
  }

  if (clean === '2' || clean === 'tomorrow') {
    return tomorrowStr;
  }

  return null;
}

/*
====================================================
RAG RESPONSE GENERATOR
====================================================
*/

async function generateRAGResponse(customerQuestion, properties) {
  if (!properties || properties.length === 0) {
    return `I'm sorry, I couldn't find any relevant information for that right now. Could you please tell me a little more about what you're looking for?`;
  }

  const context = properties
    .map((property, index) => `
Property ${index + 1}:

Title: ${property.title || ''}
Description: ${property.description || ''}
Property Type: ${property.property_type || ''}
Price: ₹${property.price || ''}
Location: ${property.location || ''}
BHK: ${property.bhk || ''}
Possession Status: ${property.possession_status || ''}
`)
    .join('\n');

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: `
You are a helpful WhatsApp sales assistant for a real-estate business.

Answer the customer's question using ONLY the property information provided in the context.

Do not invent:
- prices
- amenities
- locations
- BHK types
- possession dates
- property features
- availability

If the requested information is not present in the context, say that you don't have that information.

Keep the response natural, concise, and suitable for WhatsApp.

Do not mention embeddings, RAG, vectors, databases, or internal systems.
`
        },
        {
          role: 'user',
          content: `
Customer question:

${customerQuestion}

Property information:

${context}

Give the best natural answer to the customer.
`
        }
      ]
    });

    return (
      completion.choices?.[0]?.message?.content ||
      `I'm sorry, I couldn't generate an answer right now. Please try again.`
    );

  } catch (error) {
    console.error('❌ GPT RAG response error:', error.message);
    return `Sorry, I'm having trouble getting that information right now. Please try again in a moment.`;
  }
}

/*
====================================================
MAIN WHATSAPP WEBHOOK PROCESSOR — INTERAKT FORMAT
====================================================
*/

export async function processWhatsAppWebhook(body) {

  try {

    console.log('🔍 RAW INTERAKT PAYLOAD:', JSON.stringify(body, null, 2));

    if (body.type !== 'message_received') {
      console.log(`ℹ️ Ignoring webhook event type: ${body.type}`);
      return;
    }

    const fromPhone = body.data?.customer?.channel_phone_number;
    const senderName = body.data?.customer?.traits?.name || 'Unknown Contact';
    const messageContentType = body.data?.message?.message_content_type;
    const messageBody = body.data?.message?.message?.trim();

    // Ignore echo of our own outgoing messages (chat_message_type will be
    // "AgentMessage" or similar for our own replies, "CustomerMessage" for theirs)
    if (body.data?.message?.chat_message_type !== 'CustomerMessage') {
      console.log(`ℹ️ Ignoring non-customer message (type: ${body.data?.message?.chat_message_type}).`);
      return;
    }

    if (!fromPhone) {
      console.error('❌ Webhook payload missing customer phone number.');
      return;
    }

    if (messageContentType !== 'Text' || !messageBody) {
      console.log(`ℹ️ Ignoring non-text or empty message (type: ${messageContentType}).`);
      return;
    }

    console.log('\n====================================');
    console.log('📥 INCOMING WHATSAPP MESSAGE');
    console.log('====================================');
    console.log(`From Name : ${senderName}`);
    console.log(`From Phone: ${fromPhone}`);
    console.log(`Message   : "${messageBody}"`);
    console.log('====================================\n');

    /*
    ==================================================
    DUPLICATE MESSAGE PROTECTION
    Interakt's message object has a real "id" field —
    use it directly.
    ==================================================
    */

    const messageId = body.data?.message?.id;

    if (messageId) {
      if (processedMessageIds.has(messageId)) {
        console.log(`♻️ Duplicate webhook detected for message ID: ${messageId}. Skipping.`);
        return;
      }

      processedMessageIds.add(messageId);

      if (processedMessageIds.size > 5000) {
        const firstVal = processedMessageIds.values().next().value;
        processedMessageIds.delete(firstVal);
      }
    }

    /*
    ==================================================
    IDENTIFY BUSINESS
    Confirmed real field from Interakt's payload:
    body.data.whatsapp_api_number — the number that
    received this message.
    ==================================================
    */

    const incomingPhoneNumberId = body.data?.whatsapp_api_number;

    console.log(
      '🔍 DEBUG incomingPhoneNumberId (Interakt):',
      JSON.stringify(incomingPhoneNumberId)
    );

    if (!incomingPhoneNumberId) {
      console.error('❌ Webhook payload missing whatsapp_api_number. Cannot identify business.');
      return;
    }

    const { data: businesses, error: busError } = await supabase
      .from('businesses')
      .select('*')
      .eq('whatsapp_phone_id', incomingPhoneNumberId)
      .limit(1);

    if (busError || !businesses || businesses.length === 0) {
      console.error(
        `❌ Failed to fetch business for phone_number_id: ${incomingPhoneNumberId}`,
        busError?.message
      );
      return;
    }

    const business = businesses[0];
    const businessId = business.id;

    console.log(`🏢 Business: ${business.name}`);

    /*
    ==================================================
    FIND OR CREATE LEAD
    ==================================================
    */

    let { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('business_id', businessId)
      .eq('phone', fromPhone)
      .maybeSingle();

    if (leadError) {
      console.error('❌ Error looking up lead:', leadError.message);
      return;
    }

    if (!lead) {
      console.log(`👤 Lead not found. Creating new lead for ${fromPhone}...`);

      const { data: newLead, error: createError } = await supabase
        .from('leads')
        .insert([{
          business_id: businessId,
          phone: fromPhone,
          name: senderName,
          conversation_state: 'NEW'
        }])
        .select()
        .single();

      if (createError) {
        console.error('❌ Failed to create lead:', createError.message);
        return;
      }

      lead = newLead;
      console.log(`👤 Created lead: "${lead.name}" (ID: ${lead.id})`);

    } else {
      console.log(`👤 Lead found: "${lead.name}" (ID: ${lead.id}, State: ${lead.conversation_state})`);

      if (lead.name === 'Unknown Contact' && senderName !== 'Unknown Contact') {
        const { data: updatedLead } = await supabase
          .from('leads')
          .update({ name: senderName })
          .eq('id', lead.id)
          .select()
          .single();

        if (updatedLead) {
          lead = updatedLead;
        }
      }
    }

    /*
    ==================================================
    GET AGENT
    ==================================================
    */

    const { data: agents, error: agentError } = await supabase
      .from('agents')
      .select('*')
      .eq('business_id', businessId)
      .limit(1);

    if (agentError || !agents || agents.length === 0) {
      console.error('❌ Failed to retrieve agent for business:', agentError?.message);

      await sendWhatsAppMessage(
        fromPhone,
        `Sorry, booking is currently unavailable as no agents are registered for this business.`
      );

      return;
    }

    const agent = agents[0];

    /*
    ==================================================
    CONVERSATION STATE
    ==================================================
    */

    let state = lead.conversation_state || 'NEW';
    let pendingDate = null;

    if (state.startsWith('AWAITING_SLOT:')) {
      pendingDate = state.substring('AWAITING_SLOT:'.length);
      state = 'AWAITING_SLOT';
    }

    console.log(`📊 Current State: ${state}`);
    console.log(`📊 Existing Property Type: ${lead.property_type || 'none'}`);
    console.log(`📊 Existing Budget: ${lead.budget || 'none'}`);

    /*
    ==================================================
    BOOKED STATE
    ==================================================
    */

    if (state === 'BOOKED') {
      console.log('📊 State is BOOKED. Checking intent (cancel/reschedule/other)...');

      const bookedIntentInfo = await extractLeadInfo(messageBody, state, lead);

      console.log('🤖 BOOKED-state intent check:', JSON.stringify(bookedIntentInfo, null, 2));

      if (bookedIntentInfo.intent === 'CANCEL') {
        console.log(`🗑️ Cancel intent detected for lead ${lead.id}. Cancelling existing tour...`);

        const { error: cancelError } = await supabase
          .from('site_tours')
          .update({ status: 'CANCELLED' })
          .eq('lead_id', lead.id)
          .eq('status', 'CONFIRMED');

        if (cancelError) {
          console.error('❌ Failed to cancel site tour:', cancelError.message);
          await sendWhatsAppMessage(fromPhone, `Sorry, something went wrong while cancelling your visit. Please try again in a moment.`);
          return;
        }

        await supabase
          .from('leads')
          .update({ conversation_state: 'READY_FOR_BOOKING' })
          .eq('id', lead.id);

        await sendWhatsAppMessage(
          fromPhone,
          `Your site visit has been cancelled. ❌\n\nWhenever you're ready to schedule a new visit, just let me know!`
        );

        return;
      }

      if (bookedIntentInfo.intent === 'RESCHEDULE') {
        console.log(`🔄 Reschedule intent detected for lead ${lead.id}. Cancelling existing tour and restarting date selection...`);

        const { error: rescheduleError } = await supabase
          .from('site_tours')
          .update({ status: 'CANCELLED' })
          .eq('lead_id', lead.id)
          .eq('status', 'CONFIRMED');

        if (rescheduleError) {
          console.error('❌ Failed to cancel site tour for reschedule:', rescheduleError.message);
          await sendWhatsAppMessage(fromPhone, `Sorry, something went wrong while rescheduling your visit. Please try again in a moment.`);
          return;
        }

        await supabase
          .from('leads')
          .update({ conversation_state: 'READY_FOR_BOOKING' })
          .eq('id', lead.id);

        await sendWhatsAppMessage(
          fromPhone,
          `No problem! Let's find a new time for your visit.\n\nWhich day would you prefer?\n\n1️⃣ Today\n2️⃣ Tomorrow`
        );

        return;
      }

      console.log('📊 No cancel/reschedule intent detected. Sending confirmation reminder.');

      await sendWhatsAppMessage(
        fromPhone,
        `Your site visit is already confirmed. ✅\n\nIf you'd like to change or cancel your appointment, let me know.`
      );

      return;
    }

    /*
    ==================================================
    AWAITING SLOT
    ==================================================
    */

    if (state === 'AWAITING_SLOT' && pendingDate) {
      console.log(`🎯 AWAITING_SLOT state for date ${pendingDate}. Processing customer selection...`);

      const availableSlots = await getAvailableSlots(businessId, agent.id, pendingDate);
      const allSlots = getSlotsForDate(pendingDate);
      const selectedSlot = matchInputToSlot(messageBody, availableSlots, allSlots);

      if (selectedSlot) {
        console.log(`📌 Match found! Attempting booking for: ${selectedSlot.slotTimeISO}`);

        const result = await bookSlot({
          businessId,
          agentId: agent.id,
          leadId: lead.id,
          slotTimeISO: selectedSlot.slotTimeISO
        });

        if (result.success) {
          console.log(`✅ Booking confirmed for slot: ${selectedSlot.slotTimeISO}`);

          await supabase
            .from('leads')
            .update({ conversation_state: 'BOOKED' })
            .eq('id', lead.id);

          const dateFormatted = formatDateForMessage(pendingDate);

          await sendWhatsAppMessage(
            fromPhone,
            `✅ Your site visit is confirmed!\n\n📅 Date: ${dateFormatted}\n🕐 Time: ${selectedSlot.timeLabel}\n\nWe'll see you there. Looking forward to meeting you! 👋`
          );

          return;

        } else if (result.reason === 'SLOT_TAKEN') {
          console.log(`⚠️ Slot taken: ${selectedSlot.slotTimeISO}. Regenerating available slots...`);

          const remainingSlots = await getAvailableSlots(businessId, agent.id, pendingDate);

          if (remainingSlots.length === 0) {
            await supabase
              .from('leads')
              .update({ conversation_state: 'READY_FOR_BOOKING' })
              .eq('id', lead.id);

            await sendWhatsAppMessage(
              fromPhone,
              `That slot was just taken and unfortunately, there are no more slots available for ${formatDateForMessage(pendingDate)} 😅\n\nPlease let me know which other day you'd like to visit (Today or Tomorrow).`
            );

          } else {
            let msg = `That slot was just taken by another customer 😅\n\nHere are the remaining available times:\n\n`;

            remainingSlots.forEach((slot, idx) => {
              msg += `${idx + 1}️⃣ ${slot.timeLabel}\n`;
            });

            msg += `\nReply with the number (e.g. 1, 2) or time (e.g. 10:00 AM).`;

            await sendWhatsAppMessage(fromPhone, msg);
          }

          return;

        } else {
          console.error('❌ Unknown error during booking:', result.error);
          await sendWhatsAppMessage(fromPhone, `Sorry, something went wrong while booking your slot. Please try again.`);
          return;
        }

      } else {
        console.log(`⚠️ Customer input "${messageBody}" did not match any available slot.`);

        let msg = `I couldn't recognize that selection. Please choose from the available times for ${formatDateForMessage(pendingDate)}:\n\n`;

        availableSlots.forEach((slot, idx) => {
          msg += `${idx + 1}️⃣ ${slot.timeLabel}\n`;
        });

        msg += `\nReply with the number (e.g. 1, 2) or time (e.g. 10:00 AM).`;

        await sendWhatsAppMessage(fromPhone, msg);

        return;
      }
    }

    /*
    ==================================================
    AI LEAD EXTRACTION
    ==================================================
    */

    console.log('🧠 Sending message to OpenAI for extraction...');

    console.log('🧠 Existing lead context:', {
      property_type: lead.property_type,
      budget: lead.budget,
      conversation_state: state
    });

    const leadInfo = await extractLeadInfo(messageBody, state, lead);

    console.log('\n====================================');
    console.log('🤖 AI LEAD EXTRACTION');
    console.log('====================================');
    console.log(JSON.stringify(leadInfo, null, 2));
    console.log('====================================\n');

    /*
    ==================================================
    UPDATE LEAD INFORMATION
    ==================================================
    */

    const updateData = {};

    if (leadInfo.property_type && leadInfo.property_type !== lead.property_type) {
      updateData.property_type = leadInfo.property_type;
    }

    if (leadInfo.budget !== null && leadInfo.budget !== undefined) {
      const newBudget = String(leadInfo.budget);

      if (newBudget !== String(lead.budget || '')) {
        updateData.budget = newBudget;
      }
    }

    if (Object.keys(updateData).length > 0) {
      console.log('💾 Updating lead details in database:', updateData);

      const { data: updatedLead, error: upError } = await supabase
        .from('leads')
        .update(updateData)
        .eq('id', lead.id)
        .select()
        .single();

      if (upError) {
        console.error('❌ Failed to update lead:', upError.message);
      } else if (updatedLead) {
        lead = updatedLead;

        console.log('✅ Lead updated:', {
          property_type: lead.property_type,
          budget: lead.budget
        });
      }
    }

    /*
    ==================================================
    RAG — ANSWER BUSINESS / PROPERTY QUESTIONS
    ==================================================
    */

    if (leadInfo.intent === 'ASK_INFO') {
      console.log('📚 RAG intent detected. Searching business knowledge...');

      const relevantProperties = await searchKnowledge(messageBody);

      console.log(`📚 RAG retrieved ${relevantProperties.length} properties.`);

      const ragResponse = await generateRAGResponse(messageBody, relevantProperties);

      console.log('\n====================================');
      console.log('🤖 RAG GPT RESPONSE');
      console.log('====================================');
      console.log(ragResponse);
      console.log('====================================\n');

      await sendWhatsAppMessage(fromPhone, ragResponse);

      return;
    }

    /*
    ==================================================
    DATE / BOOKING LOGIC
    ==================================================
    */

    let chosenDate = null;

    if (state === 'READY_FOR_BOOKING') {
      chosenDate = parseDateChoice(messageBody);
    }

    if (!chosenDate && leadInfo.intent === 'BOOK_TOUR' && leadInfo.requested_tour_iso) {
      try {
        const dateObj = new Date(leadInfo.requested_tour_iso);
        const kolkataTime = new Date(dateObj.getTime() + (5.5 * 60 * 60 * 1000));

        const yyyy = kolkataTime.getUTCFullYear();
        const mm = String(kolkataTime.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(kolkataTime.getUTCDate()).padStart(2, '0');

        chosenDate = `${yyyy}-${mm}-${dd}`;

      } catch (error) {
        console.error('❌ Error parsing requested_tour_iso:', error);
      }
    }

    if (chosenDate) {
      console.log(`📅 Date chosen: ${chosenDate}. Querying available slots...`);

      const availableSlots = await getAvailableSlots(businessId, agent.id, chosenDate);

      if (availableSlots.length === 0) {
        await sendWhatsAppMessage(
          fromPhone,
          `Sorry, all appointment slots for ${formatDateForMessage(chosenDate)} are currently booked. 😅\n\nPlease let me know if you would like to choose another date (Today or Tomorrow).`
        );

        await supabase
          .from('leads')
          .update({ conversation_state: 'READY_FOR_BOOKING' })
          .eq('id', lead.id);

      } else {
        let msg = `Here are the available site visit times for ${formatDateForMessage(chosenDate)}:\n\n`;

        availableSlots.forEach((slot, idx) => {
          msg += `${idx + 1}️⃣ ${slot.timeLabel}\n`;
        });

        msg += `\nReply with the number (e.g. 1, 2) or time (e.g. 10:00 AM) to book.`;

        await sendWhatsAppMessage(fromPhone, msg);

        await supabase
          .from('leads')
          .update({ conversation_state: `AWAITING_SLOT:${chosenDate}` })
          .eq('id', lead.id);
      }

      return;
    }

    /*
    ==================================================
    BOOK TOUR INTENT
    ==================================================
    */

    if (leadInfo.intent === 'BOOK_TOUR') {
      console.log('📅 Site-visit intent detected. Asking for date selection...');

      await sendWhatsAppMessage(
        fromPhone,
        `Sure! Which day would you prefer for the site visit?\n\n1️⃣ Today\n2️⃣ Tomorrow`
      );

      await supabase
        .from('leads')
        .update({ conversation_state: 'READY_FOR_BOOKING' })
        .eq('id', lead.id);

      return;
    }

    /*
    ==================================================
    FULLY QUALIFIED LEAD
    ==================================================
    */

    if (lead.property_type && lead.budget) {
      console.log(`📊 Lead is fully qualified (Property: ${lead.property_type}, Budget: ${lead.budget}).`);

      await sendWhatsAppMessage(
        fromPhone,
        `Great! I have noted your requirements:\n\n🏠 Property Type: ${lead.property_type}\n💰 Budget: ${formatBudget(lead.budget)}\n\nWould you like to schedule a site visit to view the property?`
      );

      await supabase
        .from('leads')
        .update({ conversation_state: 'READY_FOR_BOOKING' })
        .eq('id', lead.id);

      return;
    }

    /*
    ==================================================
    QUALIFICATION CLARIFICATION
    ==================================================
    */

    console.log('📊 Lead is not fully qualified. Asking clarification question.');

    let clarificationMsg;

    if (!lead.property_type && !lead.budget) {
      clarificationMsg = `Hi ${senderName}! 👋 Thanks for reaching out.\n\nI'd be happy to help you find the right property. Could you tell me:\n\n1. What type of property you're looking for (e.g., 2BHK, 3BHK, Villa)?\n2. Your approximate budget?`;

    } else if (!lead.property_type && lead.budget) {
      clarificationMsg = `Thanks! I've noted your budget of ${formatBudget(lead.budget)}. 💰\n\nCould you tell me what type of property you're looking for?\n\nFor example: 2BHK, 3BHK, Villa, or Plot.`;

    } else if (lead.property_type && !lead.budget) {
      clarificationMsg = `Thanks! I've noted your preference for a ${lead.property_type}. 🏠\n\nCould you tell me your approximate budget?`;

    } else {
      clarificationMsg = `Thanks for the information! Could you tell me a little more about the property you're looking for?`;
    }

    await sendWhatsAppMessage(fromPhone, clarificationMsg);

    await supabase
      .from('leads')
      .update({ conversation_state: 'QUALIFYING' })
      .eq('id', lead.id);

  } catch (error) {
    console.error('❌ Error inside processWhatsAppWebhook:', error);
  }
}

/*
====================================================
GLOBAL ERROR HANDLERS
====================================================
*/

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});

/*
====================================================
START SERVER
====================================================
*/

const server = app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  console.log(`👉 Webhook endpoint: http://localhost:${PORT}/webhook`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} in use. Change PORT or kill process.`);
  } else {
    console.error('❌ Server error:', err);
  }
});