# Short Term stays — build report

Branch `feat/short-term`, commits `1f36a58` + `c293eb0`, cut from `origin/main`
(`9c37038`). **Pushed to GitHub. Not merged, not deployed.** Waiting on your
go-ahead to merge.

This follows the 15-point Final Report Rule in your `AGENTS.md`.

---

## 1. What was requested

A Short Term section for makaug — nightly stays across Uganda, prominently in
the nav, with an Airbnb-style price map, a listing route for hosts with dates,
terms and amenities, comments and scores under privately listed places, a
countdown banner, guest-facing holiday information, a pointer to UTB, short
stays counted in the site-wide property total, and a flat UGX 50,000 / 3 month
fee. Built as a **discovery platform** — makaug publishes the place and the
host's number and stays out of the transaction.

## 2. What was missing

Everything. There was no short-term concept anywhere in the repo. `properties`
carries a `CHECK` constraint on `listing_type` limited to
`sale, rent, land, commercial, student, students` — so short stays could not
have been slotted into the existing table without altering a live constraint on
your main table. They got their own namespace instead.

## 3. What was actually built

**Data** — `db/migrations/132_short_term_foundation.sql`, additive only:
`st_listing`, `st_listing_media`, `st_listing_amenity`, `st_availability`,
`st_rate_override`, `st_lead`, `st_review`, `st_listing_payment`, `st_report`,
plus indexes, `updated_at` triggers reusing `set_updated_at()` from `001_init`,
and a reference sequence (`ST-000001`).

**The discovery position, encoded in the schema.** `st_lead` has deliberately
no `status`, no `replied_at`, no `expires_at`. The moment the platform tracks
whether a host answered, it has taken on a duty to chase and it stops being a
discovery platform. There is a comment in the migration saying so, and a test
that fails if anyone adds those columns.

**Money.** One flat fee: UGX 50,000 for 3 months, raised as an unpaid
`st_listing_payment` row the moment a listing is submitted. There is no
commission field anywhere in the codebase and a test that fails if one appears.
makaug never receives or holds guest money — the host's preferred payment
method is captured so guests pay *them* directly.

**Front end** — `assets/short-term.js` + `assets/short-term.css`:
search with dates and guests, results grid, Leaflet map where **the pin is the
nightly price**, listing page with gallery / facts / amenities / house rules /
the host's own terms, live price working from the host's rates including
per-date overrides, availability check, WhatsApp and call buttons, an enquiry
form that hands back the host's number, reviews and 1–5 scores under privately
listed places, a report form, and a 4-step listing wizard.

**Nav.** "Short Term" sits directly after "To Rent", in green so it stands out,
desktop and mobile. **Nothing was removed** — a test asserts all twelve original
nav entries are still there.

## 4. Routes created / changed

Public pages (server-rendered, in `server.js`):

| Route | What it does |
|---|---|
| `GET /short-term` | Search page, SSR cards, `ItemList` JSON-LD |
| `GET /short-term/list-your-place` | Host page |
| `GET /short-term/:slug` | Listing page, `VacationRental` JSON-LD |

API (`routes/short-term.js`, mounted at `/api/short-term`):

`GET /meta` · `GET /search` · `GET /map` · `GET /summary` ·
`GET /listings/:slug` · `POST /listings` · `POST /listings/:id/enquiries` ·
`GET|POST /listings/:id/reviews` · `POST /listings/:id/reports` ·
`GET|POST /listings/:id/photos`

Staff, all behind `requireStaffAccess`: `GET /staff/queue` ·
`POST /staff/listings/:id/decision` · `POST /staff/listings/:id/payment` ·
`GET /staff/listings/:id/leads` · `GET /staff/reviews` ·
`POST /staff/reviews/:id/decision`

## 5. Components changed

`index.html` — two nav anchors, one `#page-short-term` container with the
`#short-term-ssr` render target, a stylesheet link and a conditional script
load. 16 lines. `assets/makaug-app.js` — 3 lines added to the two route maps.

## 6. Models / services changed

New: `services/shortTermService.js`, `services/shortTermSeoRenderService.js`,
`services/shortTermMediaService.js`, `utils/shortTermFeatureFlags.js`.

