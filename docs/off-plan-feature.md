# makaug Off Plan

## Release boundary

Off Plan is a Uganda-only project catalogue. A development is public only when both `status = published` and `verification_status = verified`, and the service-level publication checklist has no blockers. The supplied Entebbe Victoria Palms material is seeded as `pending_review` with its source prices preserved in USD; it deliberately has no public UGX pricing, developer claim, map pin, completion date, progress, or availability until staff verify those facts.

## Traceability

| Feature | Public route/component | Model/service | API | Staff/King control | Notification/logging | Analytics/tests |
| --- | --- | --- | --- | --- | --- | --- |
| Search verified projects | `/off-plan`, `assets/off-plan.js` | `off_plan_developments`, `offPlanService` | `GET /api/off-plan`, `GET /api/off-plan/locations` | Project queue | Development event log | `off_plan_page_view`, `off_plan_search`; off-plan and go-live tests |
| Project story, gallery, map, video | `/off-plan/:slug` | `offPlanService` | `GET /api/off-plan/:slug` | Project facts, media and video URL editors | Verification and status events | `off_plan_project_view`; browser QA |
| Payment schedule | Project detail | `buildOffPlanPaymentSchedule` | `POST /api/off-plan/calculate` | Unit types/payment JSON editors | Calculator request only; no payment action | `off_plan_payment_calculated`; exact-total tests |
| Branded brochure | Project detail download | `offPlanBrochureService` | `GET /api/off-plan/:slug/brochure.pdf` | Private brochure preview | No external delivery | Five-page PDF regression and rendered-page QA |
| List/enquire contact | Contact dialog | `off_plan_enquiries`, `offPlanNotificationService` | `POST /api/off-plan/enquiries` | Enquiry queue | Email attempt to admin, Arthur and Ronald plus event log | `off_plan_contact_opened`, `off_plan_enquiry_submitted`; mock-delivery QA |
| WhatsApp AI | WhatsApp conversation | `aiService`, `whatsappConversationService` | Existing WhatsApp webhook/test path | Enquiry appears in both queues | Deduplicated enquiry plus three email attempts | Off-plan intent and full reply regression tests |
| Project management | Protected dashboards | `offPlanService` | `/api/staff/off-plan/*`, `/api/admin/off-plan/*` | Staff Operations and King dashboard panels | Actor-aware change events | Auth, leakage and publication-gate tests |
| Walkthrough preparation | Dashboard action | `off_plan_walkthrough_jobs` | Create/update walkthrough endpoints | Floor-plan upload and approval-gated brief | Walkthrough state events | Contract tests |

## Walkthrough boundary

The first release prepares a render brief from an authorised floor plan and records the external render/approval lifecycle. It does not claim to turn a floor plan into a finished 3D video inside makaug. A hosted draft URL is required before `draft_ready`, and staff approval is required before `approved`.

The implementation review identified `FloorplanToBlender3d` as a possible image-to-Blender prototype and Blender's supported headless animation renderer as a possible worker foundation. Neither is bundled into the website: the former is GPL-licensed and version-sensitive, while both still require a separately operated render worker and human visual review. This keeps the website fast and avoids presenting an experimental render as a faithful representation of the completed property.

## 3D tour (Vanta House, 20 November 2026)

A project can have a 3D tour: one HTML page kept beside its other assets at `assets/off-plan/<slug>/tour.html` and served at `/off-plan/<slug>/tour` (a project without that file has no such page). Vanta House is the first. The page draws the home with three.js (makaug's own copy, `assets/vendor/three.min.js`) and loads nothing from any other site.

What the page does: a welcome screen with the project name, address and price; a guided tour that walks from the front door through every room, pausing with the room's name, its size in square feet and square metres, and one fact about it; walking around freely (keys and mouse, or touch with a walking pad); a dollhouse view with the roof off; three interior styles; a time-of-day slider that moves the sun and turns the lamps on; music made in the page with a mute button; a home switch (1, 2 and 3 bedroom); and a contact sheet that sends an ordinary off-plan enquiry (`metadata.from = "3d_tour"`).

The homes are data at the top of the page: every room, door and window is a position on the developer's typical floor plan (24 drawing pixels to the metre). Walls are whatever lies between rooms. To change a room, a door or a piece of furniture, edit that data; `tests/off-plan-vanta-tour.test.js` then checks that the plan still closes, that each home is within 3% of the developer's stated size, that furniture stands inside rooms, and that the guided tour still reaches every room without touching a wall.

Read from the drawing, not stated on it: the ceiling height (2.85 m assumed), window widths and sill heights, and which way the plan faces (its top is taken as north). The page says on its welcome screen that it is a concept model and that finishes, furniture and exact dimensions follow the signed agreement.

The project page links to the tour when a walkthrough entry in `extra_fields.walkthroughs` carries `tour_url` (only an address of the form `/off-plan/<slug>/tour` is accepted). The link passes the chosen home and the site language, and the tour's close button returns to the listing. Useful addresses: `?home=2bhk`, `?style=scandi`, `?time=0.8` (0 is early morning, 1 is night), `?mode=walk` or `?mode=doll` to skip the welcome screen, `?lang=sw`. English is complete; Swahili covers the buttons and hints; room names and tour sentences are English only.

The walkthrough films on the project page are the same guided tour, filmed from the page: `node scripts/off-plan-tour-film.js vanta-house 2bhk scandi 8.6` writes `tour-2bhk.mp4` and its poster beside the page. It needs Google Chrome and a real graphics card. Film again whenever the plan data, furniture or tour route changes, so the films and the page stay the same home.

## Configuration

The feature uses the existing database, authentication, email-provider and cloud-media configuration. `OFF_PLAN_NOTIFICATION_EMAILS` optionally overrides the default operations recipients. `PUBLIC_BASE_URL` controls brochure and AI links, while `SUPPORT_PHONE` controls the WhatsApp handoff.

## Rollback

Revert the Off Plan application commit to remove routes and UI. Migration 118 is additive; leave its tables in place during an application rollback so enquiries and audit history are preserved. If data removal is ever required, export the four Off Plan tables first and perform that destructive database operation as a separately approved change.
