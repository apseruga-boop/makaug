'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const acorn = require('acorn');
const source = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
const functions = new Map(ast.body.filter((node) => node.type === 'FunctionDeclaration').map((node) => [node.id.name, source.slice(node.start, node.end)]));
const agentId = 'a1000000-0000-4000-8000-000000000001';
const listingId = 'b1000000-0000-4000-8000-000000000001';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function context(extra = {}) {
  const sandbox = {
    console, URLSearchParams, Date, crypto: { randomUUID: () => 'c1000000-0000-4000-8000-000000000001' },
    FormData: class { constructor(form) { this.values = form.values; } get(name) { return this.values[name] ?? null; } },
    adminEscape: esc, adminAttr: esc, adminAuthHeaders: () => ({ Authorization: 'Bearer fixture' }),
    ADMIN_AGENT_MANAGER_STATE: { detail: null, openId: agentId, rows: [] },
    ADMIN_PUBLIC_MANAGER_STATE: { page: 1, search: '', request: 0, detailRequest: 0, loaded: false },
    ADMIN_METHOD_KEYS: ['mtn_momo', 'cash', 'absa_usd'], ADMIN_METHOD_LABELS: { mtn_momo: 'MTN MoMo', cash: 'Cash' },
    howToVideosForContext: () => [], isPublishedHowToVideo: () => true,
    document: { querySelector: () => null, getElementById: () => null },
    toast() {}, adminRevenueData: {}, ...extra
  };
  vm.createContext(sandbox);
  for (const [name, body] of functions) {
    if (/^adminManager|^adminPublicManager|^adminAgentManager(?:Day$|PhotoHtml$|MessageTemplate$|WhatsAppHtml$|UpdateMessage|DetailHtml$|TrackerHtml$|ListingChip$|ListingActions$|Chip$|StatusChip$|PaymentChip$|IdChip$|IdDocChip$|IdNeededBadge$|CanApprove$|MissingList$|ApproveButton$|LicencePlaceholder$|DaysLeft$|ListingState$)|^(normalizeWhatsAppRecipient|buildWhatsAppUrl|adminUploadAgentProfilePhoto|setAdminWorkflowTab)$/.test(name)) vm.runInContext(body, sandbox);
  }
  return sandbox;
}
function form(values = {}) {
  const button = { disabled: false };
  const error = { textContent: '', classList: { add() {}, remove() {} } };
  return { dataset: {}, values, button, error, querySelector: (selector) => selector.includes('button') ? button : error };
}
const event = (currentTarget) => ({ currentTarget, preventDefault() {} });

