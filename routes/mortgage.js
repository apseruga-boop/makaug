const express = require('express');

const db = require('../config/database');
const { requireAdminApiKey } = require('../middleware/auth');
const { cleanText, toNullableFloat, toNullableInt } = require('../middleware/validation');
const { getSupportEmail, getSupportWhatsappUrl, sendSupportEmail } = require('../services/emailService');
const { logEmailEvent } = require('../services/emailLogService');
const { logNotification, notificationStatusFromDelivery } = require('../services/notificationLogService');
const { createLead } = require('../services/leadService');

const router = express.Router();

const FALLBACK_MORTGAGE_PROVIDERS = [
  {
    key: 'stanbic',
    name: 'Stanbic Bank Uganda',
    residentialRate: 16.5,
    commercialRate: 16.5,
    landRate: null,
    minDepositPct: { residential: 20, commercial: 20, land: 20, default: 20 },
    maxYears: { residential: 25, commercial: 25, land: 25, default: 25 },
    arrangementFeePct: 1.5,
    sourceLabel: 'Stanbic home loan public pages',
    sourceUrl: 'https://www.stanbicbank.co.ug/uganda/personal/products-and-services/borrow-for-your-needs/see-all-mortgages-and-home-loans/house-purchase-loan',
    sourceNote: 'Stanbic publishes home loan fees, transfer stamp duty, mortgage stamp duty, and valuation guidance; final pricing is confirmed by the bank.',
    sourceVerifiedAt: '2026-06-21'
  },
  {
    key: 'hfb',
    name: 'Housing Finance Bank',
    residentialRate: null,
    commercialRate: null,
    landRate: null,
    minDepositPct: { residential: 20, commercial: 20, land: 40, default: 20 },
    maxYears: { residential: 20, commercial: 20, land: 5, default: 20 },
    arrangementFeePct: 1.25,
    sourceLabel: 'Housing Finance mortgage terms and conditions',
    sourceUrl: 'https://www.housingfinance.co.ug/mortgage-development-finance/housing-finance-bank-mortgage-terms-and-conditions/',
    sourceNote: 'Housing Finance publishes LTV, term, facility fee, and gross-income guidance; rate is variable and requires bank confirmation.',
    sourceVerifiedAt: '2026-06-21'
  },
  {
    key: 'dfcu',
    name: 'dfcu Bank',
    residentialRate: 16.0,
    commercialRate: null,
    landRate: null,
    minDepositPct: { residential: 15, commercial: 40, land: 40, default: 15 },
    maxYears: { residential: 20, commercial: 20, land: 20, default: 20 },
    arrangementFeePct: 2.0,
    sourceLabel: 'dfcu home loans',
    sourceUrl: 'https://www.dfcugroup.com/personal-banking/home-loans/',
    sourceNote: 'dfcu publishes UGX home-loan rate guidance, 20-year UGX term rules, and up-to-85% open-market-value guidance for residential home loans.',
    sourceVerifiedAt: '2026-06-21'
  },
  {
    key: 'kcb',
    name: 'KCB Bank Uganda',
    residentialRate: 17.5,
    commercialRate: 17.5,
    landRate: null,
    minDepositPct: { residential: 20, commercial: 20, land: 20, default: 20 },
    maxYears: { residential: 20, commercial: 20, land: 20, default: 20 },
    arrangementFeePct: 1.5,
    sourceLabel: 'KCB mortgage overview',
    sourceUrl: 'https://ug.kcbgroup.com/products/mortgage',
    sourceNote: 'KCB publishes UGX pricing from 17.5%, 20-year purchase/construction/refinance term guidance, and LTV rules.',
    sourceVerifiedAt: '2026-06-21'
  },
  {
    key: 'baroda',
    name: 'Bank of Baroda Uganda',
    residentialRate: 18.0,
    commercialRate: null,
    landRate: null,
    minDepositPct: { residential: 20, commercial: 20, land: 20, default: 20 },
    maxYears: { residential: 15, commercial: 15, land: 15, default: 15 },
    arrangementFeePct: 1.0,
    sourceLabel: 'Baroda housing loan and interest rates',
    sourceUrl: 'https://www.bankofbaroda.ug/rates-and-charges/interest-rates',
    sourceNote: 'Baroda publishes housing loan pricing as 2% below UGX PLR; with PLR 20%, this gives an indicative 18% UGX rate.',
    sourceVerifiedAt: '2026-06-07'
  },
  {
    key: 'absa',
    name: 'Absa Bank Uganda',
    residentialRate: null,
    commercialRate: null,
    landRate: null,
    minDepositPct: { residential: 15, commercial: 20, land: 20, default: 20 },
    maxYears: { residential: 25, commercial: 25, land: 25, default: 25 },
    arrangementFeePct: 1.5,
    sourceLabel: 'Absa Uganda home loans',
    sourceUrl: 'https://www.absa.co.ug/personal/home-loans/',
    sourceNote: 'Absa publishes home-loan availability in UGX/USD with competitive rates, but does not publish a fixed public rate on the page.',
    sourceVerifiedAt: '2026-06-07'
  }
];

