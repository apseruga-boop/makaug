require('dotenv').config();

const db = require('../config/database');
const { getSupportEmail, sendSupportEmail } = require('../services/emailService');
const {
  emailProviderConfigured,
  runCeoMorningReport,
  sendReportToFounderWhatsapp
} = require('../services/aiCeoControlService');

function enabled(value, fallback = true) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(text);
}

async function main() {
  const report = await runCeoMorningReport({
    reportType: 'morning',
    createdBy: 'scheduled_ai_ceo'
  });

  const deliveries = {};
  if (enabled(process.env.AI_CEO_DELIVER_WHATSAPP, true)) {
    deliveries.whatsapp = await sendReportToFounderWhatsapp(report.summary, {
      source: 'scheduled_ai_ceo_morning_report',
      actorId: 'scheduled_ai_ceo'
    });
  }

  if (enabled(process.env.AI_CEO_DELIVER_EMAIL, true) && emailProviderConfigured()) {
    const to = process.env.AI_CEO_OWNER_EMAIL || process.env.FOUNDER_EMAIL || getSupportEmail();
    deliveries.email = await sendSupportEmail({
      to,
      subject: 'MakaUg AI CEO morning report',
      text: report.summary
    });
  }

  console.log(JSON.stringify({
    ok: true,
    report_id: report.report?.id || null,
    deliveries
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end().catch(() => {});
  });
