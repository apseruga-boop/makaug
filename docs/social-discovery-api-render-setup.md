# Social Discovery API and Render Setup

This is the production setup for Makaug found-online property discovery. The job is search-engine style: find public property posts across social platforms, queue or publish only when the evidence gates pass, and keep uncertain records inside King/staff review.

## Current Code Path

- Source registry target: 60,000 social source records across TikTok, YouTube, X, Facebook, Instagram, and local-language hashtag feeds.
- Direct API discovery today: YouTube Data API and X API.
- Exact-link import today: TikTok, YouTube, X, Instagram, and Facebook public post URLs.
- Meta/TikTok broad discovery: credential readiness is tracked, but broad Facebook/Instagram/TikTok discovery stays approval-gated until the approved platform API adapter is enabled.
- Public count: the homepage number changes when a property becomes public/live through the existing public property APIs, not when a raw source or review candidate is only discovered.

## Render Environment Variables

Add these in Render Dashboard -> Makaug web service -> Environment -> Environment Variables, then save and deploy.

```bash
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
```

Use one YouTube key env and one X bearer env. The aliases are accepted so old Render names can keep working.

## Where To Get Credentials

- YouTube: Google Cloud Console -> APIs & Services -> enable YouTube Data API v3 -> Credentials -> API key. Official docs: https://developers.google.com/youtube/v3/getting-started
- X/Twitter: X Developer Portal -> project/app -> Keys and tokens -> Bearer Token. Official docs: https://docs.x.com/fundamentals/authentication/oauth-2-0/bearer-tokens
- Facebook/Meta: Meta for Developers -> app -> Graph API permissions/tokens. For Makaug, use approved Page access first, then import exact public post URLs into King review. Official docs: https://developers.facebook.com/docs/graph-api/overview/
- Instagram: Meta for Developers -> Instagram Graph API -> connect an Instagram Business/Creator account to a Facebook Page -> app review for required permissions -> use the Instagram Business Account ID. Official docs: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/
- TikTok: TikTok for Developers -> create app -> request the product/API access that fits the use case. Broad public discovery is approval-gated, so production keeps exact TikTok video URL import plus oEmbed until approved API access is available. Official docs: https://developers.tiktok.com/

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

Use bounded batches so Render does not timeout or rate-limit the API providers. The high-frequency job should keep to known YouTube channel uploads first; this keeps Makaug fresh without burning the daily YouTube Search quota on every tick.

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

- Every 10-15 minutes: `inventory:continuous-monitor` with `--youtube-job-mode=channel_uploads`. This follows known source channels, advances offsets through `audit_logs`, dedupes exact URLs, and pushes high-confidence rows through the existing auto-live/review gates.
- Every 2-4 hours: `inventory:sweep-social-platforms` with `--youtube-job-mode=all` and a small `--max-sources` batch for broader hashtag/search discovery.
- Once daily: `inventory:daily-source-sweep -- --confirm` to refresh the 60,000 source registry and King review queue baseline.

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
