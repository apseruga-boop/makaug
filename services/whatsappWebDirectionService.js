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

module.exports = {
  isOwnWhatsappMessage
};