test('listing titles link only to an API-provided public property path and escape content', () => {
  const c = context();
  assert.match(c.adminManagerPublicListingTitle({ title: '<Land>', public_url: `/property/${listingId}` }), /<a[^>]+href="\/property\//);
  assert.match(c.adminManagerPublicListingTitle({ title: '<Land>' }), /&lt;Land&gt;/);
  for (const public_url of ['javascript:alert(1)', 'https://evil.test/property/1', '/property/1?admin=1', '']) {
    assert.doesNotMatch(c.adminManagerPublicListingTitle({ title: '<Land>', public_url }), /<a/);
  }
});

test('history uses the all-time ledger total, renders receipts and reaches older pages', () => {
  const c = context();
  const html = c.adminManagerPaymentHistoryHtml('agent', agentId, { payment_summary: { lifetime_paid_ugx: 250000, payment_count: 27 }, payment_pagination: { page: 1, pages: 2, total: 27 }, payments: [{ amount_ugx: 50000, paid_at: '2026-10-01', reference: '<TX>', method: 'cash', period_start: '2026-10-01', period_end: '2026-10-31', verified_status: 'recorded' }] });
  assert.match(html, /Total paid: UGX 250,000/);
  assert.match(html, /27 receipt\(s\)/);
  assert.match(html, /UGX 50,000/);
  assert.match(html, /&lt;TX&gt;/);
  assert.match(html, /adminAgentManagerOpen\('[^']+', 2\)/);
  assert.match(html, /Page 1 of 2/);
});

test('received-payment form uses UGX methods and a distinct receipt action', () => {
  const c = context();
  const html = c.adminManagerPaymentFormHtml('agent', agentId);
  assert.match(html, /name="amount_ugx"[^>]+min="1"/);
  assert.match(html, /Record received payment/);
  assert.match(html, /value="mtn_momo"/);
  assert.doesNotMatch(html, /value="absa_usd"/);
});

test('a payment submit appends to the scoped ledger endpoint, blocks double submission and refreshes the manager', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const calls = [];
  let refreshed = 0;
  const c = context({ apiRequest: async (...args) => { calls.push(args); await pending; return { ok: true }; }, adminAgentManagerRefreshOpen: async () => { refreshed += 1; } });
  const f = form({ amount_ugx: '50000', method: 'mtn_momo', reference: 'MTN-1', paid_at: '2026-10-27', note: 'October' });
  const first = c.adminManagerRecordPayment(event(f), 'agent', agentId);
  await c.adminManagerRecordPayment(event(f), 'agent', agentId);
  assert.equal(calls.length, 1);
  assert.equal(f.button.disabled, true);
  finish(); await first;
  assert.equal(calls[0][0], `/api/admin/agent-manager/agents/${agentId}/payments`);
  assert.equal(calls[0][1].body.amount_ugx, 50000);
  assert.equal(calls[0][1].body.request_id, 'c1000000-0000-4000-8000-000000000001');
  assert.equal(calls[0][1].headers.Authorization, 'Bearer fixture');
  assert.equal(refreshed, 1);
  assert.equal(c.adminRevenueData, null);
  assert.equal(f.button.disabled, false);
});

test('retry after a lost response keeps the request ID, while changed payment data gets a new ID', async () => {
  const ids = []; let n = 0;
  const c = context({ crypto: { randomUUID: () => `request-${++n}` }, apiRequest: async (url, options) => { ids.push(options.body.request_id); throw new Error('Network interrupted'); } });
  const f = form({ amount_ugx: '50000', method: 'cash', paid_at: '2026-10-27' });
  await c.adminManagerRecordPayment(event(f), 'public', listingId);
  await c.adminManagerRecordPayment(event(f), 'public', listingId);
  f.values.amount_ugx = '60000';
  await c.adminManagerRecordPayment(event(f), 'public', listingId);
  assert.deepEqual(ids, ['request-1', 'request-1', 'request-2']);
  assert.equal(f.error.textContent, 'Network interrupted');
});

test('invalid receipt amount never reaches the API', async () => {
  let calls = 0;
  const c = context({ apiRequest: async () => { calls += 1; } });
  for (const amount of ['0', '-20', '0.5', 'wat', '9007199254740993']) {
    const f = form({ amount_ugx: amount, method: 'cash', paid_at: '2026-10-27' });
    await c.adminManagerRecordPayment(event(f), 'agent', agentId);
    assert.match(f.error.textContent, /whole UGX/);
  }
  assert.equal(calls, 0);
});

test('manual WhatsApp chooser opens the signed-in personal client with editable text and optional published guide', () => {
  const agent = { full_name: 'Charles Test', phone: '0780123456', tracker: { next_due: '2026-11-01' } };
  const c = context();
  const text = { value: 'My own edited message & date' };
  const link = {};
  const section = { querySelector: (selector) => selector.includes('-text') ? text : selector.includes('-link') ? link : { value: 'payment' } };
  c.document.querySelector = () => section;
  c.ADMIN_AGENT_MANAGER_STATE.detail = { agent };
  c.adminAgentManagerUpdateMessageLink();
  assert.equal(link.href, 'https://wa.me/256780123456?text=My%20own%20edited%20message%20%26%20date');
  const message = c.adminAgentManagerMessageTemplate(agent, 'payment', 'https://www.youtube.com/watch?v=guide');
  assert.match(message, /Charles/); assert.match(message, /1 Nov 2026/); assert.match(message, /Quick guide:/);
  assert.match(c.adminAgentManagerWhatsAppHtml(agent), /data-agent-message-text/);
  assert.match(c.adminAgentManagerWhatsAppHtml(agent), /https:\/\/wa.me\/256780123456/);
  assert.doesNotMatch(c.adminAgentManagerWhatsAppHtml(agent), /billing-message|\/send|Send automatically/);
});

test('Public begins empty, never fabricates a lister, and provides explicit first-payment selection', () => {
  const c = context();
  const html = c.adminPublicManagerHtml({ data: [], pagination: { total: 0, totalPages: 1 } });
  assert.match(html, /No paid public listings yet/);
  assert.match(html, /Record a public lister's first payment/);
  assert.doesNotMatch(html, /onclick="adminPublicManagerOpen/);
});

test('Public reads authenticated real pages, ignores stale list responses and shows failures visibly', async () => {
  const root = { innerHTML: '' }; const pending = [];
  const c = context({ document: { getElementById: () => root }, apiRequest: (url, options) => new Promise((resolve, reject) => pending.push({ url, options, resolve, reject })) });
  const older = c.adminPublicManagerLoad(1); const newer = c.adminPublicManagerLoad(2);
  assert.match(pending[1].url, /page=2/);
  assert.equal(pending[1].options.headers.Authorization, 'Bearer fixture');
  pending[1].resolve({ data: [{ id: listingId, title: 'Second page', lifetime_paid_ugx: 20000 }], pagination: { totalPages: 2 } }); await newer;
  pending[0].resolve({ data: [{ id: listingId, title: 'Stale page' }] }); await older;
  assert.match(root.innerHTML, /Second page/); assert.doesNotMatch(root.innerHTML, /Stale page/);
  const failed = c.adminPublicManagerLoad(3); pending[2].reject(new Error('Permission denied')); await failed;
  assert.match(root.innerHTML, /Permission denied/); assert.match(root.innerHTML, /Try again/);
});

test('Manage photo preview reuses the existing upload and only displays safe image URLs', () => {
  const c = context();
  const html = c.adminAgentManagerPhotoHtml({ id: agentId, status: 'approved', profile_photo_url: 'https://example.test/logo.png', full_name: 'Charles' });
  assert.match(html, /data-agent-profile-photo-preview/); assert.match(html, /adminUploadAgentProfilePhoto/); assert.match(html, /manager: true/); assert.match(html, /\/agents\//);
  assert.doesNotMatch(c.adminAgentManagerPhotoHtml({ profile_photo_url: 'javascript:alert(1)' }), /<img/);
  assert.doesNotMatch(c.adminAgentManagerPhotoHtml({ profile_photo_url: 'data:image\/svg+xml;base64,SVG' }), /<img/);
});

test('taking down a listing records an explicit reason and cancellation makes no change', async () => {
  let reason = 'Owner withdrew the property'; const calls = [];
  const c = context({ window: { confirm: () => true, prompt: () => reason }, apiRequest: async (...args) => { calls.push(args); }, adminAgentManagerRefreshOpen: async () => {} });
  await c.adminAgentManagerListingState(listingId, 'take_down');
  assert.equal(calls[0][1].body.reason, reason);
  reason = null; await c.adminAgentManagerListingState(listingId, 'take_down');
  assert.equal(calls.length, 1);
});

test('Public tab activates its own panel and lazy-loads its paid roster', () => {
  const panel = (name) => ({ dataset: { adminTabPanel: name }, hidden: false, classList: { toggle(key, value) { this[key] = value; } } });
  const panels = [panel('agents'), panel('public')];
  let loaded = 0;
  const c = context({ activeAdminWorkflowTab: 'agents', closeAdminReviewPanel() {}, adminScheduleDashboardRefreshForTab() {}, document: { querySelectorAll: (selector) => selector === '[data-admin-tab-panel]' ? panels : [] } });
  c.adminPublicManagerEnsureLoaded = () => { loaded += 1; };
  c.setAdminWorkflowTab('public');
  assert.equal(c.activeAdminWorkflowTab, 'public');
  assert.equal(panels[0].classList.hidden, true);
  assert.equal(panels[1].classList.hidden, false);
  assert.equal(loaded, 1);
});

test('agent history pagination keeps the newest requested page when responses finish out of order', async () => {
  const pending = [];
  const body = { innerHTML: '' };
  const overlay = { classList: { remove() {}, add() {} }, querySelector: () => body };
  const c = context({ apiRequest: (url) => new Promise((resolve) => pending.push({ url, resolve })), adminAgentManagerRoot: () => ({ dataset: { agentManagerReady: true } }), adminAgentManagerOverlay: () => overlay });
  c.ADMIN_AGENT_MANAGER_STATE.detailRequest = 0;
  c.adminAgentManagerDetailHtml = (data) => `Showing ${data.page}`;
  vm.runInContext(functions.get('adminAgentManagerOpen'), c);
  const first = c.adminAgentManagerOpen(agentId, 1);
  const second = c.adminAgentManagerOpen(agentId, 2);
  assert.match(pending[1].url, /payments_page=2/);
  pending[1].resolve({ data: { agent: { id: agentId }, page: 2 } }); await second;
  pending[0].resolve({ data: { agent: { id: agentId }, page: 1 } }); await first;
  assert.equal(body.innerHTML, 'Showing 2');
});
