'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { adminRouter, publicRouter, staffRouter } = require('../routes/off-plan');

test('management routers start with their authentication middleware', () => {
  assert.equal(staffRouter.stack[0]?.name, 'requireStaffAccess');
  assert.equal(adminRouter.stack[0]?.name, 'requireAdminApiKey');
});

test('public router exposes read, calculator and enquiry routes without management writes', () => {
  const paths = publicRouter.stack.map((layer) => layer.route?.path).filter(Boolean);
  assert.ok(paths.includes('/'));
  assert.ok(paths.includes('/calculate'));
  assert.ok(paths.includes('/enquiries'));
  assert.ok(paths.includes('/:slug'));
  assert.ok(!paths.includes('/developments'));
});
