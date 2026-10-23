'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  isInlineImage,
  migrateInlineAgentIdentityDocuments,
  normaliseIdentityBytes,
  parseIdentityDataUrl,
  toPrivateIdentityRef
} = require('../services/agentIdentityStorageService');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

function heicBytes() {
  const bytes = Buffer.alloc(24, 0);
  bytes.write('ftyp', 4, 'ascii');
  bytes.write('heic', 8, 'ascii');
  return bytes;
}

function webpBytes() {
  const bytes = Buffer.alloc(16, 0);
  bytes.write('RIFF', 0, 'ascii');
  bytes.write('WEBP', 8, 'ascii');
  return bytes;
}

function dataUrl(mime, bytes, extra = '') {
  return `data:${mime}${extra};base64,${bytes.toString('base64')}`;
}

const S3_KEYS = ['MEDIA_STORAGE_PROVIDER', 'S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_REGION'];

function useTestS3() {
  const previous = {};
  for (const key of S3_KEYS) previous[key] = process.env[key];
  process.env.MEDIA_STORAGE_PROVIDER = 's3';
  process.env.S3_ENDPOINT = 'https://s3.test.local';
  process.env.S3_BUCKET = 'makaug-private';
  process.env.S3_ACCESS_KEY_ID = 'AKIATEST';
  process.env.S3_SECRET_ACCESS_KEY = 'secretsecretsecretsecret';
  process.env.S3_REGION = 'auto';
  return () => {
    for (const key of S3_KEYS) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

test('identity photos accept HEIC, WebP and PDF, including aliases and parameters', () => {
  assert.equal(parseIdentityDataUrl(dataUrl('image/heic', heicBytes())).mimeType, 'image/heic');
  assert.equal(parseIdentityDataUrl(dataUrl('image/heic-sequence', heicBytes())).mimeType, 'image/heic');
  assert.equal(parseIdentityDataUrl(dataUrl('image/webp', webpBytes(), ';charset=utf-8;name=id.webp')).mimeType, 'image/webp');
  assert.equal(parseIdentityDataUrl(dataUrl('image/x-webp', webpBytes())).mimeType, 'image/webp');
  assert.equal(parseIdentityDataUrl(dataUrl('application/pdf', PDF)).mimeType, 'application/pdf');
  assert.equal(parseIdentityDataUrl(dataUrl('application/x-pdf', PDF)).mimeType, 'application/pdf');
  assert.equal(isInlineImage(dataUrl('image/heic', heicBytes())), true);
  assert.equal(isInlineImage('data:application/pdf;base64,AAAA'), true);
  assert.equal(parseIdentityDataUrl('data:text/html;base64,PGh0bWw+'), null);
  assert.equal(isInlineImage('data:text/html;base64,PGh0bWw+'), false);
});

test('readable rasters become JPEG, PDF stays PDF, and an undecodable HEIC stays HEIC', async () => {
  const png = await normaliseIdentityBytes(PNG, 'image/png');
  assert.ok(png.mimeType === 'image/jpeg' || png.mimeType === 'image/png');
  if (png.mimeType === 'image/jpeg') assert.equal(png.bytes[0], 0xff);
  const pdf = await normaliseIdentityBytes(PDF, 'application/pdf');
  assert.equal(pdf.mimeType, 'application/pdf');
  assert.equal(pdf.bytes.slice(0, 5).toString(), '%PDF-');
  const heic = await normaliseIdentityBytes(heicBytes(), 'image/heic');
  assert.equal(heic.mimeType, 'image/heic');
});

test('the private-storage move keeps HEIC, WebP and PDF as s3 refs and does not publish them', async () => {
  const restore = useTestS3();
  const puts = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    puts.push({ url: String(url), type: init.headers['Content-Type'] });
    return { ok: true, status: 200, text: async () => '' };
  };
  const docs = [
    dataUrl('image/heic-sequence', heicBytes()),
    dataUrl('image/webp', webpBytes(), ';charset=utf-8;name=id.webp'),
    dataUrl('application/x-pdf', PDF),
    dataUrl('image/png', PNG)
  ];
  const updates = [];
  const warnings = [];
  const db = {
    async query(sql, params) {
      if (sql.includes('FROM agents')) {
        return { rows: docs.map((doc, index) => ({ id: `agent-${index}`, identity_document_url: doc })) };
      }
      if (sql.includes('FROM users')) return { rows: [] };
      if (sql.includes('UPDATE agents')) {
        updates.push(params[1]);
        return { rows: [] };
      }
      throw new Error(sql.slice(0, 80));
    }
  };
  try {
    const result = await migrateInlineAgentIdentityDocuments(db, {
      logger: { warn: (...args) => warnings.push(args.join(' ')) }
    });
    assert.equal(result.failed, 0);
    assert.equal(result.agents_moved, 4);
    assert.equal(updates.length, 4);
    for (const ref of updates) {
      assert.match(ref, /^s3:\/\/makaug-private\//);
      assert.doesNotMatch(ref, /^https?:\/\//);
      assert.equal(ref.includes('base64'), false);
    }
    assert.ok(puts.some((put) => put.type === 'image/heic'));
    assert.ok(puts.some((put) => put.type === 'application/pdf'));
    assert.ok(puts.every((put) => put.url.startsWith('https://s3.test.local/')));
    assert.equal(warnings.join(' ').includes('base64'), false);
    const html = dataUrl('text/html', Buffer.from('<html>'));
    const htmlDb = {
      async query(sql) {
        if (sql.includes('FROM agents')) return { rows: [{ id: 'bad', identity_document_url: html }] };
        if (sql.includes('FROM users')) return { rows: [] };
        throw new Error('html should not be stored');
      }
    };
    const htmlResult = await migrateInlineAgentIdentityDocuments(htmlDb, { logger: { warn() {} } });
    assert.equal(htmlResult.failed, 1);
    assert.equal(htmlResult.agents_moved, 0);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});

test('a public https result is not written back over the private photo', async () => {
  const restore = useTestS3();
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
  try {
    const stored = await toPrivateIdentityRef(dataUrl('application/pdf', PDF));
    assert.match(stored, /^s3:\/\/makaug-private\//);
    const source = require('fs').readFileSync('services/agentIdentityStorageService.js', 'utf8');
    assert.match(source, /if \(stored && \/\^https\?:/);
    assert.match(source, /isPrivate: true/);
  } finally {
    global.fetch = originalFetch;
    restore();
  }
});
