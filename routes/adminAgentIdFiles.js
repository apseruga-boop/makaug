'use strict';

// King → Agents → Manage → "ID documents": staff upload an agent's ID (front,
// back, other papers) and view or download it later, for fraud checks and
// police requests. Registered on the admin router, so requireAdminApiKey has
// already turned away anyone who is not admin/super_admin (401) before any
// handler here runs. File bytes are read from Postgres and sent with no-store /
// noindex headers; nothing here hands out a URL to the file. Every upload,
// replace, view and download is written to audit_logs with the agent id, so
// it shows in the agent's "Change history".

const {
  ID_FILE_KINDS,
  idFileDownloadName,
  prepareIdFileUpload,
  privateFileHeaders
} = require('../services/agentIdFileService');

// Metadata only. The content column is never selected for the page.
const META_COLUMNS = `id, agent_id, kind, label, original_name, mime_type, byte_size, metadata_stripped,
  uploaded_by, uploaded_by_label, uploaded_at, archived_at, archived_by, archived_reason, replaced_by`;

async function listIdFiles(db, agentId) {
  try {
    const result = await db.query(
      `SELECT ${META_COLUMNS} FROM agent_identity_files
        WHERE agent_id = $1
        ORDER BY archived_at IS NULL DESC, uploaded_at DESC
        LIMIT 100`, [agentId]);
    return result.rows;
  } catch (_error) {
    return [];
  }
}

function sendPrivateFile(res, { bytes, mimeType, filename, download }) {
  res.set(privateFileHeaders({ mimeType, filename, download }));
  res.set('Content-Length', String(bytes.length));
  return res.status(200).end(bytes);
}

