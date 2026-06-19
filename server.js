require('dotenv').config();

const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const logger = require('./config/logger');
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const propertiesRoutes = require('./routes/properties');
const agentsRoutes = require('./routes/agents');
const contactRoutes = require('./routes/contact');
const advertisingRoutes = require('./routes/advertising');
const analyticsRoutes = require('./routes/analytics');
const savedPropertiesRoutes = require('./routes/saved-properties');
const adminRoutes = require('./routes/admin');
const whatsappRoutes = require('./routes/whatsapp');
const mortgageRoutes = require('./routes/mortgage');
const aiRoutes = require('./routes/ai');
const aiCoreRoutes = require('./routes/ai-core');
const aiCeoRoutes = require('./routes/ai-ceo');
const adminAiAgentsRoutes = require('./routes/admin-agents');
const propertySeekerRoutes = require('./routes/property-seeker');
const studentRoutes = require('./routes/student');
const fieldAgentRoutes = require('./routes/field-agent');
const staffRoutes = require('./routes/staff');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { runMigrations } = require('./scripts/migrate');
const {
  isProtectedPath,
  roleCanAccessProtectedPath,
  renderProtectedLoginShell,
  sanitizePublicHtml
} = require('./services/publicHtmlSanitizer');

const app = express();
// Required on Render so rate limiting uses the forwarded client IP correctly.
app.set('trust proxy', 1);

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

app.use(
  cors({
    origin(origin, callback) {
      const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(String(origin || ''));
      const isMakaugOrigin = /^https?:\/\/([^/]+\.)?makaug\.com$/i.test(String(origin || ''));
      if (!origin || !corsOrigins.length || corsOrigins.includes(origin) || isLocalOrigin || isMakaugOrigin) {
        return callback(null, true);
      }
      return callback(new Error('CORS origin not allowed'));
    },
    credentials: true
  })
);

app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(express.json({ limit: '15mb' }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  skip: (req) => req.path === '/analytics/config',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api', apiLimiter);

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/properties', propertiesRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/advertising', advertisingRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/saved-properties', savedPropertiesRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/whatsapp', whatsappRoutes);
app.use('/api/mortgage-rates', mortgageRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/ai-core', aiCoreRoutes);
app.use('/api/ai-ceo', aiCeoRoutes);
app.use('/api/admin/ai-agents', adminAiAgentsRoutes);
app.use('/api/property-seeker', propertySeekerRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/field-agent', fieldAgentRoutes);
app.use('/api/staff', staffRoutes);

// Never expose local/private operator tools on public host.
app.use('/private-local', (_req, res) => {
  return res.status(404).send('Not found');
});

app.get('/config.js', (_req, res) => {
  const publicConfig = {
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    apiBase: process.env.PUBLIC_API_BASE || '',
    adsenseClient: process.env.GOOGLE_ADSENSE_CLIENT || '',
    adsenseSlots: {
      default: process.env.GOOGLE_ADSENSE_SLOT_DEFAULT || ''
    }
  };

  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  return res.send([
    `window.MAKAUG_CONFIG = ${JSON.stringify(publicConfig)};`,
    `window.MAKAUG_GOOGLE_MAPS_API_KEY = ${JSON.stringify(publicConfig.googleMapsApiKey)};`,
    `window.MAKAUG_API_BASE = window.MAKAUG_API_BASE || ${JSON.stringify(publicConfig.apiBase)};`,
    `window.MAKAUG_ADSENSE_CLIENT = window.MAKAUG_ADSENSE_CLIENT || ${JSON.stringify(publicConfig.adsenseClient)};`,
    `window.MAKAUG_ADSENSE_SLOTS = window.MAKAUG_ADSENSE_SLOTS || ${JSON.stringify(publicConfig.adsenseSlots)};`
  ].join('\n'));
});

const staticRoot = __dirname;
const indexPath = path.join(staticRoot, 'index.html');
const appJsPath = path.join(staticRoot, 'assets', 'makaug-app.js');
const isProduction = process.env.NODE_ENV === 'production';
const captureHelperUsabilityVersion = 'capture-helper-usability-20260607';
const studentNearestUniversityVersion = 'student-nearest-university-20260616';
const staffOperationsDashboardVersion = 'staff-operations-dashboard-20260619b';
const publicAppVersionSuffixes = [captureHelperUsabilityVersion, studentNearestUniversityVersion, staffOperationsDashboardVersion];
let cachedIndexHtml = null;
const publicHtmlCache = new Map();
const textAssetCache = new Map();
const PUBLIC_HTML_CACHE_CONTROL = isProduction
  ? 'public, max-age=60, stale-while-revalidate=300'
  : 'no-store';
const LONG_LIVED_STATIC_CACHE_CONTROL = 'public, max-age=604800, immutable';

function appendVaryHeader(res, value) {
  const next = String(value || '').trim();
  if (!next) return;
  const existing = res.getHeader('Vary');
  if (!existing) {
    res.setHeader('Vary', next);
    return;
  }
  const values = String(existing)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.includes('*')) return;
  if (!values.some((item) => item.toLowerCase() === next.toLowerCase())) {
    values.push(next);
  }
  res.setHeader('Vary', values.join(', '));
}

function acceptsContentEncoding(req, encoding) {
  const header = String(req.headers['accept-encoding'] || '');
  return header.split(',').some((part) => {
    const [name, ...params] = part.trim().toLowerCase().split(';').map((item) => item.trim());
    if (name !== encoding && name !== '*') return false;
    const q = params.find((item) => item.startsWith('q='));
    return !q || Number(q.slice(2)) !== 0;
  });
}

function preferredContentEncoding(req) {
  if (acceptsContentEncoding(req, 'br')) return 'br';
  if (acceptsContentEncoding(req, 'gzip')) return 'gzip';
  return '';
}

function compressBody(body, encoding) {
  if (encoding === 'br') {
    return zlib.brotliCompressSync(body, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 5
      }
    });
  }
  if (encoding === 'gzip') {
    return zlib.gzipSync(body, { level: 6 });
  }
  return body;
}

