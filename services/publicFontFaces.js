'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const source = require('../assets/fonts/plus-jakarta-sans-optional.source.json');
const cssPath = path.join(__dirname, '..', 'assets', 'fonts', 'plus-jakarta-sans-optional.css');

function isJakartaStylesheet(link) {
  const href = link.match(/(?:^|\s)href\s*=\s*(["'])(.*?)\1/i)?.[2];
  const rel = link.match(/(?:^|\s)rel\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (!href || !/^(?:preload|stylesheet)$/i.test(rel || '')) return false;
  try {
    const url = new URL(href.replace(/&amp;/gi, '&'));
    const families = url.searchParams.getAll('family');
    return url.origin === 'https://fonts.googleapis.com' && url.pathname === '/css2'
      && families.length === 1 && families[0] === 'Plus Jakarta Sans:wght@400;500;600;700;800';
  } catch (_error) {
    return false;
  }
}

function createPublicFontFaceInliner(readFile = fs.readFileSync) {
  let cachedCss;
  return function inlinePublicFontFaces(html) {
    const input = String(html || '');
    if (input.includes('data-public-font-faces="jakarta"')) return input;
    const head = input.match(/<head\b[^>]*>[\s\S]*?<\/head>/i);
    const charset = head?.[0].match(/<meta\b[^>]*\bcharset\s*=[^>]*>/i);
    const linkPattern = /<link\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
    if (!charset || ![...head[0].matchAll(linkPattern)].some((match) => isJakartaStylesheet(match[0]))) return input;
    if (cachedCss === undefined) {
      try {
        const css = readFile(cssPath, 'utf8');
        if (typeof css !== 'string' || /<\/style\b/i.test(css)
          || crypto.createHash('sha256').update(css).digest('hex') !== source.sha256) return input;
        cachedCss = css;
      } catch (_error) {
        // Retain the current optional Google loader and retry on a later render.
        return input;
      }
    }
    // Defining faces before body layout avoids adding a new font family after
    // fallback text has painted. Keep the UTF-8 declaration first in the head.
    const marker = `${charset[0]}\n<style data-public-font-faces="jakarta" data-source-sha256="${source.sha256}">${cachedCss}</style>`;
    let output = input.replace(charset[0], marker);
    output = output.replace(/<noscript>\s*(<link\b(?:[^"'<>]|"[^"]*"|'[^']*')*>)\s*<\/noscript>/gi,
      (block, link) => isJakartaStylesheet(link) ? '' : block);
    return output.replace(linkPattern, (link) => isJakartaStylesheet(link) ? '' : link);
  };
}

module.exports = createPublicFontFaceInliner();
module.exports.createPublicFontFaceInliner = createPublicFontFaceInliner;
