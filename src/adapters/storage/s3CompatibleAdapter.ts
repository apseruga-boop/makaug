import { createHash, createHmac } from 'crypto';

import { env } from '../../config/env';
import type { MediaStorageAdapter, StorageUploadInput, StorageUploadResult } from './types';

const SERVICE = 's3';

function sha256Hex(value: string | Buffer | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

function dateParts(now = new Date()): { dateStamp: string; amzDate: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    dateStamp: iso.slice(0, 8),
    amzDate: iso
  };
}

function normalizeObjectKey(value: string): string {
  return String(value || '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUriFor(endpoint: URL, bucket: string, key: string): string {
  const prefix = endpoint.pathname && endpoint.pathname !== '/' ? endpoint.pathname.replace(/\/+$/, '') : '';
  return `${prefix}/${encodePathSegment(bucket)}/${normalizeObjectKey(key).split('/').map(encodePathSegment).join('/')}`;
}

function signedHeaders(headers: Record<string, string>): { canonicalHeaders: string; signedHeaderNames: string } {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    canonicalHeaders: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaderNames: entries.map(([name]) => name).join(';')
  };
}

function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

function publicUrlFor(key: string): string | undefined {
  if (!env.s3PublicBaseUrl) return undefined;
  return `${env.s3PublicBaseUrl.replace(/\/+$/, '')}/${normalizeObjectKey(key).split('/').map(encodePathSegment).join('/')}`;
}

export class S3CompatibleAdapter implements MediaStorageAdapter {
  async upload(input: StorageUploadInput): Promise<StorageUploadResult> {
    if (!env.s3Endpoint || !env.s3Bucket || !env.s3AccessKeyId || !env.s3SecretAccessKey) {
      throw new Error('S3 storage env vars are missing');
    }

    const endpoint = new URL(env.s3Endpoint);
    const objectKey = normalizeObjectKey(input.path);
    if (!objectKey) throw new Error('S3 upload path is missing');

    const { dateStamp, amzDate } = dateParts();
    const payloadHash = sha256Hex(input.bytes);
    const canonicalUri = canonicalUriFor(endpoint, env.s3Bucket, objectKey);
    const uploadUrl = `${endpoint.origin}${canonicalUri}`;
    const headers: Record<string, string> = {
      host: endpoint.host,
      'content-type': input.mimeType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    };
    const { canonicalHeaders, signedHeaderNames } = signedHeaders(headers);
    const canonicalRequest = [
      'PUT',
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaderNames,
      payloadHash
    ].join('\n');
    const credentialScope = `${dateStamp}/${env.s3Region}/${SERVICE}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest)
    ].join('\n');
    const signature = createHmac('sha256', signingKey(env.s3SecretAccessKey, dateStamp, env.s3Region))
      .update(stringToSign)
      .digest('hex');

    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': input.mimeType,
        'X-Amz-Content-Sha256': payloadHash,
        'X-Amz-Date': amzDate,
        Authorization: `AWS4-HMAC-SHA256 Credential=${env.s3AccessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`
      },
      body: new Uint8Array(input.bytes) as BodyInit
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`S3 upload failed: ${response.status} ${body}`);
    }

    return {
      provider: 's3',
      internalRef: `s3://${env.s3Bucket}/${objectKey}`,
      publicUrl: input.isPrivate ? undefined : publicUrlFor(objectKey)
    };
  }
}