function readCachedTextAsset(filePath) {
  const stat = fs.statSync(filePath);
  const cached = textAssetCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached;
  }
  const body = fs.readFileSync(filePath);
  const entry = {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    body,
    etag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
    lastModified: stat.mtime.toUTCString(),
    compressed: {
      br: compressBody(body, 'br'),
      gzip: compressBody(body, 'gzip')
    }
  };
  textAssetCache.set(filePath, entry);
  return entry;
}

function sendBufferResponse(req, res, body, options = {}) {
  const source = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ''), 'utf8');
  const {
    contentType = 'text/plain; charset=utf-8',
    cacheControl = 'no-store',
    etag = '',
    lastModified = '',
    compressed = null
  } = options;

  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', cacheControl);
  if (etag) res.setHeader('ETag', etag);
  if (lastModified) res.setHeader('Last-Modified', lastModified);
  appendVaryHeader(res, 'Accept-Encoding');

  if (req.fresh) {
    return res.status(304).end();
  }

  const encoding = preferredContentEncoding(req);
  let output = source;
  if (encoding && source.length >= 1024) {
    const candidate = compressed?.[encoding] || compressBody(source, encoding);
    if (candidate.length < source.length) {
      output = candidate;
      res.setHeader('Content-Encoding', encoding);
    }
  }

  res.setHeader('Content-Length', String(output.length));
  if (req.method === 'HEAD') {
    return res.end();
  }
  return res.end(output);
}

function sendTextResponse(req, res, html, options = {}) {
  return sendBufferResponse(req, res, Buffer.from(String(html || ''), 'utf8'), {
    contentType: 'text/html; charset=utf-8',
    ...options
  });
}

