'use strict';

// Public documents makaug sends on WhatsApp: private-lister terms and the agent guide.
const express = require('express');
const db = require('../config/database');
const docs = require('../services/listingDocsService');
const billingOps = require('../services/billingOpsService');

const router = express.Router();

const FILES = {
  'makaug-private-lister-terms.pdf': { name: 'lister_terms_pdf', download: 'makaug-terms-private-listers.pdf' },
  'makaug-private-lister-terms-cover.png': { name: 'lister_terms_cover' },
  'makaug-agent-guide.pdf': { name: 'agent_guide_pdf', download: 'makaug-agent-guide.pdf' },
  'makaug-agent-guide-cover.png': { name: 'agent_guide_cover' },
  'makaug-agent-terms.pdf': { name: 'agent_terms_pdf', download: 'makaug-agent-terms.pdf' },
  'makaug-agent-terms-cover.png': { name: 'agent_terms_cover' }
};

router.get('/:file', async (req, res, next) => {
  try {
    const entry = FILES[String(req.params.file || '')];
    if (!entry) return next();
    const settings = await billingOps.getSettings(db).catch(() => ({}));
    const out = await docs.getDocument(entry.name, settings);
    if (!out) return next();
    res.set('Content-Type', out.type);
    res.set('Cache-Control', 'public, max-age=600');
    if (entry.download) res.set('Content-Disposition', `inline; filename="${entry.download}"`);
    return res.send(out.body);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
