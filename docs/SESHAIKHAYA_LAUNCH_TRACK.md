# Seshaikhaya South Africa launch track

Status: active launch track, opened 11 August 2026.

Current state: South Africa staging is provisioned and live at
<https://seshaikhaya-staging-web.onrender.com>. Arthur authorised a hard
infrastructure cap of USD 13/month on 11 August 2026. Render's live checkout
priced a Starter web service plus the database at USD 17.50/month, so that plan
was not deployed. The live authorised configuration costs USD 10.50/month: one
free staging web service and one isolated Basic-256mb South Africa PostgreSQL
database. Production, workers, custom domains, DNS changes, social accounts and
production listings remain separate gates.

The free web tier does not support Render pre-deploy commands. Staging therefore
runs the existing guarded migrations during application startup. The ZA seed
isolation guard still refuses a reset when user records exist. The free web
service can cold-start slowly; process-heartbeat readiness prevents the proxy
from presenting a stalled application as ready.

Seshaikhaya is a `ZA` tenant of the shared country platform. It is not a fork of
the Uganda application. The same server, listing engine, moderation workflow,
Ask AI framework, sourced-intake services, WhatsApp framework, and shared
country package are deployed with a South Africa tenant contract.

## Isolation contract

- `COUNTRY_CODE=ZA` is mandatory on every Seshaikhaya service.
- Staging and production use separate South Africa PostgreSQL databases.
- Credentials, sessions, staff identities, inventory, backups, domains and
  deployment evidence are never reused from Uganda, Kenya or Rwanda.
- Uganda remains the default tenant so this branch cannot silently change an
  existing makaug deployment.
- Property Value and Marketplace are excluded from the ZA public product.

## Launch markers

- `seshaikhaya-za-foundation-20260811`
- `seshaikhaya-national-gazetteer-20260811`

## Runtime rollback

Set `COUNTRY_CODE=UG` only in a disposable test environment. Do not repoint a
Seshaikhaya database or domain at an Uganda service. Roll back a Seshaikhaya
deployment to its previous Render commit instead.

## Gates

1. Shared-core characterization tests prove that the Uganda renderer is still
   byte-identical apart from its existing diagnostic marker.
2. ZA public HTML contains no Uganda phone, currency, geography, Marketplace or
   Property Value navigation.
3. The national gazetteer is generated from Stats SA Census 2011 place
   boundaries, republished for public access by UCT Libraries.
4. Exact alias is the only automatic location match. Duplicate names return
   disambiguation; unknown names block approval and clear the hierarchy.
5. Real data moves through staging moderation before production. No sourced row
   is auto-published.

## Release evidence (11 August 2026)

- The Render Blueprint `seshaikhaya-staging` (`exs-d9thm3f40ujc73ec57fg`)
  contains only project `prj-d9thn3e417fc73eesuog`, staging environment
  `evm-d9thn3e417fc73eesupg`, free web service
  `srv-d9thnf6417fc73eetrg0`, and database
  `dpg-d9thn3e417fc73eesvfg-a`.
- Deployment `dep-d9tioahsrm7s73ahechg` is live from verified runtime commit
  `fd0dbac4c46dbcebca21099d48f42e0b7861453b`.
- The isolated database is migrated through migration 116, contains 19 tables,
  carries marker `za-separate-db-seed-isolation-v1-20260811`, and has zero
  inherited property inventory.
- The official 22,108-row place source expands to 33,876 canonical province,
  city and suburb nodes across all nine provinces.
- Exact Sea Point resolution succeeds; ambiguous Fourways and unknown Banda
  remain blocked.
- ZA tenant, intake integrity, WhatsApp contract/test transport, migration
  isolation, shared-core and P0 launch tests pass on Node 20.
- The transformed public application compiles, TypeScript checks pass and the
  Vitest suite passes.
- The Render Blueprint validates against Render's published Blueprint schema.
- Live public checks prove the homepage, application bundle, health and version
  endpoints remain responsive in sequence. Property Value and Marketplace
  endpoints remain absent.
- Browser QA proves English and isiZulu selection, translated isiZulu
  navigation, ZAR price bands, South Africa-only AI examples and zero inherited
  listings. Uganda how-to, contribution and district residues are absent.
- A free-tier cold start can exceed 50 seconds and a warm homepage response was
  about nine seconds during launch QA. This is acceptable for staging, not a
  production performance approval.
- `npm audit` reports four inherited dependency findings: one moderate and
  three high. They remain tracked and are not represented as resolved.

## Operator gates still open

1. Perform Dave's authenticated moderation audit against the live staging
   service; public and database proof do not replace this gate.
2. Change GoDaddy DNS only after production is separately authorised, then
   verify the production service, custom domain and TLS independently.
3. Moderate at least five current, source-backed listings with exact map pins
   and availability checks; do not count candidates as live listings.
4. Social-account creation is explicitly on hold until the company email is
   ready. Do not use a personal phone as the 2FA dependency.
5. Connect a real WhatsApp number after test transport proof; until then the
   UI must continue to state that the number is pending.
6. Keep the total live staging footprint at USD 10.50/month. Do not add a
   worker, paid web service, custom domain or production service under the
   current approval.

## Dave staging audit 1 correction

- Dave's live audit of commit `568c82e47d99eb95b770d24a5620f1325fa5db61`
  passed tenant isolation, scope, localisation and wrong-province safety, but
  found Census main places duplicated as same-name city and suburb nodes.
- The regression battery now resolves all 53 major-place cases automatically:
  53 exact, zero forced disambiguations and zero wrong-province results.
- Same-municipality city/suburb duplicates collapse to their primary city node.
  Genuine cross-municipality names such as Fourways remain ambiguous.
- Prominent aliases default safely while secondary places remain discoverable.
  Current and legacy pairs include Gqeberha/Port Elizabeth, Mbombela/Nelspruit,
  Mahikeng/Mafikeng, Pretoria/Tshwane, Durban/eThekwini,
  Makhanda/Grahamstown and Polokwane/Pietersburg.
- Location responses expose municipality and district-municipality context so
  South Africa hierarchy is Province to Municipality/City to Suburb.
- South Africa HTML renames the inherited Uganda meta-marker names while
  retaining their shared-core release evidence.
- Locations sign-off still requires the same battery and alias checks against
  the replacement live staging commit; local acceptance is not live proof.
- The free web scheduler can delay child heartbeats beyond five seconds. The
  staging proxy therefore allows a 30-second heartbeat window while retaining
  bounded upstream requests, preventing healthy instances from intermittently
  presenting as `service_starting`.
- The application child listens on loopback only. Render otherwise detects the
  internal child as a second public port and repeatedly probes its homepage,
  starving real staging traffic on the free CPU allocation.
