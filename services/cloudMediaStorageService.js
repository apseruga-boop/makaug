const crypto = require('crypto');

const SERVICE = 's3';
const DATA_URL_RE = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,([a-z0-9+/=\s]+)$/i;

function cleanSegment(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeObjectKey(value = '') {
  return String(value || '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function canonicalUriFor(endpoint, bucket, key) {
  const prefix = endpoint.pathname && endpoint.pathname !== '/' ? endpoint.pathname.replace(/\/+$/, '') : '';
  return `${prefix}/${encodePathSegment(bucket)}/${normalizeObjectKey(key).split('/').map(encodePathSegment).join('/')}`;
}

function canonicalQueryString(params = {}) {
  return Object.entries(params)
    .map(([name, value]) => [encodePathSegment(name), encodePathSegment(value)])
    .sort(([aName, aValue], [bName, bValue]) => {
      const nameCompare = aName.localeCompare(bName);
      return nameCompare || aValue.localeCompare(bValue);
    })
    .map(([name, value]) => `${name}=${value}`)
    .join('&');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function signingKey(secret, dateStamp, region) {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, SERVICE);
  return hmac(serviceKey, 'aws4_request');
}

function dateParts(now = new Date()) {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    dateStamp: iso.slice(0, 8),
    amzDate: iso
  };
}

function signedHeaders(headers) {
  const entries = Object.entries(headers)
    .map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    canonicalHeaders: entries.map(([name, value]) => `${name}:${value}\n`).join(''),
    signedHeaderNames: entries.map(([name]) => name).join(';')
  };
}

function storageError(message, status = 503) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseS3InternalRef(value = '') {
  const raw = String(value || '').trim();
  if (!raw.toLowerCase().startsWith('s3://')) return null;
  const withoutScheme = raw.slice(5);
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex <= 0 || slashIndex === withoutScheme.length - 1) {
    throw storageError('Private media reference is invalid.', 500);
  }
  return {
    bucket: withoutScheme.slice(0, slashIndex),
    key: normalizeObjectKey(withoutScheme.slice(slashIndex + 1))
  };
}

function mediaStorageProvider() {
  return String(process.env.MEDIA_STORAGE_PROVIDER || 'local').trim().toLowerCase();
}

function requiredS3Env() {
  return ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
}

function missingS3Env() {
  return requiredS3Env().filter((key) => !String(process.env[key] || '').trim());
}

function cloudMediaStorageConfigured() {
  return mediaStorageProvider() === 's3' && missingS3Env().length === 0;
}

function cloudMediaStorageRequired() {
  return process.env.NODE_ENV === 'production'
    || ['1', 'true', 'yes', 'on'].includes(String(process.env.REQUIRE_CLOUD_MEDIA_STORAGE || '').toLowerCase());
}

function assertCloudMediaStorageConfigured() {
  const provider = mediaStorageProvider();
  if (provider !== 's3') {
    throw storageError('Cloud media storage is not configured. Set MEDIA_STORAGE_PROVIDER=s3 before accepting uploaded media.', 503);
  }
  const missing = missingS3Env();
  if (missing.length) {
    throw storageError(`Cloud media storage is missing required environment variables: ${missing.join(', ')}`, 503);
  }
}

function isDataUrl(value = '') {
  return DATA_URL_RE.test(String(value || '').trim());
}

function parseDataUrl(dataUrl, { allowedMimeTypes, maxBytes, label = 'uploaded media' } = {}) {
  const match = String(dataUrl || '').trim().match(DATA_URL_RE);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  if (allowedMimeTypes?.length && !allowedMimeTypes.includes(mimeType)) {
    throw storageError(`${label} must be one of: ${allowedMimeTypes.join(', ')}`, 400);
  }
  const bytes = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (maxBytes && bytes.length > maxBytes) {
    throw storageError(`${label} is too large. Upload must be ${Math.floor(maxBytes / (1024 * 1024))}MB or smaller.`, 400);
  }
  return { bytes, mimeType };
}

function extensionForMime(mimeType = '') {
  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'text/plain': 'txt',
    'text/csv': 'csv'
  };
  return map[String(mimeType || '').toLowerCase()] || 'bin';
}

function publicUrlFor(key) {
  const base = String(process.env.S3_PUBLIC_BASE_URL || '').trim();
  if (!base) return undefined;
  return `${base.replace(/\/+$/, '')}/${normalizeObjectKey(key).split('/').map(encodePathSegment).join('/')}`;
}

