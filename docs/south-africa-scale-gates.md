# seshaikhaya South Africa scale gates

Last updated: 12 August 2026. South Africa only.

## Current release state

- PR #195 guard build `64bd757c529f360764bf78b73a53b3f4af252a94` is deployed to the shared staging service for Dave's POPIA/contact-gating audit.
- Harvesting, public submissions, registry writes, the Gauteng pilot, confidence auto-publication, full-scale rollout, provider access approval and Dave's pilot-pass gate all remain disabled.
- The six approved source-backed listings remain the regression baseline. No pilot or full-sweep inventory has been created.

## Gate 1: confidence publication policy

A South Africa sourced row is eligible for automatic publication only when every check passes:

1. exact canonical city or suburb with confidence 1;
2. positive numeric ZAR price, never POA;
3. strong non-conflicting category and transaction classification;
4. specific non-junk title;
5. exact source verified through an approved API, official oEmbed, verified registry record, or explicit staff verification;
6. database dedupe completed with no exact, stable-platform-ID, content, contact, caption or image match;
7. no data-integrity or explicit risk flags.

Any failure routes the row to King review with machine-readable blockers. Passing rows are measured as `auto_publish_eligible`, but remain in `auto_publish_hold` while `ZA_CONFIDENCE_AUTO_PUBLISH_ENABLED=false`. The wave target is at least 80% eligible and no more than 20% genuinely requiring human review. The target never weakens a check.

## Gate 2: controlled pilot

The executable dry-run contract is:

```bash
COUNTRY_CODE=ZA npm run inventory:pilot-south-africa -- --dry-run
```

Its hard scope is Gauteng, YouTube and X, agent and FSBO tracks, 50 balanced query jobs, at most 10 returned rows per query and an absolute 500-row stop. Network execution remains disabled until Dave passes the PR #195 staging audit and the access gates below are configured.

Dave's real-data acceptance sample remains:

- zero queued rows with null price or null canonical location;
- 100 location decisions with zero wrong province;
- 100 category decisions with no land/sale or rent/sale inversion;
- 100 FSBO/agent decisions;
- cross-platform duplicate collapse;
- at least 80% confidence-policy eligibility.

## Gate 3: POPIA and private sellers

- FSBO phone and email fields are not returned by the public property API and are not rendered as call, WhatsApp or original-poster contact actions.
- “Contact via seshaikhaya” posts an internal enquiry and relays it to the stored seller contact; a failed relay remains in the staff follow-up queue.
- Claim and removal controls remain beside the original-source attribution. A private seller removal request immediately changes the public listing to `hidden`, records the POPIA request and adds an immutable review event. Staff verification cannot silently republish it.
- `/privacy-policy` now identifies the responsible-party/Information-Officer channel, purposes and lawful bases, public-source processing, private contact gating, sharing, safeguards, rights and retention periods. Its secure form posts to `/api/contact/privacy-request`.
- Retention notice: 183 days without sourced-listing revalidation, 365 days for enquiries and 1,095 days for claim/takedown audit records, subject to legal holds or active disputes.

