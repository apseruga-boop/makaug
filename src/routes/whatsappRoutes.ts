import { Router } from 'express';
import { receiveWebhook, verifyWebhook } from '../controllers/whatsappWebhookController';
import { verifyWhatsAppSignature } from '../middleware/whatsappSignature';

const router = Router();

router.get('/webhook', verifyWebhook);
router.post('/webhook', verifyWhatsAppSignature, receiveWebhook);

export default router;
