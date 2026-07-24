#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const adminRoute = fs.readFileSync(path.join(root, 'routes', 'admin.js'), 'utf8');
const propertiesRoute = fs.readFileSync(path.join(root, 'routes', 'properties.js'), 'utf8');

assert(adminRoute.includes("router.patch('/properties/:id/featured'"), 'admin featured write route should exist');
assert(adminRoute.includes("'featured', true"), 'featured route should persist enabled state');
assert(adminRoute.includes("'featured', false"), 'featured route should persist disabled state');
assert(adminRoute.includes("writeAudit('admin_property_featured_updated'"), 'featured changes should be audited');

assert(app.includes('async function adminSetListingFeatured'), 'King UI should expose featured toggle');
assert(app.includes('/api/admin/properties/${encodeURIComponent(id)}/featured'), 'King toggle should call the admin featured route');
assert(app.includes('Feature on Homepage'), 'King listings should expose the homepage action');
assert(app.includes('Remove Featured'), 'King listings should expose the removal action');

assert(propertiesRoute.includes("req.query.featured ?? req.query.is_featured ?? req.query.isFeatured"), 'public feed should support featured filtering');
assert(propertiesRoute.includes("COALESCE(p.extra_fields->>'featured', 'false') IN ('true', '1', 'yes')"), 'public featured feed should read persisted state');
assert(app.includes('/api/properties?status=approved&featured=true&limit=12&page=1&public_only=1&sort=featured&include_summary=0'), 'homepage should fetch approved public featured rows');

console.log('featured-property-control tests passed');
