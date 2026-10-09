'use strict';

// "Listed on makaug.com" badge: the one place the copy-paste HTML is built on
// the server. assets/makaug-app.js builds the same string for the agent
// dashboard; tests/agent-badge.test.js keeps the two identical.

const SITE = 'https://makaug.com';
const UTM = 'utm_source=agent_badge&utm_medium=referral&utm_campaign=badge';

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function imageTag(variant) {
  const base = `${SITE}/assets/badge/makaug-listed-badge-${variant}`;
  return `<img src="${base}.png" srcset="${base}@2x.png 2x, ${base}@3x.png 3x" width="239" height="64" alt="Listed on makaug.com" style="border:0;max-width:100%;height:auto">`;
}

// Do-follow on purpose: no rel at all.
function agentBadgeSnippet({ agentId, agencyName, variant = 'light' } = {}) {
  const id = encodeURIComponent(String(agentId || ''));
  const name = escapeHtml(String(agencyName || '').trim() || 'This agent');
  const kind = variant === 'dark' ? 'dark' : 'light';
  return `<a href="${SITE}/agents/${id}?${UTM}" title="${name} on makaug.com">${imageTag(kind)}</a>`;
}

function genericBadgeSnippet(variant = 'light') {
  const kind = variant === 'dark' ? 'dark' : 'light';
  return `<a href="${SITE}/?${UTM}" title="Find our properties on makaug.com">${imageTag(kind)}</a>`;
}

function renderBadgePage() {
  const light = genericBadgeSnippet('light');
  const dark = genericBadgeSnippet('dark');
  const title = 'Listed on makaug.com badge for property agents | makaug.com';
  const description = 'Agents with live listings on makaug.com can add the "Listed on makaug.com" badge to their website. Light and dark versions with copy-paste code.';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${SITE}/badge">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${SITE}/badge">
<meta property="og:image" content="${SITE}/assets/badge/makaug-listed-badge-light@3x.png">
<link rel="icon" href="/favicon.ico">
<style>
:root{--g:#15803d;--dg:#166534;--bg:#f7faf7;--ink:#14231a;--mut:#4b5d52;--line:#d7e5da}
*{box-sizing:border-box}
body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--ink)}
header,main,footer{max-width:760px;margin:0 auto;padding:16px}
header a.brand{font-weight:800;font-size:20px;color:var(--dg);text-decoration:none}
h1{font-size:28px;line-height:1.2;margin:8px 0 12px}
h2{font-size:20px;margin:28px 0 8px}
p{color:var(--mut)}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}
.dark{background:#14532d}
pre{white-space:pre-wrap;word-break:break-all;background:#f1f5f2;border:1px solid var(--line);border-radius:8px;padding:12px;font-size:13px;margin:12px 0 0}
a{color:var(--g)}
footer{color:var(--mut);font-size:14px}
</style>
</head>
<body>
<header><a class="brand" href="/">makaug.com</a></header>
<main>
<h1>Add the “Listed on makaug.com” badge to your website</h1>
<p>If you list property on makaug.com, show it on your own website, Facebook page or email signature. Visitors click through to see your live listings, and buyers know your properties are on a site that reviews every listing before it goes live.</p>
<h2>Light badge (white or light websites)</h2>
<div class="card">${light}<pre>${escapeHtml(light)}</pre></div>
<h2>Dark badge (dark websites)</h2>
<div class="card dark">${dark}</div>
<div class="card"><pre>${escapeHtml(dark)}</pre></div>
<h2>Want it to link to your own profile?</h2>
<p>Approved agents with a public profile get a personalised version in the <a href="/broker-dashboard">broker dashboard</a> (look for “Get your badge”). It links straight to your makaug.com profile and your live listings.</p>
<p>Not on makaug.com yet? <a href="/list-property">List a property</a> or <a href="/brokers">see how brokers appear on makaug.com</a>.</p>
</main>
<footer><a href="/">Home</a> · <a href="/for-sale">For sale</a> · <a href="/to-rent">To rent</a> · <a href="/brokers">Brokers</a></footer>
</body>
</html>`;
}

module.exports = { agentBadgeSnippet, genericBadgeSnippet, renderBadgePage, escapeHtml };
