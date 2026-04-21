const express = require('express');

const db = require('../config/database');
const { requireAdminApiKey } = require('../middleware/auth');
const { parsePagination, toPagination } = require('../utils/pagination');
const { processPendingCampaignQueue } = require('../services/whatsappCampaignService');
const { generateCampaignCopy } = require('../services/aiService');

const router = express.Router();

router.use(requireAdminApiKey);

async function writeAudit(action, details = {}, actorId = 'admin_api_key') {
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_id, action, details)
       VALUES ($1, $2, $3::jsonb)`,
      [actorId, action, JSON.stringify(details || {})]
    );
  } catch (_error) {
    // Avoid failing admin APIs when audit table is temporarily unavailable.
  }
}

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
    const allowedRoles = ['buyer_renter', 'property_owner', 'agent_broker', 'field_agent', 'admin'];

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

    await writeAudit('admin_user_updated', {
      user_id: req.params.id,
      status: status || null,
      role: role || null,
      phone_verified: phoneVerified
    });

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/agents', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = String(req.query.status || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const filters = [];
    const values = [];

    if (status) {
      values.push(status);
      filters.push(`a.status = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(
        a.full_name ILIKE $${values.length}
        OR COALESCE(a.company_name, '') ILIKE $${values.length}
        OR COALESCE(a.email, '') ILIKE $${values.length}
        OR a.phone ILIKE $${values.length}
      )`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM agents a ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT
        a.id,
        a.full_name,
        a.company_name,
        a.phone,
        a.email,
        a.licence_number,
        a.registration_status,
        a.status,
        a.created_at,
        a.updated_at
      FROM agents a
      ${where}
      ORDER BY a.created_at DESC
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

router.patch('/agents/:id/status', async (req, res, next) => {
  try {
    const status = String(req.body.status || '').trim().toLowerCase();
    const allowedStatuses = ['pending', 'approved', 'rejected', 'suspended'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid status value' });
    }

    const updated = await db.query(
      `UPDATE agents
       SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, full_name, company_name, status, updated_at`,
      [req.params.id, status]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'Agent not found' });
    }

    await writeAudit('admin_agent_status_updated', {
      agent_id: req.params.id,
      status
    });

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/reports', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = String(req.query.status || '').trim().toLowerCase();
    const search = String(req.query.search || '').trim().toLowerCase();

    const filters = [];
    const values = [];

    if (status) {
      values.push(status);
      filters.push(`r.status = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      filters.push(`(
        r.property_reference ILIKE $${values.length}
        OR r.reason ILIKE $${values.length}
        OR COALESCE(r.details, '') ILIKE $${values.length}
      )`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM report_listings r ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT
        r.id,
        r.property_reference,
        r.reason,
        r.details,
        r.reporter_contact,
        r.status,
        r.created_at,
        r.updated_at
      FROM report_listings r
      ${where}
      ORDER BY r.created_at DESC
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

router.patch('/reports/:id/status', async (req, res, next) => {
  try {
    const status = String(req.body.status || '').trim().toLowerCase();
    const resolutionNote = String(req.body.resolution_note || '').trim();
    const allowedStatuses = ['open', 'in_review', 'resolved', 'dismissed'];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ ok: false, error: 'Invalid status value' });
    }

    const updated = await db.query(
      `UPDATE report_listings
       SET
         status = $2,
         details = CASE
           WHEN $3::text = '' THEN details
           ELSE CONCAT(COALESCE(details, ''), CASE WHEN COALESCE(details, '') = '' THEN '' ELSE E'\n\n' END, 'Admin note: ', $3::text)
         END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, property_reference, reason, details, reporter_contact, status, updated_at`,
      [req.params.id, status, resolutionNote]
    );

    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'Report not found' });
    }

    await writeAudit('admin_report_status_updated', {
      report_id: req.params.id,
      status,
      resolution_note: resolutionNote || null
    });

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.get('/whatsapp/insights', async (req, res, next) => {
  try {
    const [
      msgCounts,
      activeUsers,
      optIn,
      queueCounts,
      topIntents,
      transcriptionCounts
    ] = await Promise.all([
      db.query(
        `SELECT
          COUNT(*) FILTER (WHERE direction = 'inbound')::int AS inbound,
          COUNT(*) FILTER (WHERE direction = 'outbound')::int AS outbound,
          COUNT(*)::int AS total
         FROM whatsapp_messages`
      ),
      db.query(
        `SELECT
          COUNT(DISTINCT user_phone)::int AS active_7d
         FROM whatsapp_messages
         WHERE created_at >= NOW() - INTERVAL '7 days'`
      ),
      db.query(
        `SELECT
          COUNT(*) FILTER (WHERE marketing_opt_in = TRUE)::int AS opted_in,
          COUNT(*) FILTER (WHERE marketing_opt_in = FALSE)::int AS opted_out
         FROM whatsapp_user_profiles`
      ),
      db.query(
        `SELECT
          COUNT(*) FILTER (WHERE status IN ('pending','retry'))::int AS pending,
          COUNT(*) FILTER (WHERE status = 'sent')::int AS sent,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
         FROM outbound_message_queue
         WHERE channel = 'whatsapp'`
      ),
      db.query(
        `SELECT detected_intent, COUNT(*)::int AS total
         FROM whatsapp_intent_logs
         WHERE created_at >= NOW() - INTERVAL '14 days'
         GROUP BY detected_intent
         ORDER BY total DESC
         LIMIT 10`
      ),
      db.query(
        `SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS last_7d
         FROM transcriptions`
      )
    ]);

    return res.json({
      ok: true,
      data: {
        messages: msgCounts.rows[0],
        activeUsers: activeUsers.rows[0],
        optIn: optIn.rows[0],
        queue: queueCounts.rows[0],
        topIntents: topIntents.rows,
        transcriptions: transcriptionCounts.rows[0]
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/whatsapp/messages', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const direction = String(req.query.direction || '').trim().toLowerCase();
    const phone = String(req.query.phone || '').trim();
    const type = String(req.query.type || '').trim().toLowerCase();

    const filters = [];
    const values = [];

    if (direction) {
      values.push(direction);
      filters.push(`direction = $${values.length}`);
    }
    if (phone) {
      values.push(`%${phone}%`);
      filters.push(`user_phone ILIKE $${values.length}`);
    }
    if (type) {
      values.push(type);
      filters.push(`message_type = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM whatsapp_messages ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT id, user_phone, wa_message_id, direction, message_type, payload, created_at
       FROM whatsapp_messages
       ${where}
       ORDER BY created_at DESC
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

router.get('/whatsapp/intents', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const phone = String(req.query.phone || '').trim();
    const intent = String(req.query.intent || '').trim().toLowerCase();

    const filters = [];
    const values = [];

    if (phone) {
      values.push(`%${phone}%`);
      filters.push(`user_phone ILIKE $${values.length}`);
    }
    if (intent) {
      values.push(intent);
      filters.push(`detected_intent = $${values.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM whatsapp_intent_logs ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT id, user_phone, wa_message_id, detected_intent, confidence, language, current_step, raw_text, transcript, entities, model_used, created_at
       FROM whatsapp_intent_logs
       ${where}
       ORDER BY created_at DESC
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

router.get('/campaigns', async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const status = String(req.query.status || '').trim().toLowerCase();

    const values = [];
    const where = status ? `WHERE status = $1` : '';
    if (status) values.push(status);

    const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM marketing_campaigns ${where}`, values);
    const total = countResult.rows[0]?.total || 0;

    const listValues = [...values, limit, offset];
    const rows = await db.query(
      `SELECT
        c.*,
        COALESCE(q.total_recipients, 0) AS total_recipients,
        COALESCE(q.sent_count, 0) AS sent_count,
        COALESCE(q.pending_count, 0) AS pending_count,
        COALESCE(q.failed_count, 0) AS failed_count
       FROM marketing_campaigns c
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS total_recipients,
           COUNT(*) FILTER (WHERE status = 'sent')::int AS sent_count,
           COUNT(*) FILTER (WHERE status IN ('pending','retry'))::int AS pending_count,
           COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_count
         FROM outbound_message_queue q
         WHERE q.campaign_id = c.id
       ) q ON true
       ${where}
       ORDER BY c.created_at DESC
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

router.post('/campaigns/draft', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const objective = String(req.body.objective || '').trim();
    const audience = String(req.body.audience || '').trim();
    const language = String(req.body.language || 'English').trim();
    const channel = String(req.body.channel || 'whatsapp').trim().toLowerCase();
    const targetFilter = req.body.target_filter && typeof req.body.target_filter === 'object'
      ? req.body.target_filter
      : {};

    if (!name) {
      return res.status(400).json({ ok: false, error: 'name is required' });
    }
    if (!['whatsapp', 'sms', 'email'].includes(channel)) {
      return res.status(400).json({ ok: false, error: 'channel must be whatsapp, sms, or email' });
    }

    const generated = await generateCampaignCopy({
      objective,
      audience,
      language,
      channel
    });

    const inserted = await db.query(
      `INSERT INTO marketing_campaigns
        (name, channel, objective, message_template, target_filter, status, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'draft', $6)
       RETURNING *`,
      [
        name,
        channel,
        objective || null,
        generated.text,
        JSON.stringify(targetFilter),
        req.ip || 'admin_api_key'
      ]
    );

    await writeAudit('campaign_draft_created', {
      campaign_id: inserted.rows[0].id,
      channel,
      objective,
      model: generated.model
    });

    return res.status(201).json({
      ok: true,
      data: {
        ...inserted.rows[0],
        generated_by_model: generated.model
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/campaigns/:id/queue', async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const limit = Math.max(1, Math.min(parseInt(req.body.limit, 10) || 2000, 20000));

    const campaignResult = await db.query(
      `SELECT *
       FROM marketing_campaigns
       WHERE id = $1
       LIMIT 1`,
      [campaignId]
    );
    if (!campaignResult.rows.length) {
      return res.status(404).json({ ok: false, error: 'Campaign not found' });
    }

    const campaign = campaignResult.rows[0];
    if (campaign.channel !== 'whatsapp') {
      return res.status(400).json({ ok: false, error: 'Only whatsapp channel queueing is currently supported' });
    }

    const filter = campaign.target_filter && typeof campaign.target_filter === 'object'
      ? campaign.target_filter
      : {};
    const languageFilter = Array.isArray(filter.languages)
      ? filter.languages.map((x) => String(x || '').trim().toLowerCase()).filter(Boolean)
      : [];
    const sinceDays = Math.max(0, parseInt(filter.active_within_days, 10) || 0);
    const minSeenAtClause = sinceDays > 0 ? `AND p.last_seen_at >= NOW() - ($2::text || ' days')::interval` : '';

    const profileValues = [limit];
    if (sinceDays > 0) profileValues.push(String(sinceDays));

    const profiles = await db.query(
      `SELECT p.phone, p.preferred_language, p.marketing_opt_in
       FROM whatsapp_user_profiles p
       WHERE p.marketing_opt_in = TRUE
       ${minSeenAtClause}
       ORDER BY p.last_seen_at DESC
       LIMIT $1`,
      profileValues
    );

    let insertedCount = 0;
    for (const profile of profiles.rows) {
      const preferredLanguage = String(profile.preferred_language || '').toLowerCase();
      if (languageFilter.length && !languageFilter.includes(preferredLanguage)) {
        continue;
      }

      await db.query(
        `INSERT INTO outbound_message_queue
          (user_phone, payload, status, attempts, next_attempt_at, campaign_id, channel, user_consent_snapshot, metadata)
         VALUES ($1, $2::jsonb, 'pending', 0, NOW(), $3, 'whatsapp', TRUE, $4::jsonb)`,
        [
          profile.phone,
          JSON.stringify({
            text: campaign.message_template
          }),
          campaign.id,
          JSON.stringify({
            source: 'admin_campaign_queue',
            preferred_language: profile.preferred_language || 'en'
          })
        ]
      );
      insertedCount += 1;
    }

    await db.query(
      `UPDATE marketing_campaigns
       SET status = CASE WHEN $2 > 0 THEN 'queued' ELSE status END,
           queued_at = CASE WHEN $2 > 0 THEN NOW() ELSE queued_at END
       WHERE id = $1`,
      [campaign.id, insertedCount]
    );

    await writeAudit('campaign_queued', {
      campaign_id: campaign.id,
      queued_recipients: insertedCount,
      requested_limit: limit
    });

    return res.json({
      ok: true,
      data: {
        campaign_id: campaign.id,
        queued_recipients: insertedCount,
        requested_limit: limit
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/campaigns/process-queue', async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(parseInt(req.body.limit, 10) || 100, 500));
    const maxAttempts = Math.max(1, Math.min(parseInt(req.body.max_attempts, 10) || 4, 10));
    const result = await processPendingCampaignQueue({ limit, maxAttempts });

    await writeAudit('campaign_queue_processed', {
      limit,
      max_attempts: maxAttempts,
      result
    });

    return res.json({
      ok: true,
      data: result
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/campaigns/:id/cancel', async (req, res, next) => {
  try {
    const campaignId = req.params.id;
    const updated = await db.query(
      `UPDATE marketing_campaigns
       SET status = 'cancelled'
       WHERE id = $1
       RETURNING id, status, updated_at`,
      [campaignId]
    );
    if (!updated.rows.length) {
      return res.status(404).json({ ok: false, error: 'Campaign not found' });
    }

    await db.query(
      `UPDATE outbound_message_queue
       SET status = 'failed',
           last_error = 'cancelled_by_admin',
           updated_at = NOW()
       WHERE campaign_id = $1
         AND status IN ('pending','retry')`,
      [campaignId]
    );

    await writeAudit('campaign_cancelled', { campaign_id: campaignId });

    return res.json({ ok: true, data: updated.rows[0] });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
