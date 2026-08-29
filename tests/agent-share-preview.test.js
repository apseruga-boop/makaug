const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const cardPath = path.join(root, 'assets', 'marketing', 'francis-isabirye-agent-share-v2.png');
const premiumCardPath = path.join(root, 'assets', 'marketing', 'francis-isabirye-agent-share-v3.png');

assert(server.includes("const AGENT_SHARE_PREVIEW_VERSION = 'preview-v2'"), 'agent share preview must have a stable unlisted version');
assert(server.includes("const AGENT_SHARE_PREMIUM_PREVIEW_VERSION = 'preview-v3'"), 'premium agent share preview must have a stable unlisted version');
assert(server.includes("app.get('/agents/:id'"), 'agent profile route must support server-rendered rich-link metadata');
assert(server.includes("req.query.share"), 'preview metadata must remain gated behind the unlisted share query');
assert(server.includes("X-makaug-Agent-OG-Preview"), 'preview response must identify its metadata mode');
assert(server.includes("isApprovedFrancisProfile"), 'approved Francis card must render on the normal profile route');
assert(server.includes("'X-makaug-Agent-OG'"), 'approved normal profile response must identify its rich-link metadata');
assert(server.includes("'francis-v2'"), 'approved Francis share must expose a stable live version marker');
assert(server.includes("options.previewVersion === AGENT_SHARE_PREMIUM_PREVIEW_VERSION"), 'premium card must stay behind the unlisted preview version');
assert(server.includes("'/assets/marketing/francis-isabirye-agent-share-v3.png'"), 'premium preview must use the v3 card asset');
assert(server.includes('isSupportedPreview || isApprovedFrancisProfile'), 'agent route must serve both preview-only and approved metadata modes');
assert(server.includes("isSupportedPreview ? 'X-makaug-Agent-OG-Preview' : 'X-makaug-Agent-OG'"), 'unlisted preview responses must expose their preview marker');
assert(server.includes("isSupportedPreview ? previewVersion : 'francis-v2'"), 'normal Francis profile must remain on the approved v2 card before approval');
assert(server.includes("'francis-agent-premium-share-preview-v3-20260829'"), 'premium preview must expose a production release marker');
assert(server.includes("ogType: 'profile'"), 'agent preview must use profile Open Graph semantics');
assert(server.includes('Review my property profile on makaug.com.'), 'agent preview must drive viewers back to the MakaUG profile');
assert(!server.match(/title: `\$\{name\}.*listings/i), 'agent preview title must not advertise a listing count');

assert(fs.existsSync(cardPath), 'Francis rich-link preview image must exist');
const png = fs.readFileSync(cardPath);
assert.strictEqual(png.toString('ascii', 1, 4), 'PNG', 'share image must be a PNG');
assert.strictEqual(png.readUInt32BE(16), 1200, 'share image must be 1200px wide');
assert.strictEqual(png.readUInt32BE(20), 630, 'share image must be 630px high');

assert(fs.existsSync(premiumCardPath), 'premium Francis rich-link preview image must exist');
const premiumPng = fs.readFileSync(premiumCardPath);
assert.strictEqual(premiumPng.toString('ascii', 1, 4), 'PNG', 'premium share image must be a PNG');
assert.strictEqual(premiumPng.readUInt32BE(16), 1200, 'premium share image must be 1200px wide');
assert.strictEqual(premiumPng.readUInt32BE(20), 630, 'premium share image must be 630px high');

console.log('agent share preview checks passed');
