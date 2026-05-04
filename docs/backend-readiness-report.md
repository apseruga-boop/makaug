# MakaUg Backend Readiness Report

Date: 2026-05-03

## Task 15 Backend Gate Addendum

This addendum records the focused Task 15 backend audit. It intentionally separates **source/backend wiring proof** from **live owner/provider proof** so the launch gate stays honest.

### Live API Proof Captured

| Check | Result | Evidence |
|---|---:|---|
| Production backend health | Passed | `GET https://makaug.com/api/health` returned `200` with `ok: true`, `env: production`, and database `ok: true`. |
| Migration `033_task3_engagement_crm.sql` | Passed | `GET /api/health/migrations` reported `applied: true`, `appliedAt: 2026-05-03T00:06:14.457Z`. |
| Migration `034_task4_super_admin_alerts_payments.sql` | Passed | `GET /api/health/migrations` reported `applied: true`, `appliedAt: 2026-05-03T01:29:10.365Z`. |
| Public AI model-card endpoint | Passed | `GET /api/ai/model-card` returned `200` and the MakaUg AI model card. |
| Public advertising packages endpoint | Passed | `GET /api/advertising/packages` returned `200` and package data. |
| Public mortgage rates endpoint | Passed with fallback source | `GET /api/mortgage-rates` returned `200`, `source: fallback`; rates must remain labelled indicative unless a verified source is configured. |
| Anonymous admin APIs blocked | Passed | `/api/admin/summary`, `/api/admin/crm/summary`, `/api/admin/leads`, `/api/admin/emails`, `/api/admin/notifications`, and `/api/admin/alerts` returned `401`. |
| Anonymous role dashboards blocked | Passed | `/api/property-seeker/dashboard` and `/api/student/dashboard` returned `401`; `/api/advertising/dashboard` returned `403`. |

### Local Environment Proof Captured

The local audit shell did not have production secrets. Secret values were not printed. The following were missing locally: `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_INITIAL_PASSWORD`, `SUPER_ADMIN_PHONE`, `DATABASE_URL`, `JWT_SECRET`, `ADMIN_API_KEY`, `SMTP_HOST`, `MS_GRAPH_CLIENT_ID`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `PAYMENT_LINK_BASE_URL`, `PAYMENT_PROVIDER_API_KEY`, `PAYMENT_PROVIDER_WEBHOOK_SECRET`, `GOOGLE_MAPS_API_KEY`, `OPENAI_API_KEY`, and `PUBLIC_BASE_URL`.

Exact live super_admin status: **super_admin support exists, but live super_admin was not created because required env vars were not provided.**

### New Repeatable Probe

`npm run probe:backend-connections` now checks:

- source-level backend wiring for auth, listing submission, saved searches, alerts, viewings, callbacks, advertising/payment, mortgage, help, careers, fraud, AI assistant, and admin log visibility;
- provider/env presence without printing secrets;
- live health, migration, AI model card, advertising packages, and mortgage endpoint status;
- anonymous blocking for protected/admin APIs.

This probe is a launch gate helper; it does not create fake production listings, leads, payments, or users.

### Task 15 Gate Decision

Backend wiring is stronger than the frontend-only shell stage, and production migrations are applied. However, live super_admin login, live property submission, provider sends, AI tool execution with a configured LLM, saved-search scheduler cadence, live viewing/callback records, and real payment-provider execution remain unproven in this audit. The current gate remains **not masterpiece complete**.

This report is the Task 14 backend gate. It only marks a feature as **working** when a route/service/model/log path exists and is covered by automated tests or probes. Live provider delivery and owner login are tracked separately because they require production credentials and deliberate owner action.

## Status Legend

- **Working**: backend endpoint/service/log path exists and automated proof covers the path.
- **Partial**: backend exists, but live credentials, provider sends, scheduler cadence, owner login, or authenticated production proof is still missing.
- **Missing**: no durable backend path was found.

## Readiness Matrix

