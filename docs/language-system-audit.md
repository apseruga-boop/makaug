# MakaUg Language System Audit

Status: partial. English is launch-ready. Luganda and Kiswahili have meaningful public-page coverage. Acholi, Runyankole, Rukiga, and Lusoga still need editorial review before they can be called complete.

## Canonical Language Registry

The launch registry lives in `config/languageRegistry.js`.

| Canonical code | Legacy UI/API code | Display name | Native name | Web | WhatsApp | AI | Fallback | Translation status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `en` | `en` | English | English | yes | yes | yes | `en` | complete |
| `lg` | `lg` | Luganda | Luganda | yes | yes | yes | `en` | partial |
| `sw` | `sw` | Kiswahili | Kiswahili | yes | yes | yes | `en` | partial |
| `ach` | `ac` | Acholi | Acholi | yes | yes | yes | `en` | partial |
| `rnynk` | `ny` | Runyankole | Runyankore / Runyankole | yes | yes | yes | `en` | partial |
| `rkg` | `rn` | Rukiga | Rukiga | yes | yes | yes | `en` | English fallback until reviewed |
| `lus` | `sm` | Lusoga | Lusoga | yes | yes | yes | `en` | partial |

## Alias Rules

- `rukiga`, `rkg`, and legacy `rn` map to canonical `rkg`.
- `runyankole`, `runyankore`, `rnynk`, and legacy `ny` map to canonical `rnynk`.
- Rukiga and Runyankole are never mapped to Kinyarwanda.
- Kinyarwanda is not a supported MakaUg language.
- If the system cannot confidently answer in Rukiga, it must use English fallback and state that Rukiga translation is not fully available yet.

## Current Fixes

- `/about` now uses `data-content-i18n` keys for the visible body sections instead of static English-only copy.
- The shared language switch applies `applyAboutLanguageUI()` so the About page body changes when the user switches language.
- Missing body translations are recorded in `window.MAKAUG_MISSING_TRANSLATIONS` during the browser session.
- WhatsApp/AI language prompts now include guardrails that explicitly forbid substituting Kinyarwanda for Rukiga or Runyankole.
- Rukiga WhatsApp responses use English fallback until reviewed translations are supplied, preventing incorrect Kinyarwanda-style output.

## Still Partial

- Full editorial translations are still needed for legal pages, Help Centre categories, Safety, Anti-Fraud, Advertise, Brokers, Mortgage, List Property, sponsored placements, and how-to video cards.
- Admin reporting for missing translation keys is source-ready only through session logging; a persistent translation audit table is still a future improvement.
- Human language review is required before marking Acholi, Runyankole, Rukiga, and Lusoga as complete.
