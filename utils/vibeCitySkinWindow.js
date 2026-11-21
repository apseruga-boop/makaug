'use strict';

const windowApi = require('../assets/vibe-city-skin/window.js');

const BOOT_VERSION = '20261121';

function injectVibeCitySkinTags(html, opts) {
  opts = opts || {};
  const source = String(html || '');
  if (!source.includes('</head>')) return source;
  if (source.includes('/assets/vibe-city-skin/boot.js')) return source;
  if (windowApi.isDeskPath(opts.pathname || '')) return source;
  if (windowApi.envFlag(opts.env || process.env) === 'off') return source;
  const version = opts.version || BOOT_VERSION;
  const tags = [
    `  <script src="/assets/vibe-city-skin/window.js?v=${version}" defer></script>`,
    `  <script src="/assets/vibe-city-skin/boot.js?v=${version}" defer></script>`
  ].join('\n') + '\n';
  return source.replace(/<\/head>/i, `${tags}</head>`);
}

module.exports = Object.assign({ BOOT_VERSION, injectVibeCitySkinTags }, windowApi);
