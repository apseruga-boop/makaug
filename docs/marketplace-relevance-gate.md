# Marketplace relevance gate

Marker: `marketplace-relevance-gate-20260719`

## Ingestion

Google Places searches use strict `includedType` filtering where Google supports the Marketplace category. Typeless categories use a narrower trade phrase such as `land surveyor`, `property valuer`, or `private security company`.

Every candidate is classified before persistence:

- `qualified`: category evidence or a matching Google type; may be public.
- `pending_review`: borderline evidence; stored for moderation and never public.
- `reject`: an excluded place type, excluded name, invalid category, or category-specific sanity failure; not stored.

Thin district searches may produce `no_qualified_results`. Zero is authoritative; the crawler does not pad the directory with unrelated places.

## Existing inventory audit

`POST /api/admin/marketplace-drip/relevance-audit` is admin-protected and defaults to `{ "dry_run": true }`.

The live action is reversible:

- confirmed exclusions move from `live` to `hidden`;
- weak or missing legacy evidence moves from `live` to `pending_review`;
- qualified rows stay `live`;
- no business is deleted;
- every non-public decision writes a Marketplace event and moderation note.

Affected Google category/district cells are prioritized for re-check and the drip cursor is reset to the start of that priority order.

## Rollback

Pause the Marketplace drip, restore selected businesses to `status='live'` after staff review, and restore their relevance decision to `qualified`. The audit trail remains in `marketplace_events` and `moderation_notes`. Reverting application code stops new classification; migration `088` is additive and does not need to be dropped.
