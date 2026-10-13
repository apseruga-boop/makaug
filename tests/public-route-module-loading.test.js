'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const bootstrap = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map(match => match[1]).find(script => script.includes('function loadMakaugApp()'));
assert(bootstrap, 'actual bootstrap exists');
const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
const appTree = acorn.parse(app, { ecmaVersion: 'latest' });
function actualFunction(name) {
  const node = appTree.body.find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
  assert(node, `${name} is the actual app function`);
  return app.slice(node.start, node.end);
}

function fixture(page = 'page-home', { enabled = true, protectedShell = false, desk = false, appendFailures = 0 } = {}) {
  const appended = [], listeners = {}, timers = [];
  const window = { __makaugAppVersion: 'fixture-release', __makaugShortTerm: { enabled },
    setTimeout(callback) { timers.push(callback); } };
  const document = {
    readyState: 'loading', querySelector() { return { id: page }; },
    getElementById(id) { return protectedShell && (id === 'page-staff-dashboard' || (desk && id === 'staff-short-term-queue')) ? { id } : null; },
    createElement(tagName) { return { tagName, remove() { this.removed = true; } }; },
    addEventListener(type, callback) { listeners[type] = callback; },
    head: { appendChild(node) { appended.push(node); } },
    body: { appendChild(node) { if (appendFailures > 0) { appendFailures--; throw new Error('fixture DOM insertion failed'); } appended.push(node); } }
  };
  vm.runInNewContext(bootstrap, { window, document, Promise, console });
  const scripts = () => appended.filter(node => node.tagName === 'script' && !node.removed);
  const finishApp = () => { listeners.DOMContentLoaded(); scripts().find(node => /\/makaug-app\.js/.test(node.src)).onload(); };
  return { window, document, appended, scripts, finishApp, timers,
    section(kind) { return scripts().find(node => node.src.includes(`/${kind}.js`)); } };
}

test('home and property detail request no Off Plan or Short Term code after main startup', () => {
  for (const page of ['page-home', 'page-detail']) {
    const f = fixture(page);
    f.finishApp();
    assert.deepEqual(f.scripts().map(node => node.src), ['/assets/makaug-app.js?v=fixture-release']);
  }
});

test('protected startup retains ordered admin code and its management modules without public Short Term code', () => {
  const f = fixture('page-staff-dashboard', { protectedShell: true, desk: true });
  f.finishApp();
  assert.deepEqual(f.scripts().map(node => node.src), [
    '/assets/makaug-admin.js?v=fixture-release', '/assets/makaug-app.js?v=fixture-release',
    '/assets/off-plan.js?v=20261003-off-plan-v17', '/assets/short-term-admin.js?v=20260916-short-term-v4'
  ]);
  assert.equal(f.scripts()[0].async, false);
  assert.equal(f.scripts()[1].async, false);
});

test('actual SPA activation requests modules once, reactivates loaded pages and preserves protected management roles', async () => {
  const f = fixture();
  const context = vm.createContext({ window: f.window, Promise });
  vm.runInContext(actualFunction('ensurePublicPageModule'), context);
  const first = context.ensurePublicPageModule('off-plan', 'home');
  assert.equal(context.ensurePublicPageModule('off-plan', 'off-plan'), first);
  let initialized = 0;
  f.window.initializeOffPlanPage = () => { initialized++; };
  f.section('off-plan').onload();
  assert.equal(await first, true);
  assert.equal(initialized, 0, 'first evaluation owns initialization; callback must not initialize twice');
  await context.ensurePublicPageModule('off-plan', 'home');
  assert.equal(initialized, 1);
  const roles = [];
  f.window.loadOffPlanManagement = role => roles.push(role);
  await context.ensurePublicPageModule('staff-dashboard', 'home');
  await context.ensurePublicPageModule('admin-dashboard', 'home');
  assert.deepEqual(roles, ['staff', 'admin']);
  let shortHydrates = 0;
  f.window.makaugShortTerm = { route() {}, rehydrate() { shortHydrates++; } };
  await context.ensurePublicPageModule('short-term', 'home');
  await context.ensurePublicPageModule('short-term', 'short-term');
  assert.equal(shortHydrates, 1, 'same-page module routing cannot recurse through showPage');
  f.window.__makaugShortTerm.enabled = false;
  assert.equal(await context.ensurePublicPageModule('short-term', 'home'), false);
  assert.equal(shortHydrates, 1);
});