Changed: `services/publicInventoryMetricsService.js` — short stays fold into the
site-wide property total. **Only the unfiltered site-wide call is adjusted**; a
caller counting, say, rentals in Kampala passes its own `WHERE` and its number
is untouched. Guarded three ways: the feature flag, a `to_regclass` check so a
database without migration 132 returns 0, and a try/catch that falls back to 0.
The existing count cannot break because of short term.

`services/publicHtmlSanitizer.js` — registered `page-short-term` (4 lines). See
item 10; this one was found by your own tests, not by me.

## 7. APIs changed

None. Only added. Every existing endpoint is byte-identical.

## 8. Dashboards changed

None — and this is a real gap, see Known limitations. The staff API exists and
is authenticated, but there is no screen for it in the admin dashboard yet.

## 9. Tests added

`tests/short-term-route-contract.test.js`, 58 tests, wired up as
`npm run test:short-term`. They cover: the flag really being a kill switch; the
migration being additive and never naming an existing table; `st_lead` having no
reply-tracking columns; no commission field existing; check-out being exclusive
(9th→12th is three nights, not four); rate overrides applying per night; the
weekly/monthly discount thresholds; bad dates producing no quote rather than a
wrong one; blocked nights; phone normalisation across five input formats; the
right-to-let and terms declarations being mandatory; host input being escaped;
your public-HTML forbidden-string list; staff routes being protected; and the
nav keeping every entry it already had; upload tokens rejecting a wrong
listing, a forged signature, an expired stamp and a different signing key; and
EXIF being stripped from a GPS-tagged image.

## 10. Tests run and result

| Suite | Result |
|---|---|
| `npm run check` | pass |
| `npm run test:short-term` | **58 / 58** |
| `npm run test:seo-ssr` | pass |
| `npm run test:go-live-p0` | pass |
| `npm run test:shared-core-phase1` | pass |
| `npm run test:king-harvester-p0` | pass |
| `npm run test:off-plan` | **55 / 55** |
| `npm run test:south-africa` | pass (6 suites) |
| `npm run probe:public-routes` | **22 / 22** against a live boot |

**Two of your suites caught me, and they were right to.**

`go-live-p0` and `shared-core-phase1` failed with *"homepage component drift
detected in topbar-nav"*. Adding a nav entry put `index.html` out of sync with
the canonical components in `packages/shared-country-core`. Fixed by running
`npm run build:shared-homepage`.

That rebuild then exposed a worse problem: my `#page-short-term` container got
swept into `components/map.html` — meaning the short-term container would have
been injected into **every country homepage**. The cause was that
`publicHtmlSanitizer` did not know the page existed, so it never stripped it
from other routes. Registering `page-short-term` in `PUBLIC_PAGE_IDS` and the
two route maps fixed it properly, and there are now two tests that fail if it
ever regresses.

I also verified against a clean `origin/main` worktree that both suites pass
there, so the drift was definitely mine and not pre-existing.

## 11. Build result

`node --check` passes on `server.js` and on every new file. The server boots
clean with the flag off and with the flag on.

## 12. Proof

Live boot, **flag off** (port 8931):

```
GET /api/short-term/meta      404   X-makaug-Short-Term: disabled
GET /api/short-term/search    404
GET /short-term               200   (falls through to the ordinary app)
GET /                         200
homepage nav entry → hidden aria-hidden="true" style="display:none!important"
runtime config injected → 0 occurrences (client script never boots)
```

Live boot, **flag on** (port 8932):

```
GET /api/short-term/meta          200  full amenity catalogue
GET /short-term                   200  X-makaug-Short-Term-SSR: 0
GET /short-term/list-your-place   200
<title>Short Term Stays in Uganda | Nightly Rentals | makaug.com</title>
window.__makaugShortTerm={"enabled":true,"countdown":"2027-01-15T00:00:00.000Z",...}
#page-short-term on /short-term → 1 occurrence
#page-short-term on /           → 0 occurrences  (sanitizer working)
"@type":"ItemList" JSON-LD present
```

With no database attached, the page logged a warning and still returned 200
with an honest empty state — *"No short stays are published yet"* — rather than
a 500 or an invented listing.

## 13. Known limitations

**Photo upload is built** (commit `c293eb0`). Hosts submit the listing, then
add photos on the next screen. Objects go to a new `short-term/<listing id>/`
prefix in your existing R2 bucket. Two things worth knowing about it:

