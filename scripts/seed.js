require('dotenv').config();
const bcrypt = require('bcryptjs');

const db = require('../config/database');
const logger = require('../config/logger');

const MORTGAGE_SEED = [
  {
    key: 'stanbic',
    name: 'Stanbic Bank Uganda',
    residential_rate: 16.5,
    commercial_rate: 16.5,
    land_rate: null,
    min_dep_residential: 20,
    min_dep_commercial: 20,
    min_dep_land: 20,
    max_years_residential: 25,
    max_years_commercial: 25,
    max_years_land: 25,
    arrangement_fee_pct: 1.5,
    source_label: 'Stanbic mortgage rates page',
    source_url: 'https://www.stanbicbank.co.ug/uganda/personal/products-and-services/borrow-for-your-needs/vehicle-and-asset-finance/oli-in-charge'
  },
  {
    key: 'hfb',
    name: 'Housing Finance Bank',
    residential_rate: 16.0,
    commercial_rate: 18.0,
    land_rate: 18.0,
    min_dep_residential: 30,
    min_dep_commercial: 40,
    min_dep_land: 40,
    max_years_residential: 20,
    max_years_commercial: 20,
    max_years_land: 15,
    arrangement_fee_pct: 1.5,
    source_label: 'Housing Finance mortgage FAQs',
    source_url: 'https://housingfinance.co.ug/mortgages-faqs/'
  },
  {
    key: 'dfcu',
    name: 'dfcu Bank',
    residential_rate: 16.0,
    commercial_rate: 16.0,
    land_rate: 16.5,
    min_dep_residential: 40,
    min_dep_commercial: 40,
    min_dep_land: 40,
    max_years_residential: 20,
    max_years_commercial: 20,
    max_years_land: 20,
    arrangement_fee_pct: 2.0,
    source_label: 'dfcu Dream Home campaign',
    source_url: 'https://www.dfcugroup.com/personal-banking/campaigns/personal-banking/dream-home/'
  },
  {
    key: 'kcb',
    name: 'KCB Bank Uganda',
    residential_rate: 17.5,
    commercial_rate: 17.5,
    land_rate: null,
    min_dep_residential: 20,
    min_dep_commercial: 20,
    min_dep_land: 20,
    max_years_residential: 20,
    max_years_commercial: 20,
    max_years_land: 20,
    arrangement_fee_pct: 1.5,
    source_label: 'KCB mortgage overview',
    source_url: 'https://ug.kcbgroup.com/for-me/loans/mortgage'
  },
  {
    key: 'baroda',
    name: 'Bank of Baroda Uganda',
    residential_rate: 18.0,
    commercial_rate: null,
    land_rate: null,
    min_dep_residential: 20,
    min_dep_commercial: 20,
    min_dep_land: 20,
    max_years_residential: 15,
    max_years_commercial: 15,
    max_years_land: 15,
    arrangement_fee_pct: 1.5,
    source_label: 'Housing loan (2% below PLR, PLR schedule)',
    source_url: 'https://www.bankofbaroda.ug/personal-banking/retail-loans/housing-loans'
  },
  {
    key: 'absa',
    name: 'Absa Bank Uganda',
    residential_rate: null,
    commercial_rate: null,
    land_rate: null,
    min_dep_residential: 15,
    min_dep_commercial: 20,
    min_dep_land: 20,
    max_years_residential: 25,
    max_years_commercial: 25,
    max_years_land: 25,
    arrangement_fee_pct: 1.5,
    source_label: 'Absa home loan page (LTV up to 85%)',
    source_url: 'https://www.absabank.co.ug/personal/borrow/home-loans/'
  }
];

async function tableExists(name) {
  const result = await db.query('SELECT to_regclass($1) AS table_name', [name]);
  return Boolean(result.rows[0]?.table_name);
}

