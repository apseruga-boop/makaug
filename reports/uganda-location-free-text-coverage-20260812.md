# Uganda location coverage and free-text resolver — 2026-08-12

## Result

- Official-source rows checked: **12,986** UBOS county, subcounty/town-council and parish/ward rows.
- Runtime canonical rows checked after safe alias de-duplication and verified overrides: **11,533**.
- Total probes, including all 12,986 public-source rows, runtime rows,
  high-traffic suffix parity and messy-input safety fixtures: **24,578**.
- Passed: **24,578**. Failed: **0**.
- Added marketplace places: `wakiso:nalumunye` and `wakiso:kitiko`.
- Restored authoritative UBOS rows previously hidden by cross-district alias
  suppression: **90**.
- Evidence: [`coverage-results.csv`](../coverage-results.csv).
- Complete 92-row registry diff: [`uganda-location-restored-rows-20260812.csv`](uganda-location-restored-rows-20260812.csv).

## Coverage root cause

The public UBOS NPHC 2024 Subcounty Profiles workbook currently exposes County,
Subcounty / Town Council and Parish / Ward layers. It contains 12,986 generated
rows and does **not** publish a village/cell layer in that workbook. The current
UBOS census explorer likewise describes public data through parish level.

`Nalumunye` and `Kitiko`, like `Ssenge`, are marketplace-relevant village or
neighbourhood names below the public workbook's imported layer. They were never
imported; no confidence threshold, coverage threshold or fuzzy filter removed
them. Rebuilding the checked-in gazetteer from the published workbook produces
the same source hash and row set.

The full input sweep exposed a second issue: curated overrides were suppressing
same-name UBOS rows globally instead of only replacing the same alias in the
same district. For example, a curated `Senior Quarters, Gulu` row hid UBOS
`Senior Quarters, Soroti`. Restricting override suppression to its own district
restores 90 authoritative cross-district nodes. Duplicate bare names remain
ambiguous or prominence-ranked; a supplied district resolves the exact parent.

The repair therefore keeps two sources separate:

1. The complete publicly downloadable UBOS hierarchy remains the generated,
   offline administrative source of truth.
2. Verified marketplace-level gaps are explicit, reviewable overrides with a
   named district and town/municipality parent. No village is invented from a
   fuzzy result.

The UBOS metadata documentation says village-level geographies exist in census
mapping systems but may be supplied on request. Until UBOS publishes that full
frame as a downloadable authoritative dataset, Makaug must not label the public
parish workbook as a complete Uganda village list.

## Added registry rows

| Canonical ID | Display name | District | Town / municipality | Source rationale |
|---|---|---|---|---|
| `wakiso:nalumunye` | Nalumunye | Wakiso | Kyengera | Wakiso District identifies the Seguku–Nalumunye–Bandwe–Kyengera corridor. |
| `wakiso:kitiko` | Kitiko | Wakiso | Makindye-Ssabagabo | Makindye-Ssabagabo planning and education sources identify Kitiko in the municipality. |

## Query behaviour

- Full exact aliases still auto-resolve at confidence 1.
- Space-separated phrases are tokenized after removing road/stage/zone/near,
  `go down`, country and trailing district noise.
- Exact locality tokens inside a phrase are ranked by phrase length,
  specificity and original position, but remain explicit suggestions.
- Misspellings use the stronger of trigram and normalized edit-distance
  similarity. Fuzzy matches remain suggestions and cannot auto-resolve.
- No candidate means `approval_blocked: true`; the junk fixture
  `Zzxqfakeplace` remains blocked.

## Sources

- UBOS NPHC 2024 public data portal: <https://statistics.ubos.org/nphc/>
- UBOS NPHC 2024 Subcounty Profiles workbook: <https://www.ubos.org/wp-content/uploads/2025/10/NPHC-2024-Subcounty-Profiles-Excel-Tables.xlsx>
- Makindye-Ssabagabo municipal source: <https://www.msabagabo.go.ug/about-us>
- Wakiso District Nalumunye corridor source: <https://wakiso.go.ug/2026/04/06/fast-tracking-of-gkma-udp-road-projects-gains-momentum-in-the-district/>

## Safety

This is code and registry data only. It does not migrate listings, change
statuses, write proposed values, approve fuzzy matches or touch production.
