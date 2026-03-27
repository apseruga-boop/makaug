import { query } from '../../config/database';

interface QueueItem {
  id: string;
  user_phone: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export class OutboundQueueRepository {
  async enqueue(userPhone: string, payload: Record<string, unknown>, errorMessage?: string): Promise<void> {
    await query(
      `INSERT INTO outbound_message_queue (user_phone, payload, status, attempts, next_attempt_at, last_error)
       VALUES ($1, $2::jsonb, 'pending', 0, NOW(), $3)`,
      [userPhone, JSON.stringify(payload), errorMessage ?? null]
    );
  }

  async due(limit = 20): Promise<QueueItem[]> {
    const res = await query<QueueItem>(
      `SELECT id, user_phone, payload, attempts
       FROM outbound_message_queue
       WHERE status IN ('pending','retry') AND next_attempt_at <= NOW()
       ORDER BY next_attempt_at ASC
       LIMIT $1`,
      [limit]
    );
    return res.rows;
  }

  async markSent(id: string): Promise<void> {
    await query(
      `UPDATE outbound_message_queue
       SET status = 'sent', sent_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  async markRetry(id: string, attempts: number, errorMessage: string): Promise<void> {
    const delayMinutes = Math.min(60, Math.max(1, attempts * 2));
    await query(
      `UPDATE outbound_message_queue
       SET status = CASE WHEN attempts + 1 >= 8 THEN 'failed' ELSE 'retry' END,
           attempts = attempts + 1,
           last_error = $2,
           next_attempt_at = NOW() + ($3 || ' minutes')::interval,
           updated_at = NOW()
       WHERE id = $1`,
      [id, errorMessage, String(delayMinutes)]
    );
  }
}
