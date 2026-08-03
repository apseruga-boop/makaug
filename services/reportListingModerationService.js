'use strict';

const REPORT_LISTING_REMOVAL_STATUS = 'rejected';
const REPORT_LISTING_REMOVAL_STAGE = 'rejected';

function reportRemovalReason({ reportId = '', note = '' } = {}) {
  const cleanNote = String(note || '').trim();
  return cleanNote
    ? `Removed after listing report ${reportId}: ${cleanNote}`
    : `Removed after listing report ${reportId}`;
}

async function hideReportedProperty({
  query,
  propertyId,
  reportId,
  note,
  actorId = 'staff_user'
} = {}) {
  if (typeof query !== 'function') throw new TypeError('query is required');
  const id = String(propertyId || '').trim();
  if (!id) return null;

  const reason = reportRemovalReason({ reportId, note });
  const values = [
    id,
    REPORT_LISTING_REMOVAL_STATUS,
    REPORT_LISTING_REMOVAL_STAGE,
    reason,
    String(reportId || '').trim(),
    String(actorId || 'staff_user').trim() || 'staff_user'
  ];

  try {
    const result = await query(
      `UPDATE properties
       SET
         status = $2,
         reviewed_at = NOW(),
         moderation_stage = $3,
         moderation_reason = $4,
         moderation_notes = CONCAT_WS(E'\n', NULLIF(moderation_notes, ''), $4),
         rejected_at = NOW(),
         extra_fields = COALESCE(extra_fields, '{}'::jsonb)
           || jsonb_build_object(
             'hidden_by_report_id', $5::text,
             'hidden_by_report_at', NOW()::text,
             'hidden_by_report_by', $6::text,
             'hidden_by_report_note', $4::text,
             'report_removal_status', $2::text
           ),
         updated_at = NOW()
       WHERE id = $1
       RETURNING id, title, status, moderation_stage, moderation_reason, updated_at`,
      values
    );
    return result.rows[0] || null;
  } catch (fullUpdateError) {
    const fallbackResult = await query(
      `UPDATE properties
       SET
         status = $2,
         reviewed_at = NOW(),
         updated_at = NOW(),
         extra_fields = COALESCE(extra_fields, '{}'::jsonb)
           || jsonb_build_object(
             'moderation_stage', $3::text,
             'moderation_reason', $4::text,
             'hidden_by_report_id', $5::text,
             'hidden_by_report_at', NOW()::text,
             'hidden_by_report_by', $6::text,
             'hidden_by_report_note', $4::text,
             'report_removal_status', $2::text,
             'report_removal_fallback', true
           )
       WHERE id = $1
       RETURNING id, title, status, updated_at, extra_fields`,
      values
    );
    const row = fallbackResult.rows[0];
    return row
      ? {
        ...row,
        moderation_stage: REPORT_LISTING_REMOVAL_STAGE,
        moderation_reason: reason,
        compatibility_fallback_used: true,
        compatibility_fallback_reason: fullUpdateError?.code || fullUpdateError?.message || 'full_update_failed'
      }
      : null;
  }
}

module.exports = {
  REPORT_LISTING_REMOVAL_STAGE,
  REPORT_LISTING_REMOVAL_STATUS,
  hideReportedProperty,
  reportRemovalReason
};
