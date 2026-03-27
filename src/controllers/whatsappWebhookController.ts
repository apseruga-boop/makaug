import type { Request, Response } from 'express';
import { env } from '../config/env';
import { repositories } from '../repositories';
import { ConversationStateMachine } from '../services/conversationStateMachine';
import { LanguageService } from '../services/languageService';
import { OutboundQueueService } from '../services/outboundQueueService';
import { WhatsAppClient } from '../services/whatsappClient';
import { extractMessageInputs } from '../utils/whatsappPayload';

const machine = new ConversationStateMachine();
const waClient = new WhatsAppClient();
const outboundQueue = new OutboundQueueService();
const languageService = new LanguageService();

export async function verifyWebhook(req: Request, res: Response): Promise<void> {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.waVerifyToken) {
    res.status(200).send(challenge);
    return;
  }

  res.status(403).send('Forbidden');
}

export async function receiveWebhook(req: Request, res: Response): Promise<void> {
  try {
    await outboundQueue.processDue();
    const inputs = extractMessageInputs(req.body as never);

    for (const input of inputs) {
      await repositories.messages.logInbound(input.userId, input.waMessageId, input.raw);
      let session = await repositories.sessions.getOrCreate(input.userId);

      if (session.currentStep === 'language_select' && input.type === 'unknown') {
        const hello = await machine.firstMessage();
        try {
          await waClient.sendText({ to: input.userId, body: hello.text });
        } catch (error) {
          await outboundQueue.enqueueText(input.userId, hello.text, (error as Error).message);
        }
        continue;
      }

      const { state, replies } = await machine.handle(session, input);
      session = state;
      await repositories.sessions.save(session);

      for (const reply of replies) {
        const localizedText = await languageService.translateAny(session.language, reply.text);
        try {
          await waClient.sendText({ to: input.userId, body: localizedText });
        } catch (error) {
          await outboundQueue.enqueueText(input.userId, localizedText, (error as Error).message);
        }
        await repositories.messages.logOutbound(input.userId, { ...reply, text: localizedText });
      }
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('whatsapp webhook error', error);
    res.status(200).json({ ok: true });
  }
}
