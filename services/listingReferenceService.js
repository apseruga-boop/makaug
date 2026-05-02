'use strict';

const crypto = require('crypto');

function buildListingReference(date = new Date()) {
  const resolvedDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  const yyyymmdd = resolvedDate.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `MK-${yyyymmdd}-${suffix}`;
}

function isListingReference(value = '') {
  return /^MK-\d{8}-[A-Z0-9]{6}$/.test(String(value || ''));
}

module.exports = {
  buildListingReference,
  isListingReference
};
