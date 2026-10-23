'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const travelpayouts = require('../services/travelpayoutsAffiliate');
const flags = require('../utils/shortTermFeatureFlags');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const server = read('server.js');
const client = read('assets/short-term.js');
const serverAst = acorn.parse(server, { ecmaVersion: 'latest', sourceType: 'script' });

function serverFunction(name) {
  const node = serverAst.body.find((item) => item.type === 'FunctionDeclaration' && item.id && item.id.name === name);
  assert.ok(node, name);
  return server.slice(node.start, node.end);
}

function grab(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(name);
}

function inject(html, basePath, env) {
  const context = vm.createContext({
    process: { env },
    travelpayoutsAffiliate: travelpayouts
  });
  vm.runInContext(serverFunction('injectTravelpayoutsDriveHeadTag'), context);
  return context.injectTravelpayoutsDriveHeadTag(html, basePath);
}

const PAGE = '<html><head><title>makaug</title></head><body></body></html>';

test('the Drive head tag is off by default and uses the project id when enabled', () => {
  assert.equal(travelpayouts.DEFAULT_DRIVE_PROJECT_ID, '581854');
  assert.equal(travelpayouts.driveProjectId({}), '581854');
  assert.equal(travelpayouts.driveProjectId({ TRAVELPAYOUTS_DRIVE_PROJECT_ID: ' 424242 ' }), '424242');
  assert.equal(travelpayouts.driveProjectId({ TRAVELPAYOUTS_DRIVE_PROJECT_ID: 'not-an-id' }), '581854');
  assert.equal(travelpayouts.driveScriptSrc('581854'), travelpayouts.DEFAULT_DRIVE_SRC);
  assert.equal(travelpayouts.driveScriptSrc('424242'), 'https://emrldtp.cc/NDI0MjQy.js?t=424242');
  assert.equal(travelpayouts.driveScriptSrc(''), travelpayouts.DEFAULT_DRIVE_SRC);

  for (const value of [undefined, '', 'false', '0', 'off', 'no']) {
    assert.equal(travelpayouts.drivePublicHeadTag({ TRAVELPAYOUTS_DRIVE_ENABLED: value }), '', String(value));
    assert.doesNotMatch(inject(PAGE, '/', { TRAVELPAYOUTS_DRIVE_ENABLED: value }), /emrldtp/);
  }
  for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
    const tag = travelpayouts.drivePublicHeadTag({ TRAVELPAYOUTS_DRIVE_ENABLED: value });
    assert.match(tag, /emrldtp\.cc\/NTgxODU0\.js\?t=581854/, value);
    assert.doesNotMatch(tag, /tp\.media|marker=/);
  }

  const custom = inject(PAGE, '/short-term', {
    TRAVELPAYOUTS_DRIVE_ENABLED: 'true',
    TRAVELPAYOUTS_DRIVE_PROJECT_ID: '424242',
    TRAVELPAYOUTS_DRIVE_SRC: 'https://example.test/drive.js',
    TRAVELPAYOUTS_MARKER: 'marker-from-env'
  });
  assert.equal(custom.split('https://emrldtp.cc/NDI0MjQy.js?t=424242').length - 1, 1);
  assert.equal(inject(custom, '/short-term', {
    TRAVELPAYOUTS_DRIVE_ENABLED: 'true',
    TRAVELPAYOUTS_DRIVE_PROJECT_ID: '424242'
  }), custom, 'a second inject does not add another copy');
  assert.doesNotMatch(custom, /example\.test|tp\.media|marker-from-env/);
  assert.ok(custom.indexOf('emrldtp.cc') < custom.indexOf('</head>'));

  for (const route of ['/admin', '/admin/listings', '/staff-dashboard', '/staff/queue', '/king']) {
    assert.equal(inject(PAGE, route, { TRAVELPAYOUTS_DRIVE_ENABLED: 'true' }), PAGE, route);
  }

  const snippet = travelpayouts.driveHeadSnippet({
    TRAVELPAYOUTS_DRIVE_ENABLED: 'true',
    TRAVELPAYOUTS_DRIVE_SRC: 'https://example.test/drive.js'
  });
  assert.match(snippet, /https:\/\/example\.test\/drive\.js/);
  assert.doesNotMatch(snippet, /emrldtp\.cc/);
  const link = travelpayouts.trackedLink({
    marker: 'marker-from-env',
    programId: '11',
    url: 'https://www.booking.com/hotel'
  });
  assert.match(link, /^https:\/\/tp\.media\/r\?/);
  assert.match(link, /marker=marker-from-env/);
});

