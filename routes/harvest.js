'use strict';

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');

const db = require('../config/database');
const logger = require('../config/logger');
const {
  importExactSocialSourcePosts,
  normalizeExactSocialPostUrl,
} = require('../services/socialPlatformPostDiscoveryService');
const { recordHarvestImportResult } = require('../services/propertyHarvestMonitoringService');
const {
  processYouTubeWebSubNotification,
  verifyYouTubeWebSubChallenge,
} = require('../services/youtubeWebSubService');
const { stablePlatformPostIdentity } = require('../utils/sourceUrlNormalization');
const {
  harvestAutomationEnabled,
  harvestPublicSubmissionsEnabled,
} = require('../utils/harvestFeatureFlags');

const router = express.Router();

const submissionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many source-link submissions. Please try again later.' },
});

function clean(value = '', maxLength = 500) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function requestFingerprint(req) {
  const secret = String(process.env.REQUEST_FINGERPRINT_SECRET || process.env.JWT_SECRET || 'makaug-harvest');
  return crypto.createHmac('sha256', secret)
    .update(`${req.ip || ''}|${req.get('user-agent') || ''}`)
    .digest('hex');
}

router.post('/submissions', submissionLimiter, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    if (!harvestPublicSubmissionsEnabled()) {
      return res.status(503).json({
        ok: false,
        error: 'Public source submissions are disabled while the harvest rollout is verified.',
      });
    }
    if (clean(req.body?.website || req.body?.company_website)) {
      return res.status(202).json({ ok: true, data: { status: 'pending_review' } });
    }
    const submittedUrl = clean(req.body?.source_url || req.body?.url || req.body?.link, 2000);
    const sourceUrl = normalizeExactSocialPostUrl(submittedUrl);
    if (!sourceUrl) {
      return res.status(400).json({ ok: false, error: 'Paste an exact TikTok, Facebook, Instagram, YouTube, or X post URL.' });
    }
    const identity = stablePlatformPostIdentity(sourceUrl);
    const submitterName = clean(req.body?.name, 120);
    const submitterContact = clean(req.body?.contact || req.body?.phone || req.body?.email, 180);
    const note = clean(req.body?.note || req.body?.details, 1000);
    let submission;
    try {
      const inserted = await db.query(
        `INSERT INTO property_harvest_submissions (
           source_url, canonical_source_url, platform, submitter_name,
           submitter_contact, note, request_fingerprint
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [submittedUrl, sourceUrl, identity.platform || 'social', submitterName || null, submitterContact || null, note || null, requestFingerprint(req)]
      );
      submission = inserted.rows[0];
    } catch (error) {
      if (error?.code !== '23505') throw error;
      const existing = await db.query(
        `SELECT * FROM property_harvest_submissions
         WHERE canonical_source_url = $1
           AND status IN ('pending_review','imported_to_review','duplicate')
         ORDER BY created_at DESC LIMIT 1`,
        [sourceUrl]
      );
      return res.status(200).json({
        ok: true,
        data: {
          id: existing.rows[0]?.id || null,
          status: 'duplicate',
          message: 'That source link is already in the makaug review pipeline.',
        },
      });
    }
    const result = await importExactSocialSourcePosts({
      db,
      posts: [{ post_url: sourceUrl, caption: note, source_name: submitterName }],
      dryRun: false,
      fetchOembed: true,
      fetchPublicMetadata: true,
    });
    const perUrl = result.per_url_results?.[0] || result.import_result?.per_url_results?.[0] || {};
    const status = perUrl.outcome === 'duplicate'
      ? 'duplicate'
      : perUrl.outcome === 'created'
        ? 'imported_to_review'
        : 'pending_review';
    await db.query(
      `UPDATE property_harvest_submissions
       SET status = $2, import_result = $3::jsonb, updated_at = NOW()
       WHERE id = $1`,
      [submission.id, status, JSON.stringify({
        outcome: perUrl.outcome || '',
        classification: perUrl.classification || '',
        reason: perUrl.reason || '',
        property_id: perUrl.property_id || null,
      })]
    );
    await recordHarvestImportResult(db, result, { eventType: 'public_source_submission' }).catch((error) => {
      logger.warn('Public harvest submission event logging failed', { message: error.message });
    });
    return res.status(202).json({
      ok: true,
      data: {
        id: submission.id,
        status,
        review_only: true,
        message: status === 'imported_to_review'
          ? 'Thank you. The listing source is now pending makaug review.'
          : 'Thank you. The source was saved for a moderator to review.',
      },
    });
  } catch (error) {
    if (error?.code === '42P01') {
      return res.status(503).json({ ok: false, error: 'Source submissions are temporarily unavailable while storage is upgraded.' });
    }
    return next(error);
  }
});

router.get('/youtube/websub', async (req, res, next) => {
  try {
    if (!harvestAutomationEnabled()) return res.status(503).send('Harvest automation is disabled');
    const result = await verifyYouTubeWebSubChallenge(db, req.query || {});
    if (!result.ok) return res.status(result.status || 404).send('Not found');
    return res.status(200).type('text/plain').send(result.challenge);
  } catch (error) {
    return next(error);
  }
});

router.post('/youtube/websub', express.raw({ type: ['application/atom+xml', 'application/xml', 'text/xml'], limit: '1mb' }), (req, res) => {
  if (!harvestAutomationEnabled()) return res.status(503).send('Harvest automation is disabled');
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''));
  const signature = req.get('x-hub-signature') || req.get('x-hub-signature-256') || '';
  if (!process.env.YOUTUBE_WEBSUB_SECRET) return res.status(503).send('WebSub secret is not configured');
  const { webSubSignatureValid } = require('../services/youtubeWebSubService');
  if (!webSubSignatureValid(rawBody, signature)) return res.status(401).send('Invalid signature');
  res.status(204).end();
  processYouTubeWebSubNotification(db, rawBody, { signature }).catch((error) => {
    logger.error('YouTube WebSub notification processing failed', { message: error.message });
  });
});

module.exports = router;
