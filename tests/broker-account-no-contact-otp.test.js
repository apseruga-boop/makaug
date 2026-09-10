#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('assets/makaug-app.js');
const auth = read('routes/auth.js');
const authFlow = read('services/authFlowService.js');
const html = read('index.html');
const server = read('server.js');

const continueFlow = app.split('async function continueAccountAccess()')[1]?.split('function collectAccountAccessScreeningData')[0] || '';
const createFlow = app.split('async function submitAccountAccessCreate()')[1]?.split('async function submitAccountAccessOtp()')[0] || '';
const registerRoute = auth.split("router.post('/register'")[1]?.split("router.post('/login'")[0] || '';
const loginRoute = auth.split("router.post('/login'")[1]?.split("router.post('/logout'")[0] || '';

assert(app.includes('otpWrap.classList.toggle("hidden", isAccountAccessBrokerCreateFlow())'), 'broker create flow must hide the Email/SMS verification selector');
assert(app.includes('details: "1 of 4: Details"') && !app.includes('verify: "2 of 5: Verify"'), 'broker progress must not include a verification-code step');
assert(app.includes('brokerDetailsTitle: "Your details"'), 'broker contact step must not be labelled as a verification step');
assert(continueFlow.includes('if (isAccountAccessBrokerCreateFlow())') && continueFlow.indexOf('setAccountAccessCreateStep("preferences")') < continueFlow.indexOf('submitAccountAccessContactOtp()'), 'broker Details must advance directly to broker details before any signup OTP request');
assert(createFlow.includes('...(isAccountAccessBrokerCreateFlow() ? {} : {') && createFlow.includes('contact_verification_token: accountAccessContactVerificationToken'), 'broker registration payload must omit OTP fields while other account types retain their OTP proof');
assert(app.includes('Create broker profile') && app.includes('Broker ID details'), 'broker journey must finish by creating a broker profile after the ID step');
assert(app.includes('if (!details.nin || !isValidBrokerNationalId(details.nin))') && app.includes('if (!details.dataUrl)'), 'broker journey must require both a valid ID number and clear ID image');
assert(!app.includes('Optional broker trust check'), 'broker ID step must no longer be optional');

assert(registerRoute.includes("const isBrokerSignup = audience === 'agent'"), 'register API must identify the broker signup path');
assert(registerRoute.includes('if (contactVerification.ok || isBrokerSignup)'), 'broker registration must activate without issuing a signup OTP');
assert(registerRoute.includes('broker_signup_without_contact_otp: true'), 'broker account must record that contact OTP is not required');
assert(registerRoute.includes('a valid broker National ID number is required') && registerRoute.includes('a clear broker National ID photo is required'), 'register API must enforce broker ID details independently of the browser');
assert(registerRoute.includes('contactVerified: contactVerification.ok'), 'broker success payload must not falsely claim contact verification');
assert(loginRoute.includes("const brokerPhoneOtpNotRequired = user.role === 'agent_broker'"), 'broker password login must not depend on the removed contact-OTP flow, including for existing broker accounts');
assert(authFlow.includes("registration_status = 'not_registered'") && authFlow.includes("broker_review_status: brokerTrustSubmitted ? 'pending_admin_review' : 'pending_review'"), 'submitted broker ID details must create a profile that stays unregistered and pending staff review');

assert(html.includes('broker-signup-no-contact-otp-20260910'), 'homepage must carry the broker no-OTP release marker');
assert(server.includes("const brokerSignupNoContactOtpVersion = 'broker-signup-no-contact-otp-20260910'"), 'server-rendered routes must carry the same cache-busting release marker');

console.log('broker account no-contact-OTP regression checks passed');
