import { env } from '../config/env';
import { getWhatsappSendUrl } from '../config/whatsapp';

export interface SendTextPayload {
  to: string;
  body: string;
}

export interface SendListPayload {
  to: string;
  body: string;
  buttonText: string;
  rows: Array<{ id: string; title: string; description?: string }>;
}

export class WhatsAppClient {
  async sendText(payload: SendTextPayload): Promise<void> {
    if (!env.waToken || !env.waPhoneNumberId) {
      // eslint-disable-next-line no-console
      console.log(`[WA MOCK SEND] to=${payload.to} body=${payload.body}`);
      return;
    }

    const response = await fetch(getWhatsappSendUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.waToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: payload.to,
        type: 'text',
        text: {
          preview_url: true,
          body: payload.body
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`WhatsApp sendText failed: ${response.status} ${body}`);
    }
  }

  async sendList(payload: SendListPayload): Promise<void> {
    if (!env.waToken || !env.waPhoneNumberId) {
      // eslint-disable-next-line no-console
      console.log(`[WA MOCK LIST] to=${payload.to} body=${payload.body}`);
      return;
    }

    const response = await fetch(getWhatsappSendUrl(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.waToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: payload.to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: payload.body },
          action: {
            button: payload.buttonText,
            sections: [
              {
                title: 'MakaUg options',
                rows: payload.rows
              }
            ]
          }
        }
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`WhatsApp sendList failed: ${response.status} ${body}`);
    }
  }
}
