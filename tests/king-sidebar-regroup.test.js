'use strict';
// King sidebar regroup (Arthur approved 21 Nov 2026): 20 items → 16, no tab or function lost.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const desk = read('assets/king-desk.js');
const navSrc = desk.slice(desk.indexOf('  var NAV = ['), desk.indexOf('  // [chip label'));
const viewSrc = desk.slice(desk.indexOf('  var VIEWS = {'), desk.indexOf('  var LABEL = {}'));
const items = [...navSrc.matchAll(/\['([a-z:\-]+)', '[^']+', '([^']+)'/g)].map((m) => ({ id: m[1], label: m[2] }));
const groups = [...navSrc.matchAll(/^\s+\['([A-Za-z &]+)', \[/gm)].map((m) => m[1]);

test('16 sidebar items in the approved groups and order', () => {
  assert.deepEqual(groups, ['King', 'To review', 'Agents & listings', 'Leads & calls', 'Harvest', 'System']);
  assert.deepEqual(items.map((i) => i.label), ['Overview', 'Team & calls', 'Staff, pay & targets', 'Money in',
    'Found online to review', 'Agent properties to review', 'Short stays', 'Removal requests', 'Agent reports',
    'Agents & owners', 'All listings', 'Live & featured', 'Leads & WhatsApp', 'Calling lists', 'Harvest', 'Settings & logs']);
  assert.ok(!items.some((i) => i.id === 'field-agents'), 'Field agents is off the sidebar');
});

test('every King tab is still reachable from the sidebar or a page chip (nothing lost)', () => {
  const app = read('assets/makaug-app.js');
  const tabs = JSON.parse(app.match(/const allowed = (\[[^\]]+\]);\n  const previousTab = activeAdminWorkflowTab;/)[1]);
  const viewTabs = [...viewSrc.matchAll(/\['[^']+', '([a-z\-]+)', /g)].map((m) => m[1]);
  for (const t of tabs) assert.ok(items.some((i) => i.id === t || i.id === 'review:found' && t === 'review') || viewTabs.includes(t), `reachable: ${t}`);
  for (const v of items.filter((i) => i.id.startsWith('v:'))) assert.ok(viewSrc.includes(`'${v.id}': [`), `view defined: ${v.id}`);
  assert.match(viewSrc, /'Full calling desk', 'performance', null/, 'the old calling page stays whole behind a chip');
  assert.match(viewSrc, /'Harvest tools & old review queue', 'review', 'legacy'/);
});

test('calling desk sections are tagged for the page they belong to', () => {
  const cs = read('assets/calling-screen.js');
  for (const [attr, part] of [['data-k-plans', 'team'], ['data-k-act', 'team'], ['data-k-calls', 'team'], ['data-k-meetings', 'team'], ['data-k-split', 'team'],
    ['data-k-cashlog', 'money'], ['data-k-proofs', 'money'], ['data-k-blocks', 'lists'], ['data-k-intl', 'lists'], ['data-k-videos', 'old']]) {
    assert.match(cs, new RegExp(`${attr} data-kpart="${part}"`), `${attr} → ${part}`);
  }
  assert.match(cs, /data-kpart="lists"><h4>Numbers staff added/);
  assert.match(cs, /data-kpart="lists"><h4>Callbacks booked/);
  assert.match(cs, /data-kpart="staff"><h4>Logins/);
  assert.match(cs, /data-kpart="staff"><h4>Daily targets/);
  assert.doesNotMatch(cs, /host\.innerHTML = '<div class="mkc-panel" style="margin-top:16px" data-kpart/, 'the wrapper around everything is never tagged');
  const html = read('index.html');
  assert.match(html, /data-perf-root="admin" data-kpart="staff"/);
  for (const [part, n] of [['leads', 3], ['logs', 2]]) assert.equal((html.match(new RegExp(`data-kpart="${part}"`, 'g')) || []).length, n, part);
});

test('parts are hidden with CSS only (no data removed); ad slots hidden until asked for', () => {
  for (const p of ['team', 'staff', 'money', 'lists', 'leads', 'logs']) assert.ok(desk.includes(`body.kd-on[data-kd-part=\\"${p}\\"] [data-kpart]:not([data-kpart~=\\"${p}\\"]){display:none!important}`) || desk.includes(`body.kd-on[data-kd-part="${p}"] [data-kpart]:not([data-kpart~="${p}"]){display:none!important}`), p);
  assert.match(desk, /v:money"\]:not\(\[data-kd-part="ads"\]\) #admin-advertising-control\{display:none!important\}/);
  assert.match(desk, /function syncView\(tab\)/, 'the sidebar follows tab jumps made by the old code');
});
