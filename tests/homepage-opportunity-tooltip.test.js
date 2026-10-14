'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const acorn = require('acorn');
const { chromium } = require('playwright-core');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(process.env.MAKAUG_TOOLTIP_HTML_SOURCE || path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const tailwind = fs.readFileSync(path.join(root, 'assets/tailwind.css'), 'utf8');
const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map((match) => match[1]).join('\n');
const subtitle = html.match(/<p\b[^>]*\bid="hero-subtitle"[\s\S]*?<\/p>/)?.[0];
assert.ok(subtitle, 'the real subtitle and accessible counter markup exist');
const phrasesStart = app.indexOf('const I18N_UI =');
const phrasesEnd = app.indexOf('const LANG_FALLBACK =', phrasesStart);
assert.ok(phrasesStart >= 0 && phrasesEnd > phrasesStart);
const phrases = vm.runInNewContext(app.slice(phrasesStart, phrasesEnd) + '\nI18N_UI;');
const ast = acorn.parse(app, { ecmaVersion: 'latest' });
const rendererSource = ['adminEscape', 'heroOpportunityStatRow', 'renderHeroPropertyOpportunityCounter'].map((name) => {
  const node = ast.body.find((item) => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, `the production ${name} function exists`);
  return app.slice(node.start, node.end);
}).join('\n');
const languages = ['en', 'lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar'];
const fixtureHtml = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${tailwind}\n${css}\n#away{position:fixed;left:8px;top:8px;z-index:100}</style></head><body><main style="padding:120px 16px 60px;background:#063;text-align:center">${subtitle}</main><button id="away">Outside the tooltip</button></body></html>`;

async function language(page, code) {
  await page.evaluate(({ code, labels, rendererSource }) => {
    document.documentElement.lang = code;
    document.documentElement.dir = code === 'ar' ? 'rtl' : 'ltr';
    const tr = (key) => labels[key];
    const getHeroPropertyOpportunityStats = () => ({ total: 4573, sale: 1935, rent: 1041, student: 20, commercial: 144, land: 1433, other: 0 });
    const updateAboutPageUi = () => {};
    const publicListingsFromApiLoaded = true;
    const publicListingsApiStats = null;
    const publicListingsApiTotal = null;
    // Execute the real renderer against the native fixture DOM. Only its
    // inventory and non-home About-page adapter are supplied by this fixture.
    eval(rendererSource + '\nrenderHeroPropertyOpportunityCounter();');
  }, { code, labels: { ...phrases.en, ...phrases[code] }, rendererSource });
}

async function geometry(page) {
  return page.evaluate(() => {
    const counter = document.getElementById('hero-property-counter');
    const tooltip = document.getElementById('hero-property-counter-tooltip');
    const paragraph = document.getElementById('hero-subtitle');
    const bounds = (element) => { const b = element.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width, top: b.top, bottom: b.bottom }; };
    return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      counter: bounds(counter), tooltip: bounds(tooltip), subtitle: bounds(paragraph),
      tooltipContentWidth: tooltip.scrollWidth, tooltipClientWidth: tooltip.clientWidth,
      tooltipOpacity: Number(getComputedStyle(tooltip).opacity),
      focused: document.activeElement === counter, direction: document.documentElement.dir,
      whiteSpace: getComputedStyle(tooltip).whiteSpace, textAlign: getComputedStyle(tooltip).textAlign,
      counterPosition: getComputedStyle(counter).position,
      arrowContent: getComputedStyle(tooltip, '::before').content };
  });
}

async function opacity(page, visible) {
  await page.waitForFunction((wanted) => Number(getComputedStyle(document.getElementById('hero-property-counter-tooltip')).opacity) === wanted,
    visible ? 1 : 0, { timeout: 2500 });
}