| Feature name | Frontend route/component | CTA/form | API endpoint | Backend service | Database table/model/log | Email/WhatsApp/SMS event | CRM/lead event | Admin visibility | Test coverage | Live proof status | Status | Owner action required |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Sign in | `/login`, AuthDrawer | Continue / password | `POST /api/auth/login` | `routes/auth.js`, `authFlowService`, `adminSecurityService` | `users`, session/JWT cookie, admin audit for admin roles | admin login audit where applicable | none | admin audit logs, protected routes | `tests/go-live-p0.test.js` route/auth checks | Live owner login not performed | Partial | Provide live credentials and verify login. |
| Create account | AuthDrawer | Create account | `POST /api/auth/register`, `POST /api/auth/verify-otp` | `authFlowService` | `users`, `otps`, role profile/preference tables | `otp_sent`, `otp_verified`, account-created events | role preference/activity after verify | users/admin summaries | `test:go-live-p0` checks required email/phone/role flow | Live OTP provider not verified | Partial | Configure email/SMS/WhatsApp OTP provider or use approved test mode. |
| Student signup | AuthDrawer, `/student-signup` | Student role card | auth register/verify | `authFlowService.ensurePostVerificationRecords` | `users`, `student_preferences` | `account_created_student` | student preference record | admin user views | `test:go-live-p0` | Live student signup not performed | Partial | Run preview signup with provider or test OTP. |
| Broker signup | AuthDrawer, `/broker-signup` | Broker role card | auth register/verify | `authFlowService` | `users.profile_data` broker review fields | `new_broker_verification_request` | broker signup lead/activity where routed | admin broker/user review | `test:go-live-p0` | Live broker signup not performed | Partial | Run preview signup and review workflow. |
| Field-agent signup | AuthDrawer, `/field-agent-signup` | Field Agent role card | auth register/verify | `authFlowService` | `users.profile_data.field_agent_application_status` | `new_field_agent_application` | field-agent application lead/activity | `/admin/field-agents` | `test:go-live-p0` | Live field-agent signup not performed | Partial | Run preview application. |
| Advertiser signup | AuthDrawer, `/advertiser-signup`, `/advertise` | Advertiser role / inquiry | auth register, `POST /api/advertising/inquiries` | `routes/advertising.js`, `leadService` | `users`, `advertising_inquiries`, `leads` | `advertiser_signup_received` | advertiser lead | `/admin/advertising`, `/admin/leads` | `test:go-live-p0` | Live provider/payment not verified | Partial | Verify advertiser inquiry and campaign flow in preview. |
| OTP send | AuthDrawer | Send code | register/request OTP endpoints | auth/email/SMS services | `otps`, notification logs | `otp_sent` | none | `/admin/notifications` | static tests | Provider sends not verified | Partial | Configure provider credentials and run OTP smoke. |
| OTP verify | AuthDrawer | Verify code | `POST /api/auth/verify-otp` | `authFlowService` | `users`, role profile/preference tables | `otp_verified` | role activity/preference | admin users/audit | `test:go-live-p0` payload tests | Live OTP verify not performed | Partial | Run controlled preview verification. |
| Password reset | AuthDrawer | Forgot password | password reset endpoints | auth/email/SMS services | `otps`, `users.password_hash` | password reset/OTP provider logs | none | notifications | static route coverage | Provider sends not verified | Partial | Configure provider and test reset email/SMS. |
| Change password | dashboards/settings | Change password | auth change-password endpoint | auth/admin security services | `users.password_hash`, `admin_security_settings` | security notification where configured | none | admin audit for admin roles | static tests | Live not performed | Partial | Owner should rotate initial super_admin password after creation. |
| Contact preferences | dashboards/settings | Save preferences | auth/property-seeker preference APIs | auth/property-seeker routes | `users`, `property_seeker_profiles` | none | activity rows | dashboards/admin user views | static API tests | Live not performed | Partial | Verify with authenticated users. |
| Language preference | AuthDrawer/dashboards | Language selector | auth/property-seeker language APIs | auth/property-seeker routes | `users`, profile/preference rows | none | activity rows | dashboards | route/static tests | Live not performed | Partial | Complete translation keys before claiming full i18n. |
| List online | `/list-property` | Submit listing | `POST /api/properties` | `listingReferenceService`, `listingModerationService`, `leadService`, email/log services | `properties`, `property_images`, `property_moderation_events`, `email_logs`, `notifications`, `whatsapp_message_logs`, `leads` | `listing_submitted`, `new_listing_pending_review` | listing owner lead/activity | admin moderation, emails, notifications | `test:go-live-p0` static/backend wiring | Live fake listing not created by policy | Partial | Run preview/test-mode submission; do not publish fake production listing. |
| List via WhatsApp | `/list-property` | List via WhatsApp AI | `POST /api/properties/listing-intent` plus `wa.me` handoff | `leadService`, notification/log/WhatsApp log services | `leads`, `lead_activities`, `notifications`, `whatsapp_message_logs` | `list_property_whatsapp_clicked` log / provider fallback | listing-owner lead/activity | CRM, notifications, WhatsApp logs | click probe + go-live tests | Live WhatsApp delivery not verified | Partial | Configure WhatsApp provider/inbox to verify actual delivery. |
| Address lookup/map pin | `/list-property` | Find address/place / Confirm pin | frontend Places provider; listing submit stores object | Google Places/fallback UI | listing location fields, `extra_fields.location_object` | provider-missing warning/log where configured | listing lead metadata | admin moderation | public/browser route tests | Google provider not verified | Partial | Provide Google Maps/Places key and run browser selection test. |
| Photos | `/list-property` | Upload/mock photos | `POST /api/properties` accepts photo payload | properties route | `property_images` | listing submitted logs include image context | listing activity | moderation queue | static tests | Live upload storage not audited | Partial | Verify storage policy and upload limits. |
| Property OTP | `/list-property` | OTP method/verify | property OTP endpoints | properties/auth services | `otps`, submit tokens | `otp_sent`, `otp_verified` | none | notifications | static tests | Live provider not verified | Partial | Run provider/test OTP proof. |
| Submission success modal/reference | `/list-property` | Submit listing | `POST /api/properties` response | listing reference/log services | generated `MK-YYYYMMDD-XXXXX`, logs, moderation | email/notification/WhatsApp log events | listing submitted activity | admin moderation/search | `test:go-live-p0` static checks | Live modal not submitted in production | Partial | Prove in preview/test mode and capture reference. |
| Property finder dashboard | `/dashboard` | Dashboard load/actions | `/api/property-seeker/*` | property-seeker route/services | saved listings/searches, notes, recent, comparisons, viewings, callbacks, needs | saved search/viewing/callback logs where relevant | activity/lead rows | super_admin preview, admin leads | `test:go-live-p0` static/API checks | Authenticated live proof missing | Partial | Use test user or owner preview to prove data rendering. |
| Saved listings | cards/dashboard | Save/remove listing | saved-listing APIs | property-seeker route | `saved_listings` | none | activity row | dashboard/admin demand | static tests | Live user proof missing | Partial | Verify authenticated save/remove. |
| Saved searches | category/dashboard | Save Search | saved-search APIs | property-seeker/student routes | `saved_searches` | `saved_search_created` | demand/lead event | `/admin/alerts`, launch control | matcher/static tests | Live user proof missing | Partial | Verify authenticated save and dashboard display. |
| Alert matching | listing activation/admin | Match/retry alerts | listing activation service/admin alerts | `alertSchedulerService`, retry service | `alert_matches`, notifications | `alert_match_found` | demand signal | `/admin/alerts`, launch control | matcher tests | Scheduler cadence not live verified | Partial | Configure/verify cron or run manual matcher endpoint. |
| Recommendations/recently viewed | `/dashboard` | View recommendations/recent | property-seeker APIs | property-seeker route | properties, recently viewed table | none | activity | dashboard preview | static API tests | Live user proof missing | Partial | Verify with authenticated test user. |
| Enquiries/WhatsApp contacts | cards/detail | WhatsApp/call/enquiry | properties enquiry/WhatsApp endpoints | properties route, `leadService` | property enquiries, leads, lead activities, notifications | `whatsapp_contact_initiated`, `enquiry_sent` | enquiry/WhatsApp lead activity | admin leads/notifications | go-live tests | Live provider delivery not verified | Partial | Verify with production provider or safe logs. |
| Viewings | cards/detail/dashboard | Book Viewing | `POST /api/property-seeker/viewings` | property-seeker route, `leadService` | `viewing_configs`, `viewing_bookings`, leads, notifications | `viewing_requested` | viewing lead/activity | admin leads/launch control | go-live static/API tests | Production record not created | Partial | Create preview booking and verify admin record. |
| Callbacks | cards/detail/dashboard | Request Callback | `POST /api/property-seeker/callbacks` | property-seeker route, `leadService` | `callback_requests`, leads, notifications | `callback_requested` | callback lead/activity | admin leads/launch control | go-live static/API tests | Production record not created | Partial | Create preview callback and verify admin record. |
| Student dashboard | `/student-dashboard` | Dashboard/preferences | `/api/student/*` | student route | `student_preferences`, saved searches | saved-search event where relevant | activity rows | admin/user views, preview | static tests | Authenticated live proof missing | Partial | Verify with student test user. |
| Broker dashboard | `/broker-dashboard` | Listings/leads/viewings | protected UI + admin/property APIs | properties/admin/lead routes | properties, leads, viewing/callback tables | source notifications | broker lead rows | admin leads/broker review | protected/static tests | Authenticated live proof missing | Partial | Add broker-specific API aggregation later. |
| Field-agent dashboard | `/field-agent-dashboard` | Tasks/submissions | protected UI + admin/property APIs | auth/admin/property routes | user profile fields, properties | notifications | lead/activity partial | `/admin/field-agents` | protected/static tests | Authenticated live proof missing | Partial | Add dedicated tasks/contracts proof. |
| Advertiser dashboard | `/advertiser-dashboard` | Campaign/payment | advertising dashboard/campaign/payment APIs | advertising/payment services | campaigns, creatives, invoices, payment links, leads | campaign/payment events | advertiser lead | admin advertising/revenue | go-live tests | Real provider not verified | Partial | Configure payment provider or use manual payment fallback proof. |
| Campaign draft/creative/package | advertiser dashboard | Create campaign | `POST /api/advertising/campaigns` | advertising routes | `advertising_campaigns`, creative/package fields | `campaign_submitted` when submitted | advertiser lead | `/admin/advertising` | static tests | Live not performed | Partial | Run preview campaign creation. |
| Payment link | advertiser/admin | Generate payment link | payment-link APIs/webhook | `paymentProviderService` | `payment_links`, `invoices` | `payment_link_created` | advertiser lead/campaign status | `/admin/revenue` | go-live tests | Real provider missing/unverified | Partial | Provide provider envs or use manual payment. |
| Manual payment | admin revenue | Mark paid | admin manual-paid endpoint | payment/admin security services | `invoices`, `payment_links`, `admin_audit_logs` | payment notification where configured | advertiser lead/activity | admin revenue/audit | static tests | Live not performed | Partial | Use super_admin in preview to mark a test invoice paid. |
| Payment webhook | provider callback | webhook | advertising payment webhook | payment provider service | invoice/payment status | payment received/failed logs | campaign status | admin revenue | static tests | Provider webhook not live verified | Partial | Configure provider signature secret and run webhook test. |
| Admin launch control | `/admin/launch-control` | Owner dashboard | admin summary/log routes | admin routes/services | leads/listings/invoices/logs/audit | provider status/logs | all lead types | launch control UI | go-live static tests | Live super_admin login missing | Partial | Create/login super_admin and verify modules. |
| Admin docs | `/admin/docs` | Docs links | protected route | sanitizer/admin route guard | docs files | none | none | admin docs | go-live tests | Live owner not logged in | Partial | Verify after super_admin setup. |
| CRM/leads | `/admin/crm`, `/admin/leads` | Assign/note/task | admin lead APIs | `leadService`, admin routes | contacts, leads, lead activities/tasks/assignments | source notifications | central CRM | CRM/leads pages | go-live tests | Live data proof missing | Partial | Verify with created preview leads. |
| Notifications/emails/WhatsApp inbox | admin routes | filters/retry | admin log routes, retry endpoints | email/notification/WhatsApp log services | email logs, notifications, WhatsApp logs | failed/skipped/sent status | related lead/listing IDs | admin log pages | go-live tests | Provider delivery unverified | Partial | Verify real provider send plus retry policy. |
| AI assistant reply | `/discover-ai-chatbot` | Ask AI/task buttons | `POST /api/ai/assistant-reply` | `aiService`, `aiLearningCaptureService`, `leadService` | AI events, leads for actionable intents, notifications | `human_handoff_required` where needed | handoff/fraud/mortgage/advertiser/listing lead | admin AI/WhatsApp logs, leads | go-live tests | LLM provider/tool execution partial | Partial | Configure OpenAI/LLM provider and verify tool execution. |
| AI search intent | AI page/chat | Search prompts | assistant reply | AI service fallback | AI event | none | demand signal | AI/admin logs | static tests | Live not tested | Partial | Add server-side listing search tool. |
| AI save alert/viewing/callback tools | AI page/chat | task prompts | assistant reply/handoff | AI service/lead service | AI event, leads partial | handoff logs | lead/handoff | admin logs | static tests | Full tool execution partial | Partial | Implement direct tool calls for saved-search/viewing/callback. |
| AI fraud/mortgage/advertiser/handoff | AI page/chat | task prompts | assistant reply | AI service/lead service | AI event, leads | handoff/provider logs | CRM lead | admin leads/logs | static tests | Live not tested | Partial | Verify in preview; no raw PII training. |
| Mortgage calculator formula | `/mortgage` | Calculate | client/service tests | `mortgageCalculatorService` | none | none | none | none | formula tests | Browser/live route OK, no backend write | Working | None for formula. |
| Mortgage lead | `/mortgage` | Request help | `POST /api/mortgage/enquiry` | mortgage route, `leadService`, email/log services | `mortgage_enquiries`, leads, email logs, notifications | `mortgage_lead_received` | mortgage lead/activity | admin leads/launch control | go-live tests | Live lead not created | Partial | Submit preview lead and verify admin record. |
| Mortgage rates/bank source | `/mortgage` | Provider rates | `GET /api/mortgage` | mortgage route | `mortgage_providers` or fallback config | none | none | admin mortgage provider update | static tests | Live rates API not verified | Partial | Keep rates labelled indicative unless real source configured. |
| Help request | `/help` | Help form | `POST /api/contact/help-request` | contact route, `leadService`, email/log services | leads, email logs, notifications | `help_request_submitted`, admin alert | support lead/activity | admin leads/emails/notifications | go-live tests | Live request not created | Partial | Submit preview help request. |
| Careers request | `/careers` | Career interest form | `POST /api/contact/career-interest` | contact route, `leadService`, email/log services | leads, email logs, notifications; no dedicated CareerSubmission table | `career_interest_submitted`, `new_career_interest` | career lead/activity | admin leads/emails/notifications | go-live tests added | Live request not created | Partial | Submit preview career interest; add CV upload storage later if needed. |
| Fraud report | `/report-fraud`, `/anti-fraud` | Report suspicious | `POST /api/contact/report-listing` | contact route, `leadService`, email/log services | `report_listings`, leads, email logs, notifications | `fraud_report_received`, admin alert | fraud lead/activity | admin fraud/leads/logs | go-live tests | Live report not created | Partial | Submit preview fraud report and verify admin. |
| Property need/no-results | category pages | Tell MakaUg what you need | `POST /api/contact/looking-for-property` | contact route, `leadService` | `property_requests`, leads, notifications | property need logged notification | demand lead/activity | admin leads/property requests | go-live tests | Live not created | Partial | Submit preview no-results need request. |
| Public route probes | public pages | navigation | public HTML/sanitizer | `publicHtmlSanitizer` | none | none | none | none | public route/browser probes | Latest live probes to be rerun | Partial | Rerun before launch. |
| Click probes | public pages | CTA/link/button | frontend/API links | probe script | none | varies | varies | docs/launch control | click probe | Latest live probes to be rerun | Partial | Rerun before launch. |
| Performance probe | public pages | route visibility | static/server/probe | server/static config | docs audit | none | none | launch control/performance docs | performance probe | One homepage threshold miss previously reported | Partial | Fix or report exact remaining miss. |
| Protected API/admin guards | admin/protected APIs | admin actions | `/api/admin/*`, protected dashboards | auth middleware/admin guards | user role/JWT/API key, audit logs | audit/provider logs | admin action leads where applicable | all admin modules | go-live protected route/API checks | Live owner not logged in | Partial | Verify with super_admin account. |