const MORTGAGE_PROVIDER_LOGO_URLS = {
  stanbic: '/assets/mortgage-logos/stanbic.svg',
  hfb: '/assets/mortgage-logos/hfb.svg',
  dfcu: '/assets/mortgage-logos/dfcu.svg',
  kcb: '/assets/mortgage-logos/kcb.svg',
  ncba: '/assets/mortgage-logos/ncba.svg',
  centenary: '/assets/mortgage-logos/centenary.svg',
  baroda: '/assets/mortgage-logos/baroda.svg',
  absa: '/assets/mortgage-logos/absa.svg',
  equity: '/assets/mortgage-logos/equity.svg'
};

function normalizeProvider(row) {
  return {
    key: cleanText(row.provider_key || row.key).toLowerCase(),
    name: cleanText(row.provider_name || row.name),
    residentialRate: toNullableFloat(row.residential_rate ?? row.residentialRate),
    commercialRate: toNullableFloat(row.commercial_rate ?? row.commercialRate),
    landRate: toNullableFloat(row.land_rate ?? row.landRate),
    minDepositPct: {
      residential: toNullableFloat(row.min_deposit_residential ?? row.minDepositResidential) ?? 20,
      commercial: toNullableFloat(row.min_deposit_commercial ?? row.minDepositCommercial) ?? 20,
      land: toNullableFloat(row.min_deposit_land ?? row.minDepositLand) ?? 20
    },
    maxYears: {
      residential: toNullableInt(row.max_years_residential ?? row.maxYearsResidential) ?? 20,
      commercial: toNullableInt(row.max_years_commercial ?? row.maxYearsCommercial) ?? 20,
      land: toNullableInt(row.max_years_land ?? row.maxYearsLand) ?? 20
    },
    arrangementFeePct: toNullableFloat(row.arrangement_fee_pct ?? row.arrangementFeePct) ?? 1.5,
    sourceLabel: cleanText(row.source_label || row.sourceLabel),
    sourceUrl: cleanText(row.source_url || row.sourceUrl),
    sourceNote: cleanText(row.source_note || row.sourceNote || row.notes),
    logoUrl: cleanText(row.logo_url || row.logoUrl),
    logo_url: cleanText(row.logo_url || row.logoUrl),
    sourceVerifiedAt: row.source_verified_at || row.sourceVerifiedAt || null
  };
}

function withDefaultKeys(provider) {
  const providerKey = cleanText(provider.key || provider.provider_key || provider.id).toLowerCase();
  const logoUrl = provider.logoUrl || provider.logo_url || MORTGAGE_PROVIDER_LOGO_URLS[providerKey] || null;
  return {
    ...provider,
    logoUrl,
    logo_url: logoUrl,
    minDepositPct: {
      residential: provider.minDepositPct?.residential ?? 20,
      commercial: provider.minDepositPct?.commercial ?? 20,
      land: provider.minDepositPct?.land ?? 20,
      default: provider.minDepositPct?.default ?? provider.minDepositPct?.residential ?? 20
    },
    maxYears: {
      residential: provider.maxYears?.residential ?? 20,
      commercial: provider.maxYears?.commercial ?? 20,
      land: provider.maxYears?.land ?? 20,
      default: provider.maxYears?.default ?? provider.maxYears?.residential ?? 20
    }
  };
}

async function hasMortgageTable() {
  const exists = await db.query(`SELECT to_regclass('public.mortgage_providers') AS table_name`);
  return Boolean(exists.rows[0]?.table_name);
}

async function ensureMortgageEnquiriesTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS mortgage_enquiries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_phone TEXT,
      property_price NUMERIC,
      property_purpose TEXT,
      deposit_percent NUMERIC,
      term_years INTEGER,
      household_income NUMERIC,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function buildMortgageLeadRef() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `MF-${ts}-${rand}`;
}

