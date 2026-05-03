'use strict';

const EMAIL_NOTIFICATION_EVENT_MATRIX = {
  otp_sent: { templateKey: 'otp_code', channels: ['email', 'sms'], transactional: true, adminLogRequired: true },
  otp_verified: { templateKey: 'otp_verified', channels: ['in_app'], transactional: true, adminLogRequired: true },
  account_created_property_finder: { templateKey: 'account_created', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  account_created_student: { templateKey: 'account_created_student', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  account_created_broker: { templateKey: 'broker_signup_received', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  field_agent_application_received: { templateKey: 'field_agent_application_received', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  advertiser_signup_received: { templateKey: 'advertiser_signup_received', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  password_reset_requested: { templateKey: 'password_reset', channels: ['email', 'sms'], transactional: true, adminLogRequired: true },
  password_changed: { templateKey: 'password_changed', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  listing_submitted: { templateKey: 'property_submitted', channels: ['email', 'whatsapp', 'in_app'], transactional: true, adminLogRequired: true },
  listing_pending_review: { templateKey: 'listing_pending_review', channels: ['in_app'], transactional: true, adminLogRequired: true },
  listing_approved: { templateKey: 'listing_approved', channels: ['email', 'whatsapp', 'in_app'], transactional: true, adminLogRequired: true },
  listing_rejected: { templateKey: 'listing_rejected', channels: ['email', 'whatsapp', 'in_app'], transactional: true, adminLogRequired: true },
  listing_changes_requested: { templateKey: 'listing_changes_requested', channels: ['email', 'whatsapp', 'in_app'], transactional: true, adminLogRequired: true },
  saved_search_created: { templateKey: 'saved_search_created', channels: ['email', 'whatsapp', 'in_app'], transactional: true, adminLogRequired: true },
  alert_created: { templateKey: 'alert_created', channels: ['email', 'whatsapp', 'in_app'], transactional: true, adminLogRequired: true },
  alert_match_found: { templateKey: 'alert_match_found', channels: ['email', 'whatsapp', 'in_app'], transactional: true, adminLogRequired: true },
  viewing_requested: { templateKey: 'viewing_requested', channels: ['email', 'whatsapp', 'in_app'], transactional: true, adminLogRequired: true },
  viewing_confirmed: { templateKey: 'viewing_confirmed', channels: ['email', 'whatsapp', 'in_app'], transactional: true, adminLogRequired: true },
  callback_requested: { templateKey: 'callback_requested', channels: ['email', 'whatsapp', 'in_app'], transactional: true, adminLogRequired: true },
  enquiry_sent: { templateKey: 'enquiry_sent', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  whatsapp_contact_initiated: { templateKey: 'whatsapp_contact_initiated', channels: ['in_app'], transactional: true, adminLogRequired: true },
  mortgage_lead_received: { templateKey: 'mortgage_lead_received', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  help_request_submitted: { templateKey: 'help_request', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  fraud_report_received: { templateKey: 'fraud_report_received', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  campaign_submitted: { templateKey: 'campaign_submitted', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  payment_link_created: { templateKey: 'payment_link_created', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  new_listing_pending_review: { templateKey: 'admin_listing_pending_review', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  new_broker_verification_request: { templateKey: 'admin_broker_verification', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  new_field_agent_application: { templateKey: 'admin_field_agent_application', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  new_advertiser_signup: { templateKey: 'admin_advertiser_signup', channels: ['email', 'in_app'], transactional: true, adminLogRequired: true },
  email_failed: { templateKey: 'admin_email_failed', channels: ['in_app'], transactional: true, adminLogRequired: true },
  whatsapp_failed: { templateKey: 'admin_whatsapp_failed', channels: ['in_app'], transactional: true, adminLogRequired: true },
  human_handoff_required: { templateKey: 'admin_handoff_required', channels: ['in_app'], transactional: true, adminLogRequired: true }
};

function getEmailNotificationEvent(eventKey) {
  return EMAIL_NOTIFICATION_EVENT_MATRIX[eventKey] || null;
}

module.exports = {
  EMAIL_NOTIFICATION_EVENT_MATRIX,
  getEmailNotificationEvent
};
