const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'makaug-app.js'), 'utf8');

function fnBody(name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = src.indexOf('\nfunction ', start + 10);
  const nextAsync = src.indexOf('\nasync function ', start + 10);
  const end = [next, nextAsync].filter((n) => n > 0).sort((a, b) => a - b)[0] || src.length;
  return src.slice(start, end);
}

test('preview close button is labelled, not an unlabelled icon', () => {
  const render = fnBody('renderStaffListingPreviewModal');
  assert.ok(!render.includes('class="h-10 w-10 rounded-full bg-white/10 hover:bg-white/20"><i class="fas fa-xmark"></i></button>'));
  assert.match(render, /onclick="closeStaffListingPreview\(\)" aria-label="Close preview"[^>]*>.*<span>Close<\/span><\/button>/);
});

test('preview window is brought into view at its top when opened', () => {
  const render = fnBody('renderStaffListingPreviewModal');
  const calls = render.split('staffPreviewBringIntoView(modal)').length - 1;
  assert.ok(calls >= 2, 'called right after append and after set-up steps');
  assert.ok(render.indexOf('document.body.appendChild(modal)') < render.lastIndexOf('staffPreviewBringIntoView(modal)'));
});

test('staffPreviewBringIntoView scrolls the window to its top and focuses it', () => {
  const body = fnBody('staffPreviewBringIntoView');
  const classes = new Set();
  const doc = { body: { classList: { add: (c) => classes.add(c) } }, activeElement: null };
  const fn = new Function('document', `${body}\nreturn staffPreviewBringIntoView;`)(doc);
  const attrs = {};
  let focused = null; let intoView = null;
  const modal = {
    isConnected: true, scrollTop: 900,
    setAttribute: (k, v) => { attrs[k] = v; }, hasAttribute: (k) => k in attrs,
    scrollIntoView: (o) => { intoView = o; }, contains: () => false,
    focus: (o) => { focused = o; },
  };
  fn(modal);
  assert.equal(modal.scrollTop, 0);
  assert.deepEqual(intoView, { block: 'start' });
  assert.deepEqual(focused, { preventScroll: true });
  assert.equal(attrs.role, 'dialog');
  assert.ok(classes.has('overflow-hidden'));
});

test('closing the preview unlocks page scrolling', () => {
  assert.match(fnBody('closeStaffListingPreview'), /classList\.remove\("overflow-hidden"\)/);
});
