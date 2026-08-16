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
  // Respond to Meta immediately.
  res.status(200).send('EVENT_RECEIVED');

  // Process the webhook asynchronously.
  processWhatsAppWebhook(req.body).catch((error) => {
    console.error(
      '❌ Error processing WhatsApp webhook:',
      error
    );
  });
});

/**
 * ================================
 * PROCESS WHATSAPP WEBHOOK
 * ================================
 */
async function processWhatsAppWebhook(body) {
  try {

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    if (!value) {
      console.log('⚠️ Webhook received without value.');
      return;
    }

    /**
     * ==========================================
     * 1. WHATSAPP MESSAGE DELIVERY STATUS
     * ==========================================
     *
     * Meta sends these events after we send
     * a WhatsApp message.
     *
     * Possible statuses:
     *
     * sent
     * delivered
     * read
     * failed
     */

    const status = value.statuses?.[0];

    if (status) {

      console.log('\n====================================');
      console.log('📊 WHATSAPP MESSAGE STATUS');
      console.log('====================================');

      console.log(`Message ID : ${status.id}`);
      console.log(`Status     : ${status.status}`);
      console.log(`Recipient  : ${status.recipient_id}`);

      /**
       * If Meta reports an error, print the
       * complete error information.
       */
      if (status.errors) {

        console.error(
          '❌ WhatsApp delivery error:'
        );

        console.error(
          JSON.stringify(
            status.errors,
            null,
            2
          )
        );
      }

      console.log('====================================\n');

      return;
    }

    /**
     * ==========================================
     * 2. INCOMING CUSTOMER MESSAGE
     * ==========================================
     */

    const message = value.messages?.[0];

    // Ignore events that don't contain a message.
    if (!message) {

      console.log(
        'ℹ️ Webhook received without a customer message or status.'
      );

      return;
    }

    /**
     * Currently process text messages only.
     */
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

      console.log(
        '⚠️ Received an empty text message.'
      );

      return;
    }

    /**
     * ==========================================
     * LOG INCOMING MESSAGE
     * ==========================================
     */

    console.log('\n====================================');
    console.log('📥 INCOMING WHATSAPP MESSAGE');
    console.log('====================================');

    console.log(
      `From Name : ${senderName}`
    );

    console.log(
      `From Phone: ${fromPhone}`
    );

    console.log(
      `Message   : "${messageBody}"`
    );

    console.log('====================================\n');

    /**
     * ==========================================
     * AI LEAD EXTRACTION
     * ==========================================
     */

    console.log(
      '🧠 Sending message to OpenAI...'
    );

    const leadInfo =
      await extractLeadInfo(
        messageBody,
        'NEW'
      );

    console.log('\n====================================');
    console.log('🤖 AI LEAD EXTRACTION');
    console.log('====================================');

    console.log(
      JSON.stringify(
        leadInfo,
        null,
        2
      )
    );

    console.log('====================================\n');

    /**
     * ==========================================
     * GENERATE TEST RESPONSE
     * ==========================================
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
     * ==========================================
     * SEND WHATSAPP REPLY
     * ==========================================
     */

    console.log(
      `📤 Sending reply to ${fromPhone}...`
    );

    const sendResult =
      await sendWhatsAppMessage(
        fromPhone,
        replyMessage
      );

    /**
     * ==========================================
     * CHECK API RESULT
     * ==========================================
     */

    if (sendResult) {

      console.log(
        '✅ Customer reply accepted by Meta.'
      );

      console.log(
        '⏳ Waiting for WhatsApp delivery status...'
      );

    } else {

      console.error(
        '❌ Customer reply could not be sent.'
      );
    }

  } catch (error) {

    console.error(
      '❌ Error inside processWhatsAppWebhook:',
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

const server = app.listen(
  PORT,
  () => {

    console.log(
      `🚀 Server listening on port ${PORT}`
    );

    console.log(
      `👉 Webhook endpoint: http://localhost:${PORT}/webhook`
    );

  }
);

/**
 * ================================
 * SERVER ERROR HANDLER
 * ================================
 */

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