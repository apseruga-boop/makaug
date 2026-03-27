import { query } from '../../config/database';

export class ReportRepository {
  async create(payload: Record<string, unknown>): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO listing_reports (listing_ref, reporter_name, reporter_phone, details, evidence, status)
       VALUES ($1,$2,$3,$4,$5::jsonb,'open')
       RETURNING id`,
      [payload.listingRef ?? null, payload.name ?? null, payload.phone ?? null, payload.details ?? null, JSON.stringify(payload.evidence ?? [])]
    );
    return result.rows[0].id;
  }
}
