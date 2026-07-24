#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const admin = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

for (const token of ['query.category', 'query.location', 'query.date_from', 'query.date_to', 'query.bundle_tag']) {
  assert(admin.includes(token), `admin lead filters should include ${token}`);
}
assert(admin.includes("router.get('/leads-export.csv'"), 'protected CRM CSV route should exist');
assert(admin.includes('Content-Disposition'), 'CRM export should download as a file');
assert(admin.includes("/^[=+\\-@\\t\\r]/.test(text)"), 'CRM export must neutralize spreadsheet formulas');
assert(admin.includes("Object.prototype.hasOwnProperty.call(req.body, 'bundle_tag')"), 'lead patch should support bundle tags');
assert(html.includes('id="admin-crm-lead-filters"'), 'King CRM filters should render');
assert(html.includes('Export CSV'), 'King CRM export action should render');
assert(app.includes('applyAdminCrmLeadFilters'), 'CRM filters should call the server');
assert(app.includes('exportAdminCrmLeadsCsv'), 'CRM CSV download should be wired');
assert(app.includes('tagAdminCrmLeadBundle'), 'CRM bundle tags should be editable');

console.log('crm lead bundles/export tests passed');
