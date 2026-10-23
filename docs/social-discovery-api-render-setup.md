# Social Discovery API and Render Setup

This is the production setup for Makaug found-online property discovery. The job is search-engine style: find public property posts across social platforms, queue or publish only when the evidence gates pass, and keep uncertain records inside King/staff review.

## Current Code Path

- Source registry target: 60,000 social source records across TikTok, YouTube, X, Facebook, Instagram, and local-language hashtag feeds.
- Direct API discovery today: YouTube Data API and X API.
- Exact-link import today: TikTok, YouTube, X, Instagram, and Facebook public post URLs.
- TikTok public sweep: off unless `TIKTOK_SOURCE_SWEEP_ENABLED=true`. It uses unauthenticated TikTok pages plus the public oEmbed endpoint only. It does not use the Research API, a login, or a paid API.
- Meta broad discovery stays approval-gated. Facebook and Instagram still produce manual capture tasks.
- Public count: the homepage number changes when a property becomes public/live through the existing public property APIs, not when a raw source or review candidate is only discovered.

## Render Environment Variables

Add these in Render Dashboard -> Makaug web service -> Environment -> Environment Variables, then save and deploy.

```bash
HARVEST_AUTOMATION_ENABLED=false
HARVEST_PUBLIC_SUBMISSIONS_ENABLED=false

YOUTUBE_API_KEY=
GOOGLE_YOUTUBE_API_KEY=
GOOGLE_API_KEY=

X_BEARER_TOKEN=
TWITTER_BEARER_TOKEN=
X_API_BEARER_TOKEN=

META_GRAPH_ACCESS_TOKEN=
FACEBOOK_GRAPH_ACCESS_TOKEN=
FACEBOOK_PAGE_ACCESS_TOKEN=
FACEBOOK_PAGE_IDS=
FACEBOOK_PAGE_ID=
INSTAGRAM_GRAPH_ACCESS_TOKEN=
INSTAGRAM_BUSINESS_ACCOUNT_IDS=
INSTAGRAM_BUSINESS_ACCOUNT_ID=

TIKTOK_ACCESS_TOKEN=
TIKTOK_RESEARCH_API_ACCESS_TOKEN=
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=

TIKTOK_SOURCE_SWEEP_ENABLED=false
```

`TIKTOK_SOURCE_SWEEP_ENABLED` defaults off. Set it to `true` only on the daily source-monitor cron when Arthur wants the public TikTok sweep to queue posts. Leave the Research API token unset for that sweep; the public sweep does not read it.

Use one YouTube key env and one X bearer env. The aliases are accepted so old Render names can keep working.

Keep both rollout flags `false` for the initial production deploy. Dave's authenticated King/staff creator rotation, TikTok Discover helper, exact-link preview, and review-queue import remain available while these flags are off. `HARVEST_AUTOMATION_ENABLED` gates confirmed provider-driven jobs, TikTok agent writes, and YouTube WebSub. `HARVEST_PUBLIC_SUBMISSIONS_ENABLED` separately gates anonymous public link submissions.

## Where To Get Credentials

- YouTube: Google Cloud Console -> APIs & Services -> enable YouTube Data API v3 -> Credentials -> API key. Official docs: https://developers.google.com/youtube/v3/getting-started
- X/Twitter: X Developer Portal -> project/app -> Keys and tokens -> Bearer Token. Official docs: https://docs.x.com/fundamentals/authentication/oauth-2-0/bearer-tokens
- Facebook/Meta: Meta for Developers -> app -> Graph API permissions/tokens. For Makaug, use approved Page access first, then import exact public post URLs into King review. Official docs: https://developers.facebook.com/docs/graph-api/overview/
- Instagram: Meta for Developers -> Instagram Graph API -> connect an Instagram Business/Creator account to a Facebook Page -> app review for required permissions -> use the Instagram Business Account ID. Official docs: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/
- TikTok: the daily sweep does not need a TikTok app. It reads public `https://www.tiktok.com/` pages and `https://www.tiktok.com/oembed` with no login and no Research API token. Official oEmbed docs: https://developers.tiktok.com/doc/embed-videos

## First Run

Dry-run the 60,000 source registry:

```bash
npm run inventory:seed-source-registry -- --dry-run
```

Seed it after checking the summary:

```bash
npm run inventory:seed-source-registry -- --confirm
```

Run quota-safe API sweeps:

```bash
npm run inventory:sweep-social-platforms -- --platform=youtube --dry-run --published-after=2026-01-01T00:00:00.000Z --source-offset=0 --max-sources=50 --max-results=25
npm run inventory:sweep-social-platforms -- --platform=x --dry-run --x-search-mode=recent --lookback-days=7 --max-sources=25 --max-results=25
npm run inventory:sweep-social-platforms -- --platform=students --dry-run --max-sources=60
```

Switch `--dry-run` to `--confirm` only after the reports show usable exact posts and the credentials are configured.

## Render Cron Jobs

Approved schedule (Arthur, 23 Oct 2026): one daily cron, not a 10-minute loop. The blueprint service is `makaug-daily-source-monitor` in `render.yaml`. Creating it is a manual Render step after review. This repo change does not create the service.

The cron runs the existing source monitor. That command always writes a broken/stale source report to logs, `audit_logs` (`listing_source_health_report`), the in-app notification log, and the staff source monitor card. It does not send WhatsApp. YouTube and X sweeps still run only when `HARVEST_AUTOMATION_ENABLED=true`. The TikTok public sweep runs only when `TIKTOK_SOURCE_SWEEP_ENABLED=true`.

