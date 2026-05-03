# MakaUg Go-Live Manual QA Checklist

Use this checklist against the running preview/live app after deploy.

## Public

- Open `/` logged out. Header shows `Saved` and `Sign In`; it does not show `Dashboard` or `Sign Out`.
- Search from the homepage. Confirm location scope appears only once.
- Switch language. Confirm visible labels change where translations exist.
- Confirm footer says `© 2026 MakaUg. All rights reserved.`
- Confirm public HTML does not include dashboard, admin, CRM, account, or listing submission internals.

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

## Dashboards

- Property seeker can open `/dashboard`.
- Student can open `/student-dashboard`.
- Broker can open `/broker-dashboard`.
- Field agent can open `/field-agent-dashboard`.
- Advertiser can open `/advertiser-dashboard`.
- Super admin can open `/admin`, `/admin/crm`, `/admin/leads`, `/admin/advertising`, `/admin/revenue`, `/admin/alerts`, `/admin/emails`, `/admin/notifications`, and `/admin/whatsapp-inbox`.
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
