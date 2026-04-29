require('dotenv').config();

const db = require('../config/database');
const logger = require('../config/logger');
const { getSupportEmail, getSupportWhatsappUrl, sendSupportEmail } = require('../services/emailService');
const { sendWhatsAppText } = require('../services/whatsappNotificationService');

function money(value) {
  return `UGX ${Number(value || 0).toLocaleString('en-UG')}`;
}

function pct(numerator, denominator) {
  const a = Number(numerator || 0);
  const b = Number(denominator || 0);
  if (!b) return '0.0%';
  return `${((a / b) * 100).toFixed(1)}%`;
}

async function sendDailyAdvertisingReports({ dryRun = false, limit = 50 } = {}) {
  const result = await db.query(
    `SELECT *
     FROM advertising_campaigns
     WHERE status = 'live'
       AND (advertiser_email IS NOT NULL OR advertiser_phone IS NOT NULL)
       AND (last_report_sent_at IS NULL OR last_report_sent_at < NOW() - INTERVAL '20 hours')
     ORDER BY COALESCE(last_report_sent_at, created_at) ASC
     LIMIT $1`,
    [Math.max(1, Math.min(parseInt(limit, 10) || 50, 200))]
  );

  const supportEmail = getSupportEmail();
  const whatsappUrl = getSupportWhatsappUrl();
  let sent = 0;

  for (const campaign of result.rows) {
    const text = [
      `Hello ${campaign.advertiser_name || 'there'},`,
      '',
      'Here is your MakaUg advertising performance update.',
      '',
      `Campaign: ${campaign.campaign_name || '-'}`,
      `Package: ${campaign.package_label || campaign.package_key || '-'}`,
      `Status: ${campaign.status}`,
      `Spend recorded: ${money(campaign.paid_amount_ugx)}`,
      `Impressions: ${Number(campaign.impressions || 0).toLocaleString('en-UG')}`,
      `Clicks: ${Number(campaign.clicks || 0).toLocaleString('en-UG')}`,
      `Leads: ${Number(campaign.leads || 0).toLocaleString('en-UG')}`,
      `Click rate: ${pct(campaign.clicks, campaign.impressions)}`,
      campaign.ends_at ? `Campaign ends: ${new Date(campaign.ends_at).toLocaleDateString('en-GB')}` : '',
      '',
      'MakaUg will keep optimizing placement while the campaign is active.',
      `Questions? WhatsApp: ${whatsappUrl}`,
      `Email: ${supportEmail}`
    ].filter(Boolean).join('\n');

    if (!dryRun && campaign.advertiser_email) {
      await sendSupportEmail({
        to: campaign.advertiser_email,
        subject: `[MakaUg Ads] Daily report - ${campaign.campaign_name || 'Campaign'}`,
        text
      });
    }

    if (!dryRun && campaign.advertiser_phone) {
      await sendWhatsAppText({
        to: campaign.advertiser_phone,
        body: [
          `MakaUg ad report: ${campaign.campaign_name || 'Campaign'}`,
          `Impressions: ${Number(campaign.impressions || 0).toLocaleString('en-UG')}`,
          `Clicks: ${Number(campaign.clicks || 0).toLocaleString('en-UG')}`,
          `Leads: ${Number(campaign.leads || 0).toLocaleString('en-UG')}`,
          campaign.ends_at ? `Ends: ${new Date(campaign.ends_at).toLocaleDateString('en-GB')}` : ''
        ].filter(Boolean).join('\n')
      });
    }

    if (!dryRun) {
      await db.query(
        `UPDATE advertising_campaigns
         SET last_report_sent_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [campaign.id]
      );
    }
    sent += 1;
  }

  return { eligible: result.rows.length, sent, dry_run: dryRun };
}

if (require.main === module) {
  sendDailyAdvertisingReports({
    dryRun: String(process.env.AD_REPORT_DRY_RUN || '').toLowerCase() === 'true',
    limit: process.env.AD_REPORT_LIMIT || 50
  })
    .then((summary) => {
      logger.info('Advertising daily reports complete', summary);
      console.log(JSON.stringify(summary, null, 2));
      return db.end?.();
    })
    .catch(async (error) => {
      logger.error('Advertising daily reports failed', { error: error.message || error });
      console.error(error.message || error);
      await db.end?.();
      process.exit(1);
    });
}

module.exports = {
  sendDailyAdvertisingReports
};
