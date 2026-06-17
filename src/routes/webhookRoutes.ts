import { Router } from 'express';
import { verifyWebhook, handleWebhook } from '../controllers/webhookController';
import {
  handleTwilioWhatsAppInbound,
  handleTwilioWhatsAppStatusCallback,
} from "../controllers/twilioWebhookController.js";

const router = Router();

// GET endpoint for webhook verification
router.get('/whatsapp', verifyWebhook);

// Diagnostic: confirm the Twilio inbound webhook URL is reachable
router.get('/twilio/whatsapp', (_req, res) => {
  res.json({
    ok: true,
    message: 'Twilio WhatsApp inbound webhook is reachable. Configure Twilio console to POST to this URL.',
    url: 'POST /webhook/twilio/whatsapp',
  });
});

// POST endpoint for receiving webhook events
router.post('/whatsapp', handleWebhook);
router.post('/whatsapp/status', handleWebhook);
router.post("/twilio/whatsapp", handleTwilioWhatsAppInbound);
router.post("/twilio/whatsapp/status", handleTwilioWhatsAppStatusCallback);

export default router;