async function seedAgents() {
  const existing = await db.query('SELECT COUNT(*)::int AS c FROM agents');
  if (existing.rows[0].c > 0) {
    logger.info('Agents already exist, skipping agent seed');
    return;
  }

  const agentRows = [
    {
      full_name: 'James Mukasa',
      company_name: 'Prime Properties Uganda',
      licence_number: 'AREA/2023/0051',
      phone: '+256772100001',
      whatsapp: '+256772100001',
      email: 'james@primeprop.ug',
      districts: ['Kampala', 'Wakiso'],
      specs: ['Residential', 'Commercial'],
      rating: 4.9,
      sales_count: 47,
      status: 'approved'
    },
    {
      full_name: 'Sarah Namusoke',
      company_name: 'Namusoke Realty',
      licence_number: 'AREA/2022/0034',
      phone: '+256772100002',
      whatsapp: '+256772100002',
      email: 'sarah@namusokerealtyug.com',
      districts: ['Wakiso', 'Entebbe'],
      specs: ['Residential', 'Land'],
      rating: 4.8,
      sales_count: 31,
      status: 'approved'
    }
  ];

  for (const a of agentRows) {
    await db.query(
      `INSERT INTO agents (
        full_name,
        company_name,
        licence_number,
        phone,
        whatsapp,
        email,
        districts_covered,
        specializations,
        rating,
        sales_count,
        status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        a.full_name,
        a.company_name,
        a.licence_number,
        a.phone,
        a.whatsapp,
        a.email,
        a.districts,
        a.specs,
        a.rating,
        a.sales_count,
        a.status
      ]
    );
  }

  logger.info('Seeded initial agents');
}

async function seedDemoUsers() {
  const enabled = /^(1|true|yes)$/i.test(String(process.env.SEED_DEMO_USERS || '').trim());
  if (!enabled) {
    logger.info('Demo users seed disabled (set SEED_DEMO_USERS=true to enable)');
    return;
  }

  if (!(await tableExists('public.users'))) {
    logger.info('Users table missing, skipping demo users seed');
    return;
  }

  const finderPassword = String(process.env.SEED_DEMO_FINDER_PASSWORD || '').trim();
  const agentPassword = String(process.env.SEED_DEMO_AGENT_PASSWORD || '').trim();
  if (!finderPassword || !agentPassword) {
    logger.warn('Demo user seed skipped: missing SEED_DEMO_FINDER_PASSWORD or SEED_DEMO_AGENT_PASSWORD');
    return;
  }

  const demoUsers = [
    {
      first_name: 'Demo',
      last_name: 'Finder',
      phone: '+256770100111',
      email: 'demo.finder@makaug.com',
      role: 'buyer_renter',
      password: finderPassword
    },
    {
      first_name: 'Demo',
      last_name: 'Agent',
      phone: '+256772100001',
      email: 'demo.agent@makaug.com',
      role: 'agent_broker',
      password: agentPassword
    }
  ];

  for (const u of demoUsers) {
    const existing = await db.query(
      'SELECT id FROM users WHERE phone = $1 OR LOWER(email) = LOWER($2) LIMIT 1',
      [u.phone, u.email]
    );
    if (existing.rows.length) continue;

    const passwordHash = await bcrypt.hash(u.password, 10);
    await db.query(
      `INSERT INTO users (
        first_name,
        last_name,
        phone,
        email,
        role,
        password_hash,
        phone_verified,
        status
      ) VALUES ($1,$2,$3,$4,$5,$6,TRUE,'active')`,
      [u.first_name, u.last_name, u.phone, u.email, u.role, passwordHash]
    );
  }

  logger.info('Seeded demo login users');
}

async function seedProperties() {
  const existing = await db.query('SELECT COUNT(*)::int AS c FROM properties');
  if (existing.rows[0].c > 0) {
    logger.info('Properties already exist, skipping property seed');
    return;
  }

  const agent = await db.query('SELECT id FROM agents ORDER BY created_at ASC LIMIT 1');
  const agentId = agent.rows[0]?.id || null;

  const property = await db.query(
    `INSERT INTO properties (
      listing_type,
      title,
      description,
      district,
      area,
      price,
      price_period,
      bedrooms,
      bathrooms,
      property_type,
      title_type,
      amenities,
      lister_name,
      lister_phone,
      lister_type,
      status,
      listed_via,
      source,
      agent_id
    ) VALUES (
      'sale',
      'Sample 3-Bedroom Home in Ntinda',
      'Seeded listing for initial environment setup.',
      'Kampala',
      'Ntinda',
      350000000,
      NULL,
      3,
      2,
      'House',
      'Freehold',
      '["Parking","Security"]'::jsonb,
      'MakaUg Demo',
      '+256770646879',
      'agent',
      'approved',
      'website',
      'seed',
      $1
    ) RETURNING id`,
    [agentId]
  );

  await db.query(
    `INSERT INTO property_images (property_id, url, is_primary, sort_order)
     VALUES ($1, $2, true, 0)`,
    [property.rows[0].id, 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80']
  );

  logger.info('Seeded initial properties');
}

async function seedMortgageProviders() {
  if (!(await tableExists('public.mortgage_providers'))) {
    logger.info('Mortgage providers table missing, skipping mortgage seed');
    return;
  }

  const existing = await db.query('SELECT COUNT(*)::int AS c FROM mortgage_providers');
  if (existing.rows[0].c > 0) {
    logger.info('Mortgage providers already exist, skipping mortgage seed');
    return;
  }

  for (const p of MORTGAGE_SEED) {
    await db.query(
      `INSERT INTO mortgage_providers (
        provider_key,
        provider_name,
        residential_rate,
        commercial_rate,
        land_rate,
        min_deposit_residential,
        min_deposit_commercial,
        min_deposit_land,
        max_years_residential,
        max_years_commercial,
        max_years_land,
        arrangement_fee_pct,
        source_label,
        source_url,
        is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE)`,
      [
        p.key,
        p.name,
        p.residential_rate,
        p.commercial_rate,
        p.land_rate,
        p.min_dep_residential,
        p.min_dep_commercial,
        p.min_dep_land,
        p.max_years_residential,
        p.max_years_commercial,
        p.max_years_land,
        p.arrangement_fee_pct,
        p.source_label,
        p.source_url
      ]
    );
  }

  logger.info('Seeded initial mortgage providers');
}

async function run() {
  await seedDemoUsers();
  await seedAgents();
  await seedProperties();
  await seedMortgageProviders();
  await db.pool.end();
  logger.info('Seed complete');
}

run().catch(async (error) => {
  logger.error('Seed failed', error);
  await db.pool.end();
  process.exit(1);
});
