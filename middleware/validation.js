function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function cleanText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function toNullableInt(value) {
  if (value == null || value === '') return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function toNullableFloat(value) {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().replace(/,/g, '');
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function isValidEmail(email) {
  if (!email) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  if (!phone) return true;
  return /^\+?[0-9]{10,15}$/.test(String(phone).replace(/\s/g, ''));
}

module.exports = {
  asArray,
  cleanText,
  toNullableInt,
  toNullableFloat,
  isValidEmail,
  isValidPhone
};
