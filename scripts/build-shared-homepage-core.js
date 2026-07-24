const fs = require("fs");
const path = require("path");
const { sanitizePublicHtml } = require("../services/publicHtmlSanitizer");

const ROOT = path.resolve(__dirname, "..");
const CORE = path.join(ROOT, "packages", "shared-country-core");
const COMPONENTS = path.join(CORE, "components");
const ASSETS = path.join(CORE, "assets");

function sliceBetween(source, startAnchor, endAnchor, includeEnd = false) {
  const start = source.indexOf(startAnchor);
  if (start === -1) throw new Error(`Missing start anchor: ${startAnchor}`);
  const endStart = source.indexOf(endAnchor, start + startAnchor.length);
  if (endStart === -1) throw new Error(`Missing end anchor: ${endAnchor}`);
  return source.slice(start, endStart + (includeEnd ? endAnchor.length : 0));
}

function build() {
  const raw = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const sanitized = sanitizePublicHtml(raw, { pathname: "/" });
  const sections = Object.freeze({
    "topbar-nav": sliceBetween(
      sanitized,
      '<body class="bg-gray-50">',
      '<div id="page-home" class="page active">'
    ),
    "hero-search": sliceBetween(
      sanitized,
      '<div id="page-home" class="page active">',
      '<section id="home-ask-ai-feature"'
    ),
    "ask-ai": sliceBetween(
      sanitized,
      '<section id="home-ask-ai-feature"',
      '<section class="py-12">'
    ),
    featured: sliceBetween(
      sanitized,
      '<section class="py-12">',
      '<section class="py-12 bg-gray-100">'
    ),
    agents: sliceBetween(
      sanitized,
      '<section class="py-12 bg-gray-100">',
      '<section class="py-12 bg-white">'
    ),
    map: sliceBetween(
      sanitized,
      '<section class="py-12 bg-white">',
      '<footer class="bg-green-900 text-white pt-12 pb-6">'
    ),
    footer: sliceBetween(
      sanitized,
      '<footer class="bg-green-900 text-white pt-12 pb-6">',
      "</footer>",
      true
    )
  });

  fs.mkdirSync(COMPONENTS, { recursive: true });
  fs.mkdirSync(ASSETS, { recursive: true });
  for (const [name, source] of Object.entries(sections)) {
    fs.writeFileSync(path.join(COMPONENTS, `${name}.html`), `${source.trimEnd()}\n`);
  }

  const styleBlocks = [...sanitized.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1]);
  if (!styleBlocks.length) throw new Error("No canonical homepage CSS was found.");
  fs.writeFileSync(path.join(ASSETS, "homepage.css"), `${styleBlocks.join("\n").trimEnd()}\n`);
  fs.copyFileSync(path.join(ROOT, "assets", "tailwind.css"), path.join(ASSETS, "tailwind.css"));
  process.stdout.write(`Built ${Object.keys(sections).length} shared homepage components.\n`);
}

build();