- *EXIF is stripped.* A phone photo of your own front door carries GPS
  coordinates. Publishing it untouched publishes the host's address. Every
  image is re-encoded through `sharp`, which drops all metadata — and if
  `sharp` is unavailable the upload is **refused** rather than stored raw.
  There is a test that builds a GPS-tagged image and asserts the EXIF is gone.
- *No account needed.* Hosts list without signing up, deliberately — an
  account requirement is what stops most Ugandan landlords listing at all. The
  submission hands back a signed six-hour token, and that is what authorises
  attaching photos. A leaked listing id on its own buys nothing.

Photos upload one at a time with per-photo progress, so a host on Kampala
mobile data watches them land and a dropped connection keeps whatever already
uploaded. The browser downscales to 1600px before sending; the server does it
again on arrival.

**No admin screen for the staff queue.** The endpoints are there and
authenticated; the dashboard UI is not. Until it exists, approving a listing
means an authenticated `POST` rather than a click. Your `AGENTS.md` traceability
chain asks for a dashboard and I have not delivered that part.

**There are zero listings.** The section is real and it works, but the shelves
are empty until hosts are on it. It will honestly say so rather than pretend
otherwise.

**No calendar sync.** `st_availability` has a `source` column that accepts
`ical`, but nothing imports one. Hosts set dates by hand.

**The countdown has no date.** I have not set one. AFCON 2027's confirmed start
date is not something I am willing to guess at and bake into your live site —
the banner simply does not render until you put a real date in
`SHORT_TERM_COUNTDOWN_TARGET`.

**UTB.** As you said — we point at `utb.go.ug` and nothing more.

**Node version.** Your Mac runs Node 25; Render pins 20.x per `package.json`.
Tests pass locally on 25, and nothing here uses a post-20 API, but the
production run is on 20.

## 14. Environment variables needed

All documented in `.env.example`:

```
SHORT_TERM_ENABLED=false          # the master switch — this is the rollback
SHORT_TERM_INTAKE_ENABLED=true    # host submissions; defaults on
SHORT_TERM_REVIEWS_ENABLED=true   # reviews and scores; defaults on
SHORT_TERM_COUNTDOWN_ENABLED=true
SHORT_TERM_COUNTDOWN_TARGET=      # empty = no banner. Set a real date.
SHORT_TERM_COUNTDOWN_LABEL=AFCON 2027
```

Nothing new is needed for Cloudflare. Photos, when that step is built, go to a
**new `short-term/` prefix** in the existing R2 bucket through the existing
`cloudMediaStorageService`. No existing object is read, moved or rewritten, and
no storage config changes.

## 15. Rollback notes

**Set `SHORT_TERM_ENABLED=false` and restart.** That is the whole procedure.

No migration is reversed, no data is deleted, no other code path changes. With
the flag off the nav entries render hidden, `/api/short-term/*` answers 404,
the public pages fall through to the ordinary app, and the site-wide property
total returns its existing number. Proven above on a live boot.

Migration 132 is additive and idempotent, so it is safe to run while the
section is still dark — which is the recommended order: migrate first, confirm
the site is untouched, then flip the flag.

To back the whole thing out of git: `git checkout main`. The branch is
independent and `main` has not been touched.

---

## What I need from you

1. **Go-ahead to merge to main.** That deploys, with the flag off, so the site
   should look identical. Migration 132 runs itself on boot.
2. **Check the site over** once it deploys — homepage, property counts, the
   WhatsApp bot, off-plan. Then tell me it's clean.
3. **Set `SHORT_TERM_ENABLED=true`** in the Render dashboard. That is the
   moment it goes live. Either you do it, or give me access and I will.
4. **Confirm R2 is set on the live service** — photo upload needs
   `MEDIA_STORAGE_PROVIDER=s3` and the `S3_*` variables. `/api/short-term/meta`
   reports `photos.ready`, so we can check that in one request after the
   deploy rather than guessing.
5. **The AFCON 2027 date**, if you want the countdown live.

Note: your checkout is on `feat/short-term`. Your `waha-bridge` branch is
pushed and untouched, and your stash is intact — `git checkout waha-bridge`
puts you straight back.
