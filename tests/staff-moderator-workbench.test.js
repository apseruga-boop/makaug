const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function run() {
  const migration = read('db/migrations/064_staff_moderator_workbench.sql');
  const auth = read('middleware/auth.js');
  const authFlow = read('services/authFlowService.js');
  const sanitizer = read('services/publicHtmlSanitizer.js');
  const server = read('server.js');
  const staffRoutes = read('routes/staff.js');
  const adminRoutes = read('routes/admin.js');
  const propertyRoutes = read('routes/properties.js');
  const app = read('assets/makaug-app.js');
  const html = read('index.html');

  assert(migration.includes("'moderator'"), 'users role check must include moderator');
  assert(migration.includes('CREATE TABLE IF NOT EXISTS staff_activity_logs'), 'staff activity log table must exist');
  assert(migration.includes('assigned_to_user_id'), 'lead/ad ownership should be assignable to staff users');

  assert(auth.includes('requireStaffAccess'), 'auth middleware must export staff guard');
  assert(auth.includes('requireListingModerationAccess'), 'property publish route must use restricted moderation guard');
  assert(auth.includes("['moderator', 'admin', 'super_admin']"), 'staff guard should allow moderator plus admin roles');
  assert(authFlow.includes("moderator: '/staff-dashboard'"), 'moderator dashboard redirect should go to staff dashboard');
  assert(authFlow.includes("return 'moderator'"), 'staff/moderator audience normalization should exist');

  assert(sanitizer.includes("'/staff-dashboard'"), 'staff dashboard must be protected from anonymous HTML');
  assert(sanitizer.includes("'Staff Operations Dashboard'"), 'public sanitizer must forbid staff dashboard title');
  assert(sanitizer.includes("role === 'moderator'"), 'moderator role must be allowed for staff dashboard only');

  assert(server.includes("const staffRoutes = require('./routes/staff')"), 'server should import staff routes');
  assert(server.includes("app.use('/api/staff', staffRoutes)"), 'server should mount /api/staff');

  assert(staffRoutes.includes("router.get('/dashboard'"), 'staff dashboard API route should exist');
  assert(staffRoutes.includes("router.get('/properties/:id/review'"), 'staff listing review API route should exist');
  assert(staffRoutes.includes("router.patch('/properties/:id/review'"), 'staff listing review save API route should exist');
  assert(staffRoutes.includes("router.get('/properties/:id/live-preview'"), 'staff live-style preview API route should exist');
  assert(staffRoutes.includes('loadPropertyReview'), 'staff review should use the same review loader as King/admin');
  assert(staffRoutes.includes('updatePropertyEditableFields'), 'staff review save should persist edited public listing facts');
  assert(staffRoutes.includes('moderator_publications'), 'staff dashboard should return moderator publication tracking');
  assert(staffRoutes.includes('staff_listing_review_updated_with_listing_edits'), 'staff listing fact edits should be traceable');
  assert(staffRoutes.includes("router.post('/exact-social-source-posts/import'"), 'staff dashboard should let moderators import exact social links');
  assert(staffRoutes.includes('STAFF_EXACT_SOCIAL_IMPORT_LIMIT = 500'), 'staff exact social import should cap batches at 500');
  assert(staffRoutes.includes('staff_exact_social_source_posts_imported'), 'staff exact social imports should be audited');
  assert(staffRoutes.includes("router.patch('/leads/:id'"), 'staff lead update API route should exist');
  assert(staffRoutes.includes("router.patch('/advertising/inquiries/:id'"), 'staff advertising update API route should exist');
  assert(staffRoutes.includes("router.post('/assistant/query'"), 'staff AI assistant route should exist');
  assert(staffRoutes.includes('staff_activity_logs'), 'staff routes should write staff activity logs');
  assert(staffRoutes.includes('Moderators can only assign a lead to themselves'), 'lead assignment should be staff self-service only');

  assert(adminRoutes.includes("router.get('/staff'"), 'King dashboard should list moderator staff users');
  assert(adminRoutes.includes("router.post('/staff/bootstrap-five'"), 'King dashboard should bootstrap five moderator accounts');
  assert(adminRoutes.includes("router.patch('/staff/:id'"), 'King dashboard should edit moderator accounts');
  assert(adminRoutes.includes("router.post('/staff/:id/password-reset'"), 'King dashboard should reset moderator passwords');
  assert(adminRoutes.includes("'moderator'"), 'admin routes should recognize moderator role');

  assert(propertyRoutes.includes('requireListingModerationAccess'), 'property status route should use listing moderation access');
  assert(propertyRoutes.includes("actorRole === 'moderator'"), 'moderator-specific publish restrictions should exist');
  assert(propertyRoutes.includes('staff_listing_approved'), 'moderator approvals should be logged');
  assert(propertyRoutes.includes('staff_source_reviewed'), 'moderator found-online approval should require source-review confirmation');
  assert(propertyRoutes.includes('Found-online approval requires source review confirmation'), 'moderator found-online approval should block blind source overrides');

  assert(html.includes('id="page-staff-dashboard"'), 'staff dashboard page should be in the product');
  assert(html.includes('id="staff-review-queue"'), 'staff moderation queue container should exist');
  assert(html.includes('id="staff-review-panel"'), 'staff dashboard should include the listing review workspace');
  assert(html.includes('id="staff-publication-list"'), 'staff dashboard should include moderator publication tracking');
  assert(html.includes('id="staff-ai-question"'), 'staff AI assistant UI should exist');
  assert(html.includes('id="staff-social-intake-input"'), 'staff dashboard should expose exact social link intake input');
  assert(html.includes('Queue for review'), 'staff dashboard should expose exact social link queue action');
  assert(html.includes('id="admin-staff-control"'), 'King dashboard should include staff operations control panel');
  assert(html.includes('adminBootstrapStaffAccounts()'), 'King dashboard should expose five-account bootstrap action');
  assert(app.includes('"staff-dashboard": "/staff-dashboard"'), 'frontend route map should include staff dashboard');
  assert(app.includes('renderStaffDashboard'), 'frontend should render staff dashboard');
  assert(app.includes('renderAdminStaffControl'), 'King dashboard should render staff account control');
  assert(app.includes('/api/admin/staff/bootstrap-five'), 'King dashboard should call staff bootstrap API');
  assert(app.includes('/api/staff/dashboard'), 'frontend should fetch staff dashboard API');
  assert(app.includes('isAuthSessionFailure(error)'), 'staff/dashboard hydration should detect stale sessions');
  assert(app.includes('Staff session expired. Please sign in again.'), 'stale staff sessions should clear auth instead of leaving loading cards');
  assert(app.includes('["staff-stat-pending", "staff-stat-approvals", "staff-stat-leads", "staff-stat-ads", "staff-stat-whatsapp"].forEach'), 'staff dashboard failures should resolve loading stat placeholders');
  assert(app.includes('/api/staff/properties/${encodeURIComponent(propertyId)}/review'), 'frontend should load staff property reviews');
  assert(app.includes('/api/staff/properties/${encodeURIComponent(adminActiveReview.id)}/review'), 'frontend should save staff review edits');
  assert(app.includes('/api/staff/properties/${encodeURIComponent(propertyId)}/live-preview'), 'frontend should load staff live-style previews');
  assert(app.includes('/api/staff/assistant/query'), 'frontend should call staff assistant API');
  assert(app.includes('/api/staff/exact-social-source-posts/import'), 'frontend should call staff exact social import API');
  assert(app.includes('staffOpenListingReview'), 'frontend should open the moderator review workspace');
  assert(app.includes('staffApproveActiveReview'), 'frontend should approve from the saved review workspace');
  assert(app.includes('staffPreviewSocialIntake'), 'frontend should preview staff source intake before queueing');
  assert(app.includes('staffQueueSocialIntake'), 'frontend should queue staff source intake after preview');
  assert(app.includes('staffModerateListing'), 'frontend should expose moderation action');
  assert(app.includes('Approve live after preview'), 'staff review workspace should approve only after preview');
  assert(app.includes('source_reviewed = true') || app.includes('body.source_reviewed = true'), 'staff found-online approval should send source-reviewed proof');
  assert(app.includes('Listing approved, sent live, and verified on the public API.'), 'staff approval should verify public API visibility');
  assert(app.includes('moderator email or +256'), 'staff sign-in copy should be present');

  console.log('staff-moderator-workbench tests passed');
}

run();
