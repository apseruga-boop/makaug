# MakaUg CTA Action Matrix

Generated for Task 9 go-live stabilization.

Status terms: **working** means the CTA has a route, click handler, API submit, or external destination and is covered by the click-action probe or existing go-live tests. **partial** means backend/provider behaviour may depend on credentials or logged-in state. **disabled** means intentionally unavailable with a visible reason.

| Area | Label | Selector / Route | Expected action | Logged-out behaviour | Logged-in / role behaviour | Event / lead | Coverage | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Header | WhatsApp number | topbar `wa.me` | Opens official WhatsApp | Opens WhatsApp | Opens WhatsApp | source context via URL where supported | click probe href audit | working | Uses official MakaUg number. |
| Header | Email | `mailto:info@makaug.com` | Opens email client | Opens mail | Opens mail | none | href audit | working | Public support channel. |
| Header | Language | `#lang-sel` | Changes visible language labels | Saves preference locally | Saves preference locally | `language_changed` where analytics enabled | go-live/i18n checks | working | Full translations remain tracked separately in content audit. |
| Header | Currency | `#cur-sel` | Changes display currency | Saves preference locally | Saves preference locally | currency preference | static checks | working | Existing currency logic preserved. |
| Header | Saved | `#top-saved-link` | Saved page/dashboard saved tab | Opens MakaUg auth drawer with saved-property context | `/dashboard?tab=saved` | `saved_auth_required_clicked` | click probe | working | No stripped modal dependency. |
| Header | Sign In | `#top-signin-link` | Opens MakaUg auth drawer | Opens drawer; `/login` remains clean fallback | Dashboard redirect after auth | `auth_drawer_opened`, `auth_success` | click probe | working | Fixed Task 9: no messy all-in-one `/login`. |
| Header | For Sale | `#nav-sale` | `/for-sale` | Public route | Public route | `page_view` | click + route probes | working | Has real `href`. |
| Header | To Rent | `#nav-rent` | `/to-rent` | Public route | Public route | `page_view` | click + route probes | working | Has real `href`. |
| Header | Students | `#nav-students` | `/student-accommodation` | Public route | Public route | `page_view` | click + route probes | working | Has real `href`. |
| Header | Commercial | `#nav-commercial` | `/commercial` | Public route | Public route | `page_view` | click + route probes | working | Has real `href`. |
| Header | Land | `#nav-land` | `/land` | Public route | Public route | `page_view` | click + route probes | working | Has real `href`. |
| Header | Find Brokers | `#nav-brokers` | `/brokers` | Public route | Public route | `page_view` | click + route probes | working | Has real `href`. |
| Header | Mortgage Finder | `#nav-mortgage` | `/mortgage` | Public route | Public route | `page_view` | click + route probes | working | Has real `href`. |
| Header | Discover AI Chatbot | `#nav-ai` | `/discover-ai-chatbot` | Public route | Public route | `page_view` | click probe | working | Chatbot route opens AI/WhatsApp help page. |
| Header | Fraud | `#nav-fraud` | `/anti-fraud` | Public safety route | Public safety route | `page_view` | click probe | working | No report modal dependency. |
| Header | List your property for free | `[data-testid="list-property-free-cta"]` | `/list-property` | Public listing route | Public listing route | `list_property_free_cta_clicked` | click probe | working | Replaces old confusing “Advertise Property” header CTA. |
| Homepage | Search | `#hero-search-btn` | Runs search and navigates to category | Public search | Public search | `property_search` | go-live tests | working | Uses existing filters. |
| Homepage | List your property for free | `#hero-list-free-btn` | `/list-property` fallback or listing modal in full shell | Public listing route | Public listing route | `list_property_cta_clicked` | click audit | working | Fallback added if modal stripped. |
| Homepage | View all featured properties | `#home-featured-link` | `/for-sale` | Public route | Public route | `page_view` | click audit | working | Uses `showPage`/route fallback. |
| Homepage | All Agents | `#home-brokers-link` | `/brokers` | Public route | Public route | `page_view` | click audit | working | Existing route. |
| Homepage | Discover AI Chatbot | `#home-assistant-discover-btn` | AI chatbot page | Public route | Public route | `page_view` | click audit | working | Existing route. |
| Homepage | Floating WhatsApp | fixed `wa.me` button | Opens WhatsApp | Opens WhatsApp | Opens WhatsApp | source URL where present | href audit | working | No native-app language. |
| Category | Save Search | no-results copy / dashboard action | Save search where signed in | Sign-in/WhatsApp prompt | Saves to dashboard where API available | `saved_search_created` | go-live tests | partial | Minimal engine exists; full category button expansion remains product work. |
| Category | Create Alert | no-results copy / dashboard action | Alert preference | Sign-in/WhatsApp prompt | Stores alert preference where API available | alert events | go-live tests | partial | External delivery depends on configured providers. |
| Category | Ask MakaUg on WhatsApp | map assist / WhatsApp links | WhatsApp/support request | Opens WhatsApp or lead form | Same | lead/contact event | click audit | working | Map assist forms create requests. |
| Category | Tell MakaUg what you need | map assist forms | POST `/api/contact/looking-for-property` | Form submit | Form submit | CRM/property request | existing API tests | working | Has success/error toast. |
| Category | Search / filters | category filter controls | Filter current grid | Public | Public | `property_search` | go-live tests | working | Debounced typeahead still product follow-up. |
| Category | Listing card click | `.property-card` | Opens detail | Public | Public | `property_open` | existing tests | working | Depends on listing data. |
| Category | WhatsApp listing CTA | share/contact buttons | Opens WhatsApp with listing context | Public | Public | WhatsApp click lead | go-live tests | working | No undefined/null guard covered. |
| Category | Call listing CTA | `tel:` links | Opens dialer | Public | Public | lead where supported | href audit | working | Listing-specific. |
| Category | Save listing | card heart | Auth prompt or save | Auth prompt | Saved listing | save event | go-live tests | working | Fallback prevents stripped modal dead click. |
| Category | Book viewing | detail/viewing buttons | Creates viewing where configured | Contact form/auth | Creates booking/log | viewing lead | go-live tests | partial | Full slot engine remains beyond this emergency patch. |
| Category | Request callback | callback form/buttons | Creates callback | Contact form/auth | Creates callback/log | callback lead | go-live tests | partial | Provider notifications safe-log when missing. |
| List property | Continue / Submit | `#lp-step*`, submit buttons | Step wizard and API submit | Public listing flow | Public listing flow | property submit/email notification | go-live tests | working | Reference generation already tested. |
| List property | Find address or place | `#lp-address-search-btn` | Address lookup/fallback | Public | Public | location event | go-live tests | working | Provider fallback documented. |
| List property | Send/Verify OTP | `#lp-send-otp-btn`, verify buttons | OTP provider or safe dev path | Public | Public | OTP events | go-live tests | working | Provider credentials may be required live. |
| Advertise | Advertise with MakaUg | `/advertise` synthetic CTA | Paid advertising route/signup/contact | Public paid campaign route | Advertiser dashboard/admin by role | advertiser inquiry/click | click probe | working | Kept separate from free property listing. |
| Mortgage | Request mortgage help | `#mortgage-lead-submit` | POST mortgage lead | Submits/logs lead where provider/API exists | Same plus dashboard history where available | `mortgage_lead_submit` | go-live tests/perf probe | working | Calculator redesigned around professional repayment results. |
| Advertise | Start advertising / signup | `/advertiser-signup` | Advertiser signup | Signup route | Dashboard if advertiser | advertiser_signup | click probe route | working | Provider-independent. |
| Advertise | Generate payment link | advertiser dashboard | Payment link or provider-missing state | Requires auth | Advertiser/admin | payment events | go-live tests | partial | Real provider depends on env. |
| Auth | Sign In / Create account | `/login`, `/signup`, role signup routes | Auth drawer or route | Public auth route | Session/dashboard redirect | auth events | go-live tests | working | Fallback added for sanitized public pages. |
| Footer | Property links | `#footer-link-*` | Route navigation | Public routes | Public routes | `page_view` | click probe | working | Rewired from stripped modals to real routes. |
| Footer | Register as Broker | `#footer-link-register-broker` | `/broker-signup` | Signup route | Broker signup/profile | broker lead | click audit | working | Fallback route. |
| Footer | Advertise with Us | `#footer-link-advertise` | `/advertise` | Public route | Role-aware handler | advertising event | click probe | working | Rewired. |
| Footer | Terms/Privacy/Cookie/Help/Safety | legal/support links | Standalone public routes | Public routes | Public routes | `page_view` | click probe | working | Rewired from stripped page modal. |
| Admin | Run probes / docs | `#admin-launch-control` | Shows commands/docs links | Requires admin | Admin only | audit where actions are API-backed | go-live tests | working | Added Launch Control section. |
| Admin | Retry failed notification/email | `/admin/notifications`, `/admin/emails` | Admin retry API | Redirect login | Admin only | audit log | go-live tests | working | Existing retry routes. |
| Admin | Payment/listing approval actions | admin buttons/routes | Admin APIs | Redirect login | Admin only | audit log | go-live tests | working | Existing admin desk. |
