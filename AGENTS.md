# MakaUg Codex Operating Rules

MakaUg is a live Uganda-first property marketplace. Treat this repo as production.

## Completion Rule

A feature is not complete unless it is visible in the product, backed by routes/APIs/models where needed, protected by auth/roles where needed, and proven by tests.

A feature is not complete if it only exists as:
- homepage text
- hidden UI
- modal content rendered globally
- unused component
- unused model
- unused API
- placeholder
- TODO
- fake demo data
- local-only file
- “inside admin” when standalone route was requested

## Mandatory Traceability

Every feature must be checked against:

Feature → Route → Component → Model/service → API → Dashboard → Notification/logging → Analytics → Tests → Proof

If one part does not apply, explain why.

## Public HTML Leakage Rule

Anonymous public routes must not contain:
- My Account
- Sign in required
- Profile Information
- Security
- Current Password
- Update Password
- Property Finder Dashboard
- Student Dashboard
- Broker Dashboard
- Field Agent Dashboard
- Advertiser Dashboard
- Admin Dashboard
- Admin API Key
- Platform control access
- Ad Revenue
- Review Queue
- Advertising Desk
- WhatsApp AI Inbox
- Listing Review
- Motherboard Listing Control
- Recent Users
- Recent Brokers
- Recent Reports
- CRM
- Lead Centre
- Data source: local browser data
- Paste ADMIN_API_KEY
- Inquiry Number: -
- Location setup (step-by-step)

## Testing Rule

Before claiming success, run:
- lint
- typecheck
- build
- route leakage tests
- protected route tests
- signup/OTP tests
- dashboard tests
- CRM tests where relevant
- advertising tests where relevant
- listing flow tests where relevant
- email/WhatsApp tests where relevant
- i18n tests where relevant

## Final Report Rule

Every task must end with:
1. What was requested.
2. What was missing.
3. What was actually built.
4. Routes created/changed.
5. Components changed.
6. Models/services changed.
7. APIs changed.
8. Dashboards changed.
9. Tests added.
10. Tests run and result.
11. Build result.
12. Proof URLs/screenshots.
13. Known limitations.
14. Environment variables needed.
15. Rollback notes.

Do not write “complete” unless tests and build pass.
