import { createApp } from './app';
import { env } from './config/env';
import { OutboundQueueService } from './services/outboundQueueService';

const app = createApp();
const queue = new OutboundQueueService();

app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`MakaUg WhatsApp backend listening on :${env.port}`);
});

setInterval(async () => {
  try {
    await queue.processDue();
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('outbound queue worker error', error);
  }
}, Math.max(5, env.queuePollSeconds) * 1000);
