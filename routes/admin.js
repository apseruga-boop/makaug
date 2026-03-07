const express = require('express');

const db = require('../config/database');
const { requireAdminApiKey } = require('../middleware/auth');
const { parsePagination, toPagination } = require('../utils/pagination');

const router = express.Router();

router.use(requireAdminApiKey);

router.get('/summary', async (req, res, next) => {
  try {
    const [properties, agents, reports, requests, inquiries, users] = await Promise.all([
      db.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
          COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
         FROM properties`
      ),
      db.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved
         FROM agents`
      ),
      db.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'open')::int AS open
         FROM report_listings`
      ),
      db.query('SELECT COUNT(*)::int AS total FROM property_requests'),
      db.query('SELECT COUNT(*)::int AS total FROM property_inquiries'),
      db.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended,
          COUNT(*) FILTER (WHERE phone_verified = TRUE)::int AS phone_verified
         FROM users`
      )
    ]);

    return res.json({
      ok: true,
      data: {
        properties: properties.rows[0],
        agents: agents.rows[0],
        users: users.rows[0],
        reports: reports.rows[0],
        propertyRequests: requests.rows[0],
        inquiries: inquiries.rows[0]
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/recent', async (req, res, next) => {
  try {
    const [recentProperties, recentAgents, recentReports, recentUsers] = await Promise.all([
      db.query(
        `SELECT id, title, listing_type, district, status, created_at
         FROM properties
         ORDER BY created_at DESC
         LIMIT 20`
      ),
      db.query(
        `SELECT id, full_name, company_name, licence_number, status, created_at
         FROM agents
         ORDER BY created_at DESC
         LIMIT 20`
      ),
      db.query(
        `SELECT id, property_reference, reason, status, created_at
         FROM report_listings
         ORDER BY created_at DESC
         LIMIT 20`
      ),
      db.query(
        `SELECT id, first_name, last_name, phone, email, role, status, phone_verified, created_at
         FROM users
         ORDER BY created_at DESC
         LIMIT 20`
      )
    ]);

    return res.json({
      ok: true,
      data: {
        recentProperties: recentProperties.rows,
        recentAgents: recentAgents.rows,
        recentReports: recentReports.rows,
        recentUsers: recentUsers.rows
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/users', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const search = String(req.query.search || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim().toLowerCase();
    const role = String(req.query.role || '').trim().toLowerCase();

    const filters = [];
    const values = [];

    if (search) {
      values.push(`%${search}%`);
      filters.push(`(
        u.first_name ILIKE $${values.length}
        OR u.last_name ILIKE $${values.length}
        OR u.phone ILIKE $${values.length}
        OR COALESCE(u.email, '') ILIKE $${values.length}
      )`);
    }
    if (status) {
      values.push(status);
      filters.push(`u.status = $${values.length}`);
    }
    if (role) {
      values.push(role);
      filters.push(`u.role = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM users u ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT
        u.id,
        u.first_name,
        u.last_name,
        u.phone,
        u.email,
        u.role,
        u.status,
        u.phone_verified,
        u.last_login_at,
        u.created_at,
        COALESCE(p.listings_count, 0) AS listings_count,
        COALESCE(i.inquiries_count, 0) AS inquiries_count
      FROM users u
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS listings_count
        FROM properties p
        WHERE p.lister_phone = u.phone
      ) p ON true
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS inquiries_count
        FROM property_inquiries i
        WHERE i.contact_phone = u.phone OR i.contact_email = u.email
      ) i ON true
      ${where}
      ORDER BY u.created_at DESC
      LIMIT $${values.length + 1}
      OFFSET $${values.length + 2}`,
      listValues
    );

    return res.json({
      ok: true,
      data: rows.rows,
      pagination: toPagination(total, page, limit)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await db.query(
      `SELECT id, first_name, last_name, phone, email, role, status, phone_verified, last_login_at, created_at, updated_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.params.id]
    );

    if (!user.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    const [listings, inquiries] = await Promise.all([
      db.query(
        `SELECT id, title, listing_type, district, area, status, created_at
         FROM properties
         WHERE lister_phone = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [user.rows[0].phone]
      ),
      db.query(
        `SELECT id, property_id, message, channel, created_at
         FROM property_inquiries
         WHERE contact_phone = $1 OR contact_email = $2
         ORDER BY created_at DESC
         LIMIT 100`,
        [user.rows[0].phone, user.rows[0].email]
      )
    ]);

    return res.json({
      ok: true,
      data: {
        ...user.rows[0],
        listings: listings.rows,
        inquiries: inquiries.rows
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.patch('/users/:id', async (req, res, next) => {
  try {
    const status = req.body.status ? String(req.body.status).trim().toLowerCase() : undefined;
    const role = req.body.role ? String(req.body.role).trim().toLowerCase() : undefined;
    const phoneVerified = typeof req.body.phone_verified === 'boolean' ? req.body.phone_verified : undefined;

    const allowedStatuses = ['active', 'suspended', 'deleted'];
    const allowedRoles = ['buyer_renter', 'property_owner', 'agent_broker'];

    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid status value' });
    }
    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({ ok: false, error: 'Invalid role value' });
    }
    if (status === undefined && role === undefined && phoneVerified === undefined) {
      return res.status(400).json({ ok: false, error: 'No supported fields to update' });
    }

    const setParts = [];
    const values = [req.params.id];
    let idx = 2;

    if (status !== undefined) {
      setParts.push(`status = $${idx}`);
      values.push(status);
      idx += 1;
    }
    if (role !== undefined) {
      setParts.push(`role = $${idx}`);
      values.push(role);
      idx += 1;
    }
    if (phoneVerified !== undefined) {
      setParts.push(`phone_verified = $${idx}`);
      values.push(phoneVerified);
      idx += 1;
    }

    const updated = await db.query(
      `UPDATE users
       SET ${setParts.join(', ')}
       WHERE id = $1
       RETURNING id, first_name, last_name, phone, email, role, status, phone_verified, updated_at`,
      values
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