Schedule: `30 4 * * *` UTC. That is 05:30 in London during British Summer Time and 04:30 in London during winter, both before 06:00 London.

Create the cron in the Render Dashboard after this pull request is reviewed. Do not apply it from this change alone.

1. Render Dashboard -> New -> Cron Job. Connect the makaug repo and the production branch.
2. Name: `makaug-daily-source-monitor`.
3. Runtime: Node. Plan: Starter. Region: the same region as the live makaug web service (`oregon` in `render.yaml` only if the web service is there).
4. Schedule: `30 4 * * *`.
5. Build command: `npm ci --omit=dev`.
6. Start command: `npm run inventory:continuous-monitor -- --confirm --platforms=youtube,x --youtube-job-mode=channel_uploads --max-sources=8 --max-results=10 --max-pages=1`.
7. Copy these environment variable names from the web service, with no new secret values in git: `DATABASE_URL`, `HARVEST_AUTOMATION_ENABLED`, `YOUTUBE_API_KEY`, `X_BEARER_TOKEN`. Set `NODE_ENV` to `production` and `TIKTOK_SOURCE_SWEEP_ENABLED` to `false` until Arthur turns the TikTok sweep on.
8. Estimated cost: about $1/month. Render bills cron runtime by the second and applies a $1 monthly minimum. This job is one short run per day.

The same service is declared in `render.yaml` for review. Syncing that blueprint also touches the WhatsApp services in the file, so prefer the Dashboard steps above unless the CTO intends to sync the whole blueprint.

TikTok capture limits, when the flag is on: at most 8 public pages, 4 video URLs per page, 16 oEmbed calls, and 1.2 seconds between requests. Pages that return a login wall, captcha, or no video URLs are reported and not turned into listings. The sweep cannot see private posts, comments, or captions beyond the oEmbed title.

Use bounded batches so Render does not timeout or rate-limit the API providers. YouTube stays on known-channel uploads so the daily run does not burn Search quota.

One-off trigger from Render:

1. Open Render Dashboard -> Makaug project -> makaug web service.
2. Open Shell.
3. Run the dry proof first:

```bash
npm run inventory:continuous-monitor -- --dry-run
```

4. If the report looks correct, run the confirmed trigger:

```bash
npm run inventory:continuous-monitor -- --confirm --platforms=youtube,x --youtube-job-mode=channel_uploads --max-sources=15 --max-results=25 --max-pages=1
```

Cron commands:

```bash
npm run inventory:sweep-social-platforms -- --platform=youtube --confirm --published-after=2026-01-01T00:00:00.000Z --source-offset=0 --max-sources=50 --max-results=25
npm run inventory:sweep-social-platforms -- --platform=x --confirm --x-search-mode=recent --lookback-days=7 --max-sources=25 --max-results=25
npm run inventory:daily-source-sweep -- --confirm
```

Advance `--source-offset` for YouTube batches to walk the 60,000-record registry instead of repeating the first sources.

Recommended production cadence:

- Once daily at 04:30 UTC: `inventory:continuous-monitor` with `--youtube-job-mode=channel_uploads`, `--max-sources=8`, and `--max-results=10`. This is the Render cron above. It writes the broken/stale report, advances the YouTube/X cursor only when harvest automation is on, and queues TikTok posts only when the TikTok flag is on.
- Broader YouTube hashtag search stays a manual staff run with a small `--max-sources` batch.
- `inventory:daily-source-sweep -- --confirm` still refreshes the source registry and is separate from this health cron.

## Staff Dashboard Communication

The same process is shown inside `/staff-dashboard` under Source intake & social scraping:

- source registry size and active batch;
- high-frequency, broad-search, and daily-refresh cadence;
- dry-run and confirmed trigger commands;
- auto-live rule and review rule;
- the `continuous_social_monitor_run` audit action used to prove confirmed runs and advance the source cursor.

Staff should use the dashboard wording as the board-level operating process. If the cron cadence changes in Render, update `STAFF_SOURCE_MONITOR_GUIDE` in `routes/staff.js` and this document in the same pull.

Useful Render env controls for the continuous monitor:

```bash
CONTINUOUS_SOCIAL_MONITOR_PLATFORMS=youtube,x
CONTINUOUS_SOCIAL_MONITOR_YOUTUBE_JOB_MODE=channel_uploads
CONTINUOUS_SOCIAL_MONITOR_MAX_SOURCES=15
CONTINUOUS_SOCIAL_MONITOR_MAX_RESULTS=25
CONTINUOUS_SOCIAL_MONITOR_MAX_PAGES=1
CONTINUOUS_SOCIAL_MONITOR_CADENCE_MINUTES=10
CONTINUOUS_SOCIAL_MONITOR_PUBLISHED_AFTER=2026-01-01T00:00:00.000Z
CONTINUOUS_SOCIAL_MONITOR_LOOKBACK_DAYS=7
```

For a dry proof before enabling the write cadence:

```bash
npm run inventory:continuous-monitor -- --dry-run
```

## Approval Rules

- Location is non-negotiable before public approval.
- Exact source URL, source contact path, and source evidence must exist.
- Missing price can be stored as Price upon application.
- Clear, confident records can be approved through the existing found-online path.
- Any second-guessed or incomplete record remains in King/staff review.
- Do not create public broker profiles from discovered sources unless the source owner registers or claims the Makaug broker profile.
- Do not rehost third-party social photos/videos unless rights are confirmed; use source links, embeds, or authorised media.

## Dashboard Expectations

- King dashboard source registry stays paginated and sampled so 60,000 sources do not render in one response.
- King/staff review receives properties, not raw source feeds.
- The homepage public number updates after approved/live properties are served by the public inventory API.
