import { query } from '../../config/database';

export class ListingRepository {
  async upsertDraft(userPhone: string, draft: Record<string, unknown>): Promise<string> {
    const existing = await query<{ id: string }>('SELECT id FROM listing_drafts WHERE user_phone = $1 ORDER BY updated_at DESC LIMIT 1', [userPhone]);
    if (existing.rows[0]) {
      await query(
        'UPDATE listing_drafts SET draft_data = $2::jsonb, updated_at = NOW() WHERE id = $1',
        [existing.rows[0].id, JSON.stringify(draft)]
      );
      return existing.rows[0].id;
    }

    const inserted = await query<{ id: string }>(
      `INSERT INTO listing_drafts (user_phone, draft_data)
       VALUES ($1, $2::jsonb)
       RETURNING id`,
      [userPhone, JSON.stringify(draft)]
    );
    return inserted.rows[0].id;
  }

  async addMedia(draftId: string, media: { type: string; url: string; caption?: string; slot?: string }): Promise<void> {
    await query(
      `INSERT INTO listing_media (draft_id, media_type, media_url, caption, slot_key)
       VALUES ($1, $2, $3, $4, $5)`,
      [draftId, media.type, media.url, media.caption ?? null, media.slot ?? null]
    );
  }

  async listMedia(draftId: string): Promise<Array<{ media_url: string; slot_key: string | null }>> {
    const rows = await query<{ media_url: string; slot_key: string | null }>(
      'SELECT media_url, slot_key FROM listing_media WHERE draft_id = $1 ORDER BY created_at ASC',
      [draftId]
    );
    return rows.rows;
  }

  async submit(draftId: string, payload: Record<string, unknown>): Promise<{ id: string; refNo: string }> {
    const inserted = await query<{ id: string; reference_no: string }>(
      `INSERT INTO listing_submissions (draft_id, payload, status, submitted_at, reference_no)
       VALUES ($1, $2::jsonb, 'pending_review', NOW(), ('MK-' || upper(substring(gen_random_uuid()::text, 1, 8))))
       RETURNING id, reference_no`,
      [draftId, JSON.stringify(payload)]
    );

    return {
      id: inserted.rows[0].id,
      refNo: inserted.rows[0].reference_no
    };
  }
}
