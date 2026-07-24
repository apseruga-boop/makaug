# Shared-Core Multi-Country Architecture

Status: accepted for phased delivery on 24 July 2026.

## Decision

Makaug remains the live Uganda product and the canonical source of proven public
components. Country sites stay independently deployable, but consume the same
versioned shared core. Country identity is supplied by a strict tenant contract
rather than by copying and editing a complete country repository.

Phase 1 covers only:

- top bar and navigation;
- homepage hero and search;
- Ask AI search band;
- featured-property and agent strips;
- homepage map shell;
- public footer.

The core lives at `packages/shared-country-core`. The root package exports it as
`makaug-platform/shared-country-core`, allowing Nyumba KE to pin an exact Makaug
commit. A Kenya deployment therefore cannot silently float to a new core.

## Uganda safety gate

`applyUgandaHomepage()` validates every current component against its canonical
snapshot before returning the public page. Component drift fails fast and tells
the maintainer to regenerate and review the core. The Uganda renderer is a no-op
apart from the diagnostic release marker.

The runtime rollback is:

```text
SHARED_CORE_PHASE1_ENABLED=false
```

This restores the pre-shared-core homepage path without a code rollback.

## Tenant contract

Each tenant defines:

- country code and country name;
- public brand and domain;
- contact route;
- currency;
- capital and geography vocabulary;
- approved languages;
- logo letter and suffix;
- locale storage key.

The contract currently includes `UG` and `KE`. No DRC, Congo-Brazzaville or
Rwanda implementation is authorized in this phase.

## Central database boundary

Arthur has authorized one centralized production database with mandatory
`country_code` scoping. That is not part of Phase 1. It requires a separately
reviewed migration plan covering every shared table, constraints, indexes,
backfill, query guards, staff country switcher, and rollback. The existing Kenya
schema remains in place until that Phase 2/3 migration is proven.

No database credential, customer row, provider secret, Uganda phone number, or
paid-provider configuration moves through this homepage package.

## Change control

Every shared-core change follows this order:

1. update Makaug source and regenerate the components;
2. run the Uganda byte and computed-style characterization gates;
3. deploy and verify Makaug;
4. classify the change for Kenya;
5. bump Nyumba KE to the reviewed core commit;
6. deploy and verify Kenya at desktop and 390px.

No country-specific divergence may be added silently. It must be recorded as
`copy`, `adapt`, `replace`, or `exclude` in the parity register before code
changes.
