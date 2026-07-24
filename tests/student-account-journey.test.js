#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const authRoute = fs.readFileSync(path.join(root, 'routes', 'auth.js'), 'utf8');
const studentRoute = fs.readFileSync(path.join(root, 'routes', 'student.js'), 'utf8');
const savedRoute = fs.readFileSync(path.join(root, 'routes', 'saved-properties.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(authRoute.includes("router.post('/request-signup-otp'"), 'student signup should request a real OTP');
assert(authRoute.includes("router.post('/verify-signup-otp'"), 'student signup should verify its OTP');
assert(authRoute.includes('contact_verification_token'), 'OTP verification should issue a registration proof token');
assert(authRoute.includes("router.post('/register'"), 'verified student should be able to register');
assert(authRoute.includes("router.post('/login'"), 'student should be able to sign in');
assert(authRoute.includes("message: 'Signed in. Opening your makaug.com dashboard.'"), 'login should return a dashboard handoff');

assert(server.includes("app.use('/api/student', studentRoutes)"), 'student APIs should be mounted');
assert(server.includes("app.use('/api/saved-properties', savedPropertiesRoutes)"), 'saved-property APIs should be mounted');
assert(studentRoute.includes("router.get('/dashboard', requireAuth"), 'student dashboard should be protected');
assert(savedRoute.includes('router.use(requireUserAuth)'), 'all saved-property operations should be protected');
assert(savedRoute.includes("router.post('/:propertyId'"), 'signed-in users should be able to save a property');
assert(savedRoute.includes("router.get('/'"), 'saved listings should load for the signed-in user');

assert(html.includes("openAuthSignUp('student')"), 'student page should open the student signup audience');
assert(html.includes("openAuthSignIn('student')"), 'student page should open the student login audience');
assert(app.includes('"/student-dashboard": "student"'), 'student route should preserve audience');
assert(app.includes('showPage("student-dashboard")'), 'student login should render its dashboard');
assert(app.includes('apiRequest("/api/student/dashboard")'), 'student dashboard should load central data');
assert(app.includes('/api/saved-properties/${encodeURIComponent(propertyId)}'), 'property cards should persist saved listings');

console.log('student-account-journey tests passed');