## Provider Status From Local Environment

Local environment variables were checked without printing secret values. Required production provider credentials are not present in this local shell unless the owner supplies them through deployment secrets.

| Provider | Configured locally | Send/call proof | Fallback log path | Admin visibility | Required owner action |
|---|---|---|---|---|---|
| Email | Not proven | Not proven | `EmailLog`, `NotificationLog` with skipped/failed/provider-missing status | `/admin/emails`, `/admin/notifications` | Configure SMTP/Resend/MS Graph/webhook envs and run send proof. |
| WhatsApp | Not proven | Not proven | `WhatsAppMessageLog`, `NotificationLog`, wa.me handoff | `/admin/whatsapp-inbox`, `/admin/notifications` | Configure Meta/Twilio WhatsApp envs and verify inbox/webhook. |
| SMS | Not proven | Not proven | `NotificationLog` provider-missing/failure status | `/admin/notifications` | Configure Twilio/Africa's Talking or chosen SMS provider. |
| Payment | Not proven | Not proven | `payment_links`, `invoices`, manual payment audit | `/admin/revenue`, `/admin/advertising` | Configure payment provider envs or use manual fallback. |
| Google Places/Maps | Not proven | Not proven | address-first fallback/manual pin | listing flow/admin review | Provide browser API key and verify autocomplete. |
| OpenAI/LLM | Not proven | Not proven | template fallback + conversation event logging | AI/admin logs and leads | Configure LLM provider and verify tool execution. |
| PUBLIC_BASE_URL | Not proven locally | N/A | route fallback uses request origin | public links/logs | Set production base URL in deployment. |

