'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { adminRouter, publicRouter, staffRouter, whatsappEnquiryUrl } = require('../routes/off-plan');

test('management routers start with their authentication middleware', () => {
  assert.equal(staffRouter.stack[0]?.name, 'requireStaffAccess');
  assert.equal(adminRouter.stack[0]?.name, 'requireAdminApiKey');
});

test('only the admin router exposes permanent deletion', () => {
  const hasDeleteRoute = (router) => router.stack.some((layer) => layer.route?.path === '/developments/:id' && layer.route.methods.delete);
  assert.equal(hasDeleteRoute(staffRouter), false);
  assert.equal(hasDeleteRoute(adminRouter), true);
});

test('project enquiries route WhatsApp to the approved project contact', () => {
  const url = new URL(whatsappEnquiryUrl({
    enquiry_type: 'project_interest',
    name: 'QA Customer'
  }, {
    name: 'Entebbe Victoria Palms',
    source_agent_name: 'Kazi Honest',
    source_agent_whatsapp: '+256 700 123 456'
  }));
  assert.equal(url.pathname, '/256700123456');
  assert.match(url.searchParams.get('text'), /Hi Kazi Honest, my name is QA Customer/);
  assert.match(url.searchParams.get('text'), /Entebbe Victoria Palms/);
});

test('public router exposes read, calculator and enquiry routes without management writes', () => {
  const paths = publicRouter.stack.map((layer) => layer.route?.path).filter(Boolean);
  assert.ok(paths.includes('/'));
  assert.ok(paths.includes('/calculate'));
  assert.ok(paths.includes('/enquiries'));
  assert.ok(paths.includes('/:slug'));
  assert.ok(!paths.includes('/developments'));
});
