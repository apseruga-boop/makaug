import { env } from '../config/env';
import { createStorageAdapter } from '../adapters/storage';
import { getWhatsappMediaMetaUrl } from '../config/whatsapp';

export interface DownloadedMedia {
  url: string;
  mimeType?: string;
  bytes: Buffer;
  filename?: string;
}

export class MediaUploadService {
  private readonly storage = createStorageAdapter();

  async fetchMediaById(mediaId: string): Promise<DownloadedMedia | null> {
    if (!env.waToken) return null;

    const metaResp = await fetch(getWhatsappMediaMetaUrl(mediaId), {
      headers: { Authorization: `Bearer ${env.waToken}` }
    });

    if (!metaResp.ok) return null;
    const meta = (await metaResp.json()) as { url?: string; mime_type?: string; file_size?: number; id?: string };
    if (!meta.url) return null;

    const mediaResp = await fetch(meta.url, {
      headers: { Authorization: `Bearer ${env.waToken}` }
    });

    if (!mediaResp.ok) return null;
    const arrayBuffer = await mediaResp.arrayBuffer();
    const bytes = Buffer.from(arrayBuffer);

    if (bytes.length > env.maxUploadBytes) {
      throw new Error('Uploaded file exceeds max allowed size');
    }

    return {
      url: meta.url,
      mimeType: meta.mime_type,
      bytes,
      filename: `${meta.id || mediaId}`
    };
  }

  validateImageOrPdf(mimeType?: string): boolean {
    if (!mimeType) return false;
    return ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(mimeType.toLowerCase());
  }

  validatePhoto(mimeType?: string): boolean {
    if (!mimeType) return false;
    return ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType.toLowerCase());
  }

  async persistWhatsAppMedia(mediaId: string, path: string, isPrivate = false): Promise<{ internalRef: string; publicUrl?: string; mimeType?: string }> {
    const media = await this.fetchMediaById(mediaId);
    if (!media) throw new Error('Failed to fetch WhatsApp media');
    if (!media.mimeType) throw new Error('Media mime type missing');

    const stored = await this.storage.upload({
      bytes: media.bytes,
      mimeType: media.mimeType,
      path,
      isPrivate
    });

    return {
      internalRef: stored.internalRef,
      publicUrl: stored.publicUrl,
      mimeType: media.mimeType
    };
  }
}