## Owner Actions Required Before Calling It Complete

1. Provide `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_INITIAL_PASSWORD`, `SUPER_ADMIN_PHONE` optional, `DATABASE_URL`, and `JWT_SECRET`, then run `npm run admin:create-super`.
2. Log in as super_admin, rotate the initial password, and verify `/admin`, `/admin/launch-control`, `/admin/docs`, `/admin/crm`, `/admin/leads`, `/admin/advertising`, `/admin/revenue`, `/admin/notifications`, `/admin/emails`, `/admin/whatsapp-inbox`, `/admin/viewings`, `/admin/callbacks`, `/admin/field-agents`, `/admin/payments`, `/admin/contracts`, `/admin/fraud`, and `/admin/data-protection`.
3. Run one test/preview property submission and verify reference, success modal, `EmailLog`, `NotificationLog`, `WhatsAppMessageLog`, CRM lead/activity, and admin pending-review record.
4. Configure and prove email, WhatsApp, SMS, payment, Google Places, and LLM provider credentials, or accept provider-missing logging states for launch.
5. Verify saved-search alert cadence in production or configure a cron/manual run cadence and expose status in Launch Control.
6. Submit preview help, careers, fraud, mortgage, viewing, callback, advertiser, and payment/manual-payment flows and verify admin visibility.
7. Provide YouTube IDs for how-to video slots.
8. Complete non-English translations or keep the missing-key audit visible and honest.

