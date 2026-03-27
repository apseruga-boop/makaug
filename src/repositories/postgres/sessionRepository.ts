import { query } from '../../config/database';
import type { SessionRepository } from '../interfaces';
import type { SessionState, SupportedLanguage } from '../../types/domain';

interface SessionRow {
  phone: string;
  language: SupportedLanguage;
  current_step: SessionState['currentStep'];
  current_intent: SessionState['currentIntent'] | null;
  paused: boolean;
  listing_draft: Record<string, unknown>;
  session_data: Record<string, unknown>;
}

const DEFAULT_STATE: Omit<SessionState, 'userId'> = {
  language: 'en',
  currentIntent: null,
  currentStep: 'language_select',
  data: {},
  otpVerified: false,
  paused: false
};

function toState(row: SessionRow): SessionState {
  const sessionData = row.session_data ?? {};
  return {
    userId: row.phone,
    language: row.language ?? 'en',
    currentIntent: row.current_intent ?? (sessionData.currentIntent as SessionState['currentIntent']) ?? null,
    currentStep: (row.current_step as SessionState['currentStep']) ?? 'language_select',
    data: { ...(row.listing_draft ?? {}), ...(sessionData.data as Record<string, unknown> ?? {}) },
    otpVerified: Boolean(sessionData.otpVerified),
    paused: Boolean(row.paused ?? sessionData.paused)
  };
}

export class PostgresSessionRepository implements SessionRepository {
  async getOrCreate(userId: string): Promise<SessionState> {
    const found = await query<SessionRow>('SELECT phone, language, current_step, current_intent, paused, listing_draft, session_data FROM whatsapp_sessions WHERE phone = $1 LIMIT 1', [userId]);
    if (found.rows[0]) return toState(found.rows[0]);

    await query(
      `INSERT INTO whatsapp_sessions (phone, language, current_step, current_intent, paused, listing_draft, session_data)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
      [
        userId,
        DEFAULT_STATE.language,
        DEFAULT_STATE.currentStep,
        null,
        false,
        JSON.stringify({}),
        JSON.stringify({ data: {}, currentIntent: null, otpVerified: false, paused: false })
      ]
    );

    return { userId, ...DEFAULT_STATE };
  }

  async save(state: SessionState): Promise<void> {
    const listingDraft = state.data;
    const sessionData = {
      data: state.data,
      currentIntent: state.currentIntent,
      otpVerified: state.otpVerified,
      paused: state.paused
    };

    await query(
      `UPDATE whatsapp_sessions
       SET language = $2,
           current_step = $3,
           current_intent = $4,
           paused = $5,
           listing_draft = $6::jsonb,
           session_data = $7::jsonb,
           last_message_at = NOW(),
           updated_at = NOW()
       WHERE phone = $1`,
      [
        state.userId,
        state.language,
        state.currentStep,
        state.currentIntent,
        state.paused,
        JSON.stringify(listingDraft),
        JSON.stringify(sessionData)
      ]
    );
  }

  async reset(userId: string): Promise<SessionState> {
    const resetState: SessionState = { userId, ...DEFAULT_STATE };
    await this.save(resetState);
    return resetState;
  }

  async setLanguage(userId: string, language: SupportedLanguage): Promise<void> {
    await query('UPDATE whatsapp_sessions SET language = $2, updated_at = NOW() WHERE phone = $1', [userId, language]);
  }
}