test('a pending SPA module cannot revive a page after navigation leaves it', async () => {
  const f = fixture();
  const context = vm.createContext({ window: f.window, Promise, currentPage: 'off-plan' });
  vm.runInContext(actualFunction('ensurePublicPageModule'), context);
  const pending = context.ensurePublicPageModule('off-plan', 'home');
  context.currentPage = 'home';
  let calls = 0;
  f.window.initializeOffPlanPage = () => { calls++; };
  f.section('off-plan').onload();
  assert.equal(await pending, true);
  assert.equal(calls, 0);
  assert.equal(context.currentPage, 'home');
});

test('hero entry keeps its exact query in first-load navigation before Off Plan exports exist', () => {
  const calls = [];
  const context = vm.createContext({
    document: { getElementById: id => id === 'hero-q' ? { value: '  Kira & Ntinda  ' } : null },
    navigatePublicRoute: (...args) => { calls.push(args); return true; }
  });
  vm.runInContext(actualFunction('openOffPlanFromHero'), context);
  assert.equal(context.openOffPlanFromHero(), true);
  assert.equal(calls[0][0], '/off-plan?q=Kira%20%26%20Ntinda');
  assert.equal(calls[0][2].source, 'off_plan_hero');
});

test('direct Short Term starts in parallel while Off Plan waits for the app', () => {
  const short = fixture('page-short-term');
  assert(short.section('short-term'), 'section must render before main startup');
  assert.equal(short.scripts().length, 1);
  short.finishApp();
  assert.equal(short.scripts().filter(node => node.src.includes('/short-term.js')).length, 1);
  assert(!short.section('off-plan'));
  const offPlan = fixture('page-off-plan');
  assert.equal(offPlan.scripts().length, 0);
  offPlan.finishApp();
  assert(offPlan.section('off-plan'));
  assert(!offPlan.section('short-term'));
});

test('disabled Short Term and public pages never request the protected desk code', () => {
  const f = fixture('page-short-term', { enabled: false });
  f.finishApp();
  assert(!f.section('short-term'));
  assert(!f.scripts().some(node => /short-term-admin/.test(node.src)));
});

test('section loads share one flight and a network failure permits a later retry', async () => {
  const f = fixture();
  assert.equal(typeof f.window.__makaugLoadOffPlan, 'function');
  const first = f.window.__makaugLoadOffPlan();
  assert.equal(f.window.__makaugLoadOffPlan(), first);
  assert.equal(f.scripts().length, 1);
  f.section('off-plan').onerror();
  assert.equal(await first, false);
  const retry = f.window.__makaugLoadOffPlan();
  assert.notEqual(retry, first);
  f.window.initializeOffPlanPage = () => {};
  f.section('off-plan').onload();
  assert.equal(await retry, true);
  const count = f.appended.length;
  assert.equal(await f.window.__makaugLoadOffPlan(), true);
  assert.equal(f.appended.length, count);
});

test('a script that loads without its expected exports can be retried without stale events clearing the retry', async () => {
  const f = fixture();
  const first = f.window.__makaugLoadShortTerm();
  const failed = f.section('short-term');
  failed.onload();
  assert.equal(await first, false);
  const retry = f.window.__makaugLoadShortTerm();
  failed.onerror();
  assert.equal(f.window.__makaugLoadShortTerm(), retry);
  f.window.makaugShortTerm = { route() {}, rehydrate() {} };
  f.section('short-term').onload();
  assert.equal(await retry, true);
});

test('synchronous script insertion failure also releases the flight for a successful retry', async () => {
  const f = fixture('page-home', { appendFailures: 1 });
  const first = f.window.__makaugLoadOffPlan();
  assert.equal(await first, false);
  const retry = f.window.__makaugLoadOffPlan();
  assert.notEqual(retry, first);
  assert(f.section('off-plan'));
  f.window.initializeOffPlanPage = () => {};
  f.section('off-plan').onload();
  assert.equal(await retry, true);
});
