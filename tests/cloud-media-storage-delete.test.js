'use strict';

const assert = require('assert');
const {
  deleteStoredS3Object,
  parseStoredS3ObjectRef
} = require('../services/cloudMediaStorageService');

const previous = {
  MEDIA_STORAGE_PROVIDER: process.env.MEDIA_STORAGE_PROVIDER,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_REGION: process.env.S3_REGION,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  S3_PUBLIC_BASE_URL: process.env.S3_PUBLIC_BASE_URL
};

Object.assign(process.env, {
  MEDIA_STORAGE_PROVIDER: 's3',
  S3_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
  S3_REGION: 'auto',
  S3_BUCKET: 'makaug-media',
  S3_ACCESS_KEY_ID: 'test-access-key',
  S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_PUBLIC_BASE_URL: 'https://media.makaug.test'
});

(async () => {
  assert.deepEqual(
    parseStoredS3ObjectRef('https://media.makaug.test/whatsapp-employee-intake/source-evidence/id%20frame.jpg'),
    { bucket: 'makaug-media', key: 'whatsapp-employee-intake/source-evidence/id frame.jpg' }
  );
  assert.equal(parseStoredS3ObjectRef('https://foreign.example/id-frame.jpg'), null);

  let request = null;
  const deleted = await deleteStoredS3Object(
    'https://media.makaug.test/whatsapp-employee-intake/source-evidence/id-frame.jpg',
    {
      fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, status: 204, text: async () => '' };
      }
    }
  );
  assert.equal(deleted.deleted, true);
  assert.equal(request.options.method, 'DELETE');
  assert.equal(
    request.url,
    'https://example.r2.cloudflarestorage.com/makaug-media/whatsapp-employee-intake/source-evidence/id-frame.jpg'
  );
  assert.match(request.options.headers.Authorization, /^AWS4-HMAC-SHA256 /);
  console.log('Cloud media object deletion checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
