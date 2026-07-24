'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const contact = read('routes/contact.js');
const app = read('assets/makaug-app.js');
const html = read('index.html');

assert(contact.includes("Listing request was saved but CRM lead linking failed"), 'a CRM failure must not invalidate a saved removal request');
assert(contact.includes("follow_up_degraded: Boolean(leadLinkError)"), 'response must disclose degraded follow-up without failing');
assert(contact.includes("reference: report.id"), 'successful submissions must return a stable report reference');
assert(html.includes('id="report-submit-status"'), 'report modal must include an accessible inline status');
assert(app.includes('Reference') && app.includes('report-submit-status'), 'report UI must display the saved reference');
assert(app.includes('Could not submit report. Please try again.'), 'report UI must surface submission errors');
assert(!/await createLead\(db,[\\s\\S]{0,1200}return res\\.status\\(201\\)/.test(contact), 'lead creation must be isolated from report persistence');

console.log('listing removal flow tests passed');
