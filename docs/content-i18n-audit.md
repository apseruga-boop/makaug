# MakaUg Content and i18n Audit

Status: partial, go-live safe for English routes, translations still need editorial completion.

## Routes Checked

- `/about`: standalone public route exists in the single-page router. English content is present. Translation keys are partial.
- `/how-it-works`: standalone public route exists. English content is present. Translation keys are partial.
- `/careers`: standalone public route exists. English content is present. Lead capture exists through support/CRM patterns where configured. Translation keys are partial.
- `/terms`: standalone public route exists. English content is present and must remain marked for legal review. Translation keys are partial.
- `/privacy-policy`: standalone public route exists. English content is present and must remain marked for legal review. Translation keys are partial.
- `/cookie-policy`: standalone public route exists. English content is present and must remain marked for legal review. Translation keys are partial.
- `/anti-fraud`: standalone public route exists. English content is present. Translation keys are partial.
- `/help`: standalone public route exists. English content is present. Translation keys are partial.
- `/safety`: standalone public route exists. English content is present. Translation keys are partial.
- `/brokers`: standalone public route exists. English content is present. Translation keys are partial.

## Supported Language Codes

- `en`: English, complete enough for go-live.
- `lg`: Luganda, partial.
- `sw`: Kiswahili, partial.
- `ac`: Acholi, partial.
- `ny`: Runyankole, partial legacy code kept for compatibility.
- `rn`: Rukiga/Runyankole family, partial.
- `sm`: Lusoga, partial legacy code kept for compatibility.

## Missing Translation Work

The public route shells and core CTAs are language-aware, but full editorial translation is not complete for:

- Legal page body copy: `terms.*`, `privacy.*`, `cookie.*`.
- Safety page body copy: `safety.renters.*`, `safety.buyers.*`, `safety.students.*`, `safety.land.*`, `safety.commercial.*`.
- Advertising copy: `advertise.packages.*`, `advertiserDashboard.*`, `sponsored.label`, `brokerSpotlight.*`, `sponsoredMapMarker.*`.
- Listing translation preview: `listingTranslation.preview.*`, `listingTranslation.reviewStatus.*`.
- Careers lead form: `careers.form.*`, `careers.confirmation.*`.
- Help centre categories: `help.categories.*`, `help.form.*`.

## Admin Follow-up

Add a content/i18n admin report that lists missing keys by route and language before claiming full multilingual completion. Until then, only English content should be treated as complete.
