'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const acorn = require('acorn');
const { sanitizePublicHtml, PUBLIC_FORBIDDEN_STRINGS } = require('../services/publicHtmlSanitizer');
const { createPublicFontFaceInliner } = require('../services/publicFontFaces');
const sourceMetadata = require('../assets/fonts/plus-jakarta-sans-optional.source.json');
const css = fs.readFileSync(require.resolve('../assets/fonts/plus-jakarta-sans-optional.css'), 'utf8');
const index = fs.readFileSync(require.resolve('../index.html'), 'utf8');
const server = fs.readFileSync(require.resolve('../server.js'), 'utf8');
const ast = acorn.parse(server, { ecmaVersion: 'latest' });
const url = sourceMetadata.sourceUrl;
const latinFontUrl = sourceMetadata.uniqueFonts.find((font) => /CoOg4Ko20yygg_vb\.woff2$/.test(font));
const links = `<link rel="preload" href="${url}" as="style" onload="this.onload=null;this.rel='stylesheet'"><noscript><link href="${url}" rel="stylesheet"></noscript>`;
const content = '<h1>Student accommodation in Uganda</h1><p lang="lg">Ennyumba</p><p lang="ar">السكن</p><p lang="am">መኖሪያ</p><article data-ssr-property-card="a">Current listing</article>';
const fixture = `<html><head><meta charset="UTF-8"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>${links}<style>body{font-family:"Plus Jakarta Sans",system-ui,sans-serif}</style></head><body>${content}</body></html>`;
function declaration(name) {
  const node = ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id.name === name);
  assert.ok(node, name); return server.slice(node.start, node.end);
}
function faces(html) { return html.match(/<style data-public-font-faces="jakarta"[^>]*>([\s\S]*?)<\/style>/)?.[1]; }

test('pinned official response preserves all weights, unicode subsets, optional policy and original font URLs', () => {
  assert.equal(Buffer.byteLength(css), 8540); assert.equal(crypto.createHash('sha256').update(css).digest('hex'), sourceMetadata.sha256);
  assert.equal(sourceMetadata.sha256, 'e3b78a8349a330601f794eb53d7479ab2c011345279c1fdf0d1c45564f2256ab');
  assert.match(sourceMetadata.sourceUrl, /^https:\/\/fonts\.googleapis\.com\/css2\?/); assert.ok(Number.isFinite(Date.parse(sourceMetadata.retrievedAt)));
  const blocks = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((match) => match[1]); assert.equal(blocks.length, 20);
  for (const weight of [400,500,600,700,800]) {
    const matching = blocks.filter((block) => block.includes(`font-weight: ${weight};`)); assert.equal(matching.length, 4);
    assert.equal(new Set(matching.map((block) => block.match(/unicode-range: ([^;]+)/)[1])).size, 4);
    for (const block of matching) { assert.match(block, /font-display: optional;/); assert.match(block, /font-family: 'Plus Jakarta Sans';/); }
  }
  assert.deepEqual([...new Set(blocks.map((block) => block.match(/url\(([^)]+)\)/)[1]))], sourceMetadata.uniqueFonts);
  assert.ok(sourceMetadata.uniqueFonts.every((font) => font.startsWith('https://fonts.gstatic.com/s/plusjakartasans/v12/')));
});

test('one verified Latin preload and all faces precede body use; charset stays first and duplicate definitions are removed', () => {
  const output = createPublicFontFaceInliner()(fixture);
  assert.equal(faces(output), css); assert.match(output, /<head><meta charset="UTF-8">\s*<link rel="preload" as="font"/);
  const preload = output.match(/<link\b[^>]*data-public-font-preload="jakarta-latin"[^>]*>/)?.[0];
  assert.ok(preload); assert.ok(preload.includes(`href="${latinFontUrl}"`));
  assert.match(preload, /type="font\/woff2"/); assert.match(preload, /crossorigin="anonymous"/);
  assert.ok(output.indexOf(preload) < output.indexOf('data-public-font-faces'));
  assert.ok(output.indexOf('data-public-font-faces') < output.indexOf('<body'));
  assert.ok(output.includes(content)); assert.ok(output.includes('href="https://fonts.gstatic.com" crossorigin'));
  assert.doesNotMatch(output, /fonts\.googleapis\.com\/css2|<noscript>/);
  assert.equal((output.match(/as="font"/g) || []).length, 1, 'only the shared Latin file is prioritized');
  const latinFaces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((match) => match[1]).filter((block) => block.includes(`url(${latinFontUrl})`));
  assert.equal(latinFaces.length, 5); assert.ok(latinFaces.every((block) => block.includes('U+0000-00FF')));
});

test('exact face content is cached once and a repeated transform is idempotent', () => {
  let reads = 0; const apply = createPublicFontFaceInliner((filename, encoding) => { reads += 1; assert.equal(path.basename(filename), 'plus-jakarta-sans-optional.css'); assert.equal(encoding, 'utf8'); return css; });
  const once = apply(fixture); assert.equal(apply(once), once);
  apply(fixture); assert.equal(reads, 1); assert.equal((once.match(/data-public-font-faces="jakarta"/g) || []).length, 1);
  assert.equal((once.match(/data-public-font-preload="jakarta-latin"/g) || []).length, 1);
});

test('read or validation failure keeps the original optional loader and allows recovery on a later render', () => {
  for (const failure of [null, '', css.replaceAll('font-display: optional', 'font-display: swap'), css + '</style><script>bad()</script>']) {
    let first = true; const apply = createPublicFontFaceInliner(() => { if (first) { if (failure === null) throw new Error('missing asset'); return failure; } return css; });
    assert.equal(apply(fixture), fixture); first = false; assert.equal(faces(apply(fixture)), css);
  }
});

