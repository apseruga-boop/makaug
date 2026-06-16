const crypto = require('crypto');

const SERVICE = 's3';

function value(name) {
  return String(process.env[name] || '').trim();
}

function envSet(name) {
  return Boolean(value(name));
}

function normalizeObjectKey(raw = '') {
  return String(raw || '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
}

function encodePathSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUri(endpoint, bucket, key) {
  const prefix = endpoint.pathname && endpoint.pathname !== '/' ? endpoint.pathname.replace(/\/+$/, '') : '';
  return `${prefix}/${encodePathSegment(bucket)}/${normalizeObjectKey(key).split('/').map(encodePathSegment).join('/')}`;
}

function sha256Hex(valueToHash) {
  return crypto.createHash('sha256').update(valueToHash).digest('hex');
}

function hmac(key, input) {
  return crypto.createHmac('sha256', key).update(input).digest();
}

function signingKey(secret, dateStamp, region) {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

function amzDateParts(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { dateStamp: iso.slice(0, 8), amzDate: iso };
}

function signedHeaders(headers) {
  const entries = Object.entries(headers)
    .map(([name, headerValue]) => [name.toLowerCase(), String(headerValue).trim().replace(/\s+/g, ' ')])
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    canonicalHeaders: entries.map(([name, headerValue]) => `${name}:${headerValue}\n`).join(''),
    signedHeaderNames: entries.map(([name]) => name).join(';')
  };
}

function requiredStorageEnv({ bucket } = {}) {
  const missing = [];
  if (!envSet('S3_ENDPOINT')) missing.push('S3_ENDPOINT');
  if (!bucket) missing.push('bucket');
  if (!envSet('S3_ACCESS_KEY_ID')) missing.push('S3_ACCESS_KEY_ID');
  if (!envSet('S3_SECRET_ACCESS_KEY')) missing.push('S3_SECRET_ACCESS_KEY');
  return missing;
}

function storageEnvConfigured({ bucket } = {}) {
  return requiredStorageEnv({ bucket }).length === 0;
}

function publicUrlFor(key) {
  const base = value('S3_PUBLIC_BASE_URL');
  if (!base) return null;
  return `${base.replace(/\/+$/, '')}/${normalizeObjectKey(key).split('/').map(encodePathSegment).join('/')}`;
}

async function uploadBufferToS3({ bucket, key, bytes, mimeType = 'application/octet-stream', isPrivate = true }) {
  const objectKey = normalizeObjectKey(key);
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
  const missing = requiredStorageEnv({ bucket });
  if (missing.length) {
    throw new Error(`S3 object storage env vars are missing: ${missing.join(', ')}`);
  }
  if (!objectKey) throw new Error('S3 upload key is missing');

  const endpoint = new URL(value('S3_ENDPOINT'));
  const region = value('S3_REGION') || 'auto';
  const accessKey = value('S3_ACCESS_KEY_ID');
  const secret = value('S3_SECRET_ACCESS_KEY');
  const payloadHash = sha256Hex(payload);
  const { dateStamp, amzDate } = amzDateParts();
  const uri = canonicalUri(endpoint, bucket, objectKey);
  const uploadUrl = `${endpoint.origin}${uri}`;
  const headers = {
    host: endpoint.host,
    'content-length': String(payload.length),
    'content-type': mimeType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  const { canonicalHeaders, signedHeaderNames } = signedHeaders(headers);
  const canonicalRequest = ['PUT', uri, '', canonicalHeaders, signedHeaderNames, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(secret, dateStamp, region)).update(stringToSign).digest('hex');

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(payload.length),
      'Content-Type': mimeType,
      'X-Amz-Content-Sha256': payloadHash,
      'X-Amz-Date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`
    },
    body: new Uint8Array(payload)
  });

  if (!response.ok) {
    throw new Error(`S3 upload failed for ${bucket}/${objectKey}: ${response.status} ${await response.text()}`);
  }

  return {
    provider: 's3',
    bucket,
    key: objectKey,
    bytes: payload.length,
    sha256: payloadHash,
    internalRef: `s3://${bucket}/${objectKey}`,
    publicUrl: isPrivate ? null : publicUrlFor(objectKey)
  };
}

module.exports = {
  normalizeObjectKey,
  requiredStorageEnv,
  storageEnvConfigured,
  uploadBufferToS3
};
