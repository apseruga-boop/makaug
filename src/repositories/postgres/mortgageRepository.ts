import { query } from '../../config/database';

export class MortgageRepository {
  async create(payload: Record<string, unknown>): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO mortgage_enquiries (user_phone, property_price, property_purpose, deposit_percent, term_years, household_income, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING id`,
      [
        payload.userPhone ?? null,
        payload.propertyPrice ?? null,
        payload.propertyPurpose ?? null,
        payload.depositPercent ?? null,
        payload.termYears ?? null,
        payload.householdIncome ?? null,
        JSON.stringify(payload)
      ]
    );
    return result.rows[0].id;
  }
}