test('only the single exact Jakarta family/weights are selected; unrelated fonts and links stay intact', () => {
  let reads = 0; const apply = createPublicFontFaceInliner(() => { reads += 1; return css; });
  for (const other of [url.replace('Plus+Jakarta+Sans','Roboto'), url.replace('400;500;600;700;800','400;700'), url + '&family=Roboto', url.replace('fonts.googleapis.com','example.com')]) {
    const input = fixture.replaceAll(url,other); assert.equal(apply(input),input);
  }
  assert.equal(reads,0);
  const unrelated = '<noscript><link href="/icons.css" rel="stylesheet"></noscript>';
  const output = apply(fixture.replace('</head>',`${unrelated}</head>`)); assert.ok(output.includes(unrelated));
  assert.equal(createPublicFontFaceInliner()(fixture.replace('<meta charset="UTF-8">','')),fixture.replace('<meta charset="UTF-8">',''), 'a missing insertion anchor keeps the existing loader');
});

test('single-quoted and HTML-escaped existing optional links still receive exactly one early definition', () => {
  const alternate = fixture.replaceAll('href="'+url+'"', "href='"+url.replaceAll('&','&amp;')+"'");
  const output = createPublicFontFaceInliner()(alternate); assert.equal(faces(output),css); assert.doesNotMatch(output,/fonts\.googleapis\.com\/css2/);
});

function renderer(inliner = createPublicFontFaceInliner()) {
  const context = vm.createContext({ ACTIVE_COUNTRY_CODE:'UG',process:{env:{SHARED_CORE_PHASE1_ENABLED:'false'}},isProduction:false,publicHtmlCache:new Map(),
    readIndexHtml:()=>index,sanitizePublicHtml,applyHarvestPublicSubmissionVisibility:(html)=>html,applyShortTermVisibility:(html)=>html,
    injectShortTermRuntimeConfig:(html)=>html,injectGa4HeadTag:(html)=>html,
    inlinePublicFontFaces:inliner,inlinePublicCoreStylesheets:require('../services/publicCoreStylesheets')
  });
  vm.runInContext(server.match(/const TRAVELPAYOUTS_DRIVE_HEAD_TAG = `[^`]*`;/)[0], context);
  vm.runInContext(['applyHomeHeroPreload','applyShortTermStylesheetLoading','applyPublicFontDisplayOptional','injectTravelpayoutsDriveHeadTag','renderPublicHtml'].map(declaration).join('\n'),context);return context.renderPublicHtml;
}

test('actual public renderer has early faces while keeping full CSS, text, language fallback and privacy boundaries', () => {
  const render = renderer();
  for(const route of ['/','/property/7918f050-f8f3-407b-aabe-718de3deb2c8','/student-accommodation','/student-accommodation/university/makerere','/to-rent/kireka-wakiso','/to-rent/kyanja-kampala/apartments','/short-term','/about','/advertise']) {
    const output=render(route);assert.equal(faces(output),css);assert.equal((output.match(/data-public-core-css=/g)||[]).length,2);
    assert.ok(output.indexOf('data-public-font-faces')<output.indexOf('<body'));assert.doesNotMatch(output,/<link[^>]*fonts\.googleapis\.com\/css2/);
    assert.equal((output.match(/data-public-font-preload="jakarta-latin"/g)||[]).length,1);
    assert.ok(output.includes(`href="${latinFontUrl}" crossorigin="anonymous"`));
    assert.ok(output.includes('system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'));
    for(const language of ['en','lg','sw','ac','ny','rn','sm','am','ar']) assert.ok(output.includes(`value="${language}"`));
    for(const forbidden of PUBLIC_FORBIDDEN_STRINGS) assert.ok(!output.includes(forbidden),`${route}: ${forbidden}`);
  }
});

test('actual public renderer fallback retains optional Google loading and full core CSS', () => {
  const output=renderer(createPublicFontFaceInliner(()=>{throw new Error('asset missing');}))('/student-accommodation');
  assert.equal(faces(output),undefined);const google=[...output.matchAll(/<link\b[^>]*fonts\.googleapis\.com\/css2[^>]*>/g)];assert.equal(google.length,2);
  assert.doesNotMatch(output,/data-public-font-preload|as="font"/);
  assert.ok(google.every((match)=>match[0].includes('display=optional')));assert.equal((output.match(/data-public-core-css=/g)||[]).length,2);
});

test('protected admin/staff/King HTML bypasses font inlining and keeps its original swap loader', async () => {
  for(const route of ['/admin','/staff-dashboard','/king']) {
    let delivered;const context=vm.createContext({ACTIVE_TENANT:{publicFeatures:{}},publicAliasRedirectTarget:()=>null,isKnownPublicRoute:()=>true,
      isProtectedPath:()=>true,authFromCookie:()=>({role:'admin'}),roleCanAccessProtectedPath:()=>true,readIndexHtml:()=>index,
      injectShortTermRuntimeConfig:(html)=>html,applyHomeHeroPreload:(html)=>html,renderPublicHtml:()=>{throw new Error('protected entered public renderer');},
      sendTextResponse:(_req,_res,html)=>{delivered=html;return html;}});
    vm.runInContext(declaration('sendPublicIndex'),context);await context.sendPublicIndex({path:route,originalUrl:route},{set(){}},error=>{throw error||new Error('unexpected next');});
    assert.equal(delivered,index);assert.match(delivered,/display=swap/);assert.doesNotMatch(delivered,/data-public-font-faces|data-public-font-preload/);
  }
});
