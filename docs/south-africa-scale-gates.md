# seshaikhaya South Africa scale gates

Last updated: 12 August 2026. South Africa only.

## Current release state

- PR #195 base build `b6ebaec36ef59fb7bb5dce3af953dd36b92ff7aa` is deployed to the shared staging service for Dave's first audit.
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

Its hard scope is Gauteng, Facebook and TikTok, agent and FSBO tracks, 50 balanced query jobs, at most 10 returned rows per query and an absolute 500-row stop. Network execution remains disabled until Dave passes the PR #195 staging audit and the access gates below are configured.

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
| Facebook | Official Graph API approved for the exact resource, or operator-supplied exact public post URLs | Blocked until the access method and credentials are documented | 1 request/3 seconds, 120/hour |
| TikTok | Creator-consented Display API, official oEmbed for known exact videos, or an approved platform export | Broad search blocked: Display API is creator-scoped and oEmbed requires a known video URL | 1 request/2 seconds, 120/hour |

Both controls stop on 401/403, repeated 429, terms uncertainty, 500 rows or budget breach. Retries use bounded exponential backoff with a 60-second minimum on rate limits and a 15-minute ceiling.

Official TikTok documentation confirms that Display API reads an authorised creator's videos and that oEmbed converts a known exact video URL; neither is a general commercial search endpoint: [Display API](https://developers.tiktok.com/doc/display-api-overview), [oEmbed](https://developers.tiktok.com/doc/embed-videos/), [rate limits](https://developers.tiktok.com/doc/tiktok-api-v2-rate-limit/).

The full matrix is at least 241,825 job attempts before pagination or retries. YouTube currently gives `search.list` a separate default bucket of 100 calls/day, so its 48,365 planned query jobs alone would take about 484 days at one request per job without an approved quota increase: [YouTube search](https://developers.google.com/youtube/v3/docs/search/list), [quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost).

X is pay-per-use at $0.005 per public Post read. Merely reading 15,000 to 40,000 unique Posts would be about $75 to $200 before other resources, so X cannot enter a full wave under the $13 monthly platform cap without separate approval: [X API pricing](https://docs.x.com/x-api/getting-started/pricing).

The current recorded monthly infrastructure spend is approximately $7.25, leaving $5.75 under Arthur's $13 cap. The pilot estimates no new infrastructure service, but still refuses execution until the provider consoles confirm access and incremental charges. Auto-recharge must remain off.

## Wave report contract

Every wave reports:

`platform · track · queries · request_count · discovered · new · parsed_complete_pct · auto_publish_eligible · auto_published · human_review_required · queued · live · rejection reasons · estimated_cost_usd`

Province rollout remains blocked until Dave records the pilot PASS and both `ZA_SCALE_DAVE_PILOT_PASS` and `ZA_PLATFORM_ACCESS_APPROVED` are explicitly enabled. The full scheduler additionally requires `HARVEST_AUTOMATION_ENABLED` and `ZA_SCALE_HARVEST_ENABLED`; all four must be true.