test('short-term.js loads Drive only when enabled, and only on /short-term, with the same project id', () => {
  const contextFor = (cfg, pathname, scripts = []) => {
    const context = vm.createContext({
      travelpayoutsConfig: () => cfg,
      currentPath: () => pathname,
      window: {},
      document: {
        documentElement: { getAttribute() { return null; } },
        querySelector(selector) {
          const sel = String(selector);
          if (sel.includes('data-tp-drive') || sel.includes('emrldtp.cc')) {
            return scripts.find((script) => script['data-tp-drive'] || String(script.src || '').includes('emrldtp.cc')) || null;
          }
          return null;
        },
        createElement() {
          return { setAttribute(name, value) { this[name] = value; } };
        },
        head: { appendChild(node) { scripts.push(node); } },
        addEventListener() {}
      }
    });
    vm.runInContext(`${grab(client, 'travelpayoutsDriveScriptSrc')}\n${grab(client, 'loadTravelpayoutsDrive')}`, context);
    context.loadTravelpayoutsDrive();
    return { scripts, src: context.travelpayoutsDriveScriptSrc };
  };

  assert.equal(contextFor({ driveEnabled: false, driveProjectId: '424242' }, '/short-term').scripts.length, 0);
  assert.equal(contextFor({ driveEnabled: true, driveProjectId: '424242' }, '/').scripts.length, 0);
  assert.equal(contextFor({ driveEnabled: true, driveProjectId: '424242' }, '/short-term/example').scripts.length, 0);

  const fallback = contextFor({ driveEnabled: true }, '/short-term');
  assert.equal(fallback.scripts.length, 1);
  assert.equal(fallback.scripts[0].src, travelpayouts.DEFAULT_DRIVE_SRC);
  assert.equal(fallback.scripts[0].async, true);
  assert.equal(fallback.scripts[0]['data-tp-drive'], '1');

  const custom = contextFor({ driveEnabled: true, driveProjectId: '424242' }, '/short-term');
  assert.deepEqual(custom.scripts.map((script) => script.src), ['https://emrldtp.cc/NDI0MjQy.js?t=424242']);
  const present = [{ src: 'https://emrldtp.cc/NDI0MjQy.js?t=424242' }];
  const alreadyLoaded = contextFor({ driveEnabled: true, driveProjectId: '424242' }, '/short-term', present);
  assert.equal(alreadyLoaded.scripts.length, 1, 'the public head script is not loaded a second time');
  assert.equal(custom.src('not-a-project'), travelpayouts.driveScriptSrc('not-a-project'));
  for (const id of ['1', '581854', '424242', '1000000', '9999999999999999']) {
    assert.equal(custom.src(id), travelpayouts.driveScriptSrc(id), id);
  }

  const runtime = flags.injectShortTermRuntimeConfig('<html><head></head></html>', {
    SHORT_TERM_ENABLED: 'true',
    TRAVELPAYOUTS_DRIVE_ENABLED: 'false',
    TRAVELPAYOUTS_DRIVE_PROJECT_ID: '424242',
    MAKAUG_WHATSAPP_NUMBER: '+256780863394'
  });
  assert.match(runtime, /"driveEnabled":false/);
  assert.match(runtime, /"driveProjectId":"424242"/);
  assert.match(runtime, /"whatsappNumber":"256780863394"/);
  assert.doesNotMatch(runtime, /emrldtp\.cc/);
});
