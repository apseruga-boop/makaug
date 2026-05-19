const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const OLD_BRAND_FOR_TEST = 'Maka' + 'Ug';
const OLD_UPPER_VARIANT_FOR_TEST = 'Maka' + 'UG';
const BRAND_PATTERN = new RegExp(`${OLD_BRAND_FOR_TEST}|${OLD_UPPER_VARIANT_FOR_TEST}`, 'g');
const SEARCH_ROOTS = [
  'index.html',
  'assets/makaug-app.js',
  'config',
  'services',
  'routes',
  'src',
  'scripts',
  'docs',
  'examples',
  'README.md',
  'BACKEND_SETUP.md',
  'GO_LIVE_TODAY.md',
  'AGENTS.md',
  'package.json'
];
const TEXT_EXTENSIONS = new Set([
  '',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sh',
  '.sql',
  '.ts'
]);

function walk(target, files = []) {
  const fullPath = path.join(root, target);
  if (!fs.existsSync(fullPath)) return files;
  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    if (['node_modules', 'outputs', 'twende-app', '.twende-source', '.tmp-wa-probe'].includes(path.basename(fullPath))) {
      return files;
    }
    for (const entry of fs.readdirSync(fullPath)) {
      walk(path.join(target, entry), files);
    }
    return files;
  }
  if (TEXT_EXTENSIONS.has(path.extname(fullPath))) {
    files.push(fullPath);
  }
  return files;
}

const offenders = [];
for (const target of SEARCH_ROOTS) {
  for (const file of walk(target)) {
    const content = fs.readFileSync(file, 'utf8');
    if (BRAND_PATTERN.test(content)) {
      offenders.push(path.relative(root, file));
    }
    BRAND_PATTERN.lastIndex = 0;
  }
}

assert.deepStrictEqual(offenders, [], 'Visible/runtime brand text must use lowercase makaug or makaug.com');
