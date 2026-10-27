'use strict';

/**
 * 26 Oct 2026, Charles (agent) on a phone: "I can't scroll down" on
 * /list-property after Find on map. The Leaflet pin map had dragging on
 * (touch-action:none) and wheel zoom on, so every swipe on the 220px map
 * panned the map instead of scrolling the form. The list-property maps must
 * let one-finger swipes and the wheel scroll the page.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function fnBody(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = app.indexOf('\nfunction ', start + 10);
  return app.slice(start, next < 0 ? undefined : next);
}

function loadHelper({ coarse }) {
  const source = fnBody('isLpCoarsePointerDevice') + '\n' + fnBody('makeListMapScrollFriendly');
  const classes = new Set();
  const container = {
    dataset: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => (on ? classes.add(c) : classes.delete(c))
    }
  };
  const state = { dragging: true, wheel: true, controls: [], handlers: {} };
  const map = {
    getContainer: () => container,
    dragging: { enable: () => { state.dragging = true; }, disable: () => { state.dragging = false; } },
    scrollWheelZoom: { enable: () => { state.wheel = true; }, disable: () => { state.wheel = false; } },
    on: (events, fn) => { for (const e of events.split(' ')) (state.handlers[e] ||= []).push(fn); },
    addControl: (c) => { state.controls.push(c); }
  };
  const btnListeners = {};
  const btn = { setAttribute() {}, textContent: '' };
  const L = {
    Control: { extend: (proto) => function Ctl() { this.onAdd = proto.onAdd; } },
    DomUtil: { create: () => btn },
    DomEvent: {
      disableClickPropagation() {},
      preventDefault() {},
      on: (_el, ev, fn) => { btnListeners[ev] = fn; }
    }
  };
  const window = {
    L,
    matchMedia: (q) => ({ matches: q === '(pointer: coarse)' ? coarse : q === '(hover: hover)' ? !coarse : false })
  };
  const ctx = { window, L, navigator: { maxTouchPoints: coarse ? 5 : 0 }, Number, Boolean };
  vm.createContext(ctx);
  vm.runInContext(source + '\nthis.run = makeListMapScrollFriendly;', ctx);
  ctx.run(map);
  return { map, state, classes, container, btn, btnListeners };
}

test('phone: one-finger swipes scroll the page (map dragging off) and the wheel never zooms by default', () => {
  const { state, classes, btn, btnListeners } = loadHelper({ coarse: true });
  assert.equal(state.dragging, false, 'dragging must be off on touch devices so touch-action is pan-x pan-y');
  assert.equal(state.wheel, false, 'wheel zoom must be off until the map is clicked');
  assert.ok(classes.has('lp-scroll-friendly-map'));
  assert.equal(state.controls.length, 1, 'a Move map control lets the user pan on purpose');
  state.controls[0].onAdd();
  assert.equal(btn.textContent, 'Move map');
  btnListeners.click({});
  assert.equal(state.dragging, true);
  assert.ok(classes.has('lp-map-active'));
  btnListeners.click({});
  assert.equal(state.dragging, false, 'Done must hand scrolling back to the page');
  assert.ok(!classes.has('lp-map-active'));
});

test('desktop: mouse drag still pans, wheel zoom only after a click and off again on mouseout', () => {
  const { state } = loadHelper({ coarse: false });
  assert.equal(state.dragging, true);
  assert.equal(state.wheel, false);
  state.handlers.click[0]();
  assert.equal(state.wheel, true);
  state.handlers.mouseout[0]();
  assert.equal(state.wheel, false);
  assert.equal(state.controls.length, 0);
});

test('both list-property Leaflet maps use the helper; Google fallbacks use cooperative gestures', () => {
  assert.match(fnBody('initLeafletListPinMap'), /makeListMapScrollFriendly\(lpPinMap\)/);
  assert.match(fnBody('initLeafletListPreviewMap'), /makeListMapScrollFriendly\(lpPreviewMap\)/);
  assert.match(fnBody('initGoogleListPinMap'), /gestureHandling: "cooperative"/);
  assert.match(fnBody('initGoogleListPreviewMap'), /gestureHandling: "cooperative"/);
});

test('CSS safety net keeps an inactive list-property map scrollable by touch', () => {
  assert.match(html, /\.lp-scroll-friendly-map\.leaflet-container:not\(\.lp-map-active\) \{ touch-action: pan-x pan-y !important; \}/);
});

test('the shipped minified bundle carries the fix', () => {
  const min = fs.readFileSync(path.join(root, 'assets/build/makaug-app.min.js'), 'utf8');
  assert.ok(min.includes('lp-scroll-friendly-map'), 'run npm run build:js');
  assert.ok(min.includes('Move map'));
});
