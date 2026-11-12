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

const FN_NAMES = [
  'deskPageIsStaff',
  'adminDeskEl',
  'adminAgentManagerRoot',
  'adminPublicManagerRoot',
  'adminAgentManagerEnsureLoaded',
  'adminAgentManagerLoad',
  'adminAgentManagerRenderList',
  'adminAgentManagerShellHtml',
  'adminAgentManagerChip',
  'adminAgentManagerStatusChip',
  'adminAgentManagerPublicVisibility',
  'adminAgentManagerPaymentChip',
  'adminAgentManagerIdChip',
  'adminAgentManagerIdDocChip',
  'adminAgentManagerIdNeededBadge',
  'adminAgentManagerStaffAddedChip',
  'adminAgentManagerVerifiedChip',
  'adminAgentManagerCanApprove',
  'adminAgentManagerApproveButton',
  'adminAgentManagerDay',
  'adminAgentManagerDaysLeft',
  'adminAgentMoneyUgx',
  'adminAgentManagerTopPayers',
  'adminAgentManagerValueBadge',
  'adminAgentManagerPaidCell',
  'adminAgentManagerNextCell',
  'adminAgentManagerOwedCell',
  'adminAgentManagerMoneyChipsHtml',
  'adminAgentManagerSortRows',
  'staffPeopleDate'
];

const AGENT_ID = 'a1000000-0000-4000-8000-000000000001';
const MASKED_PHONE = '+256•••456';

