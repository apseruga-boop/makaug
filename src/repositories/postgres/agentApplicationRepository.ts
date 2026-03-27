import { query } from '../../config/database';

export class AgentApplicationRepository {
  async create(payload: Record<string, unknown>): Promise<string> {
    const result = await query<{ id: string }>(
      `INSERT INTO agent_applications (
        registration_track,
        full_name,
        agency_name,
        phone,
        whatsapp,
        email,
        areas_covered,
        nin,
        licence_number,
        licence_certificate_url,
        listing_limit,
        status,
        payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending_review',$12::jsonb)
      RETURNING id`,
      [
        payload.registrationTrack ?? 'not_registered',
        payload.fullName ?? null,
        payload.agencyName ?? null,
        payload.phone ?? null,
        payload.whatsapp ?? null,
        payload.email ?? null,
        payload.areasCovered ?? null,
        payload.nin ?? null,
        payload.licenceNumber ?? null,
        payload.licenceCertificateUrl ?? null,
        payload.registrationTrack === 'registered' ? 20 : 5,
        JSON.stringify(payload)
      ]
    );

    return result.rows[0].id;
  }
}
