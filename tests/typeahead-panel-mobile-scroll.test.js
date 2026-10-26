'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const app = fs.readFileSync(path.join(__dirname, '../assets/makaug-app.js'), 'utf8');
test('the suggestion panel closes on a touch outside it and shows fewer rows on a phone', () => {
  assert(/document\.addEventListener\("touchstart", \(e\) => \{[\s\S]{0,400}closeHeroSuggestions\(\);/.test(app));
  assert(app.includes('const limit = window.innerWidth < 640 ? 5 : 8;'));
});
