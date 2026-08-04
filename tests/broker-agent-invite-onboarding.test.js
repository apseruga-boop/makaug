const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const adminRoute = read('routes/admin.js');
const agentsRoute = read('routes/agents.js');
const emailService = read('services/emailService.js');
const html = read('index.html');
const app = read('assets/makaug-app.js');

assert(adminRoute.includes("router.post('/agents/invite'"), 'King API must expose a broker-only invitation route');
assert(adminRoute.includes("status = CASE WHEN status = 'approved' THEN status ELSE 'pending' END"), 'invited brokers must remain pending until review');
assert(adminRoute.includes('pendingVerification: true'), 'broker invitation must provision access without pretending approval');
assert(adminRoute.includes('phone_verified = CASE WHEN $8::boolean THEN phone_verified ELSE TRUE END'), 'pending broker invitations must not falsely verify public phone numbers');
assert(!/router\.post\('\/agents\/invite'[\s\S]{0,9000}INSERT INTO properties/.test(adminRoute), 'agent-only invitation must not create a fake property');

assert(emailService.includes('sendBrokerInvitationEmail'), 'invited brokers must receive purpose-built access instructions');
assert(emailService.includes('confirm your working phone number by OTP'), 'invitation email must explain phone verification');
assert(emailService.includes('upload a clear photo of your National ID'), 'invitation email must explain private identity verification');
assert(emailService.includes('Nothing is published automatically'), 'invitation email must preserve moderation expectations');

assert(agentsRoute.includes("router.post('/me/verification'"), 'signed-in broker must have a private verification endpoint');
assert(agentsRoute.includes('verifyListingSubmitToken'), 'broker phone verification must require a signed OTP token');
assert(agentsRoute.includes('contact_phone_verified_at = NOW()'), 'successful phone verification must be timestamped');
assert(agentsRoute.includes('identity_document_uploaded: true'), 'broker verification must persist private ID evidence');
assert(agentsRoute.includes('can_skip_listing_identity_upload: Boolean(agent?.identity_document_url && agent?.contact_phone_verified_at)'), 'fast-track identity bypass must depend on completed verification');

assert(html.includes('data-release-marker="broker-agent-invite-onboarding-20260804"'), 'live HTML needs the broker invitation release marker');
assert(html.includes('id="admin-broker-invite-form"'), 'King dashboard must expose the agent-only invite form');
assert(html.includes('id="agent-verification-notice"'), 'broker dashboard must show first-login phone and National ID completion');
assert(html.includes('id="agent-invite-welcome"'), 'invited broker must receive a welcome screen');
assert(html.includes('id="lp-video-url"'), 'listing flow must retain optional public video-tour URLs');

assert(app.includes('async function adminInviteBroker'), 'King UI must submit the broker invite');
assert(app.includes('async function sendBrokerVerificationOtp'), 'broker dashboard must send a phone OTP');
assert(app.includes('async function submitBrokerVerification'), 'broker dashboard must submit private verification evidence');
assert(app.includes('function isBrokerListingFastTrackReady'), 'listing flow must distinguish signed-in from verified brokers');
assert(app.includes('Complete phone and National ID verification in your broker dashboard before submitting a listing.'), 'unverified broker must not bypass listing identity checks');
assert(app.includes('video_url: videoUrl || null'), 'broker listing payload must keep submitted video links');

console.log('ok - secure agent invite, first-login trust check, and reviewed listing upload are wired');
