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
    sourceNote: 'Stanbic publishes 80% financing/LTV, 1.5% arrangement fee, 1.5% transfer stamp duty, 0.5% mortgage stamp duty, and 0.25% valuation guidance.',
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
    sourceNote: 'Housing Finance publishes LTV, term, facility-fee, stamp-duty, and gross-income guidance; its public page says interest is variable and requires lender confirmation.',
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
    sourceNote: 'dfcu publishes UGX home-loan rate guidance and 20-year UGX term rules; commercial and land rates need bank confirmation.',
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
    sourceNote: 'KCB publishes UGX pricing from 17.5%, 20-year purchase/construction/refinance terms, and 80% LTV guidance for Kampala, Entebbe, and Wakiso.',
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
    sourceNote: 'Baroda publishes housing-loan pricing as 2% below UGX PLR; with public PLR at 20%, this is an indicative 18% UGX rate.',
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
    sourceNote: 'Absa publishes home-loan availability but does not publish a fixed public rate on the reviewed page, so quotes are required.',
    sourceVerifiedAt: '2026-06-07'
  }
];
const AUDITED_MORTGAGE_PROVIDER_BY_KEY = new Map(FALLBACK_MORTGAGE_PROVIDERS.map((provider) => [provider.key, provider]));

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
    sourceNote: cleanText(row.source_note || row.sourceNote),
    sourceVerifiedAt: row.source_verified_at || row.sourceVerifiedAt || null
  };
}

function withAuditedMortgageData(provider) {
  const audited = AUDITED_MORTGAGE_PROVIDER_BY_KEY.get(provider.key);
  if (!audited) return provider;
  return {
    ...provider,
    residentialRate: audited.residentialRate,
    commercialRate: audited.commercialRate,
    landRate: audited.landRate,
    minDepositPct: {
      ...provider.minDepositPct,
      ...audited.minDepositPct
    },
    maxYears: {
      ...provider.maxYears,
      ...audited.maxYears
    },
    arrangementFeePct: audited.arrangementFeePct ?? provider.arrangementFeePct,
    sourceLabel: audited.sourceLabel || provider.sourceLabel,
    sourceUrl: audited.sourceUrl || provider.sourceUrl,
    sourceNote: audited.sourceNote || provider.sourceNote,
    sourceVerifiedAt: audited.sourceVerifiedAt || provider.sourceVerifiedAt
  };
}

function withDefaultKeys(provider) {
  return {
    ...provider,
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

  const providers = result.rows.map((row) => withDefaultKeys(withAuditedMortgageData(normalizeProvider(row))));
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
  const buyingStage = cleanText(body.buying_stage || body.buyingStage).toLowerCase();
  const depositStatus = cleanText(body.deposit_status || body.depositStatus).toLowerCase();
  const incomeType = cleanText(body.income_type || body.incomeType).toLowerCase();
  const preferredProviderKey = cleanText(body.preferred_provider_key || body.preferredProviderKey || body.provider_key || body.providerKey).toLowerCase();
  const preferredProviderNameInput = cleanText(body.preferred_provider_name || body.preferredProviderName || body.provider_name || body.providerName);
  const leadContext = cleanText(body.lead_context || body.leadContext).toLowerCase();

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
    const providerPayload = await readMortgageProviders();
    const selectedProvider = (providerPayload.providers || []).find((provider) => {
      const key = cleanText(provider.key).toLowerCase();
      const name = cleanText(provider.name).toLowerCase();
      return (preferredProviderKey && key === preferredProviderKey)
        || (preferredProviderNameInput && name === preferredProviderNameInput.toLowerCase());
    }) || null;
    const preferredProviderName = selectedProvider?.name || preferredProviderNameInput || null;
    const normalizedProviderKey = selectedProvider?.key || preferredProviderKey || null;
    const isBankProviderLead = leadContext === 'bank_provider' || Boolean(normalizedProviderKey || preferredProviderName);
    const fallbackRef = buildMortgageLeadRef();
    const payload = {
      name,
      email: email || null,
      contactMethod: ['phone', 'whatsapp', 'email'].includes(contactMethod) ? contactMethod : 'phone',
      amountToBorrow,
      preferredTermYears: toNullableInt(body.preferred_term_years ?? body.preferredTermYears),
      preferredProviderKey: normalizedProviderKey,
      preferredProviderName,
      buyingStage: buyingStage || null,
      depositStatus: depositStatus || null,
      incomeType: incomeType || null,
      householdIncome: householdIncome || null,
      leadContext: isBankProviderLead ? 'bank_provider' : 'general_mortgage_callback',
      bankHandoffStatus: isBankProviderLead ? 'pending_bank_handoff' : null,
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
    const lead = await createLead(db, {
      source: isBankProviderLead ? 'mortgage_bank_callback' : 'mortgage_widget',
      leadType: 'mortgage',
      category: propertyPurpose,
      budget: amountToBorrow,
      message: isBankProviderLead && preferredProviderName
        ? `Mortgage bank callback requested: ${preferredProviderName} • ${reference}`
        : `Mortgage help requested: ${reference}`,
      contact: {
        name,
        email: email || null,
        phone,
        preferredContactChannel: payload.contactMethod,
        roleType: 'mortgage'
      },
      activityType: 'mortgage_lead_received',
      metadata: {
        mortgage_enquiry_id: id || null,
        reference,
        amount_to_borrow: amountToBorrow,
        household_income: householdIncome,
        buying_stage: buyingStage || null,
        deposit_status: depositStatus || null,
        income_type: incomeType || null,
        preferred_term_years: termYears,
        preferred_provider_key: normalizedProviderKey,
        preferred_provider_name: preferredProviderName,
        lead_context: isBankProviderLead ? 'bank_provider' : 'general_mortgage_callback',
        bank_handoff_status: isBankProviderLead ? 'pending_bank_handoff' : null
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
          'A mortgage help request was submitted.',
          '',
          `Reference: ${reference}`,
          `Name: ${name}`,
          `Phone: ${phone}`,
          `Email: ${email || '-'}`,
          `Amount to borrow: UGX ${Number(amountToBorrow).toLocaleString('en-UG')}`,
          `Preferred contact: ${payload.contactMethod}`,
          `Buying stage: ${buyingStage || '-'}`,
          `Deposit readiness: ${depositStatus || '-'}`,
          `Income type: ${incomeType || '-'}`,
          `Household income: ${householdIncome ? `UGX ${Number(householdIncome).toLocaleString('en-UG')}` : '-'}`
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
        payloadSummary: { reference, amount_to_borrow: amountToBorrow },
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
            is_active
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,TRUE
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
            p.sourceUrl || null
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
