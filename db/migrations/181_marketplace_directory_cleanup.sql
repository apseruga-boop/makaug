-- Marketplace directory clean-up (display-level data only).
-- Prepared from the 25 Oct 2026 snapshot of the 1,429 live businesses and the
-- reviewed proposals in that day's marketplace health report. Per business:
--   * 52 off-topic businesses (schools, hotels, phone shops, ...) -> status 'hidden'
--   * 47 businesses moved to the right category, including the new
--     'loans_microfinance' (Loans & microfinance) category
--   * 310 names fixed: ALL-CAPS to proper case (SACCO, NSSF, UAP, Ltd and
--     other acronyms kept) plus one SEO-stuffed name trimmed
--   * 9 branch sets (21 businesses) share a branch_group_key; one card
--     per set stays live and the other 12 are hidden and counted as its branches
-- Property listings, locations and map pins are not touched. Rows are never deleted.
--
-- Left unchanged on purpose (flagged for a person to review):
--   0633da18-02dc-455e-ae3a-825aca62ea8b  LA'BOS LAUNDRY AND CLEANING SERVICES
--   38518211-4e45-4dca-a3f1-3acb23c815f3  BLOSSOM ENTERPRISES UGANDA LIMITED
--   3cc94341-f76c-40ba-9d07-0208876e9e1b  LABEJA AND FAMILY ENTERPRISE
--   3d35bb9c-8b25-4292-8e84-5b86e45cd93b  Nuwatu Enterprises Limited
--   571736f5-1a28-4b80-9094-8a0b4cd2a698  UPPER HAND ENTERPRISES
--   6696d68f-b640-43ff-b16d-144fec6e4a9e  Junior electrical & electronic services
--   828414fa-a51a-4fd6-878b-48af88444386  GOLD ENTERPRISES (U) LTD
--   8bce5df4-d5fd-4e41-acf2-d1edf4e4160f  ABIOLA SINGLE PHASE ELECTRICALS AND ELECTRONICS KAGADI
--   8da29d2f-3371-4302-a145-b7c8ecb6165a  JBK Enterprises Limited
--   973269d6-7af4-4d79-9fb1-b908e71fa708  Five star Electrical and Electronics solutions, KAKUMIRO
--   99a9f630-83f7-473e-9678-92c642ddf8a8  KYALEMA ENTERPRISES /Tonny electronics
--   a40f543e-aa92-4c58-a3a8-8f50269104f6  Kapchemeigo Electronics and electrical solutions
--   c2ba2cb7-3073-4605-9c1c-9f0d6642738a  SMK ELECTRICALS AND ELECTRONICS
--   c7e935f1-1cb4-4811-842a-50643472948f  RWENZORI PEAKS ENTERPRISES LTD
--   d65b412b-8a89-43aa-931e-d57f162b973f  GOOD LORD ELECTRONICS KITGUM
--   dfdf0682-f3fa-4a4e-a75b-172f65551570  Lamm Electrical and Electronics services
--
-- Guards: a business is changed only while it is still 'live' and has no open
-- backup row, a name only while it still equals the snapshot name, a category
-- only while it still equals the snapshot category, and a branch set only while
-- its primary card is part of this run. A second run matches nothing.
-- Uganda only: app.country_code must be UG, which scripts/migrate.js sets.
-- Old values are copied into marketplace_cleanup_181_backup before the update.
-- Manual rollback: scripts/rollback-181-marketplace-directory-cleanup.sql
-- That file is not a migration and does not run on deploy.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '120s';
SET LOCAL TIME ZONE 'UTC';

ALTER TABLE marketplace_businesses ADD COLUMN IF NOT EXISTS branch_group_key TEXT;

CREATE INDEX IF NOT EXISTS idx_marketplace_businesses_branch_group
  ON marketplace_businesses (branch_group_key)
  WHERE branch_group_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS marketplace_cleanup_181_backup (
  business_id UUID PRIMARY KEY,
  actions TEXT[] NOT NULL,
  before_row JSONB NOT NULL,
  after_row JSONB,
  backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rolled_back_at TIMESTAMPTZ
);

CREATE TEMP TABLE marketplace_cleanup_181_plan (
  business_id UUID PRIMARY KEY,
  expected_name TEXT NOT NULL,
  expected_category TEXT NOT NULL,
  new_name TEXT,
  new_category TEXT,
  hide_reason TEXT,
  branch_group_key TEXT,
  branch_primary BOOLEAN NOT NULL
) ON COMMIT DROP;

INSERT INTO marketplace_cleanup_181_plan
  (business_id, expected_name, expected_category, new_name, new_category, hide_reason, branch_group_key, branch_primary)
