# Seshaikhaya South Africa launch track

Status: active launch track, opened 11 August 2026.

Current state: the application, infrastructure specification and local release
proof are complete. No paid Render resources, DNS changes, social accounts or
production listings have been created from this branch. Those remain explicit
operator approval and audit gates.

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
  existing MakaUG deployment.
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

- The official 22,108-row place source expands to 33,876 canonical province,
  city and suburb nodes across all nine provinces.
- Exact Sea Point resolution succeeds; ambiguous Fourways and unknown Banda
  remain blocked.
- ZA tenant, intake integrity, WhatsApp contract/test transport, migration
  isolation, shared-core and P0 launch tests pass on Node 20.
- The transformed public application compiles, TypeScript checks pass and the
  Vitest suite passes.
- The Render Blueprint validates against Render's published Blueprint schema.
- Browser QA proves English and isiZulu selection, ZAR price bands, South
  Africa-only navigation and zero inherited listings.

## Operator gates still open

1. Authorise the paid Render Blueprint resources: two Starter web services,
   two Starter workers and two paid PostgreSQL databases.
2. Verify the resulting staging services and database migrations, then perform
   Dave's authenticated moderation audit.
3. Change GoDaddy DNS only after staging proof, then verify the production
   service, custom domain and TLS independently.
4. Moderate at least five current, source-backed listings with exact map pins
   and availability checks; do not count candidates as live listings.
5. Create social accounts only with an Arthur-controlled email and explicit
   approval. Do not use a personal phone as the 2FA dependency.
6. Connect a real WhatsApp number after test transport proof; until then the
   UI must continue to state that the number is pending.
