import { query } from '../../config/database';

export class LeadRepository {
  async create(payload: Record<string, unknown>): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO property_leads (name, phone, email, preferred_area, purpose, category, budget, notes, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       RETURNING id`,
      [
        payload.name ?? null,
        payload.phone ?? null,
        payload.email ?? null,
        payload.preferredArea ?? null,
        payload.purpose ?? null,
        payload.category ?? null,
        payload.budget ?? null,
        payload.notes ?? null,
        JSON.stringify(payload)
      ]
    );

    return result.rows[0].id;
  }
}
