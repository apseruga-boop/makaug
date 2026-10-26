const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// jsonb_build_object takes "any" arguments, so Postgres cannot infer the type of
// a bare $n inside it and rejects the whole query ("could not determine data type
// of parameter $4"). That broke the YouTube source drip from 18 Oct 2026.
function bareParamsInJsonbBuildObject(source) {
  const found = [];
  const re = /jsonb_build_object\(/g;
  let match;
  while ((match = re.exec(source))) {
    let i = match.index + match[0].length;
    let depth = 1;
    const start = i;
    while (i < source.length && depth) {
      if (source[i] === '(') depth += 1;
      if (source[i] === ')') depth -= 1;
      i += 1;
    }
    const body = source.slice(start, i - 1).replace(/--[^\n]*/g, '');
    for (const param of body.matchAll(/\$(\d+)(?!\d)(?!::)/g)) found.push(param[0]);
  }
  return found;
}

test('harvest listing queries cast every parameter passed to jsonb_build_object', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'socialSearchSourcedListingsService.js'), 'utf8');
  assert.deepEqual(bareParamsInJsonbBuildObject(source), []);
});

test('the checker catches a bare parameter', () => {
  assert.deepEqual(bareParamsInJsonbBuildObject("jsonb_build_object('a', $3::text, 'b', $4)"), ['$4']);
});
