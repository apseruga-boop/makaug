'use strict';

const IGNORED_SYSTEM_CHAT_TITLES = new Set([
  'whatsapp'
]);

function normalizeWhatsappChatTitle(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isIgnoredWhatsappSystemChat(value) {
  return IGNORED_SYSTEM_CHAT_TITLES.has(normalizeWhatsappChatTitle(value));
}

module.exports = {
  isIgnoredWhatsappSystemChat,
  normalizeWhatsappChatTitle
};
