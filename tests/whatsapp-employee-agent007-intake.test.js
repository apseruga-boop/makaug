'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  EMPLOYEE_INTAKE_STEPS,
  employeeIntakePhoneAllowed,
  isEmployeeIntakeComplete,
  isEmployeeIntakeTrigger,
  parseCustomerDetails,
  parseEmployeeRole,
  parseNewAgentDetails,
  parseYesNo
} = require('../services/whatsappEmployeeIntakeService');

assert.equal(isEmployeeIntakeTrigger('Agent 007'), true, 'exact Agent 007 trigger should start staff intake');
assert.equal(isEmployeeIntakeTrigger('  agent   007  '), true, 'spacing and case should be normalized');
assert.equal(isEmployeeIntakeTrigger('Agent 007 please'), false, 'trigger must not match surrounding prose');
assert.equal(parseEmployeeRole('1'), 'agent');
assert.equal(parseEmployeeRole('new customer'), 'customer');
assert.equal(parseYesNo('yes'), 'yes');
assert.equal(parseYesNo('2'), 'no');
assert.deepEqual(parseNewAgentDetails('Francis Isabirye | +256 768 524008 | Francis Homes | Kampala'), {
  fullName: 'Francis Isabirye',
  phone: '+256 768 524008',
  company: 'Francis Homes',
  district: 'Kampala'
});
assert.deepEqual(parseCustomerDetails('Arthur Seruga | +44 7757 773202 | Kira, Wakiso'), {
  fullName: 'Arthur Seruga',
  phone: '+44 7757 773202',
  location: 'Kira, Wakiso'
});
assert.equal(parseCustomerDetails('Arthur only'), null, 'customer detail collection should fail closed');
assert.equal(isEmployeeIntakeComplete('COMPLETE'), true);
assert.equal(isEmployeeIntakeComplete('complete complete'), true);
assert.equal(isEmployeeIntakeComplete('complete this'), false);
assert.equal(employeeIntakePhoneAllowed('+44 7757 773202', { allowlist: '', ownerAuthorized: false }), true, 'empty allowlist preserves exact-trigger mode');
assert.equal(employeeIntakePhoneAllowed('+44 7757 773202', { allowlist: '+447757773202,+256700000000', ownerAuthorized: false }), true);
assert.equal(employeeIntakePhoneAllowed('+44 7757 773202', { allowlist: '+44 7757 773202; +256 700 000000', ownerAuthorized: false }), true, 'formatted allowlist numbers should remain whole');
assert.equal(employeeIntakePhoneAllowed('+44 7000 000000', { allowlist: '+447757773202', ownerAuthorized: false }), false);
assert.equal(employeeIntakePhoneAllowed('+44 7000 000000', { allowlist: '+447757773202', ownerAuthorized: true }), true, 'owner control phone remains authorized');
assert(EMPLOYEE_INTAKE_STEPS.includes('employee_identity_photo'));
assert(EMPLOYEE_INTAKE_STEPS.includes('employee_property_media'));

const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
const copilotSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'whatsapp-web-copilot.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const whatsappRoute = require('../routes/whatsapp').__test;
const parsedProperty = whatsappRoute.employeePropertyFacts(
  '2 bedroom apartment for rent in Ntinda, Kampala at UGX 1.5m per month',
  {}
);

assert.equal(parsedProperty.listingType, 'rent');
assert.equal(parsedProperty.price, 1_500_000);
assert.equal(parsedProperty.bedroomDraft.bedrooms, 2, 'decimal prices must not overwrite the explicit bedroom count');
assert.equal(parsedProperty.locationPatch.area, 'Ntinda');
assert.equal(parsedProperty.locationPatch.district, 'Kampala');
assert.deepEqual(whatsappRoute.employeePropertyMissing(parsedProperty), []);

