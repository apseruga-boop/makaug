import { OutboundQueueRepository } from '../repositories/postgres/outboundQueueRepository';
import { WhatsAppClient } from './whatsappClient';

interface QueuePayload {
  text?: string;
}

export class OutboundQueueService {
  constructor(
    private readonly repo = new OutboundQueueRepository(),
    private readonly waClient = new WhatsAppClient()
  ) {}

  async enqueueText(userPhone: string, text: string, reason?: string): Promise<void> {
    await this.repo.enqueue(userPhone, { text }, reason);
  }

  async processDue(): Promise<void> {
    const items = await this.repo.due(20);
    for (const item of items) {
      try {
        const payload = item.payload as QueuePayload;
        if (!payload.text) throw new Error('Missing queued text payload');

        await this.waClient.sendText({ to: item.user_phone, body: payload.text });
        await this.repo.markSent(item.id);
      } catch (error) {
        await this.repo.markRetry(item.id, item.attempts, (error as Error).message);
      }
    }
  }
}
