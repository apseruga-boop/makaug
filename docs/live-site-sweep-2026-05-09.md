# Live Site Sweep - 2026-05-09

Base live URL: `https://makaug.com`

Purpose: full-site operational sweep across public routes, click actions, route transitions, performance, backend wiring, protected APIs, language/brand observations, and remaining launch risks.

## What Passed

- Public HTML route probe passed 22/22 routes on live.
- Browser public route probe passed 23/23 routes locally after the router fix.
- Click-action probe passed 39/39 actions locally after updating the About marker expectation.
- Live backend connection probe passed 139/139 checks.
- Post-deploy live route-transition probe passed 23/23 route transitions.
- Protected admin and role APIs returned `401`/`403` for anonymous access.
- Performance probe passed locally after the router fix; every route was under the 1500ms visible threshold and had 0 console errors.
- Google Maps did not load on non-map public pages during the performance probe.

## Critical Issue Found And Fixed

### Route Fragment Race

Fast navigation could let an older public route fragment finish loading after a newer route was already selected. The stale fragment then mounted into the DOM and made the wrong page active.

Live proof before deploy:

- `/students` expected `page-students`, but live showed `/for-sale`.
- `/discover-ai-chatbot` expected `page-ai-chatbot`, but live showed `/to-rent`.
- `/list-property` expected `page-list-property`, but live showed `/cookie-policy`.

Local proof after fix:

- Route transition probe passed 23/23 transitions on `http://127.0.0.1:5058`.
- The fix adds a monotonic public-route load token so stale fragments cannot replace the active page.

Live proof after deployment:

- Route transition probe passed 23/23 transitions on `https://makaug.com`.

## Remaining Issues To Work Through

1. Public brand copy still contains legacy `makaug` in some public strings and docs/tests. The requested public rule is `makaug.com`.
2. Language switching is still partial in some public body/search labels. The router fix did not attempt a full translation rewrite.
3. Provider credentials are not fully verified live:
   - Email provider envs missing.
   - SMS/Africa's Talking envs missing from the backend probe.
   - Payment provider envs missing.
   - Google Maps/Places envs missing from the backend probe.
   - OpenAI/LLM provider envs missing from the backend probe.
4. Super admin bootstrap envs are incomplete in the backend probe: `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_INITIAL_PASSWORD` are missing.
5. Authenticated King dashboard shortcut actions need a logged-in admin browser audit after deployment. Anonymous API protection is proven.
6. WhatsApp live delivery still needs a phone-level response proof. The backend bridge variables are present, but formal provider variables are not.
7. The final post-deploy live browser click and browser-route reruns hung without output and were stopped. The same browser probes passed locally after the fix, and live HTML/backend/performance/route-transition probes passed.

## Tests And Probes

Live:

- `BASE_URL=https://makaug.com npm run probe:public-routes` - pass.
- `BASE_URL=https://makaug.com npm run probe:backend-connections` - pass, 139 checks.
- `BASE_URL=https://makaug.com npm run probe:performance` - pass before this patch.
- `BASE_URL=https://makaug.com npm run probe:route-transitions` - failed before deploy, confirming the route race.
- `BASE_URL=https://makaug.com npm run probe:route-transitions` - pass after deploy, 23/23 transitions.
- `BASE_URL=https://makaug.com npm run probe:click-actions` - post-deploy rerun hung without output and was stopped.
- `BASE_URL=https://makaug.com npm run probe:public-routes:browser` - post-deploy rerun hung without output and was stopped.

Local after fix:

- `node --check assets/makaug-app.js` - pass.
- `node --check scripts/probe-click-actions.js` - pass.
- `npm run test:go-live-p0` - pass.
- `npm run check` - pass.
- `npm run typecheck:bot` - pass.
- `npm run build:bot` - pass.
- `npm run test:bot` - pass, 19 tests.
- `BASE_URL=http://127.0.0.1:5058 npm run probe:public-routes` - pass, 22 routes.
- `BASE_URL=http://127.0.0.1:5058 npm run probe:public-routes:browser` - pass, 23 routes.
- `BASE_URL=http://127.0.0.1:5058 npm run probe:click-actions` - pass, 39 checks.
- `BASE_URL=http://127.0.0.1:5058 npm run probe:route-transitions` - pass, 23 transitions.
- `BASE_URL=http://127.0.0.1:5058 npm run probe:performance` - pass after escalated Chrome/Playwright run.

## Environment Variables Still Required

- `SUPER_ADMIN_EMAIL`
- `SUPER_ADMIN_INITIAL_PASSWORD`
- Email provider: `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` or `RESEND_API_KEY`
- SMS/Africa's Talking: `AFRICASTALKING_API_KEY`, `AFRICASTALKING_USERNAME`, optional approved `AFRICASTALKING_SENDER_ID`, `SMS_TEST_PHONE`
- Google Maps/Places: `GOOGLE_MAPS_API_KEY`, `PUBLIC_GOOGLE_MAPS_API_KEY`
- OpenAI/LLM: `OPENAI_API_KEY`, `LLM_PROVIDER`
- Payments: `PAYMENT_LINK_BASE_URL`, `PAYMENT_PROVIDER_API_KEY`, `PAYMENT_PROVIDER_WEBHOOK_SECRET`
- WhatsApp formal provider if moving beyond web bridge: `WHATSAPP_PROVIDER`, `META_WHATSAPP_TOKEN` or Twilio WhatsApp credentials

## Rollback Notes

- Revert the public-route token guard in `assets/makaug-app.js` to return to the old router behavior.
- Revert the click probe marker in `scripts/probe-click-actions.js` if public About copy returns to the old exact `About makaug` wording.
