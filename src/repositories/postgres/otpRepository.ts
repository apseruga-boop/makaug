import { query } from '../../config/database';

export class OtpRepository {
  async create(phone: string, code: string, expiresMinutes = 10): Promise<void> {
    await query('UPDATE otp_verifications SET used = TRUE WHERE phone = $1 AND used = FALSE', [phone]);
    await query(
      `INSERT INTO otp_verifications (phone, code, expires_at, used)
       VALUES ($1, $2, NOW() + ($3 || ' minutes')::interval, FALSE)`,
      [phone, code, String(expiresMinutes)]
    );
  }

  async verify(phone: string, code: string): Promise<boolean> {
    const res = await query<{ id: string }>(
      `SELECT id
       FROM otp_verifications
       WHERE phone = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [phone, code]
    );

    if (!res.rows[0]) return false;

    await query('UPDATE otp_verifications SET used = TRUE WHERE id = $1', [res.rows[0].id]);
    return true;
  }
}