function applyCaptureHelperUsabilityIndexPatch(html) {
  if (!html) return html;
  const missingSuffixes = publicAppVersionSuffixes.filter((version) => !html.includes(version));
  if (!missingSuffixes.length) return html;
  const suffix = missingSuffixes.map((version) => `-${version}`).join('');
  const withDirectAssetUrls = html.replace(
    /(assets\/makaug-app\.js\?v=)([^"'<\s]+)/g,
    `$1$2${suffix}`
  );
  return withDirectAssetUrls.replace(
    /(window\.__makaugAppVersion\s*=\s*")([^"]+)(")/g,
    `$1$2${suffix}$3`
  );
}

const captureHelperUsabilityScriptPatch = `
;(() => {
  const version = "${captureHelperUsabilityVersion}";
  const escapeHtml = (value = "") => String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
  const attr = escapeHtml;

  window.adminSocialCaptureHelperScript = function adminSocialCaptureHelperScript() {
    return \`(async function(){
  var clean=function(value){return String(value||"").replace(/\\\\s+/g," ").trim();};
  var normalize=function(href){
    try {
      var u=new URL(href,location.href);
      var host=u.hostname.replace(/^www\\\\./,"").toLowerCase();
      var path=u.pathname || "";
      if (host==="youtu.be") {
        var shortId=path.replace(/^\\\\/+/, "").split("/")[0];
        return shortId ? "https://www.youtube.com/watch?v="+shortId : "";
      }
      if (host.endsWith("youtube.com")) {
        if (path==="/watch" && u.searchParams.get("v")) return "https://www.youtube.com/watch?v="+u.searchParams.get("v");
        if (path.indexOf("/shorts/")===0) return "https://www.youtube.com/shorts/"+path.split("/")[2];
      }
      if (host.endsWith("tiktok.com")) {
        var tik=path.match(/^\\\\/@[^/]+\\\\/video\\\\/\\\\d+/);
        if (tik) return "https://www.tiktok.com"+tik[0];
      }
      if (host.endsWith("instagram.com")) {
        var insta=path.match(/^\\\\/(p|reel|tv)\\\\/[^/]+/);
        if (insta) return "https://www.instagram.com"+insta[0]+"/";
      }
      if (host==="x.com" || host==="twitter.com" || host.endsWith(".x.com") || host.endsWith(".twitter.com")) {
        var x=path.match(/^\\\\/[^/]+\\\\/status\\\\/\\\\d+/);
        if (x) return "https://x.com"+x[0];
      }
      if (host.endsWith("facebook.com") || host.endsWith("fb.watch")) {
        if (host.endsWith("fb.watch")) return u.origin+path;
        if (path.indexOf("/watch/")===0 && u.searchParams.get("v")) return "https://www.facebook.com/watch/?v="+u.searchParams.get("v");
        if (path.indexOf("/reel/")===0) return "https://www.facebook.com"+path.split("/").slice(0,3).join("/");
        if (path.indexOf("/groups/")===0 && path.indexOf("/posts/")>0) return "https://www.facebook.com"+path.split("/").slice(0,5).join("/");
        if (/\\\\/posts\\\\//.test(path)) return "https://www.facebook.com"+path.split("/").slice(0,4).join("/");
        if (/\\\\/videos\\\\//.test(path)) return "https://www.facebook.com"+path.split("/").slice(0,4).join("/");
        if (path==="/story.php" && u.searchParams.get("story_fbid")) return u.href;
        if (path==="/permalink.php" && u.searchParams.get("story_fbid")) return u.href;
      }
      return "";
    } catch (error) {
      return "";
    }
  };
  var seen={};
  var rows=[];
  Array.prototype.slice.call(document.querySelectorAll("a[href]")).forEach(function(anchor){
    var url=normalize(anchor.href);
    if (!url || seen[url]) return;
    seen[url]=true;
    var card=anchor.closest("article,[data-e2e*=video],[data-testid*=tweet],li,div") || anchor;
    var text=clean(card.innerText || anchor.innerText || anchor.getAttribute("aria-label") || document.title || "").slice(0,220);
    rows.push(url+(text ? " | "+text : ""));
  });
  if (!rows.length) {
    alert("No exact social post links found on this visible page. Open a video/post/grid source page first, then run the helper again.");
    return;
  }
  var output=rows.join("\\\\n");
  try {
    await navigator.clipboard.writeText(output);
  } catch (error) {
    var box=document.createElement("textarea");
    box.value=output;
    box.style.position="fixed";
    box.style.left="8px";
    box.style.top="8px";
    box.style.width="80vw";
    box.style.height="40vh";
    box.style.zIndex="2147483647";
    document.body.appendChild(box);
    box.focus();
    box.select();
  }
  alert("makaug copied "+rows.length+" exact social post link(s). Go back to King, click Paste Captured Links, and paste.");
})();\`;
  };

  window.adminSocialCaptureBookmarkletUrl = function adminSocialCaptureBookmarkletUrl() {
    return \`javascript:\${encodeURIComponent(window.adminSocialCaptureHelperScript())}\`;
  };

  window.adminPasteSocialCapturedLinks = function adminPasteSocialCapturedLinks(seedText = "") {
    if (typeof window.adminOpenSocialQuickPastePanel === "function") {
      return window.adminOpenSocialQuickPastePanel(seedText);
    }
    const statusEl = document.getElementById("admin-found-online-status")
      || document.getElementById("admin-social-source-status");
    if (statusEl && typeof window.adminSocialQuickPastePanelHtml === "function") {
      statusEl.classList.remove("hidden");
      statusEl.innerHTML = window.adminSocialQuickPastePanelHtml({ seedText });
      if (typeof window.adminScrollTo === "function") {
        window.adminScrollTo(\`#\${statusEl.id || "admin-found-online-status"}\`);
      }
      return;
    }
    if (typeof toast === "function") {
      toast("Paste box is still loading. Use Paste Captured Links at the top of the dashboard.");
    }
  };

  window.adminSocialCaptureHelperPanelHtml = function adminSocialCaptureHelperPanelHtml({ copiedLabel = "" } = {}) {
    const bookmarklet = window.adminSocialCaptureBookmarkletUrl();
    return \`
    <div class="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-3 text-sm text-indigo-950">
      <div><div class="font-black">Capture helper setup</div><div>Use this once to create a browser bookmark. After that, open TikTok, YouTube, Facebook, Instagram, or X source pages and click the bookmark. It copies visible exact post/video links so you can paste them into makaug.</div>
        \${copiedLabel ? \`<div class="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-emerald-950"><div class="font-black">\${escapeHtml(copiedLabel)}</div><div class="mt-1 text-[11px]">Copied means the long bookmark code is in your computer clipboard. Nothing opens by itself. The next step is to paste it into a new browser bookmark URL field.</div></div>\` : ""}
      </div>
      <button type="button" onclick="adminPasteSocialCapturedLinks()" class="bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-50 px-3 py-2 rounded-lg text-xs font-bold">Open Paste Box</button>
      <div class="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-emerald-950">
        <div class="font-black text-violet-950">Simplest no-bookmark option</div>
        <div class="mt-1 text-xs">If bookmark setup feels annoying, open one exact YouTube, TikTok, Facebook, Instagram, or X post, copy the address bar link, then click Open Paste Box here and paste it. This works one link at a time.</div>
      </div>
      <div class="grid md:grid-cols-4 gap-2">
        <div class="bg-white border border-indigo-100 rounded-xl p-3"><b>1. Show bookmarks bar</b><br><span class="text-xs">Press Cmd+Shift+B in Chrome if you cannot see the bookmarks bar.</span></div>
        <div class="bg-white border border-indigo-100 rounded-xl p-3"><b>2. Save helper</b><br><span class="text-xs">Drag the purple makaug Capture Posts button to the bookmarks bar. If dragging is blocked, copy the Bookmark URL below into a new bookmark URL field.</span></div>
        <div class="bg-white border border-indigo-100 rounded-xl p-3"><b>3. Capture links</b><br><span class="text-xs">Open a source page, scroll until useful posts are visible, then click the bookmark. The helper copies exact links.</span></div>
        <div class="bg-white border border-indigo-100 rounded-xl p-3"><b>4. Paste into King</b><br><span class="text-xs">Return to makaug, click Open Paste Box, preview, then Queue Found Online for King review.</span></div>
      </div>
      <div class="rounded-xl border border-indigo-100 bg-white p-3">
        <div class="flex flex-wrap gap-2">
          <a href="\${attr(bookmarklet)}" onclick="return false" title="Drag this link to your browser bookmarks bar" class="inline-flex border border-indigo-300 bg-indigo-700 text-white hover:bg-indigo-800 px-3 py-2 rounded-lg text-xs font-bold">Drag to bookmarks: makaug Capture Posts</a>
          <button type="button" onclick="adminCopySocialCaptureBookmarklet()" class="border border-indigo-200 text-indigo-700 hover:bg-indigo-50 px-3 py-2 rounded-lg text-xs font-bold">Copy Bookmarklet URL</button>
          <button type="button" onclick="adminSelectSocialCaptureBookmarkletCode()" class="border border-indigo-200 text-indigo-700 hover:bg-indigo-50 px-3 py-2 rounded-lg text-xs font-bold">Select Bookmarklet URL</button>
          <button type="button" onclick="adminShowSocialCaptureConsoleCode()" class="border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg text-xs font-bold">Copy Console Code</button>
          <button type="button" onclick="adminLoadSocialCaptureExample()" class="border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-2 rounded-lg text-xs font-bold">Load Example</button>
        </div>
        <label class="mt-2 block text-[11px] font-black text-indigo-950" for="admin-social-capture-bookmarklet-url">Bookmark URL to paste</label>
        <textarea id="admin-social-capture-bookmarklet-url" class="mt-1 w-full rounded-lg border border-indigo-100 bg-indigo-50 p-2 text-[11px] font-mono text-indigo-950" rows="3" readonly>\${escapeHtml(bookmarklet)}</textarea>
        <div class="mt-2 text-xs">Fastest setup: drag the purple makaug Capture Posts button to your browser bookmarks bar. If dragging is blocked, copy the bookmark URL, create a new browser bookmark named makaug Capture Posts, then paste this text into the bookmark URL field.</div>
      </div>
      <details class="bg-white rounded-xl border border-indigo-100 p-3"><summary class="font-bold cursor-pointer">Manual console fallback</summary><pre class="mt-2 whitespace-pre-wrap text-xs text-gray-700">\${escapeHtml(window.adminSocialCaptureHelperScript())}</pre></details>
    </div>\`;
  };

  window.adminSelectSocialCaptureBookmarkletCode = function adminSelectSocialCaptureBookmarkletCode() {
    const textarea = document.getElementById("admin-social-capture-bookmarklet-url");
    if (!textarea) return;
    textarea.focus();
    textarea.select();
    try {
      document.execCommand("copy");
      if (typeof toast === "function") toast("Bookmark URL selected and copied");
    } catch (error) {
      if (typeof toast === "function") toast("Bookmark URL selected");
    }
  };

  window.__makaugCaptureHelperUsabilityPatch = version;
})();`;

function readIndexHtml() {
  if (isProduction && cachedIndexHtml) return cachedIndexHtml;
  const html = applyCaptureHelperUsabilityIndexPatch(fs.readFileSync(indexPath, 'utf8'));
  if (isProduction) cachedIndexHtml = html;
  return html;
}

function renderPublicHtml(pathname) {
  const rawPath = pathname || '/';
  const basePath = String(rawPath).split('?')[0].split('#')[0] || '/';
  const normalizedBasePath = basePath.length > 1 ? basePath.replace(/\/+$/, '') : basePath;
  const key = normalizedBasePath === '/login' ? rawPath : normalizedBasePath;
  if (isProduction && publicHtmlCache.has(key)) return publicHtmlCache.get(key);
  const rendered = sanitizePublicHtml(readIndexHtml(), { pathname: rawPath });
  if (isProduction) publicHtmlCache.set(key, rendered);
  return rendered;
}

app.get('/assets/makaug-app.js', (req, res, next) => {
  try {
    const asset = readCachedTextAsset(appJsPath);
    return sendBufferResponse(req, res, asset.body, {
      contentType: 'application/javascript; charset=utf-8',
      cacheControl: LONG_LIVED_STATIC_CACHE_CONTROL,
      etag: asset.etag,
      lastModified: asset.lastModified,
      compressed: asset.compressed
    });
  } catch (error) {
    return next(error);
  }
});

function parseCookies(header = '') {
  return String(header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const idx = part.indexOf('=');
      if (idx === -1) return acc;
      acc[decodeURIComponent(part.slice(0, idx).trim())] = decodeURIComponent(part.slice(idx + 1).trim());
      return acc;
    }, {});
}

function authFromCookie(req) {
  const token = parseCookies(req.headers.cookie || '').makaug_auth_token;
  if (!token || !process.env.JWT_SECRET) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (_) {
    return null;
  }
}

function sendPublicIndex(req, res, next) {
  if (req.path.startsWith('/api/')) return next();
  if (isProtectedPath(req.path)) {
    const auth = authFromCookie(req);
    res.set('X-Robots-Tag', 'noindex, noarchive');
    res.set('X-makaug-Protected-Route', '1');
    if (!auth) {
      return res.redirect(302, `/login?next=${encodeURIComponent(req.originalUrl || req.path)}`);
    }
    if (!roleCanAccessProtectedPath(auth, req.path)) {
      return res.status(403).send(renderProtectedLoginShell('/login?access=denied', {
        title: 'Access denied',
        message: 'This makaug area belongs to a different account type. Sign in with the right account to continue.'
      }));
    }
    try {
      const html = readIndexHtml();
      res.set('Cache-Control', 'no-store');
      return sendTextResponse(req, res, html, {
        cacheControl: 'no-store'
      });
    } catch (error) {
      return next(error);
    }
  }
  try {
    res.set('X-makaug-Public-Sanitized', '1');
    return sendTextResponse(req, res, renderPublicHtml(req.originalUrl || req.url || req.path), {
      cacheControl: PUBLIC_HTML_CACHE_CONTROL
    });
  } catch (error) {
    return next(error);
  }
}

function shouldServeIndex(req) {
  if (!['GET', 'HEAD'].includes(req.method)) return false;
  if (req.path.startsWith('/api/') || req.path === '/config.js' || req.path.startsWith('/private-local')) return false;
  if (req.path === '/' || req.path === '/index.html') return true;
  return !path.extname(req.path);
}

app.use((req, res, next) => {
  if (!shouldServeIndex(req)) return next();
  return sendPublicIndex(req, res, next);
});

app.get('/assets/makaug-app.js', (req, res, next) => {
  const appAssetPath = path.join(staticRoot, 'assets', 'makaug-app.js');
  fs.readFile(appAssetPath, 'utf8', (error, source) => {
    if (error) return next(error);
    const alreadyPatched = source.includes('admin-social-capture-bookmarklet-url')
      && source.includes('Simplest no-bookmark option');
    res.type('application/javascript');
    res.set('Cache-Control', 'no-store');
    return res.send(alreadyPatched ? source : `${source}\n${captureHelperUsabilityScriptPatch}`);
  });
});

app.use(express.static(staticRoot, {
  index: false,
  maxAge: '7d',
  setHeaders(res, filePath) {
    if (/\.(html?)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  }
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  return sendPublicIndex(req, res, next);
});

app.use(notFound);
app.use(errorHandler);

const port = parseInt(process.env.PORT || '8080', 10);

async function start() {
  if (process.env.DATABASE_URL && process.env.RUN_MIGRATIONS_ON_START !== 'false') {
    await runMigrations();
  } else if (!process.env.DATABASE_URL) {
    logger.warn('Skipping startup migrations because DATABASE_URL is not set');
  }

  app.listen(port, () => {
    logger.info(`makaug backend running on http://localhost:${port}`);
  });
}

start().catch((error) => {
  logger.error('Startup failed', error);
  process.exit(1);
});
