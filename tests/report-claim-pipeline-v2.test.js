'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const app = read('assets/makaug-app.js');
const contactRoute = read('routes/contact.js');
const adminRoute = read('routes/admin.js');
const staffRoute = read('routes/staff.js');
const migration = read('db/migrations/078_report_claim_pipeline_v2.sql');

assert(html.includes('report-claim-pipeline-v2-20260718'), 'production shell must expose the report/claim pipeline marker');
assert(html.includes('report-structured-fields'), 'public report modal must render structured evidence fields');
assert(html.includes('admin-reports-queue'), 'King dashboard must include a Reports & Claims queue');
assert(html.includes('staff-reports-queue'), 'staff dashboard must include a Reports & Claims queue');

assert(migration.includes('request_type TEXT'), 'report_listings must store request type');
assert(migration.includes('structured_fields JSONB'), 'report_listings must store structured fields');
assert(migration.includes('linked_property_id UUID'), 'report_listings must store linked property id for hide actions');
assert(migration.includes('resolution_note TEXT'), 'report_listings must store moderator resolution note');
assert(migration.includes('idx_report_listings_status_created'), 'report queue must have a status/created index');

assert(contactRoute.includes('cleanStructuredReportFields'), 'contact route must clean structured request fields');
assert(contactRoute.includes('structured_fields'), 'contact route must persist structured request fields');
assert(contactRoute.includes('linked_property_id'), 'contact route must persist linked listing id');
assert(contactRoute.includes('request_type: requestType'), 'contact route must keep request type in lead metadata');
assert(contactRoute.includes('Structured Fields:'), 'admin email alert must include structured report evidence');

assert(adminRoute.includes("router.get('/reports'"), 'admin reports list endpoint must exist');
assert(adminRoute.includes("router.patch('/reports/:id/status'"), 'admin report status endpoint must exist');
assert(adminRoute.includes('listReportRows'), 'admin reports endpoint must use the full report queue row shape');
assert(adminRoute.includes('hidePropertyForReport'), 'admin report action must be able to hide linked listings');
assert(adminRoute.includes('Moderator note is required'), 'admin report action must require a moderator note');
assert(adminRoute.includes('notifyReporterOfReportOutcome'), 'admin report resolution must notify/log reporter outcome');
assert(adminRoute.includes('admin_report_status_updated'), 'admin report status changes must be audited');

assert(staffRoute.includes("router.get('/reports'"), 'staff reports list endpoint must exist');
assert(staffRoute.includes("router.patch('/reports/:id/status'"), 'staff report status endpoint must exist');
assert(staffRoute.includes('staffHidePropertyForReport'), 'staff report action must be able to hide linked listings');
assert(staffRoute.includes('staffNotifyReporterOutcome'), 'staff report resolution must notify/log reporter outcome');
assert(staffRoute.includes('staff_report_status_updated'), 'staff report status changes must be audited');

assert(app.includes('renderThirdPartyRequestStructuredFields'), 'public modal must render request-specific structured fields');
assert(app.includes('collectReportStructuredFields'), 'public modal must send structured fields');
assert(app.includes('reportQueueCardHtml'), 'dashboard queues must render report/claim cards');
assert(app.includes('refreshAdminReportsQueue'), 'King dashboard must load the report/claim queue');
assert(app.includes('refreshStaffReportsQueue'), 'staff dashboard must load the report/claim queue');
assert(app.includes('Resolve + hide listing'), 'dashboards must expose remove/hide action for actionable reports');
assert(app.includes('Third-party - unverified'), 'source box must show the third-party unverified trust chip');
assert(app.includes('Something wrong? Report or claim this listing'), 'source box must expose obvious report/claim actions');
assert(app.includes('makaug is showing it as a discovery result'), 'source box disclaimer must use lowercase makaug');
assert(!app.includes('<summary class="cursor-pointer list-none font-black">${translateListingLabel("More options / Report an issue")}</summary>'), 'source box must not hide actions behind the old report menu');

console.log('ok - report/claim pipeline v2 wiring present');
