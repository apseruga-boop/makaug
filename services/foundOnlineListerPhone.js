'use strict';

/**
 * Found-online listers are never messaged. The phone on a scraped listing
 * belongs to someone who did not ask to hear from us.
 */

const { foundOnlinePropertySql } = require('../utils/foundOnlineSql');

function phoneKey(value) {
  return String(value || '').replace(/\D/g, '').slice(-9);
}

async function isFoundOnlineListerPhone(db, phone) {
  const key = phoneKey(phone);
  if (!key || key.length < 9 || !db || typeof db.query !== 'function') return false;
  try {
    const result = await db.query(
      `SELECT 1
         FROM properties p
        WHERE ${foundOnlinePropertySql('p')}
          AND (
            RIGHT(REGEXP_REPLACE(COALESCE(p.lister_phone, p.contact_phone, p.whatsapp, p.phone, ''), '[^0-9]', '', 'g'), 9) = $1
            OR RIGHT(REGEXP_REPLACE(COALESCE(p.extra_fields->>'lister_phone', p.extra_fields->>'phone', p.extra_fields->>'whatsapp', ''), '[^0-9]', '', 'g'), 9) = $1
          )
        LIMIT 1`,
      [key]
    );
    if (result.rows[0]) return true;
  } catch (_) {
    // A missing column must not block every send. Try the common columns only.
    try {
      const result = await db.query(
        `SELECT 1
           FROM properties p
          WHERE ${foundOnlinePropertySql('p')}
            AND RIGHT(REGEXP_REPLACE(COALESCE(p.lister_phone, ''), '[^0-9]', '', 'g'), 9) = $1
          LIMIT 1`,
        [key]
      );
      if (result.rows[0]) return true;
    } catch (__) { /* fail open on a schema we cannot read */ }
  }
  try {
    const result = await db.query(
      `SELECT 1
         FROM short_term_listings s
        WHERE COALESCE(s.do_not_message, false) = true
          AND RIGHT(REGEXP_REPLACE(COALESCE(s.host_phone, s.contact_phone, ''), '[^0-9]', '', 'g'), 9) = $1
        LIMIT 1`,
      [key]
    );
    return Boolean(result.rows[0]);
  } catch (_) {
    return false;
  }
}

module.exports = {
  phoneKey,
  isFoundOnlineListerPhone
};
