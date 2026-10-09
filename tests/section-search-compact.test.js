'use strict';

// Desktop listing pages: once the visitor scrolls into the results, the pinned
// search shell shrinks to location + Nearby + Filters + Search, and the map
// rail pins just under it. Back at the top (or after Filters) the full shell
// returns. Mobile keeps its own flow (the shell is not sticky below 1024px).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const app = fs.readFileSync('assets/makaug-app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

test('the shell carries a Filters button that only shows in compact mode', () => {
  assert.match(app, /class="section-search-compact-filters" data-section-compact-filters aria-label="Show all filters"/);
  assert.match(html, /\.section-search-compact-filters \{ display: none; \}/);
  const desktop = html.slice(html.indexOf('.section-search-compact-filters { display: none; }'));
  const block = desktop.slice(0, desktop.indexOf('@media (max-width: 1023px)'));
  assert.match(block, /@media \(min-width: 1024px\)/, 'compact mode is desktop-only');
  for (const hidden of ['.section-search-filter-row', '.canonical-location-status', '.canonical-location-chips']) {
    assert.ok(block.includes(`.section-search-shell.is-compact ${hidden}`), `${hidden} is hidden when compact`);
  }
  assert.match(block, /\.section-search-shell\.is-compact \.section-search-compact-filters \{[\s\S]*?display: inline-flex;/);
});

test('compact state follows the scroll with hysteresis, and expands at the top', () => {
  for (const fn of ['activeSectionSearchShell', 'sectionSearchShellSentinel', 'updateSectionSearchCompactState', 'scheduleSectionSearchCompactState', 'initSectionSearchCompactMode']) {
    assert.match(app, new RegExp(`function ${fn}\\(`), fn);
  }
  assert.match(app, /const enterAt = stickAt \+ fullHeight \+ SECTION_SEARCH_COMPACT_MARGIN_PX;/);
  assert.match(app, /const exitAt = stickAt \+ SECTION_SEARCH_COMPACT_EXIT_PX;/);
  assert.match(app, /if \(!shell \|\| style\.position !== "sticky"\)/, 'a non-sticky shell (mobile, brokers) never compacts');
  assert.match(app, /getAttribute\("data-section-search-shell"\) !== "brokers"/);
  assert.match(app, /window\.addEventListener\("scroll", scheduleSectionSearchCompactState, \{ passive: true \}\);/);
  assert.match(app, /shell\.matches\(":focus-within"\)/, 'never collapses while the visitor is using a filter');
  // Mounting (first time or re-showing a page) arms it.
  assert.equal((app.match(/initSectionSearchCompactMode\(\);/g) || []).length >= 2, true);
});

test('the map rail pins under the measured search bar', () => {
  assert.match(app, /root\.style\.setProperty\("--makaug-section-search-bottom", `\$\{Math\.round\(pinnedTop \+ shell\.offsetHeight\)\}px`\);/);
  const mapShellCss = (html.match(/\.listing-map-shell\s*\{[\s\S]*?\n\s*\}/) || [''])[0];
  assert.match(mapShellCss, /top: calc\(var\(--makaug-section-search-bottom, 4\.75rem\) \+ 1rem\);/);
});
