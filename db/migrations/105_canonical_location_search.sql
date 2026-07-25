-- K20: canonical location search keys for public filtering and ingest provenance.
-- Existing rows are normalized conservatively. The application registry remains
-- the source of truth and resolves aliases/new submissions before persistence.
WITH known_keys(canonical_key) AS (
  VALUES
    ('kampala:kampala'), ('kampala:nakasero'), ('kampala:kololo'), ('kampala:old kampala'),
    ('kampala:makerere'), ('kampala:wandegeya'), ('kampala:nakawa'), ('kampala:ntinda'),
    ('kampala:naguru'), ('kampala:bukoto'), ('kampala:kisaasi'), ('kampala:kyanja'),
    ('kampala:komamboga'), ('kampala:kiwatule'), ('kampala:bugolobi'), ('kampala:makindye'),
    ('kampala:muyenga'), ('kampala:ggaba'), ('kampala:kansanga'), ('kampala:buziga'),
    ('kampala:bunga'), ('kampala:kabalagala'), ('kampala:munyonyo'), ('kampala:rubaga'),
    ('kampala:nateete'), ('kampala:mengo'), ('kampala:lungujja'), ('kampala:kasubi'),
    ('kampala:kikoni'), ('kampala:ndeeba'), ('kampala:kikuubo'),
    ('wakiso:wakiso'), ('wakiso:entebbe'), ('wakiso:kitoro'), ('wakiso:nakiwogo'),
    ('wakiso:bugonga'), ('wakiso:katabi'), ('wakiso:abayita ababiri'), ('wakiso:kitende'),
    ('wakiso:kajjansi'), ('wakiso:bwebajja'), ('wakiso:namasuba'), ('wakiso:ndejje'),
    ('wakiso:lubugumu'), ('wakiso:seguku'), ('wakiso:kira'), ('wakiso:namugongo'),
    ('wakiso:bweyogerere'), ('wakiso:kyaliwajjala'), ('wakiso:naalya'), ('wakiso:najjera'),
    ('wakiso:bulindo'), ('wakiso:sonde'), ('wakiso:kira mulawa'), ('wakiso:kira nsasa'),
    ('wakiso:nansana'), ('wakiso:nabweru'), ('wakiso:wamala'), ('wakiso:gganda'),
    ('wakiso:kyebando'), ('wakiso:wakiso central'), ('wakiso:kakiri'), ('wakiso:bujjuko'),
    ('wakiso:masulita'), ('wakiso:kasanje'), ('wakiso:kasangati'),
    ('mukono:mukono'), ('mukono:seeta'), ('mukono:goma'), ('mukono:namanve'),
    ('mukono:bajjo'), ('mukono:katosi'),
    ('jinja:jinja'), ('jinja:njeru'), ('jinja:masese'), ('jinja:nalufenya'), ('jinja:bugembe'),
    ('mbarara:mbarara'), ('mbarara:nyamitanga'), ('mbarara:kakoba'), ('mbarara:ruti'), ('mbarara:biharwe'),
    ('gulu:gulu'), ('gulu:pece'), ('gulu:layibi'), ('gulu:bardege'), ('gulu:kanyagoga'),
    ('mbale:mbale'), ('mbale:industrial area'), ('mbale:namatala'), ('mbale:senior quarters'),
    ('lira:lira'), ('lira:adyel'), ('lira:barapwo'), ('lira:ireda'),
    ('arua:arua'), ('arua:olua'), ('arua:awindiri'), ('arua:pokea'),
    ('kabarole:fort portal'), ('kabarole:kijura'), ('kabarole:boma'), ('kabarole:rwengoma'),
    ('hoima:hoima'), ('hoima:kasingo'), ('hoima:busiisi'), ('hoima:kyentale'),
    ('masindi:masindi'), ('masindi:kijura'), ('masindi:kisanja'), ('masindi:nyangahya'), ('masindi:kigulya'),
    ('masaka:masaka'), ('masaka:nyendo'), ('masaka:ssenyange'), ('masaka:kimaanya'),
    ('kabale:kabale'), ('kabale:rutooma'), ('kabale:kekubo'), ('kabale:butobere')
),
normalized AS (
  SELECT
    id,
    LOWER(REGEXP_REPLACE(
      CASE
        WHEN LOWER(TRIM(COALESCE(district, ''))) = 'fort portal' THEN 'Kabarole'
        ELSE TRIM(COALESCE(district, ''))
      END,
      '[^a-zA-Z0-9]+',
      ' ',
      'g'
    )) AS district_key,
    LOWER(REGEXP_REPLACE(
      CASE
        WHEN LOWER(TRIM(COALESCE(area, ''))) IN ('kiira', 'kira town', 'kiira town', 'kira municipality') THEN 'Kira'
        WHEN LOWER(TRIM(COALESCE(area, ''))) = 'bukotto' THEN 'Bukoto'
        WHEN LOWER(TRIM(COALESCE(area, ''))) = 'mmengo' THEN 'Mengo'
        WHEN LOWER(TRIM(COALESCE(area, ''))) IN ('bujuuko', 'bujjuko akright', 'bujuuko akright', 'akright') THEN 'Bujjuko'
        WHEN LOWER(TRIM(COALESCE(area, ''))) = 'najjeera' THEN 'Najjera'
        WHEN LOWER(TRIM(COALESCE(area, ''))) = 'kajansi' THEN 'Kajjansi'
        WHEN LOWER(TRIM(COALESCE(area, ''))) = 'gaba' THEN 'Ggaba'
        WHEN LOWER(TRIM(COALESCE(area, ''))) = 'lubaga' THEN 'Rubaga'
        WHEN LOWER(TRIM(COALESCE(area, ''))) = 'munyonjo' THEN 'Munyonyo'
        ELSE TRIM(COALESCE(area, ''))
      END,
      '[^a-zA-Z0-9]+',
      ' ',
      'g'
    )) AS area_key,
    TRIM(COALESCE(area, '')) AS raw_area
  FROM properties
),
resolved AS (
  SELECT
    n.*,
    CASE
      WHEN n.raw_area ~* '^(lake victoria|victoria lake|lake albert|lake kyoga|.* road)$' THEN NULL
      WHEN EXISTS (
        SELECT 1
        FROM known_keys k
        WHERE k.canonical_key = n.district_key || ':' || n.area_key
      ) THEN n.district_key || ':' || n.area_key
      WHEN n.district_key <> '' AND (n.area_key = '' OR n.area_key = n.district_key)
        THEN n.district_key || ':' || n.district_key
      ELSE NULL
    END AS canonical_key
  FROM normalized n
)
UPDATE properties p
SET extra_fields = COALESCE(p.extra_fields, '{}'::jsonb) || jsonb_build_object(
  'raw_location', COALESCE(NULLIF(p.extra_fields->>'raw_location', ''), NULLIF(n.raw_area, ''), p.district),
  'canonical_location_id', n.canonical_key,
  'canonical_location_level',
    CASE
      WHEN n.canonical_key IS NULL THEN NULL
      WHEN n.area_key = n.district_key THEN 'district'
      ELSE 'area'
    END,
  'location_resolution_status',
    CASE
      WHEN n.canonical_key IS NOT NULL THEN 'canonical_backfill'
      ELSE 'unresolved'
    END,
  'location_resolution_confidence',
    CASE
      WHEN n.canonical_key IS NOT NULL THEN 0.85
      ELSE 0
    END
)
FROM resolved n
WHERE p.id = n.id
  AND COALESCE(p.extra_fields->>'canonical_location_id', '') = '';

CREATE INDEX IF NOT EXISTS idx_properties_canonical_location_public
  ON properties ((extra_fields->>'canonical_location_id'), listing_type, status, created_at DESC)
  WHERE COALESCE(extra_fields->>'canonical_location_id', '') <> ''
    AND COALESCE(status, '') <> 'deleted';
