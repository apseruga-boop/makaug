import { query } from '../../config/database';
import type { AgentDataAdapter, AgentSearchInput } from '../interfaces';
import type { BrokerResult } from '../../types/domain';

interface AgentRow {
  id: string;
  full_name: string;
  company_name: string | null;
  phone: string | null;
  whatsapp: string | null;
  districts_covered: string[] | null;
  specializations: string[] | null;
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  languages: string[] | null;
}

export class PostgresAgentAdapter implements AgentDataAdapter {
  async search(input: AgentSearchInput): Promise<BrokerResult[]> {
    const where: string[] = ["status IN ('approved','pending')"];
    const params: unknown[] = [];

    if (input.registeredOnly) {
      where.push(`status = 'approved'`);
    }

    if (input.area || input.district) {
      params.push(`%${input.area || input.district}%`);
      where.push(`(full_name ILIKE $${params.length} OR company_name ILIKE $${params.length} OR array_to_string(COALESCE(districts_covered,'{}'), ',') ILIKE $${params.length})`);
    }

    if (input.category || input.purpose) {
      params.push(`%${input.category || input.purpose}%`);
      where.push(`array_to_string(COALESCE(specializations,'{}'), ',') ILIKE $${params.length}`);
    }

    const sql = `
      SELECT id, full_name, company_name, phone, whatsapp, districts_covered, specializations, status, NULL::text[] as languages
      FROM agents
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT 10
    `;

    const result = await query<AgentRow>(sql, params);
    return result.rows.slice(0, 5).map((row) => ({
      id: row.id,
      name: row.full_name,
      company: row.company_name ?? undefined,
      phone: row.phone ?? undefined,
      whatsapp: row.whatsapp ?? row.phone ?? undefined,
      areaCovered: (row.districts_covered ?? []).join(', '),
      specialties: row.specializations ?? [],
      languages: row.languages ?? ['English'],
      registrationStatus: row.status === 'approved' ? 'registered' : 'not_registered',
      profileUrl: `https://makaug.com/agent/${row.id}`
    }));
  }
}
