# makaug.com King Dashboard Control Map

Date: 2026-05-07

The King Dashboard is the protected owner control centre for makaug.com. Public users must not see this surface. Admin and super_admin users can open it through `/admin`, `/admin/dashboard`, `/king`, or `/king/dashboard`; all deep links route to a backend-fed panel or to `/admin/setup-status` proof actions.

## Control Map

| Feature area | Owner route | Backend/API source | Dashboard control | Logs/proof | Status |
|---|---|---|---|---|---|
| Launch proof and provider setup | `/admin/setup-status`, `/admin/launch-control` | `/api/admin/setup-status`, proof action endpoints | Setup Status, Launch Control | AdminAuditLog, provider_missing logs, probe results | Working with provider credentials still required for live sends |
| Listing moderation | `/admin/moderation`, `/admin/listings`, `/admin/rejected`, `/admin/live`, `/admin/featured` | `/api/admin/summary`, `/api/admin/recent`, `/api/admin/properties/*` | Pending review, actioned, live follow-up, featured controls | moderation audit, listing activity, EmailLog/NotificationLog where used | Working |
| Fraud and safety | `/admin/fraud`, `/admin/notifications` | `/api/admin/reports/*`, `/api/admin/leads`, contact/fraud APIs | Fraud reports and lead follow-up | FraudReport, LeadActivity, NotificationLog | Working |
| Accounts and roles | `/admin/accounts`, `/admin/users`, `/admin/data-protection` | `/api/admin/users`, auth APIs | Contacts & Account Control | user activity, AdminAuditLog | Working |
| Field agents | `/admin/field-agents`, `/admin/field-agent-payouts`, `/admin/field-agent-training`, `/admin/field-agent-notices`, `/admin/contracts` | `/api/admin/field-agents/provision`, field-agent dashboard APIs | Field Agent Control Centre: ID/PIN setup, directory, notice board, payout control, training/contracts, support details | hashed PIN only, onboarding EmailLog/WhatsAppMessageLog/NotificationLog, AdminAuditLog, activity logs | Working for admin-created agents |
| Property finder needs | `/admin/property-needs`, `/admin/property-requests`, `/admin/crm` | `/api/admin/property-need-requests`, `/api/admin/property-requests`, `/api/contact/looking-for-property` | People Looking for Property, CRM Lead Centre | LeadActivity, EmailLog/NotificationLog, request status | Working |
| Saved alerts | `/admin/alerts`, `/admin/saved-searches` | alert matcher and saved search APIs | Leads & Notifications, Setup Status alert proof | AlertMatch, NotificationLog/provider_missing | Working with scheduled cron still owner-configured if external |
| Viewings and callbacks | `/admin/viewings`, `/admin/callbacks` | viewing/callback APIs, `/api/admin/setup-status/viewing-callback-test` | Leads & Notifications, CRM Lead Centre | ViewingBooking, CallbackRequest, LeadActivity, EmailLog/NotificationLog | Working |
| WhatsApp AI inbox | `/admin/whatsapp-inbox`, `/admin/whatsapp` | `/api/admin/whatsapp/insights`, `/api/admin/whatsapp/conversations` | WhatsApp AI Inbox | WhatsAppMessageLog, ConversationEvent, language fallback/mismatch logs | Working when WhatsApp provider/web bridge is configured |
| Language and translations | `/admin/language`, `/admin/content-i18n` | language registry, translation provider service, content audit docs | Launch Control, Setup Status | missing translation key logs, fallback counts | Partial until all human translations are complete |
| Location, maps, radius search | `/admin/location`, `/admin/setup-status` | location search service, Google Maps/Places provider checks | Setup Status, Launch Control | location search analytics, outside-Uganda fallback logs | Working with Google provider proof still required live |
| Advertising, payments, revenue | `/admin/advertising`, `/admin/payments`, `/admin/revenue` | advertising/payment APIs, payment provider service | Advertising Desk, Campaign Builder, Payment controls | PaymentLink, invoice/payment audit, provider_missing logs | Working with manual fallback; live provider proof required |
| Mortgage | `/admin/mortgage`, `/admin/crm` | mortgage route/service, lead service | CRM Lead Centre | MortgageLead/LeadActivity, EmailLog/NotificationLog | Working; bank rates remain indicative unless live source is configured |
| Help and careers | `/admin/help`, `/admin/careers`, `/admin/crm` | contact/help/careers APIs | CRM Lead Centre | HelpRequest/CareerSubmission/LeadActivity, EmailLog/NotificationLog | Working |
| Content and how-to videos | `/admin/how-to-videos`, `/admin/docs` | how-to video config and docs | Launch Control, King Docs | missing YouTube ID status | Partial until owner supplies YouTube IDs |

## Owner Rules

- The King Dashboard must never expose passwords, raw OTPs, tokens, NINs, or exact private user locations.
- Admin-created Field Agent PINs are hashed and cannot be viewed after save.
- Provider values are named in setup status but never printed.
- Public routes must not leak King/Admin dashboard text.
- If a route opens a status-only panel, the next action is shown in `/admin/setup-status`.

## Remaining Owner Proof Items

- Verify live email, SMS, WhatsApp, Google Maps/Places, OpenAI/LLM, and payment provider test actions.
- Add final YouTube IDs for how-to video slots.
- Complete human-reviewed translations for all supported languages.
- Keep external cron configured for scheduled alert matching if Render does not run it internally.