function objectKeyFor({ keyPrefix = 'uploads', filename = '', mimeType = 'application/octet-stream' } = {}) {
  const safePrefix = normalizeObjectKey(keyPrefix || 'uploads');
  const safeName = cleanSegment(filename || '');
  const ext = extensionForMime(mimeType);
  const basename = safeName && safeName.includes('.') ? safeName.replace(/\.[^.]+$/, '') : (safeName || 'media');
  return normalizeObjectKey(`${safePrefix}/${Date.now()}-${crypto.randomUUID()}-${basename}.${ext}`);
}

async function uploadBufferToS3({ bytes, mimeType, key, bucket: bucketOverride, fetchImpl = fetch } = {}) {
  assertCloudMediaStorageConfigured();

  const endpoint = new URL(process.env.S3_ENDPOINT);
  const bucket = String(bucketOverride || process.env.S3_BUCKET || '').trim();
  if (!bucket) {
    throw storageError('Cloud media upload bucket is missing.', 503);
  }
  const region = String(process.env.S3_REGION || 'auto').trim() || 'auto';
  const accessKey = String(process.env.S3_ACCESS_KEY_ID || '').trim();
  const secret = String(process.env.S3_SECRET_ACCESS_KEY || '').trim();
  const objectKey = normalizeObjectKey(key);
  const payloadHash = sha256Hex(bytes);
  const { dateStamp, amzDate } = dateParts();
  const canonicalUri = canonicalUriFor(endpoint, bucket, objectKey);
  const uploadUrl = `${endpoint.origin}${canonicalUri}`;
  const headers = {
    host: endpoint.host,
    'content-type': mimeType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate
  };
  const { canonicalHeaders, signedHeaderNames } = signedHeaders(headers);
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaderNames, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(secret, dateStamp, region)).update(stringToSign).digest('hex');

  const response = await fetchImpl(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mimeType,
      'X-Amz-Content-Sha256': payloadHash,
      'X-Amz-Date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`
    },
    body: new Uint8Array(bytes)
  });

  if (!response.ok) {
    throw storageError(`Cloud media upload failed: ${response.status} ${await response.text()}`, 502);
  }

  return {
    provider: 's3',
    key: objectKey,
    internalRef: `s3://${bucket}/${objectKey}`,
    publicUrl: publicUrlFor(objectKey),
    bytes: bytes.length,
    sha256: payloadHash,
    mimeType
  };
}

function createSignedS3GetUrl(internalRef, { expiresSeconds = 300, now = new Date() } = {}) {
  assertCloudMediaStorageConfigured();
  const parsed = parseS3InternalRef(internalRef);
  if (!parsed?.bucket || !parsed?.key) {
    throw storageError('Private media reference is not an S3 object.', 400);
  }

  const endpoint = new URL(process.env.S3_ENDPOINT);
  const region = String(process.env.S3_REGION || 'auto').trim() || 'auto';
  const accessKey = String(process.env.S3_ACCESS_KEY_ID || '').trim();
  const secret = String(process.env.S3_SECRET_ACCESS_KEY || '').trim();
  const safeExpires = Math.min(900, Math.max(60, parseInt(expiresSeconds, 10) || 300));
  const { dateStamp, amzDate } = dateParts(now);
  const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const canonicalUri = canonicalUriFor(endpoint, parsed.bucket, parsed.key);
  const headers = { host: endpoint.host };
  const { canonicalHeaders, signedHeaderNames } = signedHeaders(headers);
  const baseQuery = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKey}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(safeExpires),
    'X-Amz-SignedHeaders': signedHeaderNames
  };
  const unsignedQuery = canonicalQueryString(baseQuery);
  const canonicalRequest = ['GET', canonicalUri, unsignedQuery, canonicalHeaders, signedHeaderNames, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(secret, dateStamp, region)).update(stringToSign).digest('hex');

  return {
    url: `${endpoint.origin}${canonicalUri}?${unsignedQuery}&X-Amz-Signature=${signature}`,
    expiresSeconds: safeExpires,
    expiresAt: new Date(now.getTime() + (safeExpires * 1000)).toISOString(),
    bucket: parsed.bucket,
    key: parsed.key
  };
}