Primary references: [Protection of Personal Information Act 4 of 2013](https://www.gov.za/sites/default/files/gcis_document/201409/3706726-11act4of2013popi.pdf), [Information Regulator POPIA guidance](https://inforegulator.org.za/popia/), and [Information Officer guidance](https://inforegulator.org.za/wp-content/uploads/2020/07/InfoRegSA-GuidanceNote-IO-DIO-20210401.pdf).

## Gate 4: platform access, throttling and cost

No generic search-page scraping, login-wall bypass, rotating identity or rate-limit evasion is allowed.

| Platform | Allowed pilot access | Current state | Conservative ceiling |
|---|---|---|---|
| YouTube | YouTube Data API v3 `search.list` | Automated pilot channel; blocked until its key/access flag is configured | 1 request/1.5 seconds and no more than the active daily quota |
| X | X API v2 recent search | Automated pilot channel; blocked until its bearer token, access flag and wave cost are approved | 1 request/2 seconds, 120/hour, plus a pre-wave dollar ceiling |
| TikTok | Official oEmbed for known exact videos, creator-consented Display API, or approved export | Curated intake only; zero broad-search jobs | Exact URLs only, reviewed in bounded batches |
| Facebook | Manual group participation after Arthur approves the marketing pivot | Marketing only; zero harvest jobs and no Marketplace collection | Human posting only; no scraping or automated collection |

Automated controls stop on 401/403, repeated 429, terms uncertainty, 500 rows or budget breach. Retries use bounded exponential backoff with a 60-second minimum on rate limits and a 15-minute ceiling.

Official TikTok documentation confirms that Display API reads an authorised creator's videos and that oEmbed converts a known exact video URL; neither is a general commercial search endpoint: [Display API](https://developers.tiktok.com/doc/display-api-overview), [oEmbed](https://developers.tiktok.com/doc/embed-videos/), [rate limits](https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit/).

The compliant automated matrix is now 48,365 corpus queries across two channels, or 96,730 YouTube/X job attempts before pagination or retries. Facebook, TikTok and Instagram contribute zero automated search jobs. YouTube currently gives `search.list` a separate default bucket of 100 calls/day, so its 48,365 planned query jobs alone would take about 484 days at one request per job without an approved quota increase: [YouTube search](https://developers.google.com/youtube/v3/docs/search/list), [quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost).

A dedicated Google Cloud project now exists for this client only: `seshaikhaya-za-platform`, project number `956972769780`. YouTube Data API v3 is enabled. The proposed audit request is 500 `search.list` calls/day: 48,365 one-page calls spread over 180 days averages 269/day, and 500/day leaves bounded room for pagination and retry without burst traffic. The 25-call pilot fits the present 100-call default and therefore does not need expanded quota.

The quota-extension form remains intentionally unsubmitted. YouTube requires a compliance audit, factual legal/organisation/contact details, a public privacy policy and terms, and screenshots or a demo of the client. The branch now adds YouTube-specific disclosures, 30-day public-API-data refresh/deletion, a seven-day user deletion path, Google privacy and YouTube terms links, source attribution, and no audiovisual rehosting. Those pages must be deployed and captured, and Arthur must supply the legal name, organisation name, and durable company email before anyone can truthfully attest and submit: [quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits), [YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies).

X is pay-per-use at $0.005 per public Post read. Merely reading 15,000 to 40,000 unique Posts would be about $75 to $200 before other resources, so X cannot enter a full wave under the $13 monthly platform cap without separate approval: [X API pricing](https://docs.x.com/x-api/getting-started/pricing).

The current recorded monthly infrastructure spend is approximately $7.25, leaving $5.75 under Arthur's $13 cap. A balanced 500-row pilot has an upper bound of about 250 X Post reads, or $1.25 at the current configured rate, plus up to 25 YouTube search requests at no incremental API charge. It still refuses execution until the provider consoles confirm access and incremental charges. Auto-recharge must remain off.

The six-month compliant inventory target is therefore a measured 3,000–10,000 YouTube/X candidates plus curated TikTok URLs, not the earlier 15,000–40,000 assumption. Facebook group recruitment and private-seller self-service are separate consented growth channels and do not count as harvesting.

## Wave report contract

Every wave reports:

`platform · track · queries · request_count · discovered · new · parsed_complete_pct · auto_publish_eligible · auto_published · human_review_required · queued · live · rejection reasons · estimated_cost_usd`

Province rollout remains blocked until Dave records the pilot PASS and both `ZA_SCALE_DAVE_PILOT_PASS` and `ZA_PLATFORM_ACCESS_APPROVED` are explicitly enabled. The full scheduler additionally requires `HARVEST_AUTOMATION_ENABLED` and `ZA_SCALE_HARVEST_ENABLED`; all four must be true.
