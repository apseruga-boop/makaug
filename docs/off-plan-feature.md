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

## Configuration

The feature uses the existing database, authentication, email-provider and cloud-media configuration. `OFF_PLAN_NOTIFICATION_EMAILS` optionally overrides the default operations recipients. `PUBLIC_BASE_URL` controls brochure and AI links, while `SUPPORT_PHONE` controls the WhatsApp handoff.

## Rollback

Revert the Off Plan application commit to remove routes and UI. Migration 118 is additive; leave its tables in place during an application rollback so enquiries and audit history are preserved. If data removal is ever required, export the four Off Plan tables first and perform that destructive database operation as a separately approved change.
