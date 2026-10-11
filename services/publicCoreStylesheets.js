'use strict';

const fs = require('fs');
const path = require('path');

// Full built styles, in their existing cascade positions. No critical-CSS
// approximation or asynchronous style application is involved.
const PUBLIC_CORE_STYLESHEETS = new Map([
  ['/assets/tailwind.css', path.join(__dirname, '..', 'assets', 'tailwind.css')],
  ['/assets/off-plan.css', path.join(__dirname, '..', 'assets', 'off-plan.css')]
]);

function attribute(tag, name) {
  return tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2];
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function createPublicCoreStylesheetInliner(readFile = fs.readFileSync) {
  const cache = new Map();
  return function inlinePublicCoreStylesheets(html) {
    return String(html || '').replace(/<link\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, (link) => {
      if (attribute(link, 'rel')?.toLowerCase() !== 'stylesheet') return link;
      const href = attribute(link, 'href');
      const assetPath = href?.split(/[?#]/)[0];
      const filename = PUBLIC_CORE_STYLESHEETS.get(assetPath);
      if (!filename) return link;
      // Keep any special loading/security/alternate-sheet contract as a link.
      if (/(?:^|\s)(?:disabled|title|integrity|nonce|crossorigin|onload|onerror)(?:\s|=|>)/i.test(link)) return link;
      const type = attribute(link, 'type');
      if (type && type.toLowerCase() !== 'text/css') return link;
      let css = cache.get(assetPath);
      if (css === undefined) {
        try {
          css = readFile(filename, 'utf8');
          // These builds contain no URL dependencies. If that changes, retain
          // the original link rather than rebase paths or alter their bytes.
          if (typeof css !== 'string' || !css.trim() || /<\/style\b|@import\b|url\s*\(/i.test(css)) return link;
          cache.set(assetPath, css);
        } catch (_error) {
          // Do not cache failures: a later render can recover the asset.
          return link;
        }
      }
      const media = attribute(link, 'media');
      return `<style data-public-core-css="${assetPath}" data-source-href="${escapeAttribute(href)}"${media ? ` media="${escapeAttribute(media)}"` : ''}>${css}</style>`;
    });
  };
}

module.exports = createPublicCoreStylesheetInliner();
module.exports.createPublicCoreStylesheetInliner = createPublicCoreStylesheetInliner;
