'use strict';

// Staff API for the master contact list ("people").
// GET /api/people            list (search, filters, sort, paging)
// GET /api/people/report     latest reconcile / dedupe report (counts only)
// GET /api/people/export.csv super_admin only
// GET /api/people/:id        one person with linked rows and history
//
// Signed-in staff only (moderator, admin, super_admin): the same people who
// already see contact numbers in the staff dashboard. No API-key access, so
// every read is tied to a named staff user. Responses are never cached.

const express = require('express');

const db = require('../config/database');
const logger = require('../config/logger');
const { requireStaffAccess } = require('../middleware/auth');
const {
  getPersonDetail,
  latestDedupeReport,
  listPeople,
  peopleCsv
} = require('../services/peopleService');

const router = express.Router();

router.use(requireStaffAccess);
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store, private');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

function isSuperAdmin(req) {
  return String(req.userAuth?.role || '').toLowerCase() === 'super_admin';
}

function auditInBackground(req, action, details = {}) {
  // Ids and counts only. Never the search text, a number or an email.
  db.query(
    'INSERT INTO audit_logs (actor_id, action, details) VALUES ($1, $2, $3::jsonb)',
    [String(req.userAuth?.id || 'staff_user'), action, JSON.stringify({ role: req.userAuth?.role, ...details })]
  ).catch((error) => logger.warn('People audit log failed', { action, message: error.message }));
}

function filterSummary(query = {}) {
  return {
    has_search: Boolean(String(query.q || '').trim()),
    role: query.role || null,
    source: query.source || null,
    consent: query.consent || null,
    date_field: query.date_field || null,
    has_date_range: Boolean(query.from || query.to)
  };
}

router.get('/', async (req, res, next) => {
  try {
    const result = await listPeople(db, req.query);
    return res.json({
      ok: true,
      ...result,
      can_export: isSuperAdmin(req)
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/report', async (_req, res, next) => {
  try {
    const report = await latestDedupeReport(db);
    return res.json({ ok: true, report });
  } catch (error) {
    return next(error);
  }
});

router.get('/export.csv', async (req, res, next) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ ok: false, error: 'Only the super admin can export the contact list' });
  }
  try {
    const { csv, count } = await peopleCsv(db, req.query);
    auditInBackground(req, 'people_export_csv', { rows: count, filters: filterSummary(req.query) });
    logger.info('People CSV exported', { staff_user_id: req.userAuth?.id, rows: count });
    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="makaug-people-${stamp}.csv"`);
    return res.send(`\ufeff${csv}`);
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const detail = await getPersonDetail(db, req.params.id);
    if (!detail) return res.status(404).json({ ok: false, error: 'Person not found' });
    auditInBackground(req, 'people_view_person', { person_id: detail.person.id });
    return res.json({ ok: true, ...detail, can_export: isSuperAdmin(req) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
