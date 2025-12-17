import express from 'express';
import { 
  sendBulkWhatsApp, 
  sendSingleWhatsApp, 
  getWhatsAppStatus, 
  handleWhatsAppWebhook,
  verifyWhatsAppWebhook 
} from '../controllers/whatsappController.js';
// import { authenticateToken } from '../library/middlewares/authMiddleware.js';
import auth from "../library/middlewares/auth";

const router = express.Router();

// WhatsApp webhook verification (GET)
router.get('/webhook', verifyWhatsAppWebhook);

// WhatsApp webhook handler (POST)
router.post('/webhook', handleWhatsAppWebhook);

// Send WhatsApp to multiple guests
router.post('/send-bulk', auth, sendBulkWhatsApp);

// Send WhatsApp to single guest
router.post('/send-single', auth, sendSingleWhatsApp);

// Get WhatsApp delivery status for event
router.get('/status/:eventId', auth, getWhatsAppStatus);

export default router;