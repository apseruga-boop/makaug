import { env } from '../../config/env';
import { LocalStorageAdapter } from './localStorageAdapter';
import { S3CompatibleAdapter } from './s3CompatibleAdapter';
import { S3PresignedAdapter } from './s3PresignedAdapter';
import { SupabaseStorageAdapter } from './supabaseStorageAdapter';
import type { MediaStorageAdapter } from './types';

export function createStorageAdapter(): MediaStorageAdapter {
  if (env.mediaStorageProvider === 'supabase') return new SupabaseStorageAdapter();
  if (env.mediaStorageProvider === 's3') return new S3CompatibleAdapter();
  if (env.mediaStorageProvider === 's3_presigned') return new S3PresignedAdapter();
  return new LocalStorageAdapter();
}
