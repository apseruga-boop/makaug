# MakaUg Content and i18n Audit

Status: partial, go-live safe for English routes, translations still need editorial completion.

## Routes Checked

- `/about`: standalone public route exists in the single-page router. English content was expanded for Task 11 into a full About MakaUg page with who-we-help sections, trust/safety, and how-to video slots. English content is complete enough for go-live. Translation keys are partial and fall back to English.
- `/how-it-works`: standalone public route exists. English content was expanded for Task 11 into a 10-step visual flow with how-to video slots. Translation keys are partial and fall back to English.
- `/careers`: standalone public route exists. English content is present. Career interest form now submits to `POST /api/contact/career-interest`, creates a CRM lead, and logs email/notification fallback status. Translation keys are partial.
- `/terms`: standalone public route exists. English content is present and must remain marked for legal review. Translation keys are partial.
- `/privacy-policy`: standalone public route exists. English content is present and must remain marked for legal review. Translation keys are partial.
- `/cookie-policy`: standalone public route exists. English content is present and must remain marked for legal review. Translation keys are partial.
- `/anti-fraud`: standalone public route exists. English content is present. Translation keys are partial.
- `/help`: standalone public route exists. English content was expanded for Task 11 into a Help Centre with categories, quick actions, a support request form, WhatsApp support, and how-to video slots. Translation keys are partial and fall back to English.
- `/safety`: standalone public route exists. English content is present. Translation keys are partial.
- `/brokers`: standalone public route exists. English content is present. Translation keys are partial.
- `/discover-ai-chatbot`: standalone public route exists. Task 12 added a connected AI task panel and five AI how-to video slots. English is complete enough for go-live; translations are partial/fallback.
- Auth drawer: Task 12 cleaned the initial sign-in/create-account journey and added partial English/Luganda/Kiswahili drawer translations. Acholi, Runyankole, Rukiga, and Lusoga currently fall back to English in the drawer for missing strings.

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
- How-to video cards and modal copy: `howToVideos.*`.

## How-to Video Slots

Task 11 added 10 configurable general one-minute YouTube slots in `config/howToVideos.js`:

1. What is MakaUg?
2. How to search for property
3. How to use filters
4. How to find student accommodation
5. How to list property
6. How to add property location and photos
7. How to contact an owner or broker on WhatsApp
8. How to save searches and create alerts
9. How to book a viewing or request callback
10. How to stay safe and report suspicious listings

YouTube IDs are intentionally empty until the owner publishes the videos. The frontend shows slots and lazy-loads YouTube only when a configured video is opened.

Task 12 added 5 AI chatbot-specific video slots:

1. What MakaUg AI can help with
2. How to search property using WhatsApp/AI
3. How to list property with AI help
4. How to create alerts and recommendations
5. How to report fraud or request human help

These also have empty YouTube IDs until the videos are published.

## Admin Follow-up

Add a content/i18n admin report that lists missing keys by route and language before claiming full multilingual completion. Until then, only English content should be treated as complete.
