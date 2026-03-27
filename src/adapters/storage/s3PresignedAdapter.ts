import { env } from '../../config/env';
import type { MediaStorageAdapter, StorageUploadInput, StorageUploadResult } from './types';

interface PresignResponse {
  uploadUrl: string;
  publicUrl?: string;
  method?: string;
  headers?: Record<string, string>;
  objectKey?: string;
}

export class S3PresignedAdapter implements MediaStorageAdapter {
  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    if (!env.s3PresignEndpoint) {
      throw new Error('S3_PRESIGN_ENDPOINT is missing');
    }

    const presignResp = await fetch(env.s3PresignEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(env.s3PresignToken ? { Authorization: `Bearer ${env.s3PresignToken}` } : {})
      },
      body: JSON.stringify({
        path: input.path,
        contentType: input.mimeType,
        private: Boolean(input.isPrivate)
      })
    });

    if (!presignResp.ok) {
      const body = await presignResp.text();
      throw new Error(`S3 presign failed: ${presignResp.status} ${body}`);
    }

    const presign = (await presignResp.json()) as PresignResponse;
    if (!presign.uploadUrl) throw new Error('S3 presign response missing uploadUrl');

    const uploadResp = await fetch(presign.uploadUrl, {
      method: presign.method || 'PUT',
      headers: {
        'Content-Type': input.mimeType,
        ...(presign.headers || {})
      },
      body: input.bytes
    });

    if (!uploadResp.ok) {
      const body = await uploadResp.text();
      throw new Error(`S3 upload failed: ${uploadResp.status} ${body}`);
    }

    return {
      provider: 's3_presigned',
      internalRef: presign.objectKey || input.path,
      publicUrl: input.isPrivate ? undefined : presign.publicUrl
    };
  }
}
