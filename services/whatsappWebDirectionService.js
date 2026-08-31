function normalizeDirection(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSenderLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isOwnWhatsappMessage({ direction = '', senderLabel = '', text = '' } = {}) {
  const normalizedDirection = normalizeDirection(direction);
  if (['out', 'outbound', 'sent'].includes(normalizedDirection)) return true;

  const explicitSender = normalizeSenderLabel(senderLabel);
  if (/^(?:you|me|makaug(?:\.com)?)$/i.test(explicitSender)) return true;
  if (['in', 'inbound', 'received'].includes(normalizedDirection) && explicitSender) return false;

  const firstRenderedLine = String(text || '')
    .split(/\r?\n/, 1)[0]
    .trim();
  return /^(?:you|me|makaug(?:\.com)?)$/i.test(firstRenderedLine);
}

function isLikelyMakaugOutboundPreview(value = '') {
  const text = normalizeSenderLabel(value);
  if (!text) return false;
  return /^(?:🔐\s*)?MakaUG employee intake\b/i.test(text)
    || /^Is the agent already registered on makaug\.com\?/i.test(text)
    || /^Send the agent(?:'|’)?s exact name\b/i.test(text)
    || /^How many properties are you sending\?/i.test(text)
    || /\bis ready for (?:one|multiple) propert(?:y|ies)\b/i.test(text)
    || /^Caption saved\. Now send (?:the )?first property media\b/i.test(text)
    || /^✅\s*(?:Batch checked|\*?\d+ properties sent for staff review)/i.test(text);
}

module.exports = {
  isLikelyMakaugOutboundPreview,
  isOwnWhatsappMessage
};