async function readMortgageProviders() {
  if (!(await hasMortgageTable())) {
    return {
      providers: FALLBACK_MORTGAGE_PROVIDERS.map(withDefaultKeys),
      updatedAt: null,
      source: 'fallback'
    };
  }

  const result = await db.query(
    `SELECT
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
      notes,
      updated_at
     FROM mortgage_providers
     WHERE is_active = TRUE
     ORDER BY provider_name ASC`
  );

  if (!result.rows.length) {
    return {
      providers: FALLBACK_MORTGAGE_PROVIDERS.map(withDefaultKeys),
      updatedAt: null,
      source: 'fallback'
    };
  }

  const providers = result.rows.map((row) => withDefaultKeys(normalizeProvider(row)));
  const latest = result.rows
    .map((row) => row.updated_at)
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;

  return {
    providers,
    updatedAt: latest,
    source: 'database'
  };
}

router.get('/', async (req, res, next) => {
  try {
    const payload = await readMortgageProviders();
    return res.json({
      ok: true,
      data: {
        updatedAt: payload.updatedAt,
        refreshedAt: new Date().toISOString(),
        source: payload.source,
        providers: payload.providers
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/enquiry', async (req, res, next) => {
  const body = req.body || {};
  const name = cleanText(body.name);
  const phone = cleanText(body.phone);
  const email = cleanText(body.email).toLowerCase();
  const contactMethod = cleanText(body.contact_method || body.contactMethod || 'phone').toLowerCase();
  const amountToBorrow = toNullableFloat(body.amount_to_borrow ?? body.amountToBorrow);
  const propertyPrice = toNullableFloat(body.property_price ?? body.propertyPrice) ?? amountToBorrow;
  const propertyPurpose = cleanText(body.property_purpose || body.propertyPurpose || 'residential').toLowerCase();
  const depositPercent = toNullableFloat(body.deposit_percent ?? body.depositPercent);
  const termYears = toNullableInt(body.term_years ?? body.termYears ?? body.preferred_term_years ?? body.preferredTermYears);
  const householdIncome = toNullableFloat(body.household_income ?? body.householdIncome);
  const annualRate = toNullableFloat(body.annual_rate ?? body.annualRate);
  const monthlyRepayment = toNullableFloat(body.monthly_repayment ?? body.monthlyRepayment);
  const preferredProviderKey = cleanText(body.preferred_provider_key || body.preferredProviderKey).toLowerCase();
  const preferredProviderName = cleanText(body.preferred_provider_name || body.preferredProviderName);
  const leadContext = cleanText(body.lead_context || body.leadContext || (preferredProviderKey || preferredProviderName ? 'bank_provider' : 'general_mortgage_callback')).toLowerCase();
  const language = cleanText(body.language || body.preferred_language || body.preferredLanguage || 'en').toLowerCase();
  const extraMonthlyPayment = toNullableFloat(body.extra_monthly_payment ?? body.extraMonthlyPayment);
  const estimatedInterestSaved = toNullableFloat(body.estimated_interest_saved ?? body.estimatedInterestSaved);
  const estimatedMonthsSaved = toNullableInt(body.estimated_months_saved ?? body.estimatedMonthsSaved);
  const sourceNote = cleanText(body.source_note || body.sourceNote);
  const publicRecordDisclosure = cleanText(body.public_record_disclosure || body.publicRecordDisclosure)
    || 'Indicative mortgage data is pulled from public bank pages and public records. Terms can change without notice; customers must confirm with the lender before applying.';
  const isBankProviderLead = Boolean(preferredProviderKey || preferredProviderName || leadContext === 'bank_provider');
  const providerLabel = preferredProviderName || preferredProviderKey || '';

  if (!name) {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }
  if (!phone || !(/^\+2567\d{8}$/.test(phone) || /^\+256\d{9}$/.test(phone))) {
    return res.status(400).json({ ok: false, error: 'valid Uganda phone is required' });
  }
  if (!amountToBorrow || amountToBorrow <= 0) {
    return res.status(400).json({ ok: false, error: 'amount_to_borrow is required' });
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'email format is invalid' });
  }

  try {
    await ensureMortgageEnquiriesTable();
    const fallbackRef = buildMortgageLeadRef();
    const payload = {
      name,
      email: email || null,
      contactMethod: ['phone', 'whatsapp', 'email'].includes(contactMethod) ? contactMethod : 'phone',
      amountToBorrow,
      preferredTermYears: toNullableInt(body.preferred_term_years ?? body.preferredTermYears),
      preferredProviderKey: preferredProviderKey || null,
      preferredProviderName: preferredProviderName || null,
      leadContext: isBankProviderLead ? 'bank_provider' : 'general_mortgage_callback',
      language,
      calculation: {
        propertyPrice,
        propertyPurpose,
        depositPercent,
        termYears,
        householdIncome,
        annualRate,
        monthlyRepayment,
        extraMonthlyPayment,
        estimatedInterestSaved,
        estimatedMonthsSaved
      },
      bankHandoff: isBankProviderLead ? {
        status: 'ready_for_bank_export',
        providerKey: preferredProviderKey || null,
        providerName: preferredProviderName || null
      } : null,
      publicRecordDisclosure,
      sourceNote: sourceNote || null,
      source: 'website_mortgage_finder',
      submittedAt: new Date().toISOString()
    };

    const saved = await db.query(
      `INSERT INTO mortgage_enquiries (
        user_phone, property_price, property_purpose, deposit_percent, term_years, household_income, payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
      RETURNING id`,
      [
        phone,
        propertyPrice,
        propertyPurpose || null,
        depositPercent,
        termYears,
        householdIncome,
        JSON.stringify(payload)
      ]
    );
    const id = String(saved.rows[0]?.id || "");
    const reference = id ? `MF-${id.slice(0, 8).toUpperCase()}` : fallbackRef;
    const leadSource = isBankProviderLead ? 'mortgage_bank_callback' : 'mortgage_widget';
    const leadMessage = isBankProviderLead
      ? `Mortgage bank callback requested for ${providerLabel}: ${reference}`
      : `Mortgage help requested: ${reference}`;
    const lead = await createLead(db, {
      source: leadSource,
      leadType: 'mortgage',
      category: isBankProviderLead && providerLabel ? `bank:${providerLabel}` : propertyPurpose,
      budget: amountToBorrow,
      message: leadMessage,
      contact: {
        name,
        email: email || null,
        phone,
        preferredContactChannel: payload.contactMethod,
        preferredLanguage: language,
        roleType: 'mortgage'
      },
      activityType: 'mortgage_lead_received',
      priority: isBankProviderLead ? 'high' : 'normal',
      metadata: {
        mortgage_enquiry_id: id || null,
        reference,
        amount_to_borrow: amountToBorrow,
        preferred_term_years: termYears,
        preferred_provider_key: preferredProviderKey || null,
        preferred_provider_name: preferredProviderName || null,
        lead_context: payload.leadContext,
        bank_handoff_status: isBankProviderLead ? 'ready_for_bank_export' : null,
        annual_rate: annualRate,
        monthly_repayment: monthlyRepayment,
        property_price: propertyPrice,
        deposit_percent: depositPercent,
        household_income: householdIncome,
        extra_monthly_payment: extraMonthlyPayment,
        estimated_interest_saved: estimatedInterestSaved,
        estimated_months_saved: estimatedMonthsSaved,
        language,
        source_note: sourceNote || null,
        public_record_disclosure: payload.publicRecordDisclosure
      }
    });
    const supportEmail = getSupportEmail();
    const whatsappUrl = getSupportWhatsappUrl();
    let userDelivery = { sent: false, reason: 'not_attempted' };
    let adminDelivery = { sent: false, reason: 'not_attempted' };

    try {
      if (email) {
        userDelivery = await sendSupportEmail({
          to: email,
          subject: 'We received your makaug mortgage request',
          text: [
            `Hello ${name},`,
            '',
            'Thank you for requesting mortgage help on makaug.',
            `Reference: ${reference}`,
            `Amount to borrow: UGX ${Number(amountToBorrow).toLocaleString('en-UG')}`,
            'Our team will contact you using your preferred channel.',
            `WhatsApp support: ${whatsappUrl}`,
            '',
            'makaug'
          ].join('\n')
        });
      }
      adminDelivery = await sendSupportEmail({
        to: supportEmail,
        subject: `[makaug] Mortgage lead received • ${reference}`,
        text: [
          isBankProviderLead ? 'A bank-specific mortgage callback request was submitted.' : 'A mortgage help request was submitted.',
          '',
          `Reference: ${reference}`,
          `Lead type: ${isBankProviderLead ? 'Bank provider callback' : 'General mortgage callback'}`,
          `Preferred bank: ${providerLabel || '-'}`,
          `Name: ${name}`,
          `Phone: ${phone}`,
          `Email: ${email || '-'}`,
          `Amount to borrow: UGX ${Number(amountToBorrow).toLocaleString('en-UG')}`,
          `Preferred contact: ${payload.contactMethod}`,
          `Monthly repayment estimate: ${monthlyRepayment ? `UGX ${Number(monthlyRepayment).toLocaleString('en-UG')}` : '-'}`,
          `Public source note: ${sourceNote || '-'}`
        ].join('\n'),
        replyTo: email || undefined
      });
    } catch (_) {}

    await Promise.allSettled([
      logEmailEvent(db, {
        eventType: 'mortgage_lead_received',
        recipientEmail: email || null,
        recipientRole: 'user',
        templateKey: 'mortgage_lead_received',
        subject: 'We received your makaug mortgage request',
        status: notificationStatusFromDelivery(userDelivery),
        relatedLeadId: lead?.id || null,
        relatedMortgageLeadId: id || null,
        failureReason: userDelivery?.error || userDelivery?.reason || null,
        sentAt: userDelivery?.sent ? new Date() : null
      }),
      logEmailEvent(db, {
        eventType: 'new_mortgage_lead',
        recipientEmail: supportEmail,
        recipientRole: 'admin',
        templateKey: 'admin_alert',
        subject: `[makaug] Mortgage lead received • ${reference}`,
        status: notificationStatusFromDelivery(adminDelivery),
        relatedLeadId: lead?.id || null,
        relatedMortgageLeadId: id || null,
        failureReason: adminDelivery?.error || adminDelivery?.reason || null,
        sentAt: adminDelivery?.sent ? new Date() : null
      }),
      logNotification(db, {
        recipientEmail: email || null,
        recipientPhone: phone,
        channel: 'in_app',
        type: 'mortgage_lead_received',
        status: 'logged',
        payloadSummary: {
          reference,
          amount_to_borrow: amountToBorrow,
          preferred_provider_key: preferredProviderKey || null,
          preferred_provider_name: preferredProviderName || null,
          lead_context: payload.leadContext,
          bank_handoff_status: isBankProviderLead ? 'ready_for_bank_export' : null
        },
        relatedLeadId: lead?.id || null
      })
    ]);

    return res.json({
      ok: true,
      data: {
        reference
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.put('/', requireAdminApiKey, async (req, res, next) => {
  const body = req.body || {};
  const providers = Array.isArray(body.providers) ? body.providers : [];

  if (!providers.length) {
    return res.status(400).json({
      ok: false,
      error: 'providers array is required'
    });
  }

  try {
    if (!(await hasMortgageTable())) {
      return res.status(500).json({
        ok: false,
        error: 'mortgage_providers table is missing. Run migrations first.'
      });
    }

    const normalized = [];
    const seen = new Set();

    for (const raw of providers) {
      const item = normalizeProvider(raw || {});
      if (!item.key || !item.name) {
        return res.status(400).json({
          ok: false,
          error: 'Each provider must include key and name'
        });
      }
      if (seen.has(item.key)) {
        return res.status(400).json({
          ok: false,
          error: `Duplicate provider key: ${item.key}`
        });
      }
      seen.add(item.key);
      normalized.push(withDefaultKeys(item));
    }

    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      const keys = normalized.map((x) => x.key);
      await client.query(
        `UPDATE mortgage_providers
         SET is_active = FALSE, updated_at = NOW()
         WHERE provider_key <> ALL($1::text[])`,
        [keys]
      );

      for (const p of normalized) {
        await client.query(
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
	            notes,
	            is_active
	          ) VALUES (
	            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE
	          )
          ON CONFLICT (provider_key) DO UPDATE SET
            provider_name = EXCLUDED.provider_name,
            residential_rate = EXCLUDED.residential_rate,
            commercial_rate = EXCLUDED.commercial_rate,
            land_rate = EXCLUDED.land_rate,
            min_deposit_residential = EXCLUDED.min_deposit_residential,
            min_deposit_commercial = EXCLUDED.min_deposit_commercial,
            min_deposit_land = EXCLUDED.min_deposit_land,
            max_years_residential = EXCLUDED.max_years_residential,
            max_years_commercial = EXCLUDED.max_years_commercial,
            max_years_land = EXCLUDED.max_years_land,
	            arrangement_fee_pct = EXCLUDED.arrangement_fee_pct,
	            source_label = EXCLUDED.source_label,
	            source_url = EXCLUDED.source_url,
	            notes = EXCLUDED.notes,
	            is_active = TRUE,
            updated_at = NOW()`,
          [
            p.key,
            p.name,
            p.residentialRate,
            p.commercialRate,
            p.landRate,
            p.minDepositPct.residential,
            p.minDepositPct.commercial,
            p.minDepositPct.land,
            p.maxYears.residential,
            p.maxYears.commercial,
            p.maxYears.land,
	            p.arrangementFeePct,
	            p.sourceLabel || null,
	            p.sourceUrl || null,
	            p.sourceNote || null
	          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const payload = await readMortgageProviders();
    return res.json({
      ok: true,
      data: {
        updatedAt: payload.updatedAt,
        source: payload.source,
        providers: payload.providers
      }
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
