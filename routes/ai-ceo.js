const express = require('express');

const {
  handleCeoCommand,
  handleInboundEmailForCeo,
  isAiCeoTelegramOwnerChat,
  sendTelegramMessage
} = require('../services/aiCeoControlService');

const router = express.Router();

function forbidden(res) {
  return res.status(403).json({ ok: false, error: 'forbidden' });
}

function telegramSecretValid(req) {
  const expected = String(process.env.AI_CEO_TELEGRAM_WEBHOOK_SECRET || '').trim();
  if (!expected) return false;
  const provided = String(
    req.headers['x-telegram-bot-api-secret-token']
    || req.query.secret
    || req.body.secret
    || ''
  ).trim();
  return provided === expected;
}

function emailTokenValid(req) {
  const expected = String(process.env.AI_CEO_EMAIL_WEBHOOK_TOKEN || '').trim();
  if (!expected) return false;
  const provided = String(
    req.headers['x-ai-ceo-email-token']
    || req.query.token
    || req.body.token
    || ''
  ).trim();
  return provided === expected;
}

router.post('/telegram/webhook', async (req, res, next) => {
  try {
    if (!telegramSecretValid(req)) return forbidden(res);

    const message = req.body.message || req.body.edited_message || {};
    const chatId = String(message.chat?.id || '').trim();
    const text = String(message.text || '').trim();
    if (!chatId || !text) return res.json({ ok: true, ignored: true });
    if (!isAiCeoTelegramOwnerChat(chatId)) return forbidden(res);

    const data = await handleCeoCommand({
      commandText: text,
      channel: 'telegram_owner',
      requestedBy: `telegram:${chatId}`,
      requesterChatId: chatId
    });
    const telegram = await sendTelegramMessage(chatId, data.response || data.summary || 'Done.');
    return res.json({ ok: true, data, telegram });
  } catch (error) {
    return next(error);
  }
});

router.post('/email/inbound', async (req, res, next) => {
  try {
    if (!emailTokenValid(req)) return forbidden(res);
    if (String(process.env.AI_CEO_INBOUND_EMAIL_ENABLED || '').trim().toLowerCase() !== 'true') {
      return res.status(409).json({ ok: false, error: 'ai_ceo_inbound_email_disabled' });
    }

    const data = await handleInboundEmailForCeo({
      from: req.body.from || req.body.sender || req.body.reply_to,
      subject: req.body.subject || '',
      text: req.body.text || req.body.body || req.body.plain || '',
      messageId: req.body.message_id || req.body.messageId || '',
      channel: 'email'
    });
    return res.json({ ok: true, data });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
