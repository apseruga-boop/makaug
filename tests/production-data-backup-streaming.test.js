'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { uploadFile } = require('../scripts/run-production-data-backup');

test('production backups stream large objects without buffering through fetch', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'makaug-backup-stream-test-'));
  const fixturePath = path.join(workspace, 'fixture.bin');
  const fixture = Buffer.alloc(8 * 1024 * 1024, 0x5a);
  fs.writeFileSync(fixturePath, fixture);

  let receivedBytes = 0;
  const receivedHash = crypto.createHash('sha256');
  const server = http.createServer((request, response) => {
    assert.equal(request.method, 'PUT');
    request.on('data', (chunk) => {
      receivedBytes += chunk.length;
      receivedHash.update(chunk);
    });
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.close();
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const previous = {};
  for (const name of ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'DATA_BACKUP_BUCKET']) {
    previous[name] = process.env[name];
  }
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const address = server.address();
  process.env.S3_ENDPOINT = `http://127.0.0.1:${address.port}`;
  process.env.S3_REGION = 'auto';
  process.env.S3_ACCESS_KEY_ID = 'test-access-key';
  process.env.S3_SECRET_ACCESS_KEY = 'test-secret-key';
  process.env.DATA_BACKUP_BUCKET = 'test-backups';

  const result = await uploadFile({
    filePath: fixturePath,
    key: 'test/fixture.bin',
    contentType: 'application/octet-stream'
  });

  const expectedHash = crypto.createHash('sha256').update(fixture).digest('hex');
  assert.equal(result.bytes, fixture.length);
  assert.equal(result.sha256, expectedHash);
  assert.equal(receivedBytes, fixture.length);
  assert.equal(receivedHash.digest('hex'), expectedHash);
});
