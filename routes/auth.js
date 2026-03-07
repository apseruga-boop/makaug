const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const db = require('../config/database');
const smsService = require('../models/smsService');
const logger = require('../config/logger');
const { cleanText, isValidEmail, isValidPhone } = require('../middleware/validation');

const router = express.Router();

function normalizePhone(phone) {
  return cleanText(phone).replace(/\s+/g, '');
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    phone_verified: row.phone_verified,
    status: row.status,
    created_at: row.created_at
  };
}

function createToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not configured');
  }

  return jwt.sign(
    {
      sub: user.id,
      phone: user.phone,
      role: user.role
    },
    secret,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function getAuthUserIdFromRequest(req) {
  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    return { error: 'Missing bearer token' };
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return { userId: decoded.sub };
  } catch (error) {
    return { error: 'Invalid token' };
  }
}

async function issueOtp(phone, purpose) {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresMinutes = Math.max(parseInt(process.env.OTP_EXPIRES_MINUTES || '10', 10), 1);

  await db.query(
    `INSERT INTO otps (phone, code, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4::text || ' minutes')::interval)`,
    [phone, otp, purpose, String(expiresMinutes)]
  );

  try {
    await smsService.sendSMS(phone, `MakayUg verification code: ${otp}. Expires in ${expiresMinutes} minutes.`);
  } catch (error) {
    logger.error('Failed to send OTP SMS', error.message);
  }

  return otp;
}

router.post('/register', async (req, res, next) => {
  try {
    const firstName = cleanText(req.body.first_name);
    const lastName = cleanText(req.body.last_name);
    const phone = normalizePhone(req.body.phone);
    const email = cleanText(req.body.email).toLowerCase() || null;
    const roleInput = cleanText(req.body.role).toLowerCase();
    const password = cleanText(req.body.password);

    const roleMap = {
      'buyer / renter': 'buyer_renter',
      buyer: 'buyer_renter',
      renter: 'buyer_renter',
      buyer_renter: 'buyer_renter',
      'property owner': 'property_owner',
      owner: 'property_owner',
      property_owner: 'property_owner',
      'agent / broker': 'agent_broker',
      agent: 'agent_broker',
      broker: 'agent_broker',
      agent_broker: 'agent_broker'
    };

    const role = roleMap[roleInput] || 'buyer_renter';

    const errors = [];
    if (!firstName) errors.push('first_name is required');
    if (!lastName) errors.push('last_name is required');
    if (!phone) errors.push('phone is required');
    if (!password || password.length < 8) errors.push('password must be at least 8 characters');
    if (phone && !isValidPhone(phone)) errors.push('phone is invalid');
    if (email && !isValidEmail(email)) errors.push('email is invalid');

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await db.query(
      `INSERT INTO users (
        first_name,
        last_name,
        phone,
        email,
        role,
        password_hash,
        phone_verified,
        status
      ) VALUES ($1,$2,$3,$4,$5,$6,false,'active')
      RETURNING *`,
      [firstName, lastName, phone, email, role, passwordHash]
    );

    const user = result.rows[0];
    const otp = await issueOtp(phone, 'signup');

    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    return res.status(201).json({
      ok: true,
      data: {
        user: publicUser(user),
        requires_otp: true,
        message: 'Verification OTP sent to phone',
        dev_otp: process.env.NODE_ENV === 'production' ? undefined : otp
      }
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Account with this phone or email already exists' });
    }
    return next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const password = cleanText(req.body.password);

    if (!phone || !password) {
      return res.status(400).json({ ok: false, error: 'phone and password are required' });
    }

    const result = await db.query('SELECT * FROM users WHERE phone = $1 AND status = $2 LIMIT 1', [phone, 'active']);
    if (!result.rows.length) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }

    if (!user.phone_verified) {
      return res.status(403).json({ ok: false, error: 'Phone not verified. Use OTP sign in to verify this account.' });
    }

    const token = createToken(user);
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    return res.json({ ok: true, data: { token, user: publicUser(user) } });
  } catch (error) {
    return next(error);
  }
});

