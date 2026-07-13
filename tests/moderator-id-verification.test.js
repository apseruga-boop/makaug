const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const html = read('index.html');
const app = read('assets/makaug-app.js');
const propertiesRoute = read('routes/properties.js');
const staffRoute = read('routes/staff.js');
const adminRoute = read('routes/admin.js');
const cloudMedia = read('services/cloudMediaStorageService.js');
const identityService = read('services/listingIdentityDocumentService.js');
const moderationService = read('services/listingModerationService.js');

assert(html.includes('moderator-id-verification-20260713'), 'production shell must carry the moderator ID verification marker');
assert((html.match(/moderator-id-verification-20260713/g) || []).length >= 3, 'marker must be in preload, lazy script cache-bust, and release markers');
assert(app.includes('MODERATOR_ID_VERIFICATION_MARKER = "moderator-id-verification-20260713"'), 'app bundle must carry the moderator ID marker');
assert(html.includes('moderator-id-panel-render-20260713'), 'production shell must carry the moderator ID panel render marker');
assert((html.match(/moderator-id-panel-render-20260713/g) || []).length >= 3, 'panel render marker must be in preload, lazy script cache-bust, and release markers');
assert(app.includes('MODERATOR_ID_PANEL_RENDER_MARKER = "moderator-id-panel-render-20260713"'), 'app bundle must carry the moderator ID panel render marker');

assert(cloudMedia.includes('function createSignedS3GetUrl'), 'cloud media service must expose a signed S3 GET helper');
assert(cloudMedia.includes('UNSIGNED-PAYLOAD'), 'signed GET helper must use a presigned GET payload');
assert(cloudMedia.includes('X-Amz-Expires'), 'signed GET helper must set a short expiry');
assert(identityService.includes('buildListingIdentityDocumentPayload'), 'identity document service must build the signed viewer payload');
assert(identityService.includes('identity_document_accessed'), 'identity document access must be logged');
assert(identityService.includes('storage: \'private_s3\''), 'private S3 documents must be identified as private storage');
assert(identityService.includes('createSignedS3GetUrl(rawDocumentUrl'), 'private S3 documents must be signed, not exposed raw');
assert(!identityService.includes('direct_url'), 'identity endpoint must not expose permanent direct URLs');

assert(staffRoute.includes("router.get('/properties/:id/id-document'"), 'staff must have a role-gated ID document route');
assert(adminRoute.includes("router.get('/properties/:id/id-document'"), 'admin/King must have a role-gated ID document route');
assert(staffRoute.includes('staff_identity_document_accessed'), 'staff ID document route must log staff activity');
assert(adminRoute.includes('admin_identity_document_accessed'), 'admin ID document route must write audit logs');
assert(staffRoute.includes('id_document_url: undefined'), 'staff preview payload must strip raw ID document URLs');
assert(adminRoute.includes('id_document_url: undefined'), 'admin review payload must strip raw ID document URLs');

assert(moderationService.includes('if (/^s3:\\/\\//i.test(url)) return true;'), 'automated review must treat private S3 ID docs as available evidence');
assert(propertiesRoute.includes('listingRequiresIdentityVerification'), 'status route must know when identity verification is required');
assert(propertiesRoute.includes('ID verification confirmation is required before approval'), 'backend approval must block until ID verification is confirmed');
assert(propertiesRoute.includes('identity_document_verified = true') || propertiesRoute.includes('checklist.identity_document_verified = true'), 'backend must persist identity verification checklist flags');
assert(propertiesRoute.includes('buildIdentityVerificationExtra'), 'backend must record who verified the ID and when');
assert(propertiesRoute.includes('normalizeStructuredRejectionReasons'), 'backend must normalize structured rejection reasons');
assert(propertiesRoute.includes('structured_rejection_reasons'), 'backend must persist structured rejection reasons');

assert(app.includes('function moderationIdentitySectionHtml'), 'staff/King UI must render a shared identity panel');
assert(app.includes('View ID / Load document'), 'identity panel must expose a visible View ID / Load document action');
assert(app.includes('I confirm the typed NIN matches the uploaded National ID photo.'), 'moderator must confirm typed NIN and uploaded ID photo match');
assert(app.includes('function moderationLoadIdentityDocument'), 'frontend must fetch the signed ID document route');
assert(app.includes('/id-document'), 'frontend must call the ID document endpoint');
assert(app.includes('data-identity-document-image="true"'), 'signed ID document must render as a visible image');
assert(app.includes('moderationRequiresIdentity(review) || review?.id_document_available'), 'identity panel must fetch the endpoint when identity verification is required even if availability flag is missing');
assert(app.includes('function moderationEnsureIdentityPanel'), 'staff/King render paths must have a fallback injector for the identity panel');
assert(!app.includes('href="${adminAttr(review.id_document_url)}"'), 'King UI must not link directly to raw ID document URLs');
assert(!app.includes('src="${adminAttr(review.id_document_url)}"'), 'King UI must not render raw ID document URLs');
assert(app.includes('data-identity-approve-prefix="staff-preview"'), 'staff approve button must be identity-gated');
assert(app.includes('data-identity-approve-prefix="admin-review"'), 'King approve button must be identity-gated');
assert(app.includes('MODERATION_IDENTITY_APPROVAL_MESSAGE'), 'approve flow must have a default identity verification message');
assert(app.includes('ID number does not match the ID document'), 'reject flow must include ID mismatch reason');
assert(app.includes('ID photo not clear / unreadable'), 'reject flow must include unclear ID reason');
assert(app.includes('Location mismatch'), 'reject flow must include location mismatch reason');
assert(app.includes('structured_rejection_reasons: review.structured_rejection_reasons'), 'staff reject must send structured reasons');
assert(app.includes('structured_rejection_reasons: structuredRejectionReasons'), 'King reject must send structured reasons');
assert(app.includes('identity_verified: identityRequired ? true'), 'approval payload must send identity verification confirmation');

console.log('moderator ID verification regression checks passed');
