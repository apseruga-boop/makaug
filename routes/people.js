'use strict';

// Staff API for the master contact list ("people").
// GET /api/people            list (search, filters, sort, paging)
// GET /api/people/report     latest reconcile / dedupe report (counts only)
// GET /api/people/export.csv super_admin only
// GET /api/people/deleted    people taken off the list (active suppressions)
// POST /api/people/delete    super_admin: take people off the list, keep them off
// POST /api/people/restore   super_admin: put deleted people back
// GET /api/people/:id        one person with linked rows, original query and history
//
// Delete never touches a source row (accounts, leads, WhatsApp tables, seeker
// profiles). It removes the person from the derived list and records a
// suppression so the 15-minute / nightly reconcile does not add them back.
// Audit rows carry the action, the staff user and a count, nothing else.
//
// Signed-in staff only (moderator, admin, super_admin): the same people who
// already see contact numbers in the staff dashboard. No API-key access, so
// every read is tied to a named staff user. Responses are never cached.

const express = require('express');

const db = require('../config/database');
const logger = require('../config/logger');
const { requireStaffAccess } = require('../middleware/auth');
const {
  DELETE_MAX,
  deletePeople,
  getPersonDetail,
  latestDedupeReport,
  listDeletedPeople,
  listPeople,
  peopleCsv,
  restorePeople
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
    quick: query.quick || null,
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
      can_export: isSuperAdmin(req),
      can_delete: isSuperAdmin(req)
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

router.get('/deleted', async (req, res, next) => {
  try {
    const result = await listDeletedPeople(db, req.query);
    return res.json({ ok: true, ...result, can_restore: isSuperAdmin(req) });
  } catch (error) {
    return next(error);
  }
});

function idsFromBody(req) {
  const body = req.body || {};
  if (Array.isArray(body.ids)) return body.ids;
  if (body.id !== undefined && body.id !== null) return [body.id];
  return [];
}

router.post('/delete', async (req, res, next) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ ok: false, error: 'Only the super admin can delete people from the list' });
  }
  const ids = idsFromBody(req);
  if (!ids.length) return res.status(400).json({ ok: false, error: 'Choose at least one person' });
  if (ids.length > DELETE_MAX) {
    return res.status(400).json({ ok: false, error: `Delete at most ${DELETE_MAX} people at a time` });
  }
  if (req.body?.confirm !== true) {
    return res.status(400).json({ ok: false, error: 'Confirm the delete first' });
  }
  try {
    const result = await deletePeople(db, ids, { actorId: req.userAuth?.id, reason: 'staff_delete' });
    auditInBackground(req, 'people_delete', { requested: result.requested, deleted: result.deleted });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return next(error);
  }
});

router.post('/restore', async (req, res, next) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ ok: false, error: 'Only the super admin can restore people to the list' });
  }
  const ids = idsFromBody(req);
  if (!ids.length) return res.status(400).json({ ok: false, error: 'Choose at least one deleted person' });
  if (ids.length > DELETE_MAX) {
    return res.status(400).json({ ok: false, error: `Restore at most ${DELETE_MAX} people at a time` });
  }
  try {
    const result = await restorePeople(db, ids, { actorId: req.userAuth?.id });
    auditInBackground(req, 'people_restore', { requested: result.requested, restored: result.restored });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const detail = await getPersonDetail(db, req.params.id);
    if (!detail) return res.status(404).json({ ok: false, error: 'Person not found' });
    auditInBackground(req, 'people_view_person', { person_id: detail.person.id });
    return res.json({ ok: true, ...detail, can_export: isSuperAdmin(req), can_delete: isSuperAdmin(req) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