router.post('/request-otp', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const purposeRaw = cleanText(req.body.purpose).toLowerCase();
    const purpose = ['signup', 'login', 'reset_password'].includes(purposeRaw) ? purposeRaw : 'login';

    if (!phone || !isValidPhone(phone)) {
      return res.status(400).json({ ok: false, error: 'Valid phone is required' });
    }

    const exists = await db.query('SELECT id FROM users WHERE phone = $1 AND status = $2 LIMIT 1', [phone, 'active']);
    if (!exists.rows.length) {
      return res.status(404).json({ ok: false, error: 'No account found with that phone' });
    }

    const otp = await issueOtp(phone, purpose);

    return res.json({
      ok: true,
      data: {
        message: 'OTP sent',
        dev_otp: process.env.NODE_ENV === 'production' ? undefined : otp
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/request-password-reset', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);

    if (!phone || !isValidPhone(phone)) {
      return res.status(400).json({ ok: false, error: 'Valid phone is required' });
    }

    const exists = await db.query('SELECT id FROM users WHERE phone = $1 AND status = $2 LIMIT 1', [phone, 'active']);
    if (!exists.rows.length) {
      return res.status(404).json({ ok: false, error: 'No account found with that phone' });
    }

    const otp = await issueOtp(phone, 'reset_password');

    return res.json({
      ok: true,
      data: {
        message: 'Password reset OTP sent',
        dev_otp: process.env.NODE_ENV === 'production' ? undefined : otp
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/reset-password', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const code = cleanText(req.body.code);
    const newPassword = cleanText(req.body.new_password);

    if (!phone || !code || !newPassword) {
      return res.status(400).json({ ok: false, error: 'phone, code and new_password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ ok: false, error: 'new_password must be at least 8 characters' });
    }

    const otp = await db.query(
      `SELECT *
       FROM otps
       WHERE phone = $1
         AND code = $2
         AND purpose = 'reset_password'
         AND used = FALSE
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [phone, code]
    );

    if (!otp.rows.length) {
      return res.status(400).json({ ok: false, error: 'Invalid or expired OTP code' });
    }

    const userResult = await db.query('SELECT * FROM users WHERE phone = $1 AND status = $2 LIMIT 1', [phone, 'active']);
    if (!userResult.rows.length) {
      return res.status(404).json({ ok: false, error: 'Account not found' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await db.query('UPDATE otps SET used = TRUE WHERE id = $1', [otp.rows[0].id]);
    await db.query('UPDATE users SET password_hash = $2, phone_verified = TRUE WHERE phone = $1', [phone, newHash]);

    return res.json({ ok: true, data: { reset: true } });
  } catch (error) {
    return next(error);
  }
});

router.post('/verify-otp', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const code = cleanText(req.body.code);
    const purposeRaw = cleanText(req.body.purpose).toLowerCase();
    const purpose = purposeRaw === 'signup' ? 'signup' : 'login';

    if (!phone || !code) {
      return res.status(400).json({ ok: false, error: 'phone and code are required' });
    }

    const otp = await db.query(
      `SELECT *
       FROM otps
       WHERE phone = $1
         AND code = $2
         AND purpose = $3
         AND used = FALSE
         AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [phone, code, purpose]
    );

    if (!otp.rows.length) {
      return res.status(400).json({ ok: false, error: 'Invalid or expired OTP code' });
    }

    await db.query('UPDATE otps SET used = TRUE WHERE id = $1', [otp.rows[0].id]);
    await db.query('UPDATE users SET phone_verified = TRUE WHERE phone = $1', [phone]);

    const userResult = await db.query('SELECT * FROM users WHERE phone = $1 AND status = $2 LIMIT 1', [phone, 'active']);
    if (!userResult.rows.length) {
      return res.status(404).json({ ok: false, error: 'Account not found' });
    }

    const user = userResult.rows[0];
    const token = createToken(user);
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    return res.json({ ok: true, data: { token, user: publicUser(user) } });
  } catch (error) {
    return next(error);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    const auth = getAuthUserIdFromRequest(req);
    if (auth.error) {
      return res.status(401).json({ ok: false, error: auth.error });
    }

    const result = await db.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [auth.userId]);
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    return res.json({ ok: true, data: { user: publicUser(result.rows[0]) } });
  } catch (error) {
    return next(error);
  }
});

router.patch('/me', async (req, res, next) => {
  try {
    const auth = getAuthUserIdFromRequest(req);
    if (auth.error) {
      return res.status(401).json({ ok: false, error: auth.error });
    }

    const current = await db.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [auth.userId]);
    if (!current.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const user = current.rows[0];
    const firstName = cleanText(req.body.first_name) || user.first_name;
    const lastName = cleanText(req.body.last_name) || user.last_name;
    const emailInput = req.body.email !== undefined ? cleanText(req.body.email).toLowerCase() : user.email;
    const roleInput = cleanText(req.body.role).toLowerCase() || user.role;

    const roleMap = {
      'buyer / renter': 'buyer_renter',
      buyer: 'buyer_renter',
      renter: 'buyer_renter',
      buyer_renter: 'buyer_renter',
      'property owner': 'property_owner',
      owner: 'property_owner',
      property_owner: 'property_owner',
      'agent / broker': 'agent_broker',
      agent: 'agent_broker',
      broker: 'agent_broker',
      agent_broker: 'agent_broker'
    };
    const role = roleMap[roleInput] || user.role;

    if (emailInput && !isValidEmail(emailInput)) {
      return res.status(400).json({ ok: false, error: 'email is invalid' });
    }

    const updated = await db.query(
      `UPDATE users
       SET first_name = $2,
           last_name = $3,
           email = $4,
           role = $5
       WHERE id = $1
       RETURNING *`,
      [auth.userId, firstName, lastName, emailInput || null, role]
    );

    return res.json({ ok: true, data: { user: publicUser(updated.rows[0]) } });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Email already in use' });
    }
    return next(error);
  }
});

router.post('/change-password', async (req, res, next) => {
  try {
    const auth = getAuthUserIdFromRequest(req);
    if (auth.error) {
      return res.status(401).json({ ok: false, error: auth.error });
    }

    const oldPassword = cleanText(req.body.old_password);
    const newPassword = cleanText(req.body.new_password);

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: 'old_password and new_password are required' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ ok: false, error: 'new_password must be at least 8 characters' });
    }

    const result = await db.query('SELECT * FROM users WHERE id = $1 LIMIT 1', [auth.userId]);
    if (!result.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(oldPassword, user.password_hash);
    if (!ok) {
      return res.status(400).json({ ok: false, error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [auth.userId, newHash]);

    return res.json({ ok: true, data: { changed: true } });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
