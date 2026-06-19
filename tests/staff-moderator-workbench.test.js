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
  assert(staffRoutes.includes("router.patch('/profile'"), 'staff profile/settings save API should exist');
  assert(staffRoutes.includes("router.get('/properties/:id/preview'"), 'staff listing preview API should exist');
  assert(staffRoutes.includes("router.patch('/properties/:id/review'"), 'staff listing preview save API should exist');
  assert(staffRoutes.includes("router.post('/source-intake/exact-social/import'"), 'staff social source import API should exist');
  assert(staffRoutes.includes("router.post('/source-intake/social-sweep'"), 'staff social sweep API should exist');
  assert(staffRoutes.includes("router.patch('/leads/:id'"), 'staff lead update API route should exist');
  assert(staffRoutes.includes("router.patch('/advertising/inquiries/:id'"), 'staff advertising update API route should exist');
  assert(staffRoutes.includes("router.post('/assistant/query'"), 'staff AI assistant route should exist');
  assert(staffRoutes.includes('staff_contact_export_v1'), 'staff AI should expose controlled contact export answers');
  assert(staffRoutes.includes('normalizeReviewLocationHierarchy'), 'staff listing edits should validate Uganda location hierarchy');
  assert(staffRoutes.includes('districtForKnownArea'), 'staff listing edits should catch Nansana/Wakiso and Masindi/Masindi style hierarchy bugs');
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

  assert(html.includes('id="page-staff-dashboard"'), 'staff dashboard page should be in the product');
  assert(html.includes('id="staff-settings-panel"'), 'staff dashboard should expose staff settings and payout details');
  assert(html.includes('id="staff-stat-total"'), 'staff dashboard should show total property count');
  assert(html.includes('id="staff-stat-duplicates"'), 'staff dashboard should show duplicate risk count');
  assert(html.includes('id="staff-source-quick-paste"'), 'staff dashboard should expose source quick paste');
  assert(html.includes('id="staff-bank-leads-list"'), 'staff dashboard should expose bank/mortgage leads');
  assert(html.includes('id="staff-review-queue"'), 'staff moderation queue container should exist');
  assert(html.includes('id="staff-ai-question"'), 'staff AI assistant UI should exist');
  assert(html.includes('id="admin-staff-control"'), 'King dashboard should include staff operations control panel');
  assert(html.includes('adminBootstrapStaffAccounts()'), 'King dashboard should expose five-account bootstrap action');
  assert(app.includes('"staff-dashboard": "/staff-dashboard"'), 'frontend route map should include staff dashboard');
  assert(app.includes('renderStaffDashboard'), 'frontend should render staff dashboard');
  assert(app.includes('renderAdminStaffControl'), 'King dashboard should render staff account control');
  assert(app.includes('/api/admin/staff/bootstrap-five'), 'King dashboard should call staff bootstrap API');
  assert(app.includes('/api/staff/dashboard'), 'frontend should fetch staff dashboard API');
  assert(app.includes('/api/staff/assistant/query'), 'frontend should call staff assistant API');
  assert(app.includes('/api/staff/profile'), 'frontend should save staff settings');
  assert(app.includes('/api/staff/properties/${encodeURIComponent(propertyId)}/preview'), 'frontend should open staff listing preview before approval');
  assert(app.includes('Approve live after preview'), 'frontend should require preview before live approval');
  assert(app.includes('/api/staff/source-intake/exact-social/import'), 'frontend should call staff source intake import');
  assert(app.includes('/api/staff/source-intake/social-sweep'), 'frontend should call staff source sweep');
  assert(app.includes('Copy CSV'), 'staff AI should render contact CSV copy control');
  assert(app.includes('staffModerateListing'), 'frontend should expose moderation action');
  assert(app.includes('moderator email or +256'), 'staff sign-in copy should be present');

  console.log('staff-moderator-workbench tests passed');
}

run();