// The ID the agent sent when they signed up (agents.identity_document_url).
// Read-only: fetched server-side from the private bucket with a short signed
// link, or decoded when it was kept inline. Other links are not proxied.
async function readSignupIdentityDocument(ref, { fetchImpl = global.fetch } = {}) {
  const raw = String(ref || '').trim();
  if (!raw) return null;
  const { parseIdentityDataUrl } = require('../services/agentIdentityStorageService');
  if (raw.toLowerCase().startsWith('data:')) {
    const parsed = parseIdentityDataUrl(raw);
    return parsed ? { bytes: parsed.bytes, mimeType: parsed.mimeType } : null;
  }
  if (raw.toLowerCase().startsWith('s3://')) {
    const { createSignedS3GetUrl } = require('../services/cloudMediaStorageService');
    const signed = createSignedS3GetUrl(raw, { expiresSeconds: 60 });
    const response = await fetchImpl(signed.url, { redirect: 'error' });
    if (!response.ok) {
      const error = new Error('The sign-up ID file could not be read from storage.');
      error.status = 502;
      throw error;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const { sniffIdFileMime } = require('../services/agentIdFileService');
    return { bytes, mimeType: sniffIdFileMime(bytes) || String(response.headers.get('content-type') || 'application/octet-stream') };
  }
  return null;
}

function wantsDownload(req) {
  return ['1', 'true', 'download'].includes(String(req.query.download || req.query.mode || '').toLowerCase());
}

function registerAgentIdFileRoutes(router, deps) {
  const { db, writeAudit, actorOf, UUID_RE, fetchImpl } = deps;
  const badId = (res, what) => res.status(400).json({ ok: false, error: `Invalid ${what} id` });

  async function loadAgent(id) {
    const result = await db.query(
      'SELECT id, full_name, identity_document_url, identity_document_name, identity_document_type, identity_document_uploaded_at FROM agents WHERE id = $1',
      [id]);
    return result.rows[0] || null;
  }

  async function withClient(work) {
    if (!db.pool?.connect) return work(db);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await work(client);
      await client.query('COMMIT');
      return out;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // Metadata for the Manage page: live files, archived versions, sign-up file.
  router.get('/agent-manager/agents/:id/id-files', async (req, res, next) => {
    try {
      if (!UUID_RE.test(String(req.params.id))) return badId(res, 'agent');
      const agent = await loadAgent(req.params.id);
      if (!agent) return res.status(404).json({ ok: false, error: 'Agent not found' });
      const files = await listIdFiles(db, agent.id);
      res.set('Cache-Control', 'no-store, private, max-age=0');
      res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      return res.json({
        ok: true,
        data: {
          files,
          signup: agent.identity_document_url ? {
            name: agent.identity_document_name || null,
            type: agent.identity_document_type || null,
            uploaded_at: agent.identity_document_uploaded_at || null
          } : null
        }
      });
    } catch (error) {
      return next(error);
    }
  });

  // Upload (or replace) one ID file. The previous live front/back is archived,
  // never deleted. Body: { kind: id_front|id_back|other, data_url, name }.
  router.post('/agent-manager/agents/:id/id-files', async (req, res, next) => {
    try {
      if (!UUID_RE.test(String(req.params.id))) return badId(res, 'agent');
      const agent = await loadAgent(req.params.id);
      if (!agent) return res.status(404).json({ ok: false, error: 'Agent not found' });
      let file;
      try {
        file = await prepareIdFileUpload({ dataUrl: req.body?.data_url, name: req.body?.name, kind: String(req.body?.kind || '') });
      } catch (error) {
        return res.status(error.status || 400).json({ ok: false, error: error.message });
      }
      const actor = await actorOf(req);
      const replaceable = file.kind === 'id_front' || file.kind === 'id_back';
      const saved = await withClient(async (client) => {
        const previous = replaceable
          ? (await client.query(
            `SELECT id FROM agent_identity_files
              WHERE agent_id = $1 AND kind = $2 AND archived_at IS NULL
              FOR UPDATE`, [agent.id, file.kind])).rows[0] || null
          : null;
        if (previous) {
          await client.query(
            `UPDATE agent_identity_files
                SET archived_at = NOW(), archived_by = $2, archived_reason = 'Replaced by a newer upload'
              WHERE id = $1`, [previous.id, actor.label]);
        }
        const inserted = (await client.query(
          `INSERT INTO agent_identity_files
             (agent_id, kind, label, original_name, mime_type, byte_size, sha256, content, metadata_stripped, uploaded_by, uploaded_by_label)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING ${META_COLUMNS}`,
          [agent.id, file.kind, file.label, file.original_name, file.mime_type, file.byte_size, file.sha256,
            file.content, file.metadata_stripped, actor.id ? String(actor.id) : null, actor.label])).rows[0];
        if (previous) {
          await client.query('UPDATE agent_identity_files SET replaced_by = $2 WHERE id = $1', [previous.id, inserted.id]);
        }
        return { inserted, previousId: previous?.id || null };
      });
      await writeAudit(saved.previousId ? 'admin_agent_id_file_replaced' : 'admin_agent_id_file_uploaded', {
        agent_id: agent.id,
        file_id: saved.inserted.id,
        replaced_file_id: saved.previousId,
        kind: file.kind,
        label: file.label,
        mime_type: file.mime_type,
        byte_size: file.byte_size,
        sha256: file.sha256,
        metadata_stripped: file.metadata_stripped,
        by: actor.label
      }, actor.id);
      return res.status(201).json({ ok: true, data: { file: saved.inserted, replaced_file_id: saved.previousId } });
    } catch (error) {
      return next(error);
    }
  });

  // The file itself, for the viewer (inline) or "Download" (?download=1).
  router.get('/agent-manager/id-files/:fileId', async (req, res, next) => {
    try {
      if (!UUID_RE.test(String(req.params.fileId))) return badId(res, 'file');
      const row = (await db.query(
        `SELECT f.id, f.agent_id, f.kind, f.mime_type, f.content, f.uploaded_at, f.archived_at, a.full_name
           FROM agent_identity_files f LEFT JOIN agents a ON a.id = f.agent_id
          WHERE f.id = $1`, [req.params.fileId])).rows[0];
      if (!row) return res.status(404).json({ ok: false, error: 'File not found' });
      const download = wantsDownload(req);
      const actor = await actorOf(req);
      await writeAudit(download ? 'admin_agent_id_file_downloaded' : 'admin_agent_id_file_viewed', {
        agent_id: row.agent_id,
        file_id: row.id,
        kind: row.kind,
        label: ID_FILE_KINDS[row.kind] || row.kind,
        archived: Boolean(row.archived_at),
        by: actor.label
      }, actor.id);
      return sendPrivateFile(res, {
        bytes: Buffer.from(row.content),
        mimeType: row.mime_type,
        filename: idFileDownloadName({ agentName: row.full_name, kind: row.kind, uploadedAt: row.uploaded_at, mimeType: row.mime_type }),
        download
      });
    } catch (error) {
      return next(error);
    }
  });

  // The ID from the agent's own sign-up, read-only.
  router.get('/agent-manager/agents/:id/signup-id', async (req, res, next) => {
    try {
      if (!UUID_RE.test(String(req.params.id))) return badId(res, 'agent');
      const agent = await loadAgent(req.params.id);
      if (!agent) return res.status(404).json({ ok: false, error: 'Agent not found' });
      if (!agent.identity_document_url) return res.status(404).json({ ok: false, error: 'No sign-up ID on file' });
      const file = await readSignupIdentityDocument(agent.identity_document_url, { fetchImpl });
      if (!file) return res.status(409).json({ ok: false, error: 'The sign-up ID is stored in a way this page cannot open.' });
      const download = wantsDownload(req);
      const actor = await actorOf(req);
      await writeAudit(download ? 'admin_agent_signup_id_downloaded' : 'admin_agent_signup_id_viewed', {
        agent_id: agent.id,
        label: 'ID from sign-up',
        by: actor.label
      }, actor.id);
      return sendPrivateFile(res, {
        bytes: file.bytes,
        mimeType: file.mimeType,
        filename: idFileDownloadName({ agentName: agent.full_name, kind: 'signup_id', uploadedAt: agent.identity_document_uploaded_at, mimeType: file.mimeType }),
        download
      });
    } catch (error) {
      return next(error);
    }
  });

  // Permanent delete: super_admin only, archived versions only, reason required.
  router.delete('/agent-manager/id-files/:fileId', async (req, res, next) => {
    try {
      if (req.adminAuth?.role !== 'super_admin') {
        return res.status(403).json({ ok: false, error: 'Only a super admin can permanently delete an ID file.' });
      }
      if (!UUID_RE.test(String(req.params.fileId))) return badId(res, 'file');
      const reason = String(req.body?.reason || '').trim().slice(0, 300);
      if (reason.length < 5) return res.status(400).json({ ok: false, error: 'Say why this file is being deleted.' });
      const row = (await db.query('SELECT id, agent_id, kind, archived_at, sha256 FROM agent_identity_files WHERE id = $1', [req.params.fileId])).rows[0];
      if (!row) return res.status(404).json({ ok: false, error: 'File not found' });
      if (!row.archived_at) return res.status(409).json({ ok: false, error: 'Replace this file first; only old versions can be deleted.' });
      const actor = await actorOf(req);
      await db.query('DELETE FROM agent_identity_files WHERE id = $1 AND archived_at IS NOT NULL', [row.id]);
      await writeAudit('admin_agent_id_file_deleted', {
        agent_id: row.agent_id, file_id: row.id, kind: row.kind, sha256: row.sha256, reason, by: actor.label
      }, actor.id);
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });
}

module.exports = { registerAgentIdFileRoutes, listIdFiles, readSignupIdentityDocument };
