import { query } from '../../config/database';

export class AuditLogRepository {
  async add(userId: string | null, action: string, details: Record<string, unknown>): Promise<void> {
    await query(
      `INSERT INTO audit_logs (actor_id, action, details)
       VALUES ($1, $2, $3::jsonb)`,
      [userId, action, JSON.stringify(details)]
    );
  }
}
