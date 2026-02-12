import { Router } from 'express';
import { verifyWebhook, handleWebhook } from '../controllers/webhookController';

const router = Router();

// GET endpoint for webhook verification
router.get('/whatsapp', verifyWebhook);

// POST endpoint for receiving webhook events
router.post('/whatsapp', handleWebhook);
router.post('/whatsapp/status', handleWebhook);

export default router;