test('real tooltip CSS fits every mobile language without clipping and keeps native focus, hover and touch access', { timeout: 90000 }, async () => {
  const startedAt = Date.now();
  const timings = {};
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-first-run'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const records = [], problems = [];
  const browserVersion = await browser.version();
  let allCasesComplete = false;
  try {
    // This is an isolated HTML/CSS fixture. No user profile, live site, app
    // initializer, credentials or network performance measurement is involved.
    await context.route('**/*', (route) => route.abort());
    await page.setContent(fixtureHtml);
    const pilot = process.env.MAKAUG_TOOLTIP_PILOT === 'lg390';
    for (const width of pilot ? [390] : [320, 390, 767, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      for (const lang of pilot ? ['lg'] : languages) {
        await page.locator('#away').focus(); await page.mouse.move(0, 0);
        await language(page, lang); await opacity(page, false);
        const closed = await geometry(page);
        await page.locator('#hero-property-counter').focus(); await opacity(page, true);
        const opened = await geometry(page);
        records.push({ width, lang, input: 'keyboard-focus', closed, opened });
        if (width <= 767) {
          for (const [state, value] of [['closed', closed], ['opened', opened]]) {
            if (value.scrollWidth > width || value.tooltip.left < -0.5 || value.tooltip.right > width + 0.5) problems.push(`${width}px ${lang} ${state}: tooltip/document exceeds viewport`);
            if (value.tooltipContentWidth > value.tooltipClientWidth + 1) problems.push(`${width}px ${lang} ${state}: tooltip text exceeds its box`);
          }
        } else {
          const centre = (bounds) => (bounds.left + bounds.right) / 2;
          if (Math.abs(centre(opened.tooltip) - centre(opened.counter)) > 1) problems.push(`${width}px ${lang}: desktop counter-relative placement changed`);
        }
        if (!opened.focused || opened.tooltipOpacity !== 1) problems.push(`${width}px ${lang}: keyboard focus did not show the tooltip`);
        if (opened.direction !== (lang === 'ar' ? 'rtl' : 'ltr')) problems.push(`${width}px ${lang}: wrong document direction`);
      }
    }
    timings.geometryMatrixMs = Date.now() - startedAt;
    if (!pilot) {
      await page.setViewportSize({ width: 390, height: 844 }); await language(page, 'lg');
      await page.locator('#away').focus(); await page.mouse.move(0, 0); await opacity(page, false);
      await page.locator('#hero-property-counter').hover(); await opacity(page, true);
      records.push({ width: 390, lang: 'lg', input: 'hover', opened: await geometry(page) });
      await page.mouse.move(0, 0); await opacity(page, false);
      await page.locator('#away').focus(); await page.keyboard.press('Shift+Tab'); await opacity(page, true);
      const tabbed = await geometry(page);
      if (!tabbed.focused) problems.push('Native keyboard tab did not focus the counter');
      await page.keyboard.press('Tab'); await opacity(page, false);
      const touch = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await touch.route('**/*', (route) => route.abort());
      const touchPage = await touch.newPage(); await touchPage.setContent(fixtureHtml);
      for (const lang of ['en', 'lg', 'ar']) {
        await language(touchPage, lang);
        await touchPage.locator('#hero-property-counter').tap(); await opacity(touchPage, true);
        const opened = await geometry(touchPage);
        records.push({ width: 390, lang, input: 'touch', opened });
        if (opened.tooltip.left < -0.5 || opened.tooltip.right > 390.5 || opened.scrollWidth > 390) problems.push(`Touch ${lang}: tooltip exceeds viewport`);
        await touchPage.locator('#away').tap(); await opacity(touchPage, false);
      }
      await touch.close();
    }
    timings.interactionsMs = Date.now() - startedAt;
    allCasesComplete = true;
    assert.deepEqual(problems, [], 'the full tooltip remains within mobile bounds and all interactions work');
  } finally {
    const closeStarted = Date.now();
    await browser.close();
    timings.browserCloseMs = Date.now() - closeStarted;
    timings.totalMs = Date.now() - startedAt;
    if (process.env.MAKAUG_TOOLTIP_PROOF_PATH) fs.writeFileSync(process.env.MAKAUG_TOOLTIP_PROOF_PATH, JSON.stringify({
      observedAt: new Date().toISOString(), fixture: 'Production CSS, markup, counter renderer and phrase tables in fresh local native Chrome; synthetic counts; offline fallback fonts',
      browser: browserVersion, htmlSha256: crypto.createHash('sha256').update(html).digest('hex'),
      phraseSourceSha256: crypto.createHash('sha256').update(app).digest('hex'), records, problems, allCasesComplete, timings,
      limitation: 'This verifies isolated CSS geometry and native input behavior. It does not verify the live deployed page or its optional fonts.'
    }, null, 2));
  }
});
