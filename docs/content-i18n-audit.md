# MakaUg Content and i18n Audit

Status: partial. Public routes are English-safe, About has launch-level Luganda/Kiswahili body coverage, and unsupported or unreviewed strings fall back to English instead of a wrong nearby language.

## Routes Checked

| Route | English | Luganda | Kiswahili | Acholi | Runyankole | Rukiga | Lusoga | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/about` | complete | partial body coverage | partial body coverage | English fallback | English fallback | English fallback | English fallback | Body uses `data-content-i18n`; no Kinyarwanda fallback. |
| `/how-it-works` | complete enough | partial | partial | fallback | fallback | fallback | fallback | Needs reviewed step translations. |
| `/help` | complete enough | partial | partial | fallback | fallback | fallback | fallback | Categories/form still need reviewed translation. |
| `/safety` | complete enough | partial | partial | fallback | fallback | fallback | fallback | Safety/legal wording needs review. |
| `/anti-fraud` | complete enough | partial | partial | fallback | fallback | fallback | fallback | Fraud/legal wording needs review. |
| `/terms` | English legal-review draft | fallback | fallback | fallback | fallback | fallback | fallback | Do not machine-mark complete without legal review. |
| `/privacy-policy` | English legal-review draft | fallback | fallback | fallback | fallback | fallback | fallback | Do not machine-mark complete without legal review. |
| `/cookie-policy` | English legal-review draft | fallback | fallback | fallback | fallback | fallback | fallback | Do not machine-mark complete without legal review. |
| `/careers` | complete enough | partial | partial | fallback | fallback | fallback | fallback | Form submits to backend; copy still needs review. |
| `/advertise` | complete enough | partial | partial | fallback | fallback | fallback | fallback | Paid advertising copy needs review. |
| `/brokers` | complete enough | partial | partial | fallback | fallback | fallback | fallback | Broker spotlight copy needs review. |
| `/discover-ai-chatbot` | complete enough | partial | partial | fallback | fallback | fallback | fallback | AI prompt language guardrails are wired. |
| `/list-property` | complete enough | partial | partial | fallback | fallback | fallback | fallback | Current-location and Google Places copy added; translations partial. |
| `/mortgage` | complete enough | partial | partial | fallback | fallback | fallback | fallback | Calculator labels need reviewed translations. |

## Shared Content Areas

- Sponsored placement copy: partial, English fallback.
- Broker spotlight copy: partial, English fallback.
- Sponsored map marker copy: partial, English fallback.
- How-to video cards: slots exist, titles/descriptions need reviewed translations and YouTube IDs.
- Auth drawer: English complete enough; Luganda/Kiswahili partial; other languages fallback.
- OTP copy: channel-specific wording exists for email, SMS/text, and WhatsApp; translations are partial.
- Email templates: English branded templates exist; local-language templates need review.
- WhatsApp templates: registry guarded; Rukiga/Runyankole never map to Kinyarwanda.
- Listing description preview: source/fallback preview exists; do not overwrite original text.

## Location and Search Language Copy

Task 18 added/verified these visible flows:

- `/list-property` has `Use my current location`.
- Location permission denied says: “Location permission was denied. Search for an address or place instead.”
- Location outside Uganda says: “The location appears outside Uganda. Search for a Ugandan address or place instead.”
- Homepage/category search has `Use my location` with 10-mile default radius.
- Outside-Uganda search fallback says: “You appear to be outside Uganda. Choose a Ugandan area to search, or search all Uganda.”

These strings currently use English fallback unless a reviewed translation exists.

## Missing Translation Work

- Legal body keys: `terms.*`, `privacy.*`, `cookie.*`.
- Support/safety body keys: `help.*`, `safety.*`, `antiFraud.*`.
- Listing/search/location keys: `listing.location.*`, `search.nearMe.*`, `savedSearch.*`, `alerts.*`.
- Provider/admin status keys: `admin.setupStatus.*`, `languageSystem.*`, `locationSystem.*`.
- Video card/modal keys: `howToVideos.*`, `aiHowToVideos.*`.

## Gate Note

Do not claim full language completion until reviewed translations exist for every supported language. Rukiga and Runyankole must remain English fallback when reviewed local copy is unavailable.
