import { env } from './env';

export function getWhatsappSendUrl(): string {
  if (!env.waPhoneNumberId) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID is missing');
  }
  return `https://graph.facebook.com/${env.waApiVersion}/${env.waPhoneNumberId}/messages`;
}

export function getWhatsappMediaMetaUrl(mediaId: string): string {
  return `https://graph.facebook.com/${env.waApiVersion}/${mediaId}`;
}