async function storeRemoteImageUrl(remoteUrl, options = {}) {
  const raw = String(remoteUrl || '').trim();
  if (!raw) return null;
  let parsedUrl;
  try {
    parsedUrl = new URL(raw);
  } catch (_) {
    throw storageError(`${options.label || 'remote image'} must be a valid URL.`, 400);
  }
  if (parsedUrl.protocol !== 'https:') {
    throw storageError(`${options.label || 'remote image'} must use HTTPS.`, 400);
  }
  if (!cloudMediaStorageConfigured()) {
    if (cloudMediaStorageRequired()) assertCloudMediaStorageConfigured();
    return null;
  }
  const allowedHosts = Array.isArray(options.allowedHosts) ? options.allowedHosts.map((host) => String(host || '').toLowerCase()) : [];
  if (allowedHosts.length && !allowedHosts.some((host) => parsedUrl.hostname.toLowerCase() === host || parsedUrl.hostname.toLowerCase().endsWith(`.${host}`))) {
    throw storageError(`${options.label || 'remote image'} host is not allowed for remote caching.`, 400);
  }
  const allowedMimeTypes = options.allowedMimeTypes || ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const maxBytes = options.maxBytes || (4 * 1024 * 1024);
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(raw, {
    headers: {
      Accept: allowedMimeTypes.join(', '),
      'User-Agent': options.userAgent || 'makaug-source-preview-cache/1.0',
    },
  });
  if (!response.ok) {
    throw storageError(`${options.label || 'remote image'} download failed: ${response.status}`, 502);
  }
  const mimeType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
  if (allowedMimeTypes.length && !allowedMimeTypes.includes(mimeType)) {
    throw storageError(`${options.label || 'remote image'} must be one of: ${allowedMimeTypes.join(', ')}`, 400);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (maxBytes && bytes.length > maxBytes) {
    throw storageError(`${options.label || 'remote image'} is too large. Upload must be ${Math.floor(maxBytes / (1024 * 1024))}MB or smaller.`, 400);
  }
  const key = objectKeyFor({
    keyPrefix: options.keyPrefix || 'remote-images',
    filename: options.filename || parsedUrl.pathname.split('/').pop() || options.label || 'remote-image',
    mimeType,
  });
  const stored = await uploadBufferToS3({
    bytes,
    mimeType,
    key,
    bucket: options.bucket,
    fetchImpl: options.uploadFetchImpl || fetchImpl,
  });
  return options.isPrivate ? stored.internalRef : (stored.publicUrl || stored.internalRef);
}

async function storeDataUrl(dataUrl, options = {}) {
  if (!isDataUrl(dataUrl)) return null;
  if (!cloudMediaStorageConfigured()) {
    if (cloudMediaStorageRequired()) assertCloudMediaStorageConfigured();
    return null;
  }
  const parsed = parseDataUrl(dataUrl, options);
  if (!parsed) return null;
  const key = objectKeyFor({
    keyPrefix: options.keyPrefix,
    filename: options.filename || options.label,
    mimeType: parsed.mimeType
  });
  const stored = await uploadBufferToS3({ bytes: parsed.bytes, mimeType: parsed.mimeType, key });
  return options.isPrivate ? stored.internalRef : (stored.publicUrl || stored.internalRef);
}

async function prepareMediaUrlForStorage(value, options = {}) {
  const raw = String(value || '').trim();
  if (!isDataUrl(raw)) return raw;
  const storedUrl = await storeDataUrl(raw, options);
  return storedUrl || raw;
}

async function prepareUploadObjectForStorage(upload, options = {}) {
  if (!upload || typeof upload !== 'object' || !upload.data_url) return upload;
  const storedUrl = await storeDataUrl(upload.data_url, {
    ...options,
    filename: upload.name || options.filename,
    label: options.label || upload.name || 'uploaded media'
  });
  if (!storedUrl) return upload;
  return {
    ...upload,
    data_url: undefined,
    url: storedUrl,
    storage_provider: 's3'
  };
}

module.exports = {
  assertCloudMediaStorageConfigured,
  cloudMediaStorageConfigured,
  cloudMediaStorageRequired,
  isDataUrl,
  mediaStorageProvider,
  missingS3Env,
  prepareMediaUrlForStorage,
  prepareUploadObjectForStorage,
  parseS3InternalRef,
  createSignedS3GetUrl,
  uploadBufferToS3,
  storeDataUrl,
  storeRemoteImageUrl
};
