import express from 'express';
import dotenv from 'dotenv';
import { sendWhatsAppMessage } from './whatsapp.js';
import { extractLeadInfo } from './extract.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/**
 * ================================
 * HEALTH CHECK
 * ================================
 */
app.get('/', (req, res) => {
  res
    .status(200)
    .send('WhatsApp Lead Automation Backend is active and running.');
});

/**
 * ================================
 * META WEBHOOK VERIFICATION
 * ================================
 */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (
    mode === 'subscribe' &&
    token === 'speedlead123verify'
  ) {
    console.log('✅ Webhook verified successfully by Meta.');

    return res
      .type('text/plain')
      .status(200)
      .send(challenge);
  }

  console.warn('❌ Webhook verification failed.');

  return res.sendStatus(403);
});

/**
 * ================================
 * WHATSAPP WEBHOOK
 * ================================
 */
app.post('/webhook', (req, res) => {

  // IMPORTANT:
  // Tell Meta immediately that we received the webhook.
  res.status(200).send('EVENT_RECEIVED');

  // Process the message after acknowledging Meta.
  processWhatsAppMessage(req.body).catch((error) => {
    console.error(
      '❌ Error processing WhatsApp message:',
      error
    );
  });
});

/**
 * ================================
 * PROCESS WHATSAPP MESSAGE
 * ================================
 */
async function processWhatsAppMessage(body) {
  try {

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    // Ignore webhook events that aren't messages.
    if (!message) {
      console.log('ℹ️ Webhook received without a customer message.');
      return;
    }

    // Currently we only process text messages.
    if (message.type !== 'text') {
      console.log(
        `ℹ️ Ignoring unsupported message type: ${message.type}`
      );
      return;
    }

    const fromPhone = message.from;

    const senderName =
      value.contacts?.[0]?.profile?.name ||
      'Unknown Contact';

    const messageBody =
      message.text?.body?.trim();

    if (!messageBody) {
      console.log('⚠️ Received an empty text message.');
      return;
    }

    /**
     * ================================
     * LOG INCOMING MESSAGE
     * ================================
     */

    console.log('\n====================================');
    console.log('📥 INCOMING WHATSAPP MESSAGE');
    console.log('====================================');
    console.log(`From Name : ${senderName}`);
    console.log(`From Phone: ${fromPhone}`);
    console.log(`Message   : "${messageBody}"`);
    console.log('====================================\n');

    /**
     * ================================
     * AI LEAD EXTRACTION
     * ================================
     */

    console.log('🧠 Sending message to OpenAI...');

    const leadInfo = await extractLeadInfo(
      messageBody,
      'NEW'
    );

    console.log('\n====================================');
    console.log('🤖 AI LEAD EXTRACTION');
    console.log('====================================');
    console.log(
      JSON.stringify(leadInfo, null, 2)
    );
    console.log('====================================\n');

    /**
     * ================================
     * GENERATE BASIC TEST RESPONSE
     * ================================
     *
     * This is intentionally simple.
     * We are first proving that:
     *
     * WhatsApp
     * → Meta
     * → Render
     * → OpenAI
     * → Meta
     * → WhatsApp
     *
     * works correctly.
     *
     * We can build the real qualification
     * conversation logic after this works.
     */

    let replyMessage;

    if (leadInfo.needs_clarification) {

      replyMessage =
        `Hi ${senderName}! 👋 Thanks for reaching out. ` +
        `I'd be happy to help you find the right property. ` +
        `Could you tell me what type of property you're looking for and your approximate budget?`;

    } else {

      replyMessage =
        `Hi ${senderName}! 👋 Thanks for your interest. ` +
        `I've received your requirement for ` +
        `${leadInfo.property_type || 'a property'} ` +
        `and we'll help you with the next steps.`;
    }

    /**
     * ================================
     * SEND WHATSAPP REPLY
     * ================================
     */

    console.log(
      `📤 Sending reply to ${fromPhone}...`
    );

    const sendResult =
      await sendWhatsAppMessage(
        fromPhone,
        replyMessage
      );

    if (sendResult) {

      console.log(
        '✅ Customer reply sent successfully.'
      );

    } else {

      console.error(
        '❌ Customer reply could not be sent.'
      );
    }

  } catch (error) {

    console.error(
      '❌ Error inside processWhatsAppMessage:',
      error
    );
  }
}

/**
 * ================================
 * GLOBAL ERROR HANDLERS
 * ================================
 */

process.on('uncaughtException', (err) => {
  console.error(
    '⚠️ Uncaught Exception:',
    err
  );
});

process.on('unhandledRejection', (reason) => {
  console.error(
    '⚠️ Unhandled Rejection:',
    reason
  );
});

/**
 * ================================
 * START SERVER
 * ================================
 */

const server = app.listen(PORT, () => {

  console.log(
    `🚀 Server listening on port ${PORT}`
  );

  console.log(
    `👉 Webhook endpoint: http://localhost:${PORT}/webhook`
  );

});

server.on('error', (err) => {

  if (err.code === 'EADDRINUSE') {

    console.error(
      `❌ Port ${PORT} in use. Change PORT or kill process.`
    );

  } else {

    console.error(
      '❌ Server error:',
      err
    );

  }

});