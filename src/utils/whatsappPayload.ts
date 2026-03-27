import type { MessageInput } from '../types/domain';

interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body?: string };
  interactive?: {
    type?: 'button_reply' | 'list_reply';
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; filename?: string; mime_type?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
}

interface ChangeValue {
  messages?: WhatsAppMessage[];
  contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>;
}

interface WebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: ChangeValue;
    }>;
  }>;
}

export function extractMessageInputs(payload: WebhookPayload): MessageInput[] {
  const messages: MessageInput[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages?.length) continue;

      const contactName = value.contacts?.[0]?.profile?.name;

      for (const message of value.messages) {
        const base = {
          userId: message.from,
          waMessageId: message.id,
          fromName: contactName,
          timestamp: Number(message.timestamp || `${Date.now()}`),
          raw: message
        };

        switch (message.type) {
          case 'text':
            messages.push({ ...base, type: 'text', text: message.text?.body ?? '' });
            break;
          case 'interactive': {
            const interactiveId = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id;
            const interactiveTitle = message.interactive?.button_reply?.title || message.interactive?.list_reply?.title;
            messages.push({ ...base, type: 'interactive', text: interactiveTitle, interactiveId, interactiveTitle });
            break;
          }
          case 'location':
            if (typeof message.location?.latitude === 'number' && typeof message.location?.longitude === 'number') {
              messages.push({
                ...base,
                type: 'location',
                location: {
                  lat: message.location.latitude,
                  lng: message.location.longitude,
                  addressLine: message.location.address,
                  area: message.location.name
                }
              });
            } else {
              messages.push({ ...base, type: 'unknown', text: '' });
            }
            break;
          case 'image':
            messages.push({
              ...base,
              type: 'image',
              text: message.image?.caption,
              mediaId: message.image?.id,
              mimeType: message.image?.mime_type
            });
            break;
          case 'document':
            messages.push({
              ...base,
              type: 'document',
              text: message.document?.caption,
              mediaId: message.document?.id,
              mimeType: message.document?.mime_type,
              fileName: message.document?.filename
            });
            break;
          case 'audio':
            messages.push({
              ...base,
              type: 'audio',
              mediaId: message.audio?.id,
              mimeType: message.audio?.mime_type
            });
            break;
          default:
            messages.push({ ...base, type: 'unknown', text: '' });
        }
      }
    }
  }

  return messages;
}