## Gate Decision

Backend connectivity is substantially implemented in code and local/static tests, but live owner login, production provider sends, live property submission, AI provider/tool execution, alert scheduler cadence, live viewing/callback records, and real payment provider execution remain unproven. The current gate status is therefore **not masterpiece complete** until those owner/provider proof steps pass.

## Task 16 Owner Proof Addendum

`/admin/setup-status` is now the protected owner proof page. It is admin/super_admin only, shows setup status without secret values, and names missing environment variable keys rather than displaying values.

New admin-only proof actions:

| Proof action | API | Backend effect | Public-data safety | Status |
|---|---|---|---|---|
| Safe property submission test | `POST /api/admin/setup-status/property-submission-test` | Creates a pending admin-test listing with `MK-YYYYMMDD-XXXXXX` reference, CRM lead/activity, `EmailLog`, `NotificationLog`, `WhatsAppMessageLog`, and audit row | `source=admin_test`, test metadata, not approved publicly | Working in source; live owner must run |
| Provider tests | `POST /api/admin/setup-status/provider-test` | Creates queued/logged/provider-missing proof rows for email, WhatsApp, SMS, Google Places, OpenAI/LLM, and payment | No secret values shown; sends are not forced without configured providers | Working in source; live owner must run |
| AI chatbot smoke test | `POST /api/admin/setup-status/ai-smoke-test` | Logs eleven canonical prompts, detected intents, provider status, CRM leads for actionable intents, and audit row | Provider-missing state recorded if LLM is absent | Working in source; live provider execution still required |
| Alert matcher proof | `POST /api/admin/setup-status/run-alert-matcher` | Creates a test saved search/listing pair, runs `matchListingToSavedSearches`, creates `AlertMatch`/notification rows, and audit row | Test-labelled records | Working in source; cron cadence still owner action |
| Viewing/callback proof | `POST /api/admin/setup-status/viewing-callback-test` | Creates `ViewingConfig`, `ViewingBooking`, `CallbackRequest`, CRM leads, notification log, and audit row | Test-labelled listing/records | Working in source; live owner must run |
| Advertising/payment proof | `POST /api/admin/setup-status/advertising-payment-test` | Creates test campaign, invoice, payment link or provider-missing state, manually marks paid with audit | Test campaign/invoice | Working in source; real provider remains unverified |
| Mortgage/help/careers/fraud proof | `POST /api/admin/setup-status/support-flow-test` | Creates mortgage/help/careers/fraud leads, mortgage enquiry/report row where available, email/notification logs, and audit | Test-labelled lead/log rows | Working in source; live owner must run |

