# Country Parity Log

| Date | Makaug release/core | Surface | Kenya decision | Status | Evidence |
|---|---|---|---|---|---|
| 2026-07-24 | `shared-core-phase1-20260724` | Homepage shared components | Adapt through `KE` tenant configuration | In implementation | Uganda byte-equivalence and 17-selector computed-style A/B gate |
| 2026-10-08 | `rate-card-20261008` (PR G) | Shared footer (`components/footer.html`): price from the rate card (`{{PRICE:private_listing}}`) and live district coverage (`{{FOOTER_COVERAGE}}`, no "all 146 districts") | `replace`: KE and ZA keep replacing the whole footer paragraph; their rewrites now match the new Uganda phrases ("from any district in Uganda", "districts with live listings") instead of "146 districts". Owner: Arthur. State: PR open | `tests/shared-core-phase1.test.js` (Kenya homepage has no `{{FOOTER_COVERAGE}}`, "UGX 20,000" or "districts with live listings"), `tests/pricing-single-source.test.js` |

## Required entry fields

Every Makaug release that changes a shared surface must add a row before Kenya
work begins:

- release marker or commit;
- affected route/component;
- `copy`, `adapt`, `replace`, or `exclude`;
- owner and state;
- test and live proof link.

An unexplained mismatch is a blocker. Do not silently edit either country to
make a daily check green.
