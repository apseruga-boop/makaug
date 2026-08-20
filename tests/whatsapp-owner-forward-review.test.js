const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'routes', 'whatsapp.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'scripts', 'whatsapp-web-copilot.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

assert(
  route.includes("whatsapp-owner-forward-review-media-20260820")
    && server.includes("whatsapp-owner-forward-review-media-20260820"),
  'owner forward review intake must expose a unique release marker'
);
assert(
  route.includes('isAiCeoOwnerPhone(phone)') && route.includes('parseOwnerReviewForward(body)'),
  'direct review intake must be restricted to an authenticated founder phone plus an explicit source label'
);
assert(
  route.includes("(FRANCIS|KAZI)") && route.includes('sourceLabel'),
  'owner forwards must require FRANCIS: or KAZI: source attribution'
);
assert(
  bridge.includes('image_previews:') && bridge.includes('data_url: item.dataUrl'),
  'the hosted bridge must transmit real image bytes to the backend'
);
assert(
  route.includes("keyPrefix: 'whatsapp-forward-review/photos'") && route.includes('storeDataUrl(candidate.dataUrl'),
  'forwarded images must be uploaded to permanent cloud storage before the review row is created'
);
assert(
  route.includes("source = 'whatsapp_forward_review'")
    && route.includes("'pending','whatsapp','whatsapp_forward_review'"),
  'owner forwards must be deduplicated and inserted into the shared pending review queue'
);
assert(
  route.includes('review_only: true') && route.includes('auto_publish: false'),
  'owner-forwarded properties must never auto-publish'
);
assert(
  route.includes('INSERT INTO property_images') && route.includes('Primary property photo'),
  'stored media must be attached to the property record used by staff moderation'
);
assert(
  route.includes("action: 'whatsapp_owner_forward_queued'")
    || route.includes("'whatsapp_owner_forward_queued'"),
  'the intake must create an auditable moderation/learning event'
);
assert(
  route.includes('✅ Saved to review') && route.includes('Status: pending, not live.'),
  'the owner must receive an explicit persisted-review confirmation'
);
assert(
  route.indexOf('const ownerReviewForward = await handleOwnerReviewForward')
    < route.indexOf('const ownerCommand = await handleOwnerWhatsappCommand'),
  'owner review forwards must be captured before generic owner-command or search routing can discard the image'
);

console.log('WhatsApp owner forward review checks passed');
