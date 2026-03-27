import { query } from '../../config/database';
import type { SearchResult } from '../../types/domain';

export class SearchRepository {
  async saveRequest(payload: Record<string, unknown>): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO property_search_requests (user_phone, payload)
       VALUES ($1, $2::jsonb)
       RETURNING id`,
      [payload.userPhone ?? null, JSON.stringify(payload)]
    );
    return result.rows[0].id;
  }

  async cacheResults(requestId: string, results: SearchResult[]): Promise<void> {
    await query(
      `INSERT INTO search_results_cache (search_request_id, results_json)
       VALUES ($1, $2::jsonb)`,
      [requestId, JSON.stringify(results)]
    );
  }
}
