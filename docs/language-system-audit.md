# MakaUg Language System Audit

Status: partial, guarded, and honest for launch. English is complete enough for go-live. Luganda and Kiswahili have meaningful public-page coverage. Acholi, Runyankole, Rukiga, and Lusoga still require human editorial review before they can be called complete.

## Canonical Language Registry

The canonical registry lives in `config/languageRegistry.js` and is now shared by web UI, auth/OTP copy, WhatsApp/AI prompt guardrails, translation-provider status, and admin setup health.

| Canonical code | Legacy UI/API code | Display name | Native name | Web | WhatsApp | AI | Fallback | Translation status | Provider support | Human review |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `en` | `en` | English | English | yes | yes | yes | `en` | complete | human table + LLM allowed | no |
| `lg` | `lg` | Luganda | Luganda | yes | yes | yes | `en` | partial | human table + LLM allowed | yes |
| `sw` | `sw` | Kiswahili | Kiswahili | yes | yes | yes | `en` | partial | human table + LLM allowed | yes |
| `ach` | `ac` | Acholi | Acholi | yes | yes | yes | `en` | partial | LLM allowed only with review | yes |
| `rnynk` | `ny` | Runyankole | Runyankore / Runyankole | yes | yes | yes | `en` | partial | LLM allowed only with review | yes |
| `rkg` | `rn` | Rukiga | Rukiga | yes | yes | yes | `en` | English fallback until reviewed | no machine guessing | yes |
| `lus` | `sm` | Lusoga | Lusoga | yes | yes | yes | `en` | partial | LLM allowed only with review | yes |

## Guardrails

- Rukiga is never mapped to Kinyarwanda.
- Runyankole is never mapped to Kinyarwanda.
- Kinyarwanda is not a supported MakaUg language.
- If a Rukiga or Runyankole translation is missing or low confidence, the system uses English fallback instead of inventing a nearby language.
- AI/WhatsApp prompts include: “Do not use Kinyarwanda for Rukiga or Runyankole.”
- `services/translationProviderService.js` follows `human_table_then_provider_then_english`.
- Machine-generated language output is not considered complete until reviewed.

## Current Working Coverage

- `/about` uses `data-content-i18n` keys for visible body sections and changes body copy when language switches.
- About page launch coverage exists for English, Luganda, and Kiswahili; Rukiga/Runyankole/Acholi/Lusoga fall back to English where reviewed copy is missing.
- Missing browser-side content translations are recorded in `window.MAKAUG_MISSING_TRANSLATIONS`.
- WhatsApp language resolver uses the registry and English fallback rules.
- AI prompt guardrails use the registry and block wrong nearby-language substitution.
- `/admin/setup-status` exposes language-system status and fallback rules without secrets.

## Still Partial

- Legal pages, Help Centre body, Safety, Anti-Fraud, Advertise, Brokers, Mortgage, List Property, sponsored copy, how-to video cards, and email/WhatsApp templates still need complete reviewed translations.
- Persistent translation-missing telemetry is source-ready through admin setup status and browser session logs, but a dedicated translation audit table remains future work.
- Rukiga currently falls back to English unless reviewed translation text exists.

## Owner Action

Provide reviewed translations for Luganda, Kiswahili, Acholi, Runyankole, Rukiga, and Lusoga, starting with the public route body copy and legal/support pages. Until then, the system should remain in fallback mode and must not claim full multilingual completion.
