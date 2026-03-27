import { query } from '../../config/database';

export class MessageRepository {
  async logInbound(userId: string, waMessageId: string, payload: unknown): Promise<void> {
    await query(
      `INSERT INTO whatsapp_messages (user_phone, wa_message_id, direction, message_type, payload)
       VALUES ($1, $2, 'inbound', 'message', $3::jsonb)
       ON CONFLICT (wa_message_id) DO NOTHING`,
      [userId, waMessageId, JSON.stringify(payload)]
    );
  }

  async logOutbound(userId: string, payload: unknown): Promise<void> {
    await query(
      `INSERT INTO whatsapp_messages (user_phone, direction, message_type, payload)
       VALUES ($1, 'outbound', 'message', $2::jsonb)`,
      [userId, JSON.stringify(payload)]
    );
  }
}
