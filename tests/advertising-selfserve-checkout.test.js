#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const route = fs.readFileSync(path.join(root, 'routes', 'advertising.js'), 'utf8');
const adminRoute = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
const sanitizer = fs.readFileSync(path.join(root, 'services', 'publicHtmlSanitizer.js'), 'utf8');

assert(html.includes('advertising-selfserve-checkout-20260724'), 'release marker should be present');
assert(html.includes('id="page-advertise"'), 'dedicated advertise page should render');
assert(html.includes('id="advertise-selfserve-form"'), 'self-serve wizard form should render');
assert(html.includes('hosted checkout'), 'hosted-checkout privacy copy should render');
assert(app.includes('initializeAdvertisingSelfServe'), 'advertise route should hydrate live packages and readiness');
const selfServeStart = app.indexOf('async function submitAdvertisingSelfServe');
const selfServeEnd = app.indexOf('const PAGE_ROUTE_MAP', selfServeStart);
const selfServeSource = app.slice(selfServeStart, selfServeEnd);
assert(selfServeSource.includes('/api/advertising/campaigns'), 'authenticated flow should create a campaign');
assert(!selfServeSource.includes('/payment-link'), 'self-serve submission must not create payment before review');
assert(selfServeSource.includes('is saved for review'), 'self-serve should explain that the campaign enters review');
assert(selfServeSource.includes('only after payment'), 'self-serve should explain the live payment gate');
assert(app.includes("openAuthSignUp('advertiser')"), 'anonymous inquiry should route to advertiser account');
assert(app.includes('async function adminSetAdCampaignPaymentLink'), 'King should be able to generate hosted payment after approval');
assert(app.includes('Approve the campaign creative before generating payment.'), 'King UI should enforce review before payment');
assert(app.includes('/api/advertising/campaigns/${encodeURIComponent(campaignId)}/payment-link'), 'approved campaign should use hosted payment endpoint');
assert(route.includes("router.get('/readiness'"), 'safe payment readiness endpoint should exist');
assert(route.includes('paymentProviderConfigured'), 'readiness should use provider service');
assert(route.includes("'draft','weekly'"), 'new campaigns should enter draft review status');
assert(route.includes("code: 'campaign_approval_required'"), 'payment endpoint should reject unapproved campaigns');
assert(route.includes("status IN ('created', 'pending')"), 'payment endpoint should reuse an active hosted link');
assert(adminRoute.includes("error: 'Advertiser approval is required before a campaign can go live.'"), 'admin route should require campaign approval');
assert(adminRoute.includes("error: 'Paid or waived payment status is required before a campaign can go live.'"), 'admin route should require payment before live');
assert(sanitizer.includes("'/advertise': ['page-advertise']"), 'SSR sanitizer should keep dedicated page');
assert(!sanitizer.includes("'/advertise': {\n    title: 'Advertise with makaug'"), 'legacy synthetic advertise shell should be removed');

console.log('advertising-selfserve-checkout tests passed');
