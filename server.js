import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('WhatsApp Lead Automation Backend is active and running.');
});

/**
 * Meta Webhook Verification (GET /webhook)
 */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Hardcoded check for guaranteed verification
  if (mode === 'subscribe' && token === 'speedlead123verify') {
    console.log('✅ Webhook verified successfully by Meta.');
    // Explicitly send as raw text/plain for Meta's bot
    return res.type('text/plain').status(200).send(challenge);
  } else {
    console.warn('❌ Webhook verification failed.');
    return res.sendStatus(403);
  }
});

/**
 * WhatsApp Event Webhook (POST /webhook)
 */
app.post('/webhook', (req, res) => {
  res.status(200).send('EVENT_RECEIVED');

  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    if (message.type === 'text') {
      const fromPhone = message.from;
      const senderName = value.contacts?.[0]?.profile?.name || 'Unknown Contact';
      const messageBody = message.text?.body;

      console.log('\n--- 📥 Incoming WhatsApp Message ---');
      console.log(`From Name:  ${senderName}`);
      console.log(`From Phone: ${fromPhone}`);
      console.log(`Body:       "${messageBody}"`);
      console.log('-------------------------------------\n');
    }
  } catch (error) {
    console.error('Error processing webhook event:', error);
  }
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Unhandled Rejection:', reason);
});

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