# MakaUg Go-Live Manual QA Checklist

Use this checklist against the running preview/live app after deploy.

## Public

- Open `/` logged out. Header shows `Saved` and `Sign In`; it does not show `Dashboard` or `Sign Out`.
- Open `/for-sale`, `/to-rent`, `/student-accommodation`, `/students`, `/land`, `/commercial`, `/brokers`, `/mortgage`, `/advertise`, `/list-property`, `/about`, `/help`, `/safety`, and `/anti-fraud`.
- Confirm every public route shows route-specific body content, not only header/footer.
- On empty category routes, confirm no-results content shows Save Search, Create Alert, Ask MakaUg on WhatsApp, and Tell MakaUg what you need.
- Search from the homepage. Confirm location scope appears only once.
- Switch language. Confirm visible labels change where translations exist.
- Confirm footer says `© 2026 MakaUg. All rights reserved.`
- Confirm public HTML does not include dashboard, admin, CRM, account, or listing submission internals.
- Run `BASE_URL=https://makaug.com npm run probe:public-routes`.

## Signup

- Complete property seeker signup. Confirm password confirmation blocks mismatches.
- Complete student signup. Confirm dashboard redirects to `/student-dashboard`.
- Complete broker signup. Confirm broker profile is pending review.
- Complete field agent signup. Confirm application is pending review.
- Complete advertiser signup. Confirm advertiser dashboard or pending state appears.
- Verify OTP. Confirm the user is not left stuck and lands on the correct dashboard.

## Listing

- Open `/list-property`.
- Confirm flow order: Listing Type, Title, Find address or place.
- If Google Places is configured, type `Ntinda`, select a suggestion, confirm map and location fields update.
- If provider is missing, confirm manual landmark/district/town fallback works.
- Submit a test listing in non-production/test mode.
- Confirm a real reference like `MK-20260503-ABCDE` appears.
- Confirm email/notification logs include the same reference.
- Confirm admin moderation can find the listing by reference.

## Super Admin

- Set `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_INITIAL_PASSWORD`, `SUPER_ADMIN_PHONE` optional, `DATABASE_URL`, and `JWT_SECRET` in the target environment.
- Run `npm run admin:create-super`.
- Confirm the script does not print the password.
- Sign in as the super admin.
- Immediately change the initial password.
- Confirm `/admin`, `/admin/docs`, `/admin/crm`, `/admin/leads`, `/admin/advertising`, `/admin/revenue`, `/admin/notifications`, `/admin/emails`, `/admin/whatsapp-inbox`, `/admin/viewings`, `/admin/callbacks`, `/admin/field-agents`, `/admin/payments`, `/admin/contracts`, `/admin/fraud`, and `/admin/data-protection` are accessible.
- Confirm admin login, bootstrap, password change, manual payment, and retry actions create audit rows.

## Backend Connection Audit

- Open `docs/backend-traceability-matrix.md` or `/admin/docs` as super admin.
- Open `/admin/setup-status` as super admin. Confirm it does not show secret values.
- Confirm Super admin status, provider status, migration status, launch proof timestamps, and owner actions required.
- Run each setup-status proof action: safe property submission, provider tests, AI smoke test, alert matcher, viewing/callback test, advertising/payment test, and mortgage/help/careers/fraud test.
- Confirm generated proof records appear in `/admin/launch-control`, `/admin/leads`, `/admin/emails`, `/admin/notifications`, `/admin/whatsapp-inbox`, `/admin/alerts`, and `/admin/revenue` where relevant.
- Confirm every launch-critical public CTA and form has an API/service/table/log/admin visibility row.
- Confirm no item marked `Partial` is described as complete in launch messaging.
- Run `BASE_URL=https://makaug.com npm run probe:backend-connections` and confirm live health, migrations, public backend endpoints, and anonymous admin/API blocking pass.
- Run `npm run test:go-live-p0` and confirm backend wiring checks pass.
- Check `/api/health/migrations` and confirm migrations `033_task3_engagement_crm.sql` and `034_task4_super_admin_alerts_payments.sql` are applied.
- In preview/test mode, submit one property and confirm the same reference appears in `properties`, `email_logs`, `whatsapp_message_logs`, `notifications`, CRM leads, and admin moderation.
- Confirm provider-missing states are visible for email, WhatsApp, SMS, payment, Google Places, and OpenAI/LLM if credentials are absent.

## Dashboards

- Property seeker can open `/dashboard`.
- Student can open `/student-dashboard`.
- Broker can open `/broker-dashboard`.
- Field agent can open `/field-agent-dashboard`.
- Advertiser can open `/advertiser-dashboard`.
- Super admin can open `/admin`, `/admin/crm`, `/admin/leads`, `/admin/advertising`, `/admin/revenue`, `/admin/alerts`, `/admin/emails`, `/admin/notifications`, and `/admin/whatsapp-inbox`.
- Admin/super admin can open `/admin/docs` and read the Feature Completion Matrix, Go-Live Manual QA, Content/i18n Audit, and Operating Rules summaries.
- Protected routes include noindex/noarchive.

## WhatsApp

- Click listing card WhatsApp. Message includes title, location, category, reference, and URL.
- Click listing detail WhatsApp. Message includes title, location, category, reference, and URL.
- Confirm no WhatsApp text contains `undefined` or `null`.
- Confirm WhatsApp click creates a lead/activity event.

## Payments

- Create advertiser campaign.
- Generate payment link.
- If provider is missing, confirm safe provider-missing state appears.
- Mark invoice paid manually as admin with a reason.
- If a provider exists, send webhook test and confirm invoice/campaign status updates.

## Alerts

- Save a search as a signed-in user.
- Activate a matching listing.
- Confirm an `AlertMatch` is created.
- Confirm duplicate alert is prevented.
- Confirm provider-missing external sends are logged safely.
- Open `/admin/alerts` and verify counts/failed alerts.

## Content

- Check `/about`, `/how-it-works`, `/careers`, `/terms`, `/privacy-policy`, `/cookie-policy`, `/anti-fraud`, `/help`, `/safety`, and `/brokers`.
- Confirm each route is standalone, not a homepage fragment.
- Confirm legal pages remain marked for legal review.
- Confirm WhatsApp support CTA appears where useful.
