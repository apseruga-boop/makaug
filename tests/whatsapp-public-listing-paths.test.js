'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(html.includes('data-listing-path-version="whatsapp-direct-20260910"'), 'the restored listing-path release marker should exist');
assert(html.includes('id="list-choice-online-btn"'), 'the listing modal must retain the List Online choice');
assert(html.includes('id="lp-whatsapp-option-btn" href="https://wa.me/256780863394'), 'the modal WhatsApp choice must use the makaug number');
assert(html.includes('id="lp-whatsapp-option-inline-btn" href="https://wa.me/256780863394'), 'the inline WhatsApp choice must be a working link');
assert(html.includes('id="topbar-whatsapp-link" href="https://wa.me/256780863394"'), 'the top-left WhatsApp number must remain a direct link');
assert(html.includes('id="floating-whatsapp-link" href="https://wa.me/256780863394"'), 'the floating WhatsApp icon must remain a direct link');
assert(html.includes('List through WhatsApp'), 'the listing choice should use the approved WhatsApp label');
assert(html.includes('0780 863 394'), 'the listing choice should visibly show the WhatsApp number');
assert(html.includes('Start with 7 days free.'), 'the listing modal should explain the introductory trial');
assert(html.includes('one private listing costs UGX 25,000 per month'), 'the listing modal should state the post-trial price');
assert(html.includes('Every submission stays in staff review until approved.'), 'the listing modal must retain the review boundary');

assert(!html.includes('Always 100% Free.'), 'the listing page must not claim listings are always free');
assert(!app.includes('Always 100% Free.'), 'listing translations must not restore the obsolete always-free claim');
assert(!app.includes('MAKAUG_WHATSAPP_AI_WEB_FALLBACK'), 'public WhatsApp must not be controlled by the removed website fallback');
assert(!app.includes('installTemporaryWebSupportFallback'), 'the app must not intercept WhatsApp clicks and reroute them online');
assert(!app.includes('whatsapp_support_web_fallback'), 'obsolete fallback analytics must not remain active');
assert(!app.includes('mobile_route_auto'), 'mobile visitors must see the two listing choices instead of being forced into WhatsApp');
assert(!app.includes('mobile_options_auto'), 'the mobile choice control must not auto-open one path');
assert(app.includes('return buildWhatsAppUrl(MAKAUG_SUPPORT_WHATSAPP, buildListPropertyWhatsAppMessage());'), 'listing links must build a contextual wa.me URL');
assert(app.includes('logListPropertyIntent("whatsapp_ai"'), 'WhatsApp listing selection must remain measurable');
assert(app.includes('logListPropertyIntent("online"'), 'online listing selection must remain measurable');

console.log('WhatsApp public listing paths restored');
