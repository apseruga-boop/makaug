'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const acorn = require('acorn');
const { mergePublicOrganizationSchema } = require('../services/publicOrganizationSchema');

// Exercise the actual head renderer without booting the server or schedulers.
const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const names = new Set(['escapeMetaContent', 'patchMetaTag', 'patchDocumentTitle', 'patchCanonicalLink', 'patchStructuredData', 'patchPublicPageSeoMeta']);
const functions = acorn.parse(source, { ecmaVersion: 'latest' }).body
  .filter((node) => node.type === 'FunctionDeclaration' && names.has(node.id.name));
assert.equal(functions.length, names.size);
const context = vm.createContext({ mergePublicOrganizationSchema });
vm.runInContext(functions.map((node) => source.slice(node.start, node.end)).join('\n'), context);

for (const existing of [false, true]) {
  test(`listing head preserves dollar text with ${existing ? 'existing' : 'missing'} tags`, () => {
    const text = 'Bungalows for sale. Tenants pay $1500. Literal $& $` $\' $$ <offer>';
    const oldGraph = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Existing website' };
    const tags = existing ? `<title>Old title</title><meta name="description" content="Old description"><link rel="canonical" href="https://makaug.com/"><script type="application/ld+json" id="makaug-route-structured-data">${JSON.stringify(oldGraph)}</script>` : '';
    const input = `<html><head>${tags}</head><body>Unchanged page body</body></html>`;
    const product = { '@type': 'Product', name: text, description: text, offers: { '@type': 'Offer', price: 550000000, priceCurrency: 'UGX' } };
    const output = context.patchPublicPageSeoMeta(input, { title: text, description: text, canonical: 'https://makaug.com/property/example', image: 'https://makaug.com/photo.jpg', structuredData: { '@context': 'https://schema.org', '@graph': [product] } });
    const encoded = context.escapeMetaContent(text);
    assert.ok(output.includes(`<title>${encoded}</title>`));
    for (const name of ['description', 'og:description', 'twitter:description']) {
      const attribute = name.startsWith('og:') ? 'property' : 'name';
      assert.ok(output.includes(`<meta ${attribute}="${name}" content="${encoded}">`), name);
    }
    const script = output.match(/<script[^>]+id="makaug-route-structured-data"[^>]*>([\s\S]*?)<\/script>/)[1];
    const graph = JSON.parse(script)['@graph'];
    assert.equal(graph.find((node) => node['@type'] === 'Product').description, text);
    assert.equal(graph.filter((node) => [].concat(node['@type']).includes('Organization')).length, 1);
    assert.equal((output.match(/id="makaug-route-structured-data"/g) || []).length, 1);
    assert.ok(output.endsWith('<body>Unchanged page body</body></html>'));
  });
}

test('the live Ntinda income quote stays literal inside valid listing JSON-LD', () => {
  const description = 'Bungalows for sale in Ntinda. Tenants paying $1500 per month.';
  const input = '<head><script type="application/ld+json" id="makaug-route-structured-data">{"@type":"Organization","name":"MakaUG"}</script></head>';
  const data = { '@context': 'https://schema.org', '@type': 'Product', name: 'Bungalows for sale in Ntinda', description };
  const output = context.patchStructuredData(input, data);
  const graph = JSON.parse(output.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1])['@graph'];
  assert.equal(graph.find((node) => node['@type'] === 'Product').description, description);
  assert.equal(context.patchStructuredData(output, data), output);
});