VALUES
  ('4432d772-f5bd-482c-9092-fa47ded204ed'::uuid, 'Reach Loans Uganda', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('bdffe932-7651-4f48-ab7d-a6d93b38720d'::uuid, 'Select’s vision', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('b668782c-13aa-4911-8e5d-a544e99bf284'::uuid, 'JOLA FINANCE SOLUTIONS LIMITED', 'mortgage_providers', 'Jola Finance Solutions Limited', 'loans_microfinance', NULL, NULL, FALSE),
  ('c880e4d3-2093-4f29-a124-0080b7582cca'::uuid, 'Fincredit Uganda Ltd', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('637e4ff9-7fd6-4e0b-9e23-6709933c52bb'::uuid, 'Rukungiri Farmers'' Sacco', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('4fafbb7d-857e-407a-84ed-ba6bdd0d2771'::uuid, 'Express loans Uganda', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('b712992a-a61d-4b31-bce2-b5a4bf952538'::uuid, 'Platinum credit', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('7b244ef7-2c10-4deb-ad18-b0f64f0a0067'::uuid, 'Unifi Mbale', 'mortgage_providers', NULL, 'loans_microfinance', NULL, 'unifi', TRUE),
  ('0b633ae7-4156-4e8c-a56c-314b0a206c79'::uuid, 'Fortune Credit', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('d1ac2dfa-b0aa-4404-8f12-1ad95a733e1d'::uuid, 'Unifi Lira', 'mortgage_providers', NULL, 'loans_microfinance', NULL, 'unifi', FALSE),
  ('c9f0c3e7-67b9-4aba-b04c-7fe3907ba738'::uuid, 'Unifi Mbarara', 'mortgage_providers', NULL, 'loans_microfinance', NULL, 'unifi', FALSE),
  ('db10b9d8-7e0d-4806-8bb7-3233db92fddc'::uuid, 'Unifi Jinja', 'mortgage_providers', NULL, 'loans_microfinance', NULL, 'unifi', FALSE),
  ('5ef9a7fa-df7a-4d26-91e4-b8026618e676'::uuid, 'DADAM FINANCIAL SERVICES', 'mortgage_providers', 'Dadam Financial Services', 'loans_microfinance', NULL, NULL, FALSE),
  ('6ebd4b9a-ddfc-400a-b57b-fae41c6e1340'::uuid, 'PESA CAPITAL LIMITED', 'mortgage_providers', 'Pesa Capital Limited', 'loans_microfinance', NULL, NULL, FALSE),
  ('3fcfd14e-1983-422a-a674-66330a744064'::uuid, 'Fido Credit Uganda', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('362f42b3-8b54-422e-8f2b-8d27db8c4c8a'::uuid, 'STREET FINANCE UGANDA', 'mortgage_providers', 'Street Finance Uganda', 'loans_microfinance', NULL, NULL, FALSE),
  ('74cb9ff5-9863-4c5f-b202-5428a753717d'::uuid, 'Smart Loans Uganda', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('b471c151-035f-4bf5-bedb-dad40bad0367'::uuid, 'Augusto Property Services', 'commercial_services', NULL, 'property_managers', NULL, NULL, FALSE),
  ('5ff3963a-4d70-46b7-8323-0fede0085b3d'::uuid, 'Ayinza General Electrical Store', 'electricians', NULL, NULL, 'electrical/electronics shop, not an electrician', NULL, FALSE),
  ('356b836c-c195-4719-bb3f-cc8747f51e63'::uuid, 'Financial Advisor', 'insurance', NULL, NULL, 'not property related', NULL, FALSE),
  ('5bc41229-3316-4c85-b0c1-28eadff2dd5f'::uuid, 'One Stop Energy Center kagadi', 'electricians', NULL, NULL, 'electrical/electronics shop, not an electrician', NULL, FALSE),
  ('88e4c117-4805-452f-99f4-abd0af700f68'::uuid, 'Universal Christian Development Sacco(UCDS) Bugiri Uganda', 'developers', NULL, NULL, 'SACCO', NULL, FALSE),
  ('df513cf4-222d-42ba-8ad2-42ecbee1e707'::uuid, 'Collins Electronics Centre kasese', 'valuers', NULL, NULL, 'electronics / phone retail', NULL, FALSE),
  ('12ecb2fb-9f3f-44a9-b688-41e0accf89ce'::uuid, 'Mityana Central Market', 'commercial_services', NULL, NULL, 'a public market', NULL, FALSE),
  ('862c66d3-9742-43c2-abd4-b64a7129cabf'::uuid, 'Ntezza Property Consultancy', 'commercial_services', NULL, 'property_managers', NULL, NULL, FALSE),
  ('622a7bbb-2d95-4aad-8634-8ad3b785e070'::uuid, 'Euranie electronics center limited', 'solar', NULL, NULL, 'electronics / phone retail', NULL, FALSE),
  ('4d60aaa6-ea9c-42d8-9366-f4c24d478832'::uuid, 'Shadia Auto Paints', 'painters', NULL, NULL, 'motor vehicle trade', NULL, FALSE),
  ('1b0c63d2-9198-4165-b10c-776a29d47d5b'::uuid, 'HK Properties Uganda Limited', 'commercial_services', NULL, 'property_managers', NULL, NULL, FALSE),
  ('59821e90-b4b1-4a37-9c16-a257ed01efb9'::uuid, 'Sparta properties limited', 'commercial_services', NULL, 'property_managers', NULL, NULL, FALSE),
  ('0a673d9e-2f4b-4e06-acff-efccacd415de'::uuid, 'Canner Properties Ltd.', 'commercial_services', NULL, 'property_managers', NULL, NULL, FALSE),
  ('1daedf81-92bb-47d2-9bfb-763d30728fd9'::uuid, 'Property Care Ltd', 'commercial_services', NULL, 'property_managers', NULL, NULL, FALSE),
  ('21e260ae-01b1-4a9c-90c8-2d6d624a3255'::uuid, 'Skality Properties Uganda', 'commercial_services', NULL, 'property_managers', NULL, NULL, FALSE),
  ('6b32980e-ff78-4ae2-8bb2-96c98c9f6670'::uuid, '5 Square Homes : Real Estate Developers in Uganda - Houses & Apartments for Sale in Uganda.', 'commercial_services', '5 Square Homes', 'developers', NULL, NULL, FALSE),
  ('fdc38ab1-3c00-45cc-8de2-9fc5fa21ff13'::uuid, 'Prudential Uganda', 'insurance', NULL, NULL, 'health / life insurer', NULL, FALSE),
  ('8b5b8ca4-bf4a-4bfc-9dad-45f247691b7b'::uuid, 'The Microfinance Support Centre Ltd', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('ea91e34a-11f7-4eb6-83a7-43054df13c2e'::uuid, 'Premier Credit Limited', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('42e229b3-8c75-4724-97c4-e62d99f701ff'::uuid, 'FINCA Uganda - Head Office', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('ecf96d06-758a-4974-b113-4e319fe5c7b3'::uuid, 'Pride Microfinance', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('78c0ddf3-67ef-4e76-87ae-c0e629083ff7'::uuid, 'TFS Financial Services Limited', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('b777e6d0-07e2-4825-bb94-c60b633805f4'::uuid, 'Bayport Financial Services Uganda - Head Office', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('3f39319f-3815-4f84-88a7-2bb112ef7e99'::uuid, 'Afroteller Microfinance', 'mortgage_providers', NULL, 'loans_microfinance', NULL, NULL, FALSE),
  ('56b93893-2aa7-4180-983d-69e7be6ec16c'::uuid, 'KAMULI PROPERTY SERVICES', 'commercial_services', 'Kamuli Property Services', 'property_managers', NULL, NULL, FALSE),
  ('121076da-27e9-4309-b2dd-90d5b7d074b0'::uuid, 'Arthorft retail shop', 'brokers', NULL, NULL, 'retail shop', NULL, FALSE),
  ('5cc26766-08cc-48f7-aabd-9caa43a4ab3b'::uuid, 'Kamusiime and son''s electronics,& kamusiime and son''s video Hall, kagaba gold city', 'electricians', NULL, NULL, 'electronics / phone retail', NULL, FALSE),
  ('abc77c5c-e6ae-4eb1-a3e3-76579ef4ddf2'::uuid, 'Kusiima Electrical and solar solutions kagadi', 'electricians', NULL, 'solar', NULL, NULL, FALSE),
  ('28d50f38-793b-4f5d-b4f1-a8716fe7e911'::uuid, 'HUSSEIN PHONE NETWORK &ELECTRONICS', 'electricians', 'Hussein Phone Network &Electronics', NULL, 'electronics / phone retail', NULL, FALSE),
  ('00b9c25d-78a2-473d-999a-455ac40d33c7'::uuid, 'Same same electrical center Amuru', 'electricians', NULL, NULL, 'electrical/electronics shop, not an electrician', NULL, FALSE),
  ('019ab509-6f8c-43ed-860b-0c9844856997'::uuid, 'JB Electronics and video Library', 'electricians', NULL, NULL, 'electronics / phone retail', NULL, FALSE),
  ('70d099f8-2dff-455f-b45d-52fd6d6e4a5a'::uuid, 'Muko Solar & Electronics Center', 'solar', NULL, NULL, 'electronics / phone retail', NULL, FALSE),
  ('edf79fa1-f618-46bf-b69b-0ea59d4bca03'::uuid, 'Clearing Busia', 'insurance', NULL, NULL, 'not property related', NULL, FALSE),
  ('4cb495c5-bc55-4919-9450-8faba684c8b5'::uuid, 'AUTOTECH ELECTRICALS', 'electricians', 'Autotech Electricals', NULL, 'motor vehicle trade', NULL, FALSE),
  ('9b14df45-0453-467a-b24d-a3722b05c164'::uuid, 'Spax Stationers Housing Finance Bank Agent', 'mortgage_providers', NULL, NULL, 'bank agent kiosk, not the lender', NULL, FALSE),
  ('feb1f0bd-ba6c-4ec9-ad78-843564f9970e'::uuid, 'Chris craft shoes', 'brokers', NULL, NULL, 'retail shop', NULL, FALSE),
  ('0003209c-3b09-4543-beb0-da73160c72b1'::uuid, 'BOMBOKA VINTAGE DRY CLEANERS,LAUNDRY, FUMIGATION, GENERAL CLEANING ,SUITS FOR HIRE AND PURCHASE SERVICES', 'cleaning', 'Bomboka Vintage Dry Cleaners,Laundry, Fumigation, General Cleaning ,Suits for Hire and Purchase Services', NULL, 'laundry / dry cleaning, not a property service', NULL, FALSE),
  ('100c4623-9fda-4d61-bea9-bf7749d7bcca'::uuid, 'Kikka electricals and solar center masaka', 'electricians', NULL, NULL, 'electrical/electronics shop, not an electrician', NULL, FALSE),
  ('fa2bf1b4-cc87-48fc-a4a7-84e077eab70d'::uuid, 'KAWEESI AND SONS ELECTRICAL CENTRE', 'electricians', 'Kaweesi and Sons Electrical Centre', NULL, 'electrical/electronics shop, not an electrician', NULL, FALSE),
  ('071c5b38-5fad-43a5-9d64-a0652baeef75'::uuid, 'EDJO ELECTRICAL and solar wiring center', 'electricians', NULL, 'solar', NULL, NULL, FALSE),
  ('9dd8781e-cf1f-45d0-a41f-55c200d8218e'::uuid, 'Masaka Traders Housing finance Bank Agent', 'mortgage_providers', NULL, NULL, 'bank agent kiosk, not the lender', NULL, FALSE),
  ('2e7c474b-174b-4609-8b49-d38edcc9058f'::uuid, 'Solar Extension Agent-Lira City', 'electricians', NULL, 'solar', NULL, NULL, FALSE),
  ('42178257-ae2d-4c99-aec3-0eedeb264eb5'::uuid, 'Emmanuel Electrical and Solar Power', 'electricians', NULL, 'solar', NULL, NULL, FALSE),
  ('daadbc0b-82eb-41d6-b262-9a74660653f9'::uuid, 'Elohim Laundry And Dry Cleaners', 'cleaning', NULL, NULL, 'laundry / dry cleaning, not a property service', NULL, FALSE),
  ('562375e8-b766-4a75-b3dd-bbe99f093617'::uuid, 'Holaz Laundry Cleaning Services, Mbale', 'cleaning', NULL, NULL, 'laundry / dry cleaning, not a property service', NULL, FALSE),
  ('b826a7a4-ae12-4be9-9ed6-11e4269d70ff'::uuid, 'M. G ELECTRICALS & SOLAR INSTALLATION CO LTD', 'electricians', 'M. G Electricals & Solar Installation Co Ltd', 'solar', NULL, NULL, FALSE),
  ('c89d44b5-c2e6-42c9-8713-c6f8cb4ddc60'::uuid, 'Smart Energy Electrical and Electronics Centre', 'electricians', NULL, NULL, 'electronics / phone retail', NULL, FALSE),
  ('d0741a2d-8b1e-42e7-a1c7-0a0d98a33dde'::uuid, 'EMMA Electrical shop in Mbale Musoto trading centre', 'electricians', NULL, NULL, 'electrical/electronics shop, not an electrician', NULL, FALSE),
  ('917a2995-bfaa-4d51-9e3f-add8f04132f1'::uuid, 'MAK-H ELECTRICAL CENTER_MBALE', 'electricians', 'Mak-H Electrical Center_Mbale', NULL, 'electrical/electronics shop, not an electrician', NULL, FALSE),
  ('ffe92b48-6613-4759-a32b-ae293f287da7'::uuid, 'La''Bos Laundry & Cleaning Services', 'cleaning', NULL, NULL, 'laundry / dry cleaning, not a property service', NULL, FALSE),
  ('23550395-d58a-444a-9c98-bc637081c045'::uuid, 'G pop electronics', 'electricians', NULL, NULL, 'electronics / phone retail', NULL, FALSE),
  ('ed0e905d-fece-4f54-a2e7-4f43fe249fb9'::uuid, 'OKELLO OPIRO''S SHOP', 'brokers', 'Okello Opiro''s Shop', NULL, 'retail shop', NULL, FALSE),
  ('8409d9f6-e7ad-42a7-b99b-c1c7e0942db5'::uuid, 'Washy Cleaning Services Ltd (Washy Drycleaners)', 'cleaning', NULL, NULL, 'laundry / dry cleaning, not a property service', NULL, FALSE),
  ('d0f24e74-089a-4db4-8fc5-947cee775dcc'::uuid, 'SwiftKlean Laundry and Cleaning Services', 'cleaning', NULL, NULL, 'laundry / dry cleaning, not a property service', NULL, FALSE),
  ('c12db407-4c28-4c62-ad4f-df255c62e471'::uuid, 'Rwensha Electricals and solar systems', 'electricians', NULL, 'solar', NULL, NULL, FALSE),
  ('84420ed1-1e4d-4f2a-90e0-6f8d415a5a7d'::uuid, 'Nextedge Cloud', 'insurance', NULL, NULL, 'not property related', NULL, FALSE),
  ('a3690458-5e94-4921-8c1d-b58553bce6c3'::uuid, 'Rk electrical and satellite services', 'electricians', NULL, 'security', NULL, NULL, FALSE),
  ('cb9ee8ca-6cee-4786-93ec-62a6c04c0c49'::uuid, 'Energy first Electro Centre', 'electricians', NULL, NULL, 'electrical/electronics shop, not an electrician', NULL, FALSE),
  ('c32f96e3-e194-4559-8d13-3c5a515b498c'::uuid, 'Naluvule property Services', 'commercial_services', NULL, 'property_managers', NULL, NULL, FALSE),
  ('202f3398-c05c-40a0-be9b-de26978e1f68'::uuid, 'Safe Property Services Ltd', 'commercial_services', NULL, 'property_managers', NULL, NULL, FALSE),
  ('0c8f7993-8e9d-40ac-a212-125aac650352'::uuid, 'Dr Berry Electronics Store 🇺🇬', 'electricians', NULL, NULL, 'electronics / phone retail', NULL, FALSE),
  ('b2aeac3e-cbdc-439b-b345-350c6e708807'::uuid, 'MASTER ISAIAH CCTV SURVEILLANCE SYSTEM, SATELITE DISH INSTALLATION AND NETWORKING SERVICES', 'electricians', 'Master Isaiah CCTV Surveillance System, Satelite Dish Installation and Networking Services', 'security', NULL, NULL, FALSE),
  ('2a943521-aff4-4866-9264-37a04198a966'::uuid, 'Yasin electrical shop', 'electricians', NULL, NULL, 'electrical/electronics shop, not an electrician', NULL, FALSE),
  ('a6ba4cac-8303-4d3a-93b6-30585cb61f24'::uuid, 'Pearson Property Services', 'commercial_services', NULL, 'property_managers', NULL, NULL, FALSE),
  ('71339cbe-e4a0-4b5a-bc9b-2f12305c598d'::uuid, 'Muwendo Property Services Ltd', 'commercial_services', NULL, 'property_managers', NULL, NULL, FALSE),
  ('566ff7b3-b2e3-41c1-9416-63958184d7f2'::uuid, 'Perfect Property Services', 'commercial_services', NULL, 'property_managers', NULL, NULL, FALSE),
  ('0e402b8e-d606-4395-a287-b92ef45842e9'::uuid, 'Vouch property services smc-ltd', 'commercial_services', NULL, 'property_managers', NULL, NULL, FALSE),
  ('c3c76b15-6550-4401-819d-8973263706e2'::uuid, 'Jubilee Life Insurance Company Uganda', 'insurance', NULL, NULL, 'health / life insurer', NULL, FALSE),
  ('f7d32183-6c33-4c57-b4da-3f1d41f13146'::uuid, 'Insurance Regulatory Authority', 'insurance', NULL, NULL, 'a regulator, not a provider', NULL, FALSE),
  ('dad36be0-df6b-4e97-8599-1776d33d8671'::uuid, 'BROWN ELECTRICAL & ELECTRONICS CENTRE KAGADI', 'electricians', 'Brown Electrical & Electronics Centre Kagadi', NULL, 'electronics / phone retail', NULL, FALSE),
  ('5ed71dfe-d8a8-4e11-beb1-9d1483b3b47c'::uuid, 'Dunwell Dry Cleaners', 'cleaning', NULL, NULL, 'laundry / dry cleaning, not a property service', NULL, FALSE),
  ('12f61b89-8968-413f-ba9c-6cb235cd549f'::uuid, 'Gango''s Laundry, Dry Cleaner & General Cleaning Services.', 'cleaning', NULL, NULL, 'laundry / dry cleaning, not a property service', NULL, FALSE),
  ('bead8c4b-2afa-4207-b5e8-d81361c73b3d'::uuid, 'Hanz electrical & electronics repair center', 'electricians', NULL, NULL, 'electrical/electronics shop, not an electrician', NULL, FALSE),
  ('897b0e0d-8e3d-49d5-a08a-f7cb542a4d78'::uuid, 'Jubilee Health Insurance Uganda Limited', 'insurance', NULL, NULL, 'health / life insurer', NULL, FALSE),
  ('ce95a1fd-4af7-4162-9057-f7dde6bd59df'::uuid, 'KAGANGA PHONES & ELECTRONICS', 'electricians', 'Kaganga Phones & Electronics', NULL, 'electronics / phone retail', NULL, FALSE),
  ('51928925-7973-4380-a6ac-d132532b5f5c'::uuid, 'Liberty Life Assurance Uganda', 'insurance', NULL, NULL, 'health / life insurer', NULL, FALSE),
  ('5a846d26-a686-4d5d-a03c-a1c1d1fe8fa1'::uuid, 'Makanga Electrical center and Makap technical services', 'electricians', NULL, NULL, 'electrical/electronics shop, not an electrician', NULL, FALSE),
  ('0c2e570e-1d2d-482f-b7d9-77b53a14bd2a'::uuid, 'MDK Electronics and Tv Repair', 'electricians', NULL, NULL, 'electronics / phone retail', NULL, FALSE),
  ('cc430e50-d015-4573-ad1b-47d76053cf8f'::uuid, 'RWOT AMIO ELECTRICAL CENTER', 'electricians', 'Rwot Amio Electrical Center', NULL, 'electrical/electronics shop, not an electrician', NULL, FALSE),
  ('9ff546da-66b6-4c30-90e4-3bbd68c5c966'::uuid, 'Sanlam Allianz Life Insurance (Uganda) Limited', 'insurance', NULL, NULL, 'health / life insurer', NULL, FALSE),
  ('ba0820c8-f0bd-4e77-818c-1b62aec3d610'::uuid, 'Sesc Electrical Services Store', 'electricians', NULL, NULL, 'electrical/electronics shop, not an electrician', NULL, FALSE),
  ('fa72ae91-7afe-4107-93dc-c9d62558c677'::uuid, 'SHAFIQ ELECTRONICZ Networking, CCTV & Solar electronics', 'electricians', NULL, NULL, 'electronics / phone retail', NULL, FALSE),
  ('7c91eaaa-a0b0-4d90-ad02-fec15bd6e02b'::uuid, 'ELEB ENGINEERING SERVICES (U) LTD', 'builders', 'Eleb Engineering Services (U) Ltd', NULL, NULL, NULL, FALSE),
  ('36f98b07-107f-4365-a21e-4e5a34ee0bd5'::uuid, 'MAIL STEP ENGINEERING CO.LIMITED', 'builders', 'Mail Step Engineering Co. Limited', NULL, NULL, NULL, FALSE),
  ('39264836-baf4-4438-a603-c242f97a46ab'::uuid, 'JML PLUMBING SYSTEMS', 'plumbers', 'JML Plumbing Systems', NULL, NULL, NULL, FALSE),
  ('0146f438-3b84-4268-ab2c-920b9f5d4165'::uuid, 'FRAMIR ENGINEERING COMPANY LIMITED', 'builders', 'Framir Engineering Company Limited', NULL, NULL, NULL, FALSE),
  ('1da80016-23d8-4ddf-bf9d-315900ee7f65'::uuid, 'MUCOBADI', 'developers', 'Mucobadi', NULL, NULL, NULL, FALSE),
  ('a76c869e-0536-4488-b173-13d303fa3e10'::uuid, 'ELITES ENGINEERING SERVICES LTD', 'builders', 'Elites Engineering Services Ltd', NULL, NULL, NULL, FALSE),
  ('6c27eef7-e994-4fa6-873d-cb8a4d138842'::uuid, 'THINK WORK ENGINEERING SERVICES LIMITED', 'builders', 'Think Work Engineering Services Limited', NULL, NULL, NULL, FALSE),
  ('f059d801-a361-4fe3-92ef-e2f2a71d5fb8'::uuid, 'ARRIS ENGINEERING LIMITED', 'builders', 'Arris Engineering Limited', NULL, NULL, NULL, FALSE),
  ('8ef428e6-facb-4e58-ae06-c10d352a541a'::uuid, 'SITYCON ENGINEERING COMPANY LIMITED', 'builders', 'Sitycon Engineering Company Limited', NULL, NULL, NULL, FALSE),
  ('6b5aaf5d-d333-4e2e-a69b-2abfd5770cea'::uuid, 'GALULEEBA DEVELOPERS LTD', 'developers', 'Galuleeba Developers Ltd', NULL, NULL, NULL, FALSE),
  ('b27ea60c-75a9-49ba-8ce7-799eeb3af377'::uuid, 'BAKERM ENTERPRISES', 'plumbers', 'Bakerm Enterprises', NULL, NULL, NULL, FALSE),
  ('6a0c1284-8e3c-4a46-94de-d1bf69c35436'::uuid, 'LEPRIN TECHNICAL SERVICES', 'cleaning', 'Leprin Technical Services', NULL, NULL, NULL, FALSE),
  ('2d159a3a-92ee-4dd1-9103-823f863d1d14'::uuid, 'SHIKOTAR IMPEX LTD', 'plumbers', 'Shikotar Impex Ltd', NULL, NULL, NULL, FALSE),
  ('e3c2a680-7446-4ad3-baa0-a42eb2709648'::uuid, 'PELGET INVESTMENTS LTD UGANDA', 'brokers', 'Pelget Investments Ltd Uganda', NULL, NULL, NULL, FALSE),
  ('191bc848-b326-48ac-8cab-475e25acad29'::uuid, 'VUMILIA HOME OF FURNITURE', 'interior_design', 'Vumilia Home of Furniture', NULL, NULL, NULL, FALSE),
  ('63c85212-2fc3-4e6e-9d4d-64033f6edf7f'::uuid, 'UEDCL KAGADI (Rst)', 'electricians', 'UEDCL Kagadi (Rst)', NULL, NULL, NULL, FALSE),
  ('bc8b62a9-d72b-494c-ad77-b4defa4572c8'::uuid, 'LINGLOO TECH SERVICES', 'builders', 'Lingloo Tech Services', NULL, NULL, NULL, FALSE),
  ('d1cfaa77-e465-4f86-8f0d-0678f2da215e'::uuid, 'VIGISH INTERNATIONAL SMC LTD', 'builders', 'Vigish International SMC Ltd', NULL, NULL, NULL, FALSE),
  ('1138a845-8f88-45c3-8349-1266e7429f8d'::uuid, 'HIMOE LIMITED', 'developers', 'Himoe Limited', NULL, NULL, NULL, FALSE),
  ('50772b6b-18e7-414a-bc1c-5ee21c01d4a0'::uuid, 'BLT GUEST HOUSE', 'valuers', 'BLT Guest House', NULL, NULL, NULL, FALSE),
  ('13172d90-8d3d-49ef-a507-0d8d4efb407a'::uuid, 'GOOD HOPE MOTEL', 'developers', 'Good Hope Motel', NULL, NULL, NULL, FALSE),
  ('8dc8a497-50bd-44d5-880c-fd9ce7c2dbfa'::uuid, 'NUATU CONSULT LIMITED', 'developers', 'Nuatu Consult Limited', NULL, NULL, NULL, FALSE),
  ('ba89c7c3-1911-4499-a80b-614cd88503b5'::uuid, 'EZEK CONTRACTORS LIMITED', 'interior_design', 'Ezek Contractors Limited', NULL, NULL, NULL, FALSE),
  ('d7131372-f548-4e30-92e5-1a489ece4af4'::uuid, 'SWICO HOIMA', 'insurance', 'SWICO Hoima', NULL, NULL, 'swico', TRUE),
  ('90323d65-1819-4186-92c6-64e9127416dd'::uuid, 'PEAK PARTNERS', 'property_managers', 'Peak Partners', NULL, NULL, NULL, FALSE),
  ('34805305-8d60-40f8-b085-b09279c3e368'::uuid, 'HECTOR ESTATE', 'property_managers', 'Hector Estate', NULL, NULL, NULL, FALSE),
  ('07948d77-63cd-43f2-9af3-dcdf235d05ab'::uuid, 'MrMCARTIST1', 'painters', 'MrMCArtist1', NULL, NULL, NULL, FALSE),
  ('f8964d00-0009-4df9-97b2-1113360f8611'::uuid, 'MAKINAND ENGINEERING SERVICES U LTD', 'painters', 'Makinand Engineering Services U Ltd', NULL, NULL, NULL, FALSE),
  ('bc57d97d-998b-4f21-b0a9-98d3a2d4551a'::uuid, '3BROZ FURNITURE MASAKA CITY NYENDO BUKAKATA ROAD', 'painters', '3Broz Furniture Masaka City Nyendo Bukakata Road', NULL, NULL, NULL, FALSE),
  ('116b91a6-cc74-4352-a392-a2c48a70df2a'::uuid, 'ECO PAINTS MASAKA OUTLET', 'painters', 'Eco Paints Masaka Outlet', NULL, NULL, NULL, FALSE),
  ('05e6856d-3b10-45a2-86aa-144b800e2ed3'::uuid, 'THE DJEMBE PERFORMERS', 'painters', 'The Djembe Performers', NULL, NULL, NULL, FALSE),
  ('7407043c-24f7-472f-b50d-d6992e0bcec4'::uuid, 'ABU ARTIST & EMBROIDERY SERVICES', 'painters', 'Abu Artist & Embroidery Services', NULL, NULL, NULL, FALSE),
  ('adef8c55-170c-4378-b221-35839c30de4a'::uuid, 'AMASAKA GALLERY', 'painters', 'Amasaka Gallery', NULL, NULL, NULL, FALSE),
  ('64aef134-f98a-410f-a7bd-ca0728d2413d'::uuid, 'EBERAH', 'plumbers', 'Eberah', NULL, NULL, NULL, FALSE),
  ('1f18d6ba-4133-413a-80f1-7d6a43478fcd'::uuid, 'BALKAH WORLD TRADING AND CONTRACTING COMPANY LIMITED', 'builders', 'Balkah World Trading and Contracting Company Limited', NULL, NULL, NULL, FALSE),
  ('101c7fa9-d649-4ad2-8c82-454c52c3ee7a'::uuid, 'HEAVEN HOME DESIGN''S', 'architects', 'Heaven Home Design''s', NULL, NULL, NULL, FALSE),
  ('4d73ff01-375a-4724-9db1-e1b7fe596ee7'::uuid, 'LATWOM TECH-SERVICES', 'architects', 'Latwom Tech-Services', NULL, NULL, NULL, FALSE),
  ('cd770d58-c45b-4323-a19e-066aa31feac0'::uuid, 'WAZZ CONTRACTOR (U) LIMITED', 'architects', 'Wazz Contractor (U) Limited', NULL, NULL, NULL, FALSE),
  ('ed285c4d-4985-46af-9fe8-14d8aa4574c3'::uuid, 'INDEX SURVEYORS AND PROPERTY CONSULTANTS', 'valuers', 'Index Surveyors and Property Consultants', NULL, NULL, NULL, FALSE),
  ('85eaaf23-3f2e-4093-ba3f-55f913ab8088'::uuid, 'BASELI PROPERTY SERVICES LTD', 'brokers', 'Baseli Property Services Ltd', NULL, NULL, NULL, FALSE),
  ('2aae4c6e-3054-4854-8df0-4aeaa7a6784c'::uuid, 'GUARDFORCE SECURITY AND INVESTIGATION SERVICES LIMITED', 'security', 'Guardforce Security and Investigation Services Limited', NULL, NULL, NULL, FALSE),
  ('cfb09434-06f3-4b89-ac78-b215bb966fc5'::uuid, 'SGA SECURITY UGANDA HEADQUARTERS', 'security', 'SGA Security Uganda Headquarters', NULL, NULL, NULL, FALSE),
  ('bdc40ace-4b12-4be4-b03d-22efae79b4b6'::uuid, 'ALJA PROPERTIES LIMITED', 'property_managers', 'Alja Properties Limited', NULL, NULL, NULL, FALSE),
  ('b9f3e6b2-b213-476c-a9c6-cd7d9617d377'::uuid, 'NEXT PAINTS UGANDA LIMITED', 'painters', 'Next Paints Uganda Limited', NULL, NULL, NULL, FALSE),
  ('60cdd8d5-00d3-4ee5-a6a8-2a26117a410e'::uuid, 'P-U Nard CONTRACTORS', 'painters', 'P-U Nard Contractors', NULL, NULL, NULL, FALSE),
  ('07f1bb91-7d43-4b9a-9a73-dcf37257bd8c'::uuid, 'TURSH WATERTECH UGANDA LTD', 'plumbers', 'Tursh Watertech Uganda Ltd', NULL, NULL, NULL, FALSE),
  ('ed3ed981-2667-4f52-bec7-39881c8851b5'::uuid, 'HAGA WATER LIMITED', 'plumbers', 'Haga Water Limited', NULL, NULL, NULL, FALSE),
  ('e88e388d-3fef-4488-a6f8-fad315f912ab'::uuid, 'SSENTOOGO AND PARTNERS.', 'architects', 'Ssentoogo and Partners.', NULL, NULL, NULL, FALSE),
  ('4263c69c-2ae2-4a08-b145-13647a875227'::uuid, 'BATTE INTERIORS AND LANDSCAPE DESIGN (B.I.L.D HOLDINGS)', 'architects', 'Batte Interiors and Landscape Design (B.I.L.D Holdings)', NULL, NULL, NULL, FALSE),
  ('288cc071-3e8a-45a5-ba2c-5897b6a1c405'::uuid, 'FIM LIGHT TECHNICAL SERVICES LTD', 'builders', 'Fim Light Technical Services Ltd', NULL, NULL, NULL, FALSE),
  ('168495a7-fcc6-4d33-99c8-072dc7c5a019'::uuid, 'SIM ENGINEERING CONSULT', 'surveyors', 'Sim Engineering Consult', NULL, NULL, NULL, FALSE),
  ('ec8e2b01-28ed-47d0-a3b0-4eb2be5ac04a'::uuid, 'SJ CONSTRUCTIONS COMPANY LTD', 'builders', 'SJ Constructions Company Ltd', NULL, NULL, NULL, FALSE),
  ('b5e724d4-e6c7-43d8-8f71-60e2008fc7e6'::uuid, 'KESA HALAL PROPERTY SERVICES U LIMITED', 'surveyors', 'Kesa Halal Property Services U Limited', NULL, NULL, NULL, FALSE),
  ('bb96d675-858d-489a-b38b-3b34930210c3'::uuid, 'SNOW LAND SERVICES', 'surveyors', 'Snow Land Services', NULL, NULL, NULL, FALSE),
  ('97a14023-0a97-4020-a787-befd91569934'::uuid, 'EYE VIEW PROPERTIES LTD', 'surveyors', 'Eye View Properties Ltd', NULL, NULL, NULL, FALSE),
  ('e7398478-313d-4b8e-9f72-2f9aaf3525df'::uuid, 'TURKISH DESIGN BLOCKS COMPANY LIMITED', 'builders', 'Turkish Design Blocks Company Limited', NULL, NULL, NULL, FALSE),
  ('cd558b89-d031-4585-a454-09cec353cd88'::uuid, 'MASTER INDUSTRIES UGANDA LIMITED', 'builders', 'Master Industries Uganda Limited', NULL, NULL, NULL, FALSE),
  ('ea6af232-2957-4460-a6d5-1daf552f9e11'::uuid, '2ESCAPE SERVICES LTD', 'builders', '2Escape Services Ltd', NULL, NULL, NULL, FALSE),
  ('ddb6a529-8f16-420d-a112-23fdea162079'::uuid, 'PRABAT ENGINEERING LTD', 'builders', 'Prabat Engineering Ltd', NULL, NULL, NULL, FALSE),
  ('221a68b8-82f0-4f00-9d2c-b6eb75290cb0'::uuid, 'SKY-LIT CIVIL & ENVIRONMENTAL ENGINEERING SOLUTIONS (U) LTD', 'builders', 'Sky-Lit Civil & Environmental Engineering Solutions (U) Ltd', NULL, NULL, NULL, FALSE),
  ('a3d06124-d0aa-485f-a936-0f88e4fc6f06'::uuid, 'PLAN QUICK CONSULT LTD', 'surveyors', 'Plan Quick Consult Ltd', NULL, NULL, NULL, FALSE),
  ('c42b4031-4c3f-43a4-8b62-db9ab1ba0ed8'::uuid, 'DICKCOM PROPERTY AGENCY', 'surveyors', 'Dickcom Property Agency', NULL, NULL, NULL, FALSE),
  ('b593644b-9573-4efa-b79c-98001c69e6f3'::uuid, 'BASELINE REAL ESTATE VENTURES LTD', 'surveyors', 'Baseline Real Estate Ventures Ltd', NULL, NULL, NULL, FALSE),
  ('8132f9de-251f-4148-a45e-19d90e79b8ab'::uuid, 'LANDPOINT ASSOCIATES', 'surveyors', 'Landpoint Associates', NULL, NULL, NULL, FALSE),
  ('796d4da5-5f1d-45ce-9f4c-06e5678c5c9c'::uuid, 'UGANDA ARCHITECTS AND ENGINEERS LTD', 'surveyors', 'Uganda Architects and Engineers Ltd', NULL, NULL, NULL, FALSE),
  ('1ccb9d0f-94fb-4443-b559-715c06fa1134'::uuid, 'GO-INTERNATIONAL AFRICA', 'insurance', 'Go-International Africa', NULL, NULL, NULL, FALSE),
  ('710edb0b-f71d-4011-85c9-afecb6559b48'::uuid, 'BIG ART', 'painters', 'Big Art', NULL, NULL, NULL, FALSE),
  ('7c58fd77-de05-4727-81b6-63c3ca11c686'::uuid, 'MAPLAND SURVEYS AND MUKI BUSINESS CENTRE PLUS RESIDENTIAL ROOMS', 'surveyors', 'Mapland Surveys and Muki Business Centre Plus Residential Rooms', NULL, NULL, NULL, FALSE),
  ('729fd975-e4bc-431e-9040-0bf8f828b318'::uuid, 'BASO CONSTRUCTION', 'builders', 'Baso Construction', NULL, NULL, NULL, FALSE),
  ('acc90dec-b23b-4548-adf5-8a3dc121e9bc'::uuid, 'MUGABE ELECTRICALS AND ACCESSORIES', 'electricians', 'Mugabe Electricals and Accessories', NULL, NULL, NULL, FALSE),
  ('3101a984-22e1-4ed2-85e4-09c3f2111542'::uuid, 'RIVERSIDE GUEST HOUSE KAPCHORWA', 'brokers', 'Riverside Guest House Kapchorwa', NULL, NULL, NULL, FALSE),
  ('b60deff5-1554-4b38-bf3a-247ddb0e9a3f'::uuid, 'POWER MAN ELECTRICAL SERVICES', 'electricians', 'Power Man Electrical Services', NULL, NULL, NULL, FALSE),
  ('36561966-94c2-48d6-84da-7efcba56ba42'::uuid, 'MUWANGUZI DISTRIBUTORS UGANDA LIMITED', 'brokers', 'Muwanguzi Distributors Uganda Limited', NULL, NULL, NULL, FALSE),
  ('d19f60f8-0a14-479d-a010-dcb48851523e'::uuid, 'MART ARCHITECTURAL SERVICES', 'architects', 'Mart Architectural Services', NULL, NULL, NULL, FALSE),
  ('e48b0e13-610d-4443-98d0-d64bb9090580'::uuid, 'BDA ARCHITECTS AND ENGINEERS', 'architects', 'BDA Architects and Engineers', NULL, NULL, NULL, FALSE),
  ('14de2f24-827c-4cbf-bc9c-ba3fcb2eb586'::uuid, 'UGANDA BUSINESS AGENTS LTD', 'brokers', 'Uganda Business Agents Ltd', NULL, NULL, NULL, FALSE),
  ('69338ab2-41c6-40e2-955b-be1c898c5950'::uuid, 'STONEFIELD ASSOCIATE SURVEYORS', 'surveyors', 'Stonefield Associate Surveyors', NULL, NULL, NULL, FALSE),
  ('ed7dcef5-b2f2-4ddf-af94-5cd413f48fc0'::uuid, 'ISAAC AND SONS ENTERPRISE', 'electricians', 'Isaac and Sons Enterprise', NULL, NULL, NULL, FALSE),
  ('922d6c3c-b07f-4422-a6a4-585a2c48dca1'::uuid, 'TIMELINK REAL ESTATE CONSULTANCY', 'brokers', 'Timelink Real Estate Consultancy', NULL, NULL, NULL, FALSE),
  ('31104651-12d9-46a0-b2fe-b7c0a09e91fc'::uuid, 'MUDI-FLO CONSTRUCTION COMPANY LIMITED', 'builders', 'Mudi-Flo Construction Company Limited', NULL, NULL, NULL, FALSE),
  ('cab7e934-57d3-4446-9517-506cf055c6ea'::uuid, 'PARIPARA HOUSE', 'brokers', 'Paripara House', NULL, NULL, NULL, FALSE),
  ('4292c6b7-4a68-4038-b57e-643b056cfb73'::uuid, 'CRG CONSTRUCTION LTD', 'builders', 'CRG Construction Ltd', NULL, NULL, NULL, FALSE),
  ('df0b459b-bf28-479e-9193-ec0714e0868d'::uuid, 'A3 CLEANING AND FUMIGATION SERVICES LTD', 'cleaning', 'A3 Cleaning and Fumigation Services Ltd', NULL, NULL, NULL, FALSE),
  ('f868b6ad-98ff-4a3d-8bbd-f61c971edf8c'::uuid, 'PYT INTERIORS', 'interior_design', 'Pyt Interiors', NULL, NULL, NULL, FALSE),
  ('bfdc2491-e617-416e-9e31-224f33c1547b'::uuid, 'SABOZ CONTRACTORS', 'builders', 'Saboz Contractors', NULL, NULL, NULL, FALSE),
  ('ba3edd98-5e7c-4967-aad7-286879678c82'::uuid, 'SIMPLE SOLAR SUPPLIER', 'solar', 'Simple Solar Supplier', NULL, NULL, NULL, FALSE),
  ('3d2694e9-e213-410b-99fe-567cf39a4fd2'::uuid, 'KIKANDWA ELECTRONICS & SOLAR SOLUTIONS, MITYANA', 'solar', 'Kikandwa Electronics & Solar Solutions, Mityana', NULL, NULL, NULL, FALSE),
  ('adf62d02-0bc7-424e-a140-6226266d0103'::uuid, 'SOVEREIGN SURVEY CONSULTANTS', 'surveyors', 'Sovereign Survey Consultants', NULL, NULL, NULL, FALSE),
  ('015c028f-7df4-46de-be4d-3527341b7f70'::uuid, 'KELOY TECHNICAL SERVICES LTD', 'electricians', 'Keloy Technical Services Ltd', NULL, NULL, NULL, FALSE),
  ('a2175d1c-4ffd-4db3-9b0d-d23fc350e683'::uuid, 'JOMOK FACTORY LTD, ECO-CONCRETE MANUFACTURING,CONSTRUCTION CONTRACTORS &REAL EASTATE', 'builders', 'Jomok Factory Ltd, Eco-Concrete Manufacturing,Construction Contractors &Real Eastate', NULL, NULL, NULL, FALSE),
  ('b19e4fc3-85ea-44a9-af0d-f7c313807712'::uuid, 'D&M REAL ESTATES LTD', 'brokers', 'D&M Real Estates Ltd', NULL, NULL, NULL, FALSE),
  ('89e36480-726b-4635-8d77-1e634b7e84da'::uuid, 'BULAMBA SEMEI ARCHITECTURAL ENGINEERS LIMITED', 'architects', 'Bulamba Semei Architectural Engineers Limited', NULL, NULL, NULL, FALSE),
  ('63fd630b-7bd8-42aa-bf1a-cef43ea73862'::uuid, 'RAMA APARTMENT''S LTD KAYUNGA', 'brokers', 'Rama Apartment''s Ltd Kayunga', NULL, NULL, NULL, FALSE),
  ('bcaae7b5-027f-4676-842e-c796a16f41d0'::uuid, 'CROWN LAND SURVEYORS LTD', 'surveyors', 'Crown Land Surveyors Ltd', NULL, NULL, NULL, FALSE),
  ('1f434ca7-a1ea-488e-be9a-5ebfeba724d0'::uuid, 'EGONGA PLUMBING SOLUTIONS- IGANGA', 'plumbers', 'Egonga Plumbing Solutions- Iganga', NULL, NULL, NULL, FALSE),
  ('3163ca78-3666-4d3d-b850-2692e4bf6e38'::uuid, 'SOLID ENGINEERING AND CONSTRUCTION LIMITED', 'builders', 'Solid Engineering and Construction Limited', NULL, NULL, NULL, FALSE),
  ('8865738c-83d9-46bf-b828-98abee29b26c'::uuid, 'AYJ POWER SERVICES BUSIA LIMITED', 'electricians', 'AYJ Power Services Busia Limited', NULL, NULL, NULL, FALSE),
  ('877ce120-9c69-4635-bd83-aaf9b9752b5f'::uuid, 'HEIGHTS INTERIOR FURNITURE', 'interior_design', 'Heights Interior Furniture', NULL, NULL, NULL, FALSE),
  ('688914cc-c08c-4262-b9e6-33d5a27dd73e'::uuid, 'SWICO SOROTI', 'insurance', 'SWICO Soroti', NULL, NULL, 'swico', FALSE),
  ('d4aa9c6e-db72-45e4-a054-ff4e59933917'::uuid, 'OGUTH ENTERPRISES', 'electricians', 'Oguth Enterprises', NULL, NULL, NULL, FALSE),
  ('ced7b73d-1e1d-43de-b8f0-1b7c54a8ffef'::uuid, 'STRUFIX CONTRACTORS (U) LTD', 'builders', 'Strufix Contractors (U) Ltd', NULL, NULL, NULL, FALSE),
  ('63498670-58ba-4e77-b86c-9b37f9835cac'::uuid, 'MUHA INVESTMENTS LTD', 'movers', 'Muha Investments Ltd', NULL, NULL, NULL, FALSE),
  ('571e2ac0-11d1-4d54-ba1b-f516d8ce0827'::uuid, 'TAJ PROPERTY LINK', 'brokers', 'Taj Property Link', NULL, NULL, NULL, FALSE),
  ('c9d76663-a637-4593-9750-584f0ef5945b'::uuid, 'OILLAND REAL ESTATES LTD', 'brokers', 'Oilland Real Estates Ltd', NULL, NULL, NULL, FALSE),
  ('464404de-1b28-4afb-a0d5-fb80ba562e1a'::uuid, 'RAFA GEOMATIC SOLUTIONS', 'surveyors', 'Rafa Geomatic Solutions', NULL, NULL, NULL, FALSE),
  ('370d10ee-9806-47b2-a2cd-69e447883783'::uuid, 'JOY CURTAINS, BEDDINGS AND INTERIOR DESIGNS', 'interior_design', 'Joy Curtains, Beddings and Interior Designs', NULL, NULL, NULL, FALSE),
  ('b7c7f8a7-51d0-4a88-9882-694cfead41ee'::uuid, 'ANDY FURNITURES AND INTERIOR DESIGNS', 'interior_design', 'Andy Furnitures and Interior Designs', NULL, NULL, NULL, FALSE),
  ('e87c4d27-19a1-429b-ab51-772790d335b4'::uuid, 'MS ELECTRICALS UG', 'electricians', 'MS Electricals UG', NULL, NULL, NULL, FALSE),
  ('9135c745-da9a-4be2-ad98-c60bf22e5527'::uuid, 'LUKANGA ELECTRICAL SERVICES', 'electricians', 'Lukanga Electrical Services', NULL, NULL, NULL, FALSE),
  ('4f36f9d7-2648-4452-94c1-7914093d38c1'::uuid, 'ENOCKSSE ELECTRICAL SERVICES', 'electricians', 'Enocksse Electrical Services', NULL, NULL, NULL, FALSE),
  ('04d9e301-c5d3-4245-a242-5ac4e578360d'::uuid, 'PEARNET CONSTRUCTION COMPANY (u)LTD', 'builders', 'Pearnet Construction Company (U) Ltd', NULL, NULL, NULL, FALSE),
  ('3fb16aa7-857c-4c24-aba9-407783b4da30'::uuid, 'BENZYL ARCHITECTURAL AND ENGINEERING SERVICES', 'architects', 'Benzyl Architectural and Engineering Services', NULL, NULL, NULL, FALSE),
  ('dfcc62da-e1db-47eb-b356-0e5f841379d9'::uuid, 'KUKIPANDE BUSINESS SOLUTION', 'brokers', 'Kukipande Business Solution', NULL, NULL, NULL, FALSE),
  ('55cd8bd5-330d-4c18-9b6c-af44bd15d67b'::uuid, 'BATTERY AND SOLAR SERVICE CENTRE', 'solar', 'Battery and Solar Service Centre', NULL, NULL, NULL, FALSE),
  ('852e56d2-738f-4c1d-847d-0a3c998bd8f8'::uuid, 'JASO POWER CONSULT LTD', 'electricians', 'Jaso Power Consult Ltd', NULL, NULL, NULL, FALSE),
  ('14a94641-3ee1-44ad-830e-675c3f827a03'::uuid, 'DESTINY POWER CONSULT', 'electricians', 'Destiny Power Consult', NULL, NULL, NULL, FALSE),
  ('82015114-0364-49fc-ae1e-b44f9cc706ba'::uuid, 'UPLAND ENTERPRISES & CONSTRUCTION LTD', 'builders', 'Upland Enterprises & Construction Ltd', NULL, NULL, NULL, FALSE),
  ('93ea2002-1ad9-44f9-9d1b-0cc42bbbd2ba'::uuid, 'OMARA DESIGN AND CONSTRUCTION COMPANY LIMITED', 'builders', 'Omara Design and Construction Company Limited', NULL, NULL, NULL, FALSE),
  ('9518c365-9cf9-4130-8ab5-7029b8b36bf1'::uuid, 'EMPRESS NORTHERN REALTORS', 'brokers', 'Empress Northern Realtors', NULL, NULL, NULL, FALSE),
  ('9215dbc9-ff57-4d77-8d81-67c3916f7c40'::uuid, 'JOTHAN INTERIORS COMPANY', 'interior_design', 'Jothan Interiors Company', NULL, NULL, NULL, FALSE),
  ('c15b1e57-d5b7-450b-b54b-fc5095dddf8f'::uuid, 'ATLANTIC ARCHITECTS (U) LTD', 'architects', 'Atlantic Architects (U) Ltd', NULL, NULL, NULL, FALSE),
  ('ea42552e-af90-4376-9969-57e49fc15b83'::uuid, 'M&F REAL ESTATE', 'brokers', 'M&F Real Estate', NULL, NULL, NULL, FALSE),
  ('7cb06b9c-04c9-4e96-9a1c-c678477c663e'::uuid, 'KIKAJAMU PROPERTY MANAGEMENT AND CONSULTANTS COMPANY LIMITED', 'property_managers', 'Kikajamu Property Management and Consultants Company Limited', NULL, NULL, NULL, FALSE),
  ('12e7a674-fc1e-430a-90c7-06df12e8f8b2'::uuid, 'SAGA ELECTRICAL AND POWER LINES SOLUTIONS', 'electricians', 'Saga Electrical and Power Lines Solutions', NULL, NULL, NULL, FALSE),
  ('9e1fe786-56cf-4b9e-92c4-6bdce1abc48a'::uuid, 'JBM ESTATES LTD', 'brokers', 'JBM Estates Ltd', NULL, NULL, NULL, FALSE),
  ('ef2858e6-04a0-484e-ad45-617f4882b878'::uuid, 'CORPORATE SECURITY SERVICES (U) LTD - MBAALE BRANCH', 'security', 'Corporate Security Services (U) Ltd - Mbaale Branch', NULL, NULL, NULL, FALSE),
  ('a9806d40-d42b-4e91-9453-6aa554a5389e'::uuid, 'NOID BRAND INTERIORS & HOME DECORE', 'interior_design', 'Noid Brand Interiors & Home Decore', NULL, NULL, NULL, FALSE),
  ('b589b39d-fd75-4ddd-99a3-4774b3f61b01'::uuid, 'SWICO MBALE', 'insurance', 'SWICO Mbale', NULL, NULL, 'swico', FALSE),
  ('4742353c-86a4-4bc2-a997-0848b7bf618e'::uuid, 'AGOBI DIGITAL LINKS LTD', 'electricians', 'Agobi Digital Links Ltd', NULL, NULL, NULL, FALSE),
  ('ebf6f06a-d5eb-4819-8109-6e93f5b9e355'::uuid, 'DAWA CONSTRUCTION WORKS LTD', 'builders', 'Dawa Construction Works Ltd', NULL, NULL, NULL, FALSE),
  ('34d9d1a1-cda0-4212-aa8d-4748654f2407'::uuid, 'KADUWA CONSTRUCTION COMPANY LIMITED', 'builders', 'Kaduwa Construction Company Limited', NULL, NULL, NULL, FALSE),
  ('1f95f682-c130-46cd-8a42-6679cd9c85e5'::uuid, 'AFUSABUD INVESTMENTS SMC LIMITED', 'brokers', 'Afusabud Investments SMC Limited', NULL, NULL, NULL, FALSE),
  ('0c94d294-4f2d-4b18-8405-7c889e4808dd'::uuid, 'HOPE P''LACEL INV.LTD', 'electricians', 'Hope P''lacel Inv.Ltd', NULL, NULL, NULL, FALSE),
  ('ec945038-47fd-4f72-a8c1-830869031629'::uuid, 'LIBES ELECTRICAL', 'electricians', 'Libes Electrical', NULL, NULL, NULL, FALSE),
  ('9f307cc1-6179-4bdb-94f2-c03242ba2c55'::uuid, 'MASOB D&S ENGINEERING SOLUTIONS', 'electricians', 'Masob D&S Engineering Solutions', NULL, NULL, NULL, FALSE),
  ('d7c08bca-98a7-46bf-9921-4c6848c77a68'::uuid, 'F.A.O ENGINEERING AND CONSTRUCTION CO LTD', 'builders', 'F.A.O Engineering and Construction Co Ltd', NULL, NULL, NULL, FALSE),
  ('914e793a-8766-41bd-95a4-9582e5a05cc9'::uuid, 'PAICAT CONSTRUCTION SERVICES LIMITED', 'builders', 'Paicat Construction Services Limited', NULL, NULL, NULL, FALSE),
  ('ed13bcb9-e24f-428c-8dcb-4bba7139146f'::uuid, 'REWA CONSTRUCTION UG LIMITED', 'builders', 'Rewa Construction UG Limited', NULL, NULL, NULL, FALSE),
  ('beb3b732-74a1-4c08-be43-1a2de79b9900'::uuid, 'LOYI CONCRETE MASTERS LIMITED', 'brokers', 'Loyi Concrete Masters Limited', NULL, NULL, NULL, FALSE),
  ('885b4105-a8dd-4e29-b7cb-f2b803fa8254'::uuid, 'SHAATY COMPANY', 'brokers', 'Shaaty Company', NULL, NULL, NULL, FALSE),
  ('eff77650-aff2-497f-8dcf-7290d9300de8'::uuid, 'GULU ESTATE UGANDA LIMITED', 'brokers', 'Gulu Estate Uganda Limited', NULL, NULL, NULL, FALSE),
  ('94084b43-e054-4128-ab1b-5406be72d716'::uuid, 'SUPER SMART CLEANING SERVICES MBARARA', 'cleaning', 'Super Smart Cleaning Services Mbarara', NULL, NULL, NULL, FALSE),
  ('950a59d0-1847-4ecc-98a4-982437d7fb92'::uuid, 'BMK ELECTRICALS & SOLAR SYSTEMS', 'solar', 'BMK Electricals & Solar Systems', NULL, NULL, NULL, FALSE),
  ('758080fa-1d94-42f7-a64f-da2d81b15c27'::uuid, 'MODERN HOME INTERIORS', 'interior_design', 'Modern Home Interiors', NULL, NULL, NULL, FALSE),
  ('6785496f-d678-408b-b0ac-9aeeeddb54a3'::uuid, 'REAL INTERIOR CONCEPTS', 'interior_design', 'Real Interior Concepts', NULL, NULL, NULL, FALSE),
  ('fe0a68ac-0ffe-411c-ba59-a3c408dd1526'::uuid, 'EYECOR INTERIORS', 'interior_design', 'Eyecor Interiors', NULL, NULL, NULL, FALSE),
  ('b12c6e87-4819-4766-86c2-c0e44edab8e8'::uuid, 'BORATI INTERIORS', 'interior_design', 'Borati Interiors', NULL, NULL, NULL, FALSE),
  ('7efd41c2-c38f-43dd-a18f-ad3474b102ac'::uuid, 'UNIQ INTERIORS AND CONSTRUCTION LTD', 'builders', 'Uniq Interiors and Construction Ltd', NULL, NULL, NULL, FALSE),
  ('6af8e974-d6fb-488b-b25c-11849bd6d7d8'::uuid, 'PHILLIPS REAL ESTATE COMPANY AND PROPERTY MANAGEMENT', 'brokers', 'Phillips Real Estate Company and Property Management', NULL, NULL, NULL, FALSE),
  ('10ea0447-26aa-4e72-98fb-c7672c4e354c'::uuid, 'BLUE RISE(U) LTD', 'electricians', 'Blue Rise(U) Ltd', NULL, NULL, NULL, FALSE),
  ('c333566f-af23-4d86-9a80-67a5d81edfb3'::uuid, 'UEDCL MBARARA OFFICE', 'electricians', 'UEDCL Mbarara Office', NULL, NULL, NULL, FALSE),
  ('ab92efca-b343-4dc6-8462-ec0a56bd217c'::uuid, 'ENERGIES FOR BUILDING COMMUNITIES', 'electricians', 'Energies for Building Communities', NULL, NULL, NULL, FALSE),
  ('6ac7e8d2-2ffa-44ae-8652-9651daa27c01'::uuid, 'DUSMAN CONTRACTORS', 'builders', 'Dusman Contractors', NULL, NULL, NULL, FALSE),
  ('b5a18f26-6f82-481a-8ea1-d6ea8214a6cb'::uuid, 'B E L CONSTRUCTION LIMITED', 'builders', 'B E L Construction Limited', NULL, NULL, NULL, FALSE),
  ('afb4629d-2bc7-44be-9888-953a2e4d20c4'::uuid, 'PIUSTIC CONSTRUCTION AND COMPOUND DESIGNERS', 'builders', 'Piustic Construction and Compound Designers', NULL, NULL, NULL, FALSE),
  ('b243d190-8eec-4ca4-b596-83b054453ae2'::uuid, 'KENISHA CONSTRUCTION UGANDA LTD', 'builders', 'Kenisha Construction Uganda Ltd', NULL, NULL, NULL, FALSE),
  ('da8f0cde-6de5-4c1d-9bdf-ae82448d0dc2'::uuid, 'THE WESTSIDE APARTMENTS', 'brokers', 'The Westside Apartments', NULL, NULL, NULL, FALSE),
  ('7f5bb269-9c02-497d-aa91-4f1a6e8a7e95'::uuid, 'BRIGHT LUCRATIVES LIMITED "REAL ESTATES"', 'brokers', 'Bright Lucratives Limited "Real Estates"', NULL, NULL, NULL, FALSE),
  ('d9bf9481-5d22-44bc-a0fe-2c8f3211bb24'::uuid, 'NEMBABAZI REAL ESTATES', 'brokers', 'Nembabazi Real Estates', NULL, NULL, NULL, FALSE),
  ('f72f3c23-390f-49ca-96bc-feccf6db4bdd'::uuid, 'BAWA PLUMBING SOLUTIONS JINJA CITY UGANDA', 'plumbers', 'Bawa Plumbing Solutions Jinja City Uganda', NULL, NULL, NULL, FALSE),
  ('3ed6b65f-57c3-4fbf-8be1-d6f3ba78acb0'::uuid, 'MAWOOGOLE CONSTRUCTION COMPANY LTD', 'builders', 'Mawoogole Construction Company Ltd', NULL, NULL, NULL, FALSE),
  ('67217c5a-c4e0-40d5-9054-ac50cd74f3e3'::uuid, 'MICHEAL INVESTMENTS', 'brokers', 'Micheal Investments', NULL, NULL, NULL, FALSE),
  ('f1287f79-fb96-4b79-ac80-b5b4c309c8ba'::uuid, 'MUKONO SOLAR UG', 'solar', 'Mukono Solar UG', NULL, NULL, NULL, FALSE),
  ('46b0f8ac-5862-4e1a-95e2-600fc85e845b'::uuid, 'NAAM SUPREME PAINTING AND INTERIORS UGANDA LIMITED', 'interior_design', 'Naam Supreme Painting and Interiors Uganda Limited', NULL, NULL, NULL, FALSE),
  ('308e8533-6ee1-45df-a76f-4ddb8f635922'::uuid, 'KMK INTERIOR DESIGNERS', 'interior_design', 'KMK Interior Designers', NULL, NULL, NULL, FALSE),
  ('1d6b5072-3bd5-4126-8d8c-85109018980c'::uuid, 'KASIM PLUMBING SERVICES LTD', 'plumbers', 'Kasim Plumbing Services Ltd', NULL, NULL, NULL, FALSE),
  ('7d5c5999-85c2-4266-a745-75cf995c2b8d'::uuid, 'DARRIC CLEANING SERVICES', 'cleaning', 'Darric Cleaning Services', NULL, NULL, NULL, FALSE),
  ('24ba6706-014c-49ee-b947-fd0baf1e17b8'::uuid, 'ASKAR SECURITY SERVICES, LWEZA', 'security', 'Askar Security Services, Lweza', NULL, NULL, NULL, FALSE),
  ('4418885f-0a59-4907-a1df-6993b06f08ad'::uuid, 'DT SOLAR & CCTV CAMERA SYSTEMS STORE', 'solar', 'DT Solar & CCTV Camera Systems Store', NULL, NULL, NULL, FALSE),
  ('7193503a-93eb-40a8-a418-c41e7d61c5cb'::uuid, 'VRON SOLAR', 'solar', 'Vron Solar', NULL, NULL, NULL, FALSE),
  ('5eb010e4-1936-4820-93d1-51774c336098'::uuid, 'LUK SOLAR LTD', 'solar', 'Luk Solar Ltd', NULL, NULL, NULL, FALSE),
  ('656846b5-bc13-4f97-8d07-86c3b80f40a1'::uuid, 'VRON INTERIOR DESIGNS', 'interior_design', 'Vron Interior Designs', NULL, NULL, NULL, FALSE),
  ('26570de2-3e5a-4c6c-b187-5d411fac2a43'::uuid, 'GLAM INTERIORS AND DECOR UGANDA LIMITED', 'interior_design', 'Glam Interiors and Decor Uganda Limited', NULL, NULL, NULL, FALSE),
  ('fd078895-90e2-4bbe-9bd9-b4d36d3b9c03'::uuid, 'MR.MAF INTERIOR COMPANY LIMITED', 'interior_design', 'Mr.Maf Interior Company Limited', NULL, NULL, NULL, FALSE),
  ('92e41d38-c196-470a-b85a-2f6e04494da5'::uuid, 'TIM PLUMBERS', 'plumbers', 'Tim Plumbers', NULL, NULL, NULL, FALSE),
  ('67f67e7b-3858-4d9e-898c-f78eccb44f3b'::uuid, 'IDEAL PLUMBERS CO LTD', 'plumbers', 'Ideal Plumbers Co Ltd', NULL, NULL, NULL, FALSE),
  ('0f0c3975-b602-4d8e-b911-6e50e1e3a0c9'::uuid, 'MUHOOLI PLUMBING SERVICES', 'plumbers', 'Muhooli Plumbing Services', NULL, NULL, NULL, FALSE),
  ('fb777567-d4ec-41cc-9c95-6a66dcfb541f'::uuid, 'RASHID PLUMBING SERVICES', 'plumbers', 'Rashid Plumbing Services', NULL, NULL, NULL, FALSE),
  ('57fa702c-c038-4c8f-857e-aa0d66c555a7'::uuid, 'KIZITO UKASHA ELECTRIC', 'electricians', 'Kizito Ukasha Electric', NULL, NULL, NULL, FALSE),
  ('9b9c9119-b9ab-437f-810d-e00cc99e54a7'::uuid, 'COMFORT ELECTRICAL ENGINEERING (C.E.E)', 'electricians', 'Comfort Electrical Engineering (C.E.E)', NULL, NULL, NULL, FALSE),
  ('bd109666-3a33-4d33-af66-9c03ee9c4fef'::uuid, 'SSENSWA ELECTRIC MART', 'electricians', 'Ssenswa Electric Mart', NULL, NULL, NULL, FALSE),
  ('4fb2ab93-3095-4278-9ddd-62d768b1a787'::uuid, 'MK ELECTRICAL CONTRACTORS UGANDA', 'electricians', 'MK Electrical Contractors Uganda', NULL, NULL, NULL, FALSE),
  ('98471a34-f6fb-436c-bdb8-3b2b54e46dca'::uuid, 'KNB ELECTRICAL SERVICES', 'electricians', 'KNB Electrical Services', NULL, NULL, NULL, FALSE),
  ('bd181fa2-3aca-4609-9105-d5dffc94570d'::uuid, 'FREMA ARCHITECTS UG', 'architects', 'Frema Architects UG', NULL, NULL, NULL, FALSE),
  ('f186658d-5d70-418e-ac63-8134f4787514'::uuid, 'GENUINE ESTATES UGANDA LTD', 'brokers', 'Genuine Estates Uganda Ltd', NULL, NULL, NULL, FALSE),
  ('39a18a34-ecc0-4714-b633-de7d38671e0a'::uuid, 'NEWTON ELECTRICAL CONTRACTORS', 'electricians', 'Newton Electrical Contractors', NULL, NULL, NULL, FALSE),
  ('dc8c37d9-b080-4416-a95b-3490a79945cd'::uuid, 'SAMCO ELECTRICAL SERVICES', 'electricians', 'Samco Electrical Services', NULL, NULL, NULL, FALSE),
  ('cddc97d6-aff4-4c74-b2d5-50e2e066a2c1'::uuid, 'SERN ELECTRIC', 'electricians', 'Sern Electric', NULL, NULL, NULL, FALSE),
  ('9647ff4d-009e-41c9-b77b-00fbd2b6ff86'::uuid, 'ANDE_TECH POWER HUB', 'electricians', 'Ande_Tech Power Hub', NULL, NULL, NULL, FALSE),
  ('e9adab44-acae-4bcf-83de-98a612caad00'::uuid, 'AARONS ELECTRICAL SERVICES.UG', 'electricians', 'Aarons Electrical Services UG', NULL, NULL, NULL, FALSE),
  ('0876af32-f5a6-4f7d-a945-32bd20bede86'::uuid, 'WILL POWER VALUERS & SURVEYORS', 'surveyors', 'Will Power Valuers & Surveyors', NULL, NULL, NULL, FALSE),
  ('6dc62f58-f677-4508-91dc-e460d3d88935'::uuid, 'SPARKS ELECTRICALS SERVICES', 'electricians', 'Sparks Electricals Services', NULL, NULL, NULL, FALSE),
  ('c3bfd6fb-d739-483b-bf1c-e035bbf848be'::uuid, 'SETTEX ELECTRICALS LTD', 'electricians', 'Settex Electricals Ltd', NULL, NULL, NULL, FALSE),
  ('400afafb-1881-4326-bbe3-d1c604f38dfc'::uuid, 'MUHAMMED .K .THE POWER GUYS ELECTRICAL ENGINEERING CONSULTING COMPANY LTD', 'electricians', 'Muhammed .K .The Power Guys Electrical Engineering Consulting Company Ltd', NULL, NULL, NULL, FALSE),
  ('99f5ed81-174e-487e-b3c3-978b46a45364'::uuid, 'LUTON CONSTRUCTION AND TECHNICAL SERVICES', 'builders', 'Luton Construction and Technical Services', NULL, NULL, NULL, FALSE),
  ('75968b1a-4aef-477f-b88b-174e8ec7996f'::uuid, 'MARKSMEN CONSTRUCTION & REAL ESTATE (U) LTD', 'builders', 'Marksmen Construction & Real Estate (U) Ltd', NULL, NULL, NULL, FALSE),
  ('f364bd19-3ada-4b98-af96-d8c91ba0b84c'::uuid, 'PHOENIX ADVOCATES', 'property_lawyers', 'Phoenix Advocates', NULL, NULL, NULL, FALSE),
  ('61fef2b3-263b-4a33-8b37-997eefe52e81'::uuid, 'VOICE PROPERTY ESTATES LIMITED', 'brokers', 'Voice Property Estates Limited', NULL, NULL, NULL, FALSE),
  ('6f96bf00-ee9a-47cf-9db5-ada22d096890'::uuid, 'JOLOPAL PROPERTIES AND REAL ESTATE CONSULTANTS', 'brokers', 'Jolopal Properties and Real Estate Consultants', NULL, NULL, NULL, FALSE),
  ('0a6b522f-91bd-4bea-91f0-dc5d27da2cfd'::uuid, 'QHISA CONSTRUCTION', 'builders', 'Qhisa Construction', NULL, NULL, NULL, FALSE),
  ('ec972658-5c2e-4a1a-9403-a3c1c6911b8e'::uuid, 'RAFEX CONTRACTORS & REAL ESTATE CONSULTANTS LTD', 'builders', 'Rafex Contractors & Real Estate Consultants Ltd', NULL, NULL, NULL, FALSE),
  ('86e551ea-3f6d-42c6-b019-c2f57fcd1365'::uuid, 'KATS AND DEO SURVEYS LTD', 'surveyors', 'Kats and Deo Surveys Ltd', NULL, NULL, NULL, FALSE),
  ('bd831164-4732-4997-8948-138c6636f433'::uuid, 'TRAINED HOUSEMAIDS AND HOME CLEANERS UGANDA', 'cleaning', 'Trained Housemaids and Home Cleaners Uganda', NULL, NULL, NULL, FALSE),
  ('44b7ea43-0267-407d-a989-9a9c5159d294'::uuid, 'FRISPY CLEANING AND FUMIGATION AGENCY', 'cleaning', 'Frispy Cleaning and Fumigation Agency', NULL, NULL, NULL, FALSE),
  ('0e6bad55-615d-406b-a8ed-3e319d6116c4'::uuid, 'MUDDY CLEANING AND FUMIGATION SERVICES', 'cleaning', 'Muddy Cleaning and Fumigation Services', NULL, NULL, NULL, FALSE),
  ('3b2ed3dc-2cce-4fdd-8585-2a7481abf53a'::uuid, 'MAGNUM SECURITY COMPANY LIMITED', 'security', 'Magnum Security Company Limited', NULL, NULL, NULL, FALSE),
  ('b2908173-64ed-4ee2-8885-6b0eae743e1d'::uuid, 'KC SOLAR SOLUTIONS UGANDA', 'solar', 'KC Solar Solutions Uganda', NULL, NULL, NULL, FALSE),
  ('33d05a9a-7344-4d46-b0b7-b1f20c5ae970'::uuid, 'FELICITY SOLAR UGANDA LTD', 'solar', 'Felicity Solar Uganda Ltd', NULL, NULL, 'felicity-solar', TRUE),
  ('ff70abae-f9e7-456e-bb81-6474c8f91d66'::uuid, 'SRNE SOLAR UGANDA NAKASERO', 'solar', 'SRNE Solar Uganda Nakasero', NULL, NULL, NULL, FALSE),
  ('02b78ed5-8c3a-4e17-a9a6-f897501d3f73'::uuid, 'SOLAR ENERGY UGANDA', 'solar', 'Solar Energy Uganda', NULL, NULL, NULL, FALSE),
  ('cb1dd13f-a518-477b-8a11-e8ee523c6f66'::uuid, 'DOM SIGNATURE INTERIORS AND CONSTRUCTION COMPANY', 'builders', 'Dom Signature Interiors and Construction Company', NULL, NULL, NULL, FALSE),
  ('271c7327-adb0-457c-8755-47796f4c3594'::uuid, 'TIMELINE INTERIORS AND SERVICES LTD.', 'interior_design', 'Timeline Interiors and Services Ltd.', NULL, NULL, NULL, FALSE),
  ('e3bbc1bd-61df-48cd-9d84-2e5c900eb539'::uuid, 'SNUG SPACE INTERIOR AND EXTERIOR', 'interior_design', 'Snug Space Interior and Exterior', NULL, NULL, NULL, FALSE),
  ('ad967fa1-3074-4121-b77d-bda64b13a49a'::uuid, 'SMART MOVERS UGANDA', 'movers', 'Smart Movers Uganda', NULL, NULL, NULL, FALSE),
  ('36e12cdf-d616-40af-9f4a-f546654e3ee0'::uuid, 'TEBBS INSURANCE AGENCY', 'insurance', 'Tebbs Insurance Agency', NULL, NULL, NULL, FALSE),
  ('22cd9f8a-6cc9-4048-ad5a-6fae431ee1dd'::uuid, 'NEWCITY INSURANCE PARTNERS', 'insurance', 'Newcity Insurance Partners', NULL, NULL, NULL, FALSE),
  ('4d10360a-e3c1-45b3-b3d2-27cf5a12ce95'::uuid, 'SKY REINSURANCE BROKERS LIMITED', 'insurance', 'Sky Reinsurance Brokers Limited', NULL, NULL, NULL, FALSE),
  ('44ab2eed-32a4-4521-8c36-6a49729b727d'::uuid, 'S AND J PLUMBERS UG LTD', 'plumbers', 'S and J Plumbers UG Ltd', NULL, NULL, NULL, FALSE),
  ('bdd92a36-bb68-4054-86aa-82cf737fcf27'::uuid, 'BYAKI NEXUS CONSTRUCTION COMPANY', 'builders', 'Byaki Nexus Construction Company', NULL, NULL, NULL, FALSE),
  ('90b6381f-8f3f-4909-a919-4da0f086122c'::uuid, 'G.EMPIRE CONSTRUCTION COMPANY', 'builders', 'G.Empire Construction Company', NULL, NULL, NULL, FALSE),
  ('78049e44-adb2-4fb0-9f83-c5b1adfed087'::uuid, 'KALIKUMUTIMA & CO. ADVOCATES', 'property_lawyers', 'Kalikumutima & Co. Advocates', NULL, NULL, NULL, FALSE),
  ('e415b396-a5c4-4cb5-91fa-7e02c474e97b'::uuid, 'ARNOLD ASHABA - THE UGANDAN LAWYER / ATTORNEY', 'property_lawyers', 'Arnold Ashaba - The Ugandan Lawyer / Attorney', NULL, NULL, NULL, FALSE),
  ('c181efff-3a7a-4ac6-a31a-768d2540b79a'::uuid, 'NYUMBAYO', 'brokers', 'Nyumbayo', NULL, NULL, NULL, FALSE),
  ('9d86e0cc-c34a-467f-9dd6-b2fde0928a98'::uuid, 'DDIIRO PROPERTY CONSULTANTS LIMITED .', 'brokers', 'Ddiiro Property Consultants Limited .', NULL, NULL, NULL, FALSE),
  ('7001b4aa-77f5-47c7-a8e2-a2038322f5a9'::uuid, 'INTERIOR MASTERS', 'interior_design', 'Interior Masters', NULL, NULL, NULL, FALSE),
  ('da2be1a2-2ef9-483f-bc9a-5c0628426188'::uuid, 'TOM ARTISTS & PAINTERS', 'painters', 'Tom Artists & Painters', NULL, NULL, NULL, FALSE),
  ('782dbdf1-c5bf-48b4-8818-0a8aa09475c5'::uuid, 'SSEDIKA REAL ESTATE PROPERTY DEALERS', 'brokers', 'Ssedika Real Estate Property Dealers', NULL, NULL, NULL, FALSE),
  ('8bb5b321-bd97-4784-929f-1e3498d2fa9f'::uuid, 'INLAND PROPERTY AGENTS LTD', 'brokers', 'Inland Property Agents Ltd', NULL, NULL, NULL, FALSE),
  ('6d809f60-b8dd-4366-83b6-8c318a95543e'::uuid, 'PALNAM SURVEYING NETWORK', 'surveyors', 'Palnam Surveying Network', NULL, NULL, NULL, FALSE),
  ('18250fed-43e2-4fcc-8683-314eabb6e266'::uuid, 'SURVPOINT SURVEY CONSULTS', 'surveyors', 'Survpoint Survey Consults', NULL, NULL, NULL, FALSE),
  ('143c110b-1def-483e-83fd-effd320b945a'::uuid, 'A-CLASS CLEANING COMPANY LTD', 'cleaning', 'A-Class Cleaning Company Ltd', NULL, NULL, NULL, FALSE),
  ('d28f8247-e04a-48f5-a0e2-3a71d7a9c7c2'::uuid, 'AS-M ELECTRICALS', 'electricians', 'As-M Electricals', NULL, NULL, NULL, FALSE),
  ('25ed88ed-f304-40d4-a073-de529d9d6bf1'::uuid, 'BAKAIMA REAL ESTATE AGENTS', 'brokers', 'Bakaima Real Estate Agents', NULL, NULL, NULL, FALSE),
  ('32759b12-b32c-47b3-92ac-fe169bdbb9fd'::uuid, 'BK ELECTRICAL SERVICES LTD', 'electricians', 'BK Electrical Services Ltd', NULL, NULL, NULL, FALSE),
  ('d1bb70d7-5d1e-4ab3-89fe-47390c0a67d4'::uuid, 'BLESSING VENTURE LTD', 'brokers', 'Blessing Venture Ltd', NULL, NULL, NULL, FALSE),
  ('78a7b10d-6469-4723-a859-417c64c5d700'::uuid, 'BWENGYE & ASSOCIATED ADVOCATES', 'property_lawyers', 'Bwengye & Associated Advocates', NULL, NULL, NULL, FALSE),
  ('9fb816ba-8d02-434f-b334-c01a52f39c42'::uuid, 'CANTILEVER CONTRACTORS LIMITED', 'builders', 'Cantilever Contractors Limited', NULL, NULL, NULL, FALSE),
  ('16d860b7-5c8c-431e-acdb-55d24e3851a3'::uuid, 'CCTV CAMERA SECURITY UGANDA', 'security', 'CCTV Camera Security Uganda', NULL, NULL, NULL, FALSE),
  ('f90bb3ce-a820-4e6e-a0be-de72c5899c3b'::uuid, 'DASH PROPERTIES UGANDA', 'brokers', 'Dash Properties Uganda', NULL, NULL, NULL, FALSE),
  ('6aa811f1-84a9-4f4e-b667-7bdbf4cb3337'::uuid, 'DEROTECH ELECTRICAL SOLUTIONS', 'electricians', 'Derotech Electrical Solutions', NULL, NULL, NULL, FALSE),
  ('aedac3d5-4696-4d90-9be4-88598cc7682f'::uuid, 'DIT ADVOCATES', 'property_lawyers', 'DIT Advocates', NULL, NULL, NULL, FALSE),
  ('d06bbccc-626b-4ce5-a05f-84994ecb7ef8'::uuid, 'DOUBLE HEIGHTS REAL ESTATE CONSULT LTD', 'brokers', 'Double Heights Real Estate Consult Ltd', NULL, NULL, NULL, FALSE),
  ('73d9c19b-6bda-4a75-8625-62878477bcd7'::uuid, 'EASTON CLEANING AND FUMIGATION SERVCES', 'cleaning', 'Easton Cleaning and Fumigation Servces', NULL, NULL, NULL, FALSE),
  ('7169ec0f-9d02-4597-aa7e-12c065f98c46'::uuid, 'EDEN CONTRACTORS UGANDA 🇺🇬', 'builders', 'Eden Contractors Uganda 🇺🇬', NULL, NULL, NULL, FALSE),
  ('bdb56206-2de2-4219-a80e-be93b6ca3a90'::uuid, 'ELECTRICAL INSTALLATION SERVICE', 'electricians', 'Electrical Installation Service', NULL, NULL, NULL, FALSE),
  ('d20c87b3-ec71-4614-a33a-4e42280575b4'::uuid, 'EXCEL INSURANCE HOIMA BRANCH', 'insurance', 'Excel Insurance Hoima Branch', NULL, NULL, 'excel-insurance', FALSE),
  ('0483935d-5389-4c52-94b3-ed5ccabb918b'::uuid, 'FLEXI PAINTERS KAMPALA', 'painters', 'Flexi Painters Kampala', NULL, NULL, NULL, FALSE),
  ('8c33e491-16fe-497a-bd35-9c7860d86ad8'::uuid, 'GEAR ELECTRICAL CONTRACTORS LTD', 'electricians', 'Gear Electrical Contractors Ltd', NULL, NULL, NULL, FALSE),
  ('57fdc749-2363-444b-a7d1-145deb9e594e'::uuid, 'GEORIAN CONSTRUCTION SERVICES LIMITED', 'builders', 'Georian Construction Services Limited', NULL, NULL, NULL, FALSE),
  ('3e9823a3-4899-4452-8064-f733508dbba3'::uuid, 'GODELECTRICS', 'electricians', 'Godelectrics', NULL, NULL, NULL, FALSE),
  ('4f83497f-fd55-4d1e-a576-464de229924b'::uuid, 'HOODVILLE ELECTRICAL REPAIRS', 'electricians', 'Hoodville Electrical Repairs', NULL, NULL, NULL, FALSE),
  ('a2ce0b3e-2a29-4265-8e8e-243fcc0d7aee'::uuid, 'ILUKOR ADVOCATES & SOLICITORS', 'property_lawyers', 'Ilukor Advocates & Solicitors', NULL, NULL, NULL, FALSE),
  ('3c3c280c-03fc-4747-8e8f-8006924e8d8d'::uuid, 'INTERNATIONAL MODERN PAINTING COMPANY', 'painters', 'International Modern Painting Company', NULL, NULL, NULL, FALSE),
  ('879b6995-e1b7-4d96-962e-1912e35ed47a'::uuid, 'JAMES CONSTRUCTION MATERIAL SUPPLIER', 'builders', 'James Construction Material Supplier', NULL, NULL, NULL, FALSE),
  ('527dce7f-5087-41eb-a3e1-39ca9bbf9606'::uuid, 'JCR ELECTRONICS AND ELECTRICAL ENGINEERING', 'electricians', 'JCR Electronics and Electrical Engineering', NULL, NULL, NULL, FALSE),
  ('c611e8b0-2244-4584-a57c-557b0a572980'::uuid, 'KAISON CONSTRUCTION COMPANY', 'builders', 'Kaison Construction Company', NULL, NULL, NULL, FALSE),
  ('d6010a85-bb99-496e-a2e7-5050cede08a9'::uuid, 'KAKASA CONSTRUCTION COMPANY LIMITED', 'builders', 'Kakasa Construction Company Limited', NULL, NULL, NULL, FALSE),
  ('4e594aa2-9ec7-4c1b-be52-f85635e520eb'::uuid, 'KALAZO ELECTRICAL SERVICES', 'electricians', 'Kalazo Electrical Services', NULL, NULL, NULL, FALSE),
  ('02aff2c7-65a2-464f-9086-4ff832480f28'::uuid, 'KAS ELECTRICAL & PLUMBING SERVICES', 'electricians', 'Kas Electrical & Plumbing Services', NULL, NULL, NULL, FALSE),
  ('68bba2e6-e7b9-432d-b1ce-cc50d46389cb'::uuid, 'KATGO CONSTRUCTION COMPANY (U) LTD', 'builders', 'Katgo Construction Company (U) Ltd', NULL, NULL, NULL, FALSE),
  ('f92ad7c7-8ace-4c85-b258-47d5194b72ba'::uuid, 'K-JEREMYX ELECTRICALS', 'electricians', 'K-Jeremyx Electricals', NULL, NULL, NULL, FALSE),
  ('1d33b2e5-85e8-4840-8adb-41b84b7e4cc5'::uuid, 'KOMS ELECTRICAL COMPANY', 'electricians', 'Koms Electrical Company', NULL, NULL, NULL, FALSE),
  ('8bab078d-8fdf-4ec5-bf10-27626428fdb3'::uuid, 'LOMAX ASSOCIATED ADVOCATES', 'property_lawyers', 'Lomax Associated Advocates', NULL, NULL, NULL, FALSE),
  ('923dc6be-f85a-48c0-bd74-169ca35ed404'::uuid, 'LUCKY FAMILY ELECTRICALS', 'electricians', 'Lucky Family Electricals', NULL, NULL, NULL, FALSE),
  ('2d032ffc-6e0b-4cdf-8e95-533e50a8f522'::uuid, 'LUKMAN ENGINEERING AND CONSTRUCTION ASSOCIATES LTD', 'builders', 'Lukman Engineering and Construction Associates Ltd', NULL, NULL, NULL, FALSE),
  ('943f7423-3089-4998-91e7-2e1b3814381f'::uuid, 'LUZZE PROPERTY CONSULTANTS LTD', 'brokers', 'Luzze Property Consultants Ltd', NULL, NULL, NULL, FALSE),
  ('4151be75-de34-4f9b-9298-ced6dda97bd4'::uuid, 'MJ CONSTRUCTION COMPANY', 'builders', 'MJ Construction Company', NULL, NULL, NULL, FALSE),
  ('16502aad-f796-4b12-b811-fd1949a99067'::uuid, 'MUTAKI de ELECTRICIAN', 'electricians', 'Mutaki de Electrician', NULL, NULL, NULL, FALSE),
  ('66fc2f6d-2f6f-478e-9e53-4f50ce4835b8'::uuid, 'NAMARA MUSINGUZI & Co ADVOCATES', 'property_lawyers', 'Namara Musinguzi & Co Advocates', NULL, NULL, NULL, FALSE),
  ('2013680a-5ded-4ef1-b760-cfb5d04105f9'::uuid, 'NEXA ELECTRICAL CONTRACTORS LTD', 'electricians', 'Nexa Electrical Contractors Ltd', NULL, NULL, NULL, FALSE),
  ('4ac90ef0-31a7-464e-803d-f4b63ef87ed8'::uuid, 'NXT CONSTRUCTION COMPANY', 'builders', 'NXT Construction Company', NULL, NULL, NULL, FALSE),
  ('bbb99274-caee-4110-858c-c56857e52a22'::uuid, 'OMEGA GENERAL ELECTRICALS LTD', 'electricians', 'Omega General Electricals Ltd', NULL, NULL, NULL, FALSE),
  ('e27520ff-d788-4cba-9477-45ae8359470a'::uuid, 'OMURON & COMPANY ADVOCATES', 'property_lawyers', 'Omuron & Company Advocates', NULL, NULL, NULL, FALSE),
  ('c53dd6ca-b5d1-4e4d-83d6-46fd255a893b'::uuid, 'ONE SOUND EVENTS & ELECTRICAL SERVICES', 'electricians', 'One Sound Events & Electrical Services', NULL, NULL, NULL, FALSE),
  ('f1000892-e158-4738-942a-49ba5b3cd485'::uuid, 'OSH ADVOCATES', 'property_lawyers', 'OSH Advocates', NULL, NULL, NULL, FALSE),
  ('f9c0a47f-ab59-493a-b470-cad91aaad96e'::uuid, 'PAINTERS OF UGANDA', 'painters', 'Painters of Uganda', NULL, NULL, NULL, FALSE),
  ('7a021778-e2e3-4f81-aeef-959fabfe1a2d'::uuid, 'PROELIUM ADVOCATES', 'property_lawyers', 'Proelium Advocates', NULL, NULL, NULL, FALSE),
  ('20141c44-2b25-40e8-97d4-4585eebae763'::uuid, 'R.KASAIJA & PARTNERS ADVOCATES', 'property_lawyers', 'R.Kasaija & Partners Advocates', NULL, NULL, NULL, FALSE),
  ('51cca6b2-dc54-48d1-a47e-0903b43ada81'::uuid, 'RK ENGINEERING AND CONSTRUCTION COMPANY U LIMITED', 'builders', 'RK Engineering and Construction Company U Limited', NULL, NULL, NULL, FALSE),
  ('8dab4382-c7cf-4266-b4ea-d39398c57563'::uuid, 'RMS ELECTRICAL TECHNICIANS', 'electricians', 'RMS Electrical Technicians', NULL, NULL, NULL, FALSE),
  ('da956946-b18a-4449-91a8-7583b6a8b06f'::uuid, 'RON ELECTRICAL CONTRACTORS', 'electricians', 'Ron Electrical Contractors', NULL, NULL, NULL, FALSE),
  ('dbbe4e5d-f02d-4d1f-8cc2-6880d6d6070b'::uuid, 'ROOFMAN UG CONSTRUCTORS LTD THE ROOFING AND CONSTRUCTION ENGINEERS OF UGANDA', 'builders', 'Roofman UG Constructors Ltd the Roofing and Construction Engineers of Uganda', NULL, NULL, NULL, FALSE),
  ('8b374fcb-f25f-434e-9598-6dd8a09544bf'::uuid, 'SALIPHINA PROPERTIES', 'brokers', 'Saliphina Properties', NULL, NULL, NULL, FALSE),
  ('dce6a29d-14a3-4d5b-8c74-7e6e0fb343e4'::uuid, 'SARUT ELECTRICAL SUPPLIES AND CONSTRUCTION LTD', 'electricians', 'Sarut Electrical Supplies and Construction Ltd', NULL, NULL, NULL, FALSE),
  ('15d9e355-3978-42af-a89c-e8a5219c5c5f'::uuid, 'SEMA PROPERTIES LIMITIED', 'brokers', 'Sema Properties Limitied', NULL, NULL, NULL, FALSE),
  ('28e21ee1-825c-407d-9079-1a470cc1129e'::uuid, 'SKY MOVERS UGANDA', 'movers', 'Sky Movers Uganda', NULL, NULL, NULL, FALSE),
  ('220a5b5d-a4bf-4966-8221-d039b97bb9bd'::uuid, 'SUBLIME MOVERS', 'movers', 'Sublime Movers', NULL, NULL, NULL, FALSE),
  ('2dd16238-6da1-4d76-a4e9-905275d13562'::uuid, 'TAP ESTATE', 'brokers', 'Tap Estate', NULL, NULL, NULL, FALSE),
  ('33f27189-0eff-48ad-8471-011060a5bad3'::uuid, 'TB ESTATES', 'brokers', 'TB Estates', NULL, NULL, NULL, FALSE),
  ('cc771a4d-917d-48ae-8083-4f41b33ffe43'::uuid, 'TERITO PROPERTY CONSULTANTS', 'brokers', 'Terito Property Consultants', NULL, NULL, NULL, FALSE),
  ('9ba380bb-f936-4549-92fd-3a9b8db98f65'::uuid, 'TIMON ELECTRICALS', 'electricians', 'Timon Electricals', NULL, NULL, NULL, FALSE),
  ('f0fd53c2-9e01-4817-8505-ebecb8f81849'::uuid, 'UNIQUE PLUMBERS UGANDA LTD', 'plumbers', 'Unique Plumbers Uganda Ltd', NULL, NULL, NULL, FALSE),
  ('dd48913c-ea4d-4329-8942-8f38730ec38c'::uuid, 'WAMELI & CO. ADVOCATES AND SOLICITORS', 'property_lawyers', 'Wameli & Co. Advocates and Solicitors', NULL, NULL, NULL, FALSE),
  ('f9bbe7f7-5f3d-4b3f-a6e0-608c3ad9c645'::uuid, 'SolarNow Branch Iganga', 'solar', NULL, NULL, NULL, 'solarnow', FALSE),
  ('ab527337-1f1b-4790-bf53-4a44ba9de2bc'::uuid, 'Solarnow Uganda limited', 'solar', NULL, NULL, NULL, 'solarnow', TRUE),
  ('a44aefee-dcfc-4aa6-a7f0-c80670fb959c'::uuid, 'Elgon United Surveyors and Engineers', 'surveyors', NULL, NULL, NULL, 'elgon-united-surveyors', TRUE),
  ('6c4b8eee-386e-41dc-9132-8d8dbcdb43a4'::uuid, 'Elgon United Surveyors and Engineers (EUSE)', 'surveyors', NULL, NULL, NULL, 'elgon-united-surveyors', FALSE),
  ('bb0aa491-925c-439e-8f95-19c095ddba56'::uuid, 'Felicity solar Jinja branch', 'solar', NULL, NULL, NULL, 'felicity-solar', FALSE),
  ('e3b463be-3202-4d7f-9e13-6a58d48d851f'::uuid, 'Costa Construction Services Ltd', 'builders', NULL, NULL, NULL, 'costa-construction', TRUE),
  ('5139936a-d0bb-463c-91c8-e58510c67417'::uuid, 'COSTA CONSTRUCTION SERVICES - Namanve Workshop', 'builders', NULL, NULL, NULL, 'costa-construction', FALSE),
  ('f22e9c4a-5daf-47b9-be18-6f0de76aa243'::uuid, 'Excel Insurance Limited', 'insurance', NULL, NULL, NULL, 'excel-insurance', TRUE),
  ('6e54fba7-df2c-4d85-bd37-f1441a9757df'::uuid, 'Housing Finance Bank - Head Office', 'mortgage_providers', NULL, NULL, NULL, 'housing-finance-bank', TRUE),
  ('b316ff66-c9d1-4e50-9137-b853b051abd0'::uuid, 'Housing Finance Bank | Kikuubo Branch', 'mortgage_providers', NULL, NULL, NULL, 'housing-finance-bank', FALSE),
  ('1f6f89e7-4482-4830-9b2c-4dd584e62995'::uuid, 'NIC Insurance Hoima', 'insurance', NULL, NULL, NULL, 'nic-insurance', FALSE),
  ('1bdfb1ba-4d50-46ff-90fb-d2ed0dfa59d7'::uuid, 'NIC Insurance Uganda', 'insurance', NULL, NULL, NULL, 'nic-insurance', TRUE);

DO $do_181$
DECLARE
  n_targets integer;
  n_renamed integer;
  n_recategorised integer;
  n_hidden integer;
  n_grouped integer;
  n_folded integer;
BEGIN
  IF current_setting('app.country_code', true) IS DISTINCT FROM 'UG' THEN
    RAISE NOTICE 'marketplace_cleanup_181 skipped: app.country_code is not UG';
    RETURN;
  END IF;

  CREATE TEMP TABLE marketplace_cleanup_181_targets ON COMMIT DROP AS
  SELECT p.*
  FROM marketplace_cleanup_181_plan p
  JOIN marketplace_businesses b ON b.id = p.business_id
  WHERE b.status = 'live'
    AND NOT EXISTS (
      SELECT 1 FROM marketplace_cleanup_181_backup k
      WHERE k.business_id = p.business_id AND k.rolled_back_at IS NULL
    );
  GET DIAGNOSTICS n_targets = ROW_COUNT;

  -- A branch set is folded only when its primary card is in this run.
  UPDATE marketplace_cleanup_181_targets t
     SET branch_group_key = NULL
   WHERE t.branch_group_key IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM marketplace_cleanup_181_targets head
       WHERE head.branch_group_key = t.branch_group_key AND head.branch_primary
     );

  INSERT INTO marketplace_cleanup_181_backup (business_id, actions, before_row)
  SELECT b.id,
         ARRAY_REMOVE(ARRAY[
           CASE WHEN t.new_name IS NOT NULL THEN 'rename' END,
           CASE WHEN t.new_category IS NOT NULL THEN 'recategorise' END,
           CASE WHEN t.hide_reason IS NOT NULL THEN 'hide' END,
           CASE WHEN t.branch_group_key IS NOT NULL AND t.branch_primary THEN 'branch_primary' END,
           CASE WHEN t.branch_group_key IS NOT NULL AND NOT t.branch_primary THEN 'branch_fold' END
         ], NULL),
         jsonb_build_object(
           'name', b.name,
           'category', b.category,
           'status', b.status,
           'moderation_notes', b.moderation_notes,
           'branch_group_key', b.branch_group_key,
           'updated_at', b.updated_at
         )
  FROM marketplace_businesses b
  JOIN marketplace_cleanup_181_targets t ON t.business_id = b.id
  ON CONFLICT (business_id) DO UPDATE
    SET actions = EXCLUDED.actions,
        before_row = EXCLUDED.before_row,
        after_row = NULL,
        backed_up_at = NOW(),
        rolled_back_at = NULL;

  UPDATE marketplace_businesses b
     SET name = t.new_name
    FROM marketplace_cleanup_181_targets t
   WHERE t.business_id = b.id
     AND t.new_name IS NOT NULL
     AND b.name = t.expected_name;
  GET DIAGNOSTICS n_renamed = ROW_COUNT;

  UPDATE marketplace_businesses b
     SET category = t.new_category
    FROM marketplace_cleanup_181_targets t
   WHERE t.business_id = b.id
     AND t.new_category IS NOT NULL
     AND b.category = t.expected_category;
  GET DIAGNOSTICS n_recategorised = ROW_COUNT;

  UPDATE marketplace_businesses b
     SET status = 'hidden',
         moderation_notes = CONCAT_WS(E'\n', NULLIF(b.moderation_notes, ''), '[cleanup-181] hidden: off-topic for a property directory (' || t.hide_reason || ').')
    FROM marketplace_cleanup_181_targets t
   WHERE t.business_id = b.id
     AND t.hide_reason IS NOT NULL
     AND b.status = 'live';
  GET DIAGNOSTICS n_hidden = ROW_COUNT;

  UPDATE marketplace_businesses b
     SET branch_group_key = t.branch_group_key
    FROM marketplace_cleanup_181_targets t
   WHERE t.business_id = b.id
     AND t.branch_group_key IS NOT NULL;
  GET DIAGNOSTICS n_grouped = ROW_COUNT;

  UPDATE marketplace_businesses b
     SET status = 'hidden',
         moderation_notes = CONCAT_WS(E'\n', NULLIF(b.moderation_notes, ''), '[cleanup-181] branch of ' || t.branch_group_key || ': counted on the primary card.')
    FROM marketplace_cleanup_181_targets t
   WHERE t.business_id = b.id
     AND t.branch_group_key IS NOT NULL
     AND NOT t.branch_primary
     AND b.status = 'live';
  GET DIAGNOSTICS n_folded = ROW_COUNT;

  UPDATE marketplace_cleanup_181_backup k
     SET after_row = jsonb_build_object(
           'name', b.name,
           'category', b.category,
           'status', b.status,
           'moderation_notes', b.moderation_notes,
           'branch_group_key', b.branch_group_key
         )
    FROM marketplace_businesses b
    JOIN marketplace_cleanup_181_targets t ON t.business_id = b.id
   WHERE k.business_id = b.id;

  RAISE NOTICE 'marketplace_cleanup_181 targets=% renamed=% recategorised=% hidden=% grouped=% folded=%',
    n_targets, n_renamed, n_recategorised, n_hidden, n_grouped, n_folded;
END
$do_181$;
