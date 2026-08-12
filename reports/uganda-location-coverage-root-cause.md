# Uganda location coverage root cause — 2026-08-11

## Ssenge

`Ssenge` was absent because the generated registry imports administrative layers from the UBOS NPHC 2024 Subcounty Profiles: county, subcounty, town council, parish and ward. Ssenge is a listing-heavy neighbourhood/village near Nansana rather than a distinct row in those imported layers. No confidence threshold or fuzzy-matching rule removed it; the source layer simply does not contain it.

The contained repair is a verified canonical override: `wakiso:ssenge`, town/parent `Nansana`, aliases `Ssenge` and `Senge`, approximate centre `0.4167, 32.5167`. It uses the same shared resolver as listing, moderation, search, intake and WhatsApp.

## Permanent guard

The coverage sweep resolves every runtime gazetteer row back to its canonical ID using district context, then runs a curated high-traffic bare-name and `, Uganda` parity set. CI fails if any curated locality is missing, ambiguous unexpectedly, or resolves to the wrong canonical ID. The generated `coverage-results.csv` is review evidence, not a new source of location truth.