function parseAttrs(raw) {
  const attrs = {};
  const re = /([:@]?[A-Za-z_:][\w:.-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match;
  while ((match = re.exec(raw || ''))) {
    attrs[match[1]] = match[3] ?? match[4] ?? match[5] ?? '';
  }
  return attrs;
}

function toDatasetKey(name) {
  return name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
}

class TokenList {
  constructor(el) {
    this.el = el;
  }
  _set() {
    return new Set(String(this.el.attrs.class || '').split(/\s+/).filter(Boolean));
  }
  _write(set) {
    this.el.attrs.class = [...set].join(' ');
  }
  contains(name) {
    return this._set().has(name);
  }
  add(name) {
    const set = this._set();
    set.add(name);
    this._write(set);
  }
  remove(name) {
    const set = this._set();
    set.delete(name);
    this._write(set);
  }
  toggle(name, force) {
    const set = this._set();
    const should = force == null ? !set.has(name) : !!force;
    if (should) set.add(name);
    else set.delete(name);
    this._write(set);
    return should;
  }
}

class El {
  constructor(tag, attrs = {}, children = []) {
    this.tag = String(tag || '').toLowerCase();
    this.attrs = { ...attrs };
    this.children = children;
    this.parent = null;
    this.classList = new TokenList(this);
    this.nodeType = this.tag === '#text' ? 3 : 1;
    this.text = this.tag === '#text' ? String(attrs.text || '') : '';
    const dataset = {};
    for (const [key, value] of Object.entries(this.attrs)) {
      if (key.startsWith('data-')) dataset[toDatasetKey(key)] = value;
    }
    this.dataset = new Proxy(dataset, {
      set: (target, prop, value) => {
        target[prop] = String(value);
        const attr = `data-${String(prop).replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`)}`;
        this.attrs[attr] = String(value);
        return true;
      }
    });
  }
  get id() {
    return this.attrs.id || '';
  }
  set id(value) {
    this.attrs.id = value;
  }
  get textContent() {
    if (this.tag === '#text') return this.text;
    return this.children.map((child) => child.textContent).join('');
  }
  set textContent(value) {
    this.children = [new El('#text', { text: String(value ?? '') })];
  }
  get innerHTML() {
    return this.children.map((child) => child.outerHTML).join('');
  }
  set innerHTML(value) {
    const parsed = parseFragment(String(value ?? ''));
    this.children = parsed;
    parsed.forEach((child) => { child.parent = this; });
  }
  get outerHTML() {
    if (this.tag === '#text') return escapeText(this.text);
    const attrs = Object.entries(this.attrs).map(([key, value]) => ` ${key}="${escapeAttr(value)}"`).join('');
    if (this.tag === '#document') return this.innerHTML;
    return `<${this.tag}${attrs}>${this.innerHTML}</${this.tag}>`;
  }
  appendChild(node) {
    if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node);
    node.parent = this;
    this.children.push(node);
    return node;
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
  querySelectorAll(sel) {
    return walk(this, false).filter((node) => node.matches(sel));
  }
  matches(sel) {
    if (this.tag === '#text' || this.tag === '#document') return false;
    const parts = String(sel || '').trim().split(/\s+/);
    if (parts.length > 1) return false;
    return matchSimple(this, parts[0]);
  }
}

function escapeText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escapeAttr(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}

function parseFragment(html) {
  const nodes = [];
  const stack = [];
  const re = /<!--[\s\S]*?-->|<\/([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  let match;
  const current = () => stack[stack.length - 1];
  const push = (node) => {
    const parent = current();
    if (parent) {
      node.parent = parent;
      parent.children.push(node);
    } else nodes.push(node);
  };
  while ((match = re.exec(html))) {
    if (match[0].startsWith('<!--')) continue;
    if (match[1]) {
      const tag = match[1].toLowerCase();
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    if (match[2]) {
      const node = new El(match[2], parseAttrs(match[3]));
      push(node);
      const voidish = /^(br|img|input|meta|link|hr|source)$/i.test(node.tag) || match[4] === '/';
      if (!voidish) stack.push(node);
      continue;
    }
    if (match[5] != null) push(new El('#text', { text: match[5] }));
  }
  return nodes;
}

function walk(root, includeSelf = true) {
  const out = [];
  const visit = (node, inc) => {
    if (inc && node.tag !== '#text') out.push(node);
    (node.children || []).forEach((child) => visit(child, true));
  };
  visit(root, includeSelf);
  return out;
}

function matchSimple(node, selector) {
  const re = /([.#]?\[?[A-Za-z_*][\w:-]*\]?|\[[^\]]+\])/g;
  const tokens = String(selector || '').match(re) || [];
  if (!tokens.length) return false;
  return tokens.every((token) => {
    if (token.startsWith('#')) return node.id === token.slice(1);
    if (token.startsWith('.')) return node.classList.contains(token.slice(1));
    if (token.startsWith('[')) {
      const body = token.slice(1, -1);
      const eq = body.indexOf('=');
      if (eq === -1) return Object.prototype.hasOwnProperty.call(node.attrs, body) || (body.startsWith('data-') && toDatasetKey(body) in node.dataset);
      const key = body.slice(0, eq);
      const val = body.slice(eq + 1).replace(/^["']|["']$/g, '');
      return String(node.attrs[key] ?? '') === val;
    }
    return token === '*' || node.tag === token.toLowerCase();
  });
}

function queryFrom(root, selector, includeRoot) {
  const parts = String(selector || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  let current = walk(root, includeRoot);
  const first = current.filter((node) => matchSimple(node, parts[0]));
  return parts.slice(1).reduce((found, part) => {
    const next = [];
    found.forEach((node) => {
      walk(node, false).forEach((child) => {
        if (matchSimple(child, part)) next.push(child);
      });
    });
    return next;
  }, first);
}

function createDocument(html) {
  const doc = new El('#document');
  doc.innerHTML = html;
  const body = doc.querySelector('body') || doc;
  doc.body = body;
  doc.getElementById = (id) => walk(doc, true).find((node) => node.id === id) || null;
  doc.querySelector = (sel) => queryFrom(doc, sel, true)[0] || null;
  doc.querySelectorAll = (sel) => queryFrom(doc, sel, true);
  return doc;
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function deskHtml({ kingActive = true } = {}) {
  const kingClass = kingActive ? 'page active' : 'page';
  const staffClass = kingActive ? 'page' : 'page active';
  return `
    <div id="page-admin-dashboard" class="${kingClass}">
      <div id="admin-agent-manager" data-agent-manager-root><p class="text-sm text-gray-500">Loading agents…</p></div>
      <div id="admin-public-manager" data-public-manager-root><p>Public stays here on King.</p></div>
      <div id="admin-accounts">King accounts</div>
    </div>
    <div id="page-staff-dashboard" class="${staffClass}">
      <div id="staff-agent-manager" data-agent-manager-root><p class="text-sm text-gray-500">Open Agents to load the list.</p></div>
      <div id="staff-public-manager" data-public-manager-root><p>Staff public copy.</p></div>
      <div id="staff-accounts">Staff accounts</div>
    </div>`;
}

function fixtureAgent() {
  return {
    id: AGENT_ID,
    full_name: 'Jane Example',
    company_name: 'Example Agency',
    phone: MASKED_PHONE,
    whatsapp: MASKED_PHONE,
    status: 'approved',
    makaug_agent_number: 'MK-A-1',
    created_at: '2026-11-01T09:00:00.000Z',
    has_nin: true,
    has_id_document: true,
    live_listings: 2,
    total_listings: 3,
    public_live_listings: 2,
    web_directory_visible: true,
    web_directory_reason: 'Approved agent with live public properties',
    payment: { key: 'paid', label: 'Paid' },
    tracker: { plan: 'monthly', next_due: '2026-12-01', days_left: 19, paid_until: '2026-12-01' },
    money: { paid_to_date_ugx: 150000, payment_count: 1, next_amount_ugx: 150000, owed_ugx: 0 },
    fee_exempt: false
  };
}

function context(html, extra = {}) {
  const document = createDocument(html);
  const state = { rows: [], counts: {}, show: 'active', search: '', missingOnly: false, only: '', sort: 'joined', loading: false, loadedAt: 0, openId: null, detail: null, detailRequest: 0 };
  const sandbox = {
    console,
    URLSearchParams,
    Date,
    document,
    authState: { token: 'fixture-token' },
    ADMIN_AGENT_MANAGER_STATE: state,
    adminEscape: esc,
    adminAttr: esc,
    adminAuthHeaders: () => ({ Authorization: 'Bearer fixture' }),
    toast() {},
    apiRequest: extra.apiRequest || (async () => ({})),
    ...extra
  };
  vm.createContext(sandbox);
  for (const name of FN_NAMES) {
    const body = functions.get(name);
    assert.ok(body, name);
    vm.runInContext(body, sandbox);
  }
  return sandbox;
}

test('deskPageIsStaff follows the active page, not a missing hidden class', () => {
  const king = context(deskHtml({ kingActive: true }));
  assert.equal(king.deskPageIsStaff(), false);
  assert.equal(king.adminAgentManagerRoot().id, 'admin-agent-manager');
  assert.equal(king.adminPublicManagerRoot().id, 'admin-public-manager');
  assert.equal(king.adminDeskEl('admin-accounts', 'staff-accounts').id, 'admin-accounts');

  const staff = context(deskHtml({ kingActive: false }));
  assert.equal(staff.deskPageIsStaff(), true);
  assert.equal(staff.adminAgentManagerRoot().id, 'staff-agent-manager');
  assert.equal(staff.adminPublicManagerRoot().id, 'staff-public-manager');
  assert.equal(staff.adminDeskEl('admin-accounts', 'staff-accounts').id, 'staff-accounts');
});

test('King Agents tab leaves “Loading agents…” when the list payload is valid, and does not write into the hidden staff copy', async () => {
  const agent = fixtureAgent();
  let requested = '';
  const c = context(deskHtml({ kingActive: true }), {
    apiRequest: async (url) => {
      requested = String(url);
      return {
        ok: true,
        data: [agent],
        counts: { active: 1, removed: 0, missing_id: 0, approved_missing_id: 0, pending: 0, due_date_set: 1 },
        money_totals: { collected_ugx: 150000, paying_agents: 1, due_next_cycle_ugx: 150000, overdue_ugx: 0, overdue_agents: 0, fee_ugx: 150000 }
      };
    }
  });

  const king = c.document.getElementById('admin-agent-manager');
  const staff = c.document.getElementById('staff-agent-manager');
  assert.match(king.innerHTML, /Loading agents…/);
  assert.match(staff.innerHTML, /Open Agents to load the list/);

  // EnsureLoaded is fire-and-forget; Load is the request the tab awaits in practice.
  c.adminAgentManagerEnsureLoaded();
  await c.adminAgentManagerLoad();

  assert.match(requested, /\/api\/admin\/agent-manager\/agents/);
  assert.doesNotMatch(king.innerHTML, /Loading agents…/);
  assert.match(king.innerHTML, /Jane Example/);
  assert.match(king.innerHTML, /\+256•••456/);
  assert.doesNotMatch(king.innerHTML, /256\d{9}/);
  assert.equal(king.dataset.agentManagerReady, '1');
  assert.match(staff.innerHTML, /Open Agents to load the list/);
  assert.doesNotMatch(staff.innerHTML, /Jane Example/);
  assert.doesNotMatch(staff.innerHTML, /Loading agents…/);
});

test('Staff Agents tab still loads into the staff copy when that desk is active', async () => {
  const c = context(deskHtml({ kingActive: false }), {
    apiRequest: async () => ({ ok: true, data: [fixtureAgent()], counts: { active: 1 }, money_totals: null })
  });
  await c.adminAgentManagerLoad();
  const king = c.document.getElementById('admin-agent-manager');
  const staff = c.document.getElementById('staff-agent-manager');
  assert.match(king.innerHTML, /Loading agents…/);
  assert.doesNotMatch(staff.innerHTML, /Loading agents…/);
  assert.match(staff.innerHTML, /Jane Example/);
});