Owner actions after deployment:

1. Add `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_INITIAL_PASSWORD`, `SUPER_ADMIN_PHONE` optional, `DATABASE_URL`, `JWT_SECRET`, and `ADMIN_API_KEY` if API-key fallback is desired.
2. Run `npm run admin:create-super`, log in as super_admin, and rotate the initial password.
3. Open `/admin/setup-status`, confirm provider/database/super_admin status, then run each proof button.
4. Review `/admin/launch-control`, `/admin/emails`, `/admin/notifications`, `/admin/whatsapp-inbox`, `/admin/alerts`, `/admin/revenue`, and `/admin/leads` for the generated proof records.

Gate remains **not masterpiece complete** until the owner has run those live proof actions and confirmed provider sends or admin-visible provider-missing logs.

## Task 18 Language, OTP, and Location Addendum

Task 18 adds source-level backend visibility for language fallback and location search.

| Flow | Frontend/API | Backend service/log | Admin visibility | Status |
|---|---|---|---|---|
| Language registry | Web/auth/OTP/WhatsApp/AI | `config/languageRegistry.js`, `services/translationProviderService.js` | `/api/admin/setup-status` `languageSystem` | Working in source; full translations partial |
| Wrong-language guard | WhatsApp/AI prompts | registry guardrails and fallback metadata | setup/launch status counts where logs exist | Working in source; live WhatsApp/LLM needs proof |
| List Property current location | `/list-property` button `lp-current-location-btn` | listing payload location object on submit | listing moderation/admin review | Working in source; browser permission must be tested live |
| Typed address autocomplete | `/list-property` `Find address or place` | Google Places if configured, Nominatim/manual fallback otherwise | provider status in setup page | Working in source; Google key must be verified live |
| Web radius search | `/api/properties/search?lat=&lng=&radiusKm=` | Haversine query, `property_search_requests` log | setup status `locationSearches` | Working in source; live API/probe to rerun after deploy |
| Outside-Uganda fallback | `/api/properties/search` and browser near-me | safe 400/fallback response, rounded location log | setup status location counts | Working in source |
| WhatsApp shared-location search | WhatsApp webhook shared location | 10-mile default search, rounded location analytics, search result cache | WhatsApp/search logs | Working in source; provider webhook still needs live proof |

Owner actions still required:

1. Verify Google Maps/Places key in production.
2. Test browser geolocation on HTTPS for `/list-property` and homepage/category search.
3. Confirm SMS OTP provider sends a real text message through Africa's Talking.
4. Run WhatsApp shared-location search through the live webhook or a controlled provider test.
5. Review Rukiga/Runyankole/Luganda/Kiswahili/Acholi/Lusoga translations before marking multilingual content complete.
