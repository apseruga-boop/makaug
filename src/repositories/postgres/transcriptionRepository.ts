import { query } from '../../config/database';

export class TranscriptionRepository {
  async create(payload: {
    userPhone: string;
    waMessageId: string;
    transcript: string;
    confidence?: number;
    language?: string;
    mediaUrl?: string;
  }): Promise<void> {
    await query(
      `INSERT INTO transcriptions (user_phone, wa_message_id, transcript, confidence, detected_language, media_url)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [payload.userPhone, payload.waMessageId, payload.transcript, payload.confidence ?? null, payload.language ?? null, payload.mediaUrl ?? null]
    );
  }
}
