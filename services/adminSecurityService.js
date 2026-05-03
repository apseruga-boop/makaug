'use strict';

const logger = require('../config/logger');

function getIpAddress(req) {
  return String(
    req?.headers?.['x-forwarded-for']
      || req?.socket?.remoteAddress
      || ''
  ).split(',')[0].trim() || null;
}

async function writeAdminAudit(db, {
  adminUserId = null,
  action,
  targetType = null,
  targetId = null,
  metadata = {},
  req = null
} = {}) {
  if (!db || !action) return null;
  const payload = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  try {
    const result = await db.query(
      `INSERT INTO admin_audit_logs (
        admin_user_id, action, target_type, target_id, ip_address, user_agent, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
      RETURNING id`,
      [
        adminUserId || null,
        String(action).slice(0, 160),
        targetType || null,
        targetId ? String(targetId).slice(0, 160) : null,
        getIpAddress(req),
        req?.get ? (req.get('user-agent') || null) : null,
        JSON.stringify(payload)
      ]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (!['42P01', '42703'].includes(error.code)) {
      logger.warn('Admin audit log write failed', { action, error: error.message });
    }
    return null;
  }
}

async function mirrorLegacyAudit(db, {
  actorId = null,
  action,
  details = {}
} = {}) {
  if (!db || !action) return null;
  try {
    const result = await db.query(
      `INSERT INTO audit_logs (actor_id, action, details)
       VALUES ($1,$2,$3::jsonb)
       RETURNING id`,
      [actorId || null, String(action).slice(0, 160), JSON.stringify(details || {})]
    );
    return result.rows[0] || null;
  } catch (_error) {
    return null;
  }
}

async function ensureAdminSecuritySettings(db, user = {}, options = {}) {
  if (!db || !user?.id || !['admin', 'super_admin'].includes(String(user.role || '').toLowerCase())) return null;
  try {
    const result = await db.query(
      `INSERT INTO admin_security_settings (
        user_id, role, mfa_enabled, last_password_change_at, force_password_change
      ) VALUES ($1,$2,false,$3,$4)
      ON CONFLICT (user_id) DO UPDATE
      SET role = EXCLUDED.role,
          force_password_change = admin_security_settings.force_password_change OR EXCLUDED.force_password_change,
          updated_at = NOW()
      RETURNING *`,
      [
        user.id,
        user.role,
        options.lastPasswordChangeAt || null,
        options.forcePasswordChange === true
      ]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (!['42P01', '42703'].includes(error.code)) {
      logger.warn('Admin security settings write failed', { userId: user.id, error: error.message });
    }
    return null;
  }
}

async function recordAdminLogin(db, user = {}, req = null) {
  if (!db || !user?.id || !['admin', 'super_admin'].includes(String(user.role || '').toLowerCase())) return;
  await ensureAdminSecuritySettings(db, user);
  try {
    await db.query(
      `UPDATE admin_security_settings
       SET last_login_at = NOW(),
           failed_login_count = 0,
           updated_at = NOW()
       WHERE user_id = $1`,
      [user.id]
    );
  } catch (_error) {}
  await writeAdminAudit(db, {
    adminUserId: user.id,
    action: 'admin_login',
    targetType: 'user',
    targetId: user.id,
    metadata: { role: user.role },
    req
  });
  await mirrorLegacyAudit(db, {
    actorId: user.id,
    action: 'admin_login',
    details: { role: user.role }
  });
}

async function recordAdminPasswordChange(db, user = {}, req = null) {
  if (!db || !user?.id || !['admin', 'super_admin'].includes(String(user.role || '').toLowerCase())) return;
  await ensureAdminSecuritySettings(db, user);
  try {
    await db.query(
      `UPDATE admin_security_settings
       SET last_password_change_at = NOW(),
           force_password_change = FALSE,
           updated_at = NOW()
       WHERE user_id = $1`,
      [user.id]
    );
  } catch (_error) {}
  await writeAdminAudit(db, {
    adminUserId: user.id,
    action: 'admin_password_changed',
    targetType: 'user',
    targetId: user.id,
    metadata: { role: user.role },
    req
  });
}

module.exports = {
  ensureAdminSecuritySettings,
  mirrorLegacyAudit,
  recordAdminLogin,
  recordAdminPasswordChange,
  writeAdminAudit
};
