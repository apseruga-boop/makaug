import { env } from '../../config/env';
import type { MediaStorageAdapter, StorageUploadInput, StorageUploadResult } from './types';

export class SupabaseStorageAdapter implements MediaStorageAdapter {
  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
      throw new Error('Supabase storage env vars are missing');
    }

    const bucket = env.supabaseStorageBucket;
    const objectPath = input.path.replace(/^\/+/, '');
    const uploadUrl = `${env.supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.supabaseServiceRoleKey}`,
        apikey: env.supabaseServiceRoleKey,
        'Content-Type': input.mimeType,
        'x-upsert': 'true'
      },
      body: new Uint8Array(input.bytes) as BodyInit
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Supabase upload failed: ${response.status} ${body}`);
    }

    const internalRef = `supabase://${bucket}/${objectPath}`;
    const publicUrl = input.isPrivate
      ? undefined
      : `${env.supabaseUrl}/storage/v1/object/public/${bucket}/${objectPath}`;

    return {
      provider: 'supabase',
      internalRef,
      publicUrl
    };
  }
}
