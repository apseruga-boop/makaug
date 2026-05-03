'use strict';

require('dotenv').config();

const bcrypt = require('bcryptjs');
const db = require('../config/database');
const {
  ensureAdminSecuritySettings,
  mirrorLegacyAudit,
  writeAdminAudit
} = require('../services/adminSecurityService');

function clean(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function validatePassword(password) {
  if (!password || password.length < 12) {
    throw new Error('SUPER_ADMIN_INITIAL_PASSWORD must be at least 12 characters.');
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    throw new Error('SUPER_ADMIN_INITIAL_PASSWORD must include uppercase, lowercase, and a number.');
  }
}

async function main() {
  const email = normalizeEmail(process.env.SUPER_ADMIN_EMAIL);
  const password = clean(process.env.SUPER_ADMIN_INITIAL_PASSWORD);
  const phone = clean(process.env.SUPER_ADMIN_PHONE) || `superadmin:${email}`;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('SUPER_ADMIN_EMAIL must be a valid email address.');
  }
  validatePassword(password);

  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await db.query('SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1', [email]);
  let user;

  if (existing.rows.length) {
    const updated = await db.query(
      `UPDATE users
       SET role = 'super_admin',
           password_hash = $2,
           phone = COALESCE(NULLIF(phone, ''), $3),
           phone_verified = TRUE,
           status = 'active',
           profile_data = COALESCE(profile_data, '{}'::jsonb)
             || jsonb_build_object('audience', 'super_admin', 'account_kind', 'super_admin'),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [existing.rows[0].id, passwordHash, phone]
    );
    user = updated.rows[0];
  } else {
    const inserted = await db.query(
      `INSERT INTO users (
        first_name, last_name, phone, email, role, password_hash, phone_verified,
        status, marketing_opt_in, weekly_tips_opt_in, preferred_contact_channel,
        preferred_language, profile_data
      ) VALUES (
        'MakaUg', 'Super Admin', $1, $2, 'super_admin', $3, TRUE,
        'active', FALSE, FALSE, 'email', 'en',
        jsonb_build_object('audience', 'super_admin', 'account_kind', 'super_admin')
      )
      RETURNING *`,
      [phone, email, passwordHash]
    );
    user = inserted.rows[0];
  }

  await ensureAdminSecuritySettings(db, user, {
    forcePasswordChange: true,
    lastPasswordChangeAt: null
  });
  await writeAdminAudit(db, {
    adminUserId: user.id,
    action: 'super_admin_bootstrapped',
    targetType: 'user',
    targetId: user.id,
    metadata: { email, phone_configured: Boolean(process.env.SUPER_ADMIN_PHONE) }
  });
  await mirrorLegacyAudit(db, {
    actorId: user.id,
    action: 'super_admin_bootstrapped',
    details: { email, phone_configured: Boolean(process.env.SUPER_ADMIN_PHONE) }
  });

  console.log(`Super admin ready for ${email}. Initial password was accepted but is not printed. Rotate it after first login.`);
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.pool.end().catch(() => {});
  });