assert(routeSource.includes("const WHATSAPP_EMPLOYEE_AGENT_007_MARKER = 'whatsapp-employee-agent-007-review-intake-20260829'"));
assert(routeSource.includes("$16,'pending','submitted','whatsapp','whatsapp_employee_intake'"), 'employee properties must enter staff review as pending');
assert(routeSource.includes('review_only: true') && routeSource.includes('auto_publish: false'), 'review-only and no-autopublish gates are required');
assert(routeSource.includes("'whatsapp-employee-agent-007','whatsapp_employee_intake_queued','pending','pending'"), 'moderation history must retain pending status');
assert(routeSource.includes('whatsapp_employee_property_review_queued'), 'each property should create a notification/audit record');
assert(routeSource.includes('whatsapp_employee_batch_complete'), 'completed batches should create a WhatsApp notification record');
assert(routeSource.includes("keyPrefix: privateMedia ? 'whatsapp-employee-intake/private-id'"), 'ID media must use private cloud storage');
assert(routeSource.includes('id_document_name, id_document_url, extra_fields'), 'customer ID must use protected property identity columns');
assert(!routeSource.includes('customer_identity_document_url'), 'private ID references must never be copied into public extra fields');
assert(routeSource.includes('agent_profile_linked: Boolean(agent?.id)'), 'approved agent link state must be visible to moderation');
assert(routeSource.includes('video_urls: videoMedia.map'), 'video references must be preserved for staff review');
assert(routeSource.includes('document_urls: documentMedia.map'), 'document references must be preserved for staff review');
assert(routeSource.includes('media_sha256'), 'media deduplication hashes must be persisted');
assert(routeSource.includes('source_caption_sha256') && routeSource.includes("status IN ('pending','approved')"), 'property-level duplicate checks must cover pending and approved inventory');
assert(!routeSource.includes("source = 'whatsapp_employee_intake' AND status = 'approved'"), 'employee intake must never auto-approve');
assert(copilotSource.includes('async function hydrateVideoSnapshot'), 'WhatsApp Web bridge should download video bytes');
assert(copilotSource.includes('media_previews:'), 'WhatsApp Web bridge should transmit non-image media bytes');
assert(serverSource.includes('whatsapp-employee-agent-007-review-intake-20260829'), 'release marker should be externally verifiable');

const db = require('../config/database');
const originalQuery = db.query;

(async () => {
  const updates = [];
  db.query = async (sql, params = []) => {
    if (/UPDATE whatsapp_sessions/i.test(sql)) {
      updates.push({ sql, params });
      return { rows: [] };
    }
    if (/FROM agents/i.test(sql)) {
      return {
        rows: [{
          id: '11111111-1111-4111-8111-111111111111',
          full_name: 'Francis Isabirye',
          company_name: 'Francis Homes',
          phone: '+256768524008',
          whatsapp: '+256768524008',
          email: null
        }]
      };
    }
    if (/INSERT INTO notifications/i.test(sql)) return { rows: [{ id: 'notification-test' }] };
    throw new Error(`Unexpected test query: ${String(sql).slice(0, 80)}`);
  };

  const triggered = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: 'Agent 007',
    session: { current_step: 'main_menu', session_data: {} }
  });
  assert.equal(triggered.nextStep, 'employee_intake_role');
  assert.match(triggered.message, /Agent|employee intake/i);

  const role = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: 'agent',
    session: { current_step: 'employee_intake_role', session_data: { property_ids: [] } }
  });
  assert.equal(role.nextStep, 'employee_agent_existing');

  const existing = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: 'yes',
    session: { current_step: 'employee_agent_existing', session_data: { employee_role: 'agent' } }
  });
  assert.equal(existing.nextStep, 'employee_agent_lookup');

  const found = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: 'Francis Isabirye',
    session: { current_step: 'employee_agent_lookup', session_data: { employee_role: 'agent' } }
  });
  assert.equal(found.nextStep, 'employee_agent_confirm');
  assert.match(found.message, /Francis Isabirye/);

  const confirmed = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: '1',
    session: {
      current_step: 'employee_agent_confirm',
      session_data: {
        employee_role: 'agent',
        agent_candidates: [{
          id: '11111111-1111-4111-8111-111111111111',
          full_name: 'Francis Isabirye',
          company_name: 'Francis Homes',
          phone: '+256768524008',
          whatsapp: '+256768524008',
          email: null
        }]
      }
    }
  });
  assert.equal(confirmed.nextStep, 'employee_property_media');
  assert.match(confirmed.message, /COMPLETE/);

  const completed = await whatsappRoute.handleEmployeeWhatsappIntake({
    phone: '+447757773202',
    body: 'COMPLETE',
    session: {
      current_step: 'employee_property_media',
      session_data: {
        employee_role: 'agent',
        property_ids: ['22222222-2222-4222-8222-222222222222'],
        total_media_count: 7
      }
    }
  });
  assert.equal(completed.nextStep, 'main_menu');
  assert.equal(completed.batchComplete, true);
  assert.match(completed.message, /1 property is now in staff review/);
  assert.match(completed.message, /Nothing is live/);
  assert.equal(updates.length, 6, 'each state transition should persist immediately');

  console.log('WhatsApp Agent 007 employee intake contract tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  db.query = originalQuery;
});
