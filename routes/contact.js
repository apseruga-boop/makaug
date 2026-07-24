const express = require('express');

const db = require('../config/database');
const logger = require('../config/logger');
const { cleanText, toNullableInt, isValidEmail, isValidPhone } = require('../middleware/validation');
const { getSupportEmail, getSupportWhatsappUrl, sendSupportEmail } = require('../services/emailService');
const { captureLearningEvent } = require('../services/aiLearningCaptureService');
const { createLead } = require('../services/leadService');
const { logEmailEvent } = require('../services/emailLogService');
const { logNotification, notificationStatusFromDelivery } = require('../services/notificationLogService');

const router = express.Router();

function normalizeReportRequestType(value) {
  const normalized = cleanText(value).toLowerCase();
  if (['claim', 'correction', 'removal', 'report', 'fraud'].includes(normalized)) return normalized;
  return normalized || 'report';
}

function cleanStructuredReportFields(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const allowedKeys = [
    'claim_name',
    'claim_role',
    'claim_proof',
    'claim_account',
    'correction_field',
    'correction_value',
    'correction_source',
    'removal_reason',
    'removal_evidence',
    'fraud_details',
    'fraud_evidence'
  ];
  return allowedKeys.reduce((fields, key) => {
    const value = cleanText(source[key]);
    if (value) fields[key] = value;
    return fields;
  }, {});
}

function normalizeOptionalUuid(value) {
  const text = cleanText(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

async function handleReportListing(req, res, next) {
  try {
    const propertyReference = cleanText(req.body.property_reference || req.body.property_url);
    const reason = cleanText(req.body.reason);
    const details = cleanText(req.body.details) || null;
    const reporterContact = cleanText(req.body.reporter_contact || req.body.contact) || null;
    const requestType = normalizeReportRequestType(req.body.request_type);
    const requestSource = cleanText(req.body.source) || (requestType ? 'third_party_listing_request' : 'fraud_report');
    const linkedPropertyId = normalizeOptionalUuid(req.body.property_id || req.body.linked_property_id);
    const structuredFields = cleanStructuredReportFields(req.body.structured_fields || req.body);

    if (!propertyReference || !reason) {
      return res.status(400).json({
        ok: false,
        error: 'property_reference and reason are required'
      });
    }

    let result;
    try {
      result = await db.query(
        `INSERT INTO report_listings (
          property_reference,
          reason,
          details,
          reporter_contact,
          status,
          request_type,
          request_source,
          structured_fields,
          linked_property_id
        ) VALUES ($1,$2,$3,$4,'open',$5,$6,$7::jsonb,$8)
        RETURNING id, status, request_type, created_at`,
        [
          propertyReference,
          reason,
          details,
          reporterContact,
          requestType,
          requestSource,
          JSON.stringify(structuredFields),
          linkedPropertyId
        ]
      );
    } catch (insertError) {
      if (insertError?.code !== '42703') throw insertError;
      result = await db.query(
        `INSERT INTO report_listings (
          property_reference,
          reason,
          details,
          reporter_contact,
          status
        ) VALUES ($1,$2,$3,$4,'open')
        RETURNING id, status, created_at`,
        [
          propertyReference,
          reason,
          [
            details,
            requestType ? `Request type: ${requestType}` : '',
            requestSource ? `Request source: ${requestSource}` : '',
            Object.keys(structuredFields).length ? `Structured fields: ${JSON.stringify(structuredFields)}` : ''
          ].filter(Boolean).join('\n\n'),
          reporterContact
        ]
      );
    }

    const report = result.rows[0];
    const supportEmail = getSupportEmail();
    const whatsappUrl = getSupportWhatsappUrl();
    let lead = null;
    let leadLinkError = null;
    try {
      lead = await createLead(db, {
        source: requestSource,
        leadType: requestType === 'fraud' || requestType === 'report' ? 'fraud' : 'listing_request',
        category: reason,
        message: details || `${requestType || 'Listing'} request: ${propertyReference}`,
        priority: ['fraud', 'removal'].includes(requestType) ? 'high' : 'medium',
        contact: {
          name: reporterContact || 'Listing request reporter',
          email: reporterContact && isValidEmail(reporterContact) ? reporterContact : null,
          phone: reporterContact && isValidPhone(reporterContact) ? reporterContact : null,
          preferredContactChannel: reporterContact && isValidEmail(reporterContact) ? 'email' : 'whatsapp',
          roleType: `${requestType || 'report'}_requester`
        },
        activityType: `${requestType || 'report'}_request_received`,
        metadata: {
          report_id: report.id,
          property_reference: propertyReference,
          reason,
          request_type: requestType,
          request_source: requestSource,
          linked_property_id: linkedPropertyId,
          structured_fields: structuredFields
        }
      });
    } catch (leadError) {
      leadLinkError = leadError;
      logger.warn('Listing request was saved but CRM lead linking failed', {
        reportId: report.id,
        requestType,
        error: leadError.message || 'lead_link_failed'
      });
    }
    let adminDelivery = { sent: false, reason: 'not_attempted' };
    let userDelivery = { sent: false, reason: 'not_attempted' };

    try {
      adminDelivery = await sendSupportEmail({
        to: supportEmail,
        subject: `[makaug] Listing report received • ${reason}`,
        text: [
          'A listing report was submitted on makaug.com.',
          '',
          `Report ID: ${report.id}`,
          `Property Reference: ${propertyReference}`,
          requestType ? `Request Type: ${requestType}` : '',
          `Request Source: ${requestSource}`,
          `Reason: ${reason}`,
          `Reporter Contact: ${reporterContact || '-'}`,
          details ? `Details: ${details}` : '',
          Object.keys(structuredFields).length ? `Structured Fields: ${JSON.stringify(structuredFields, null, 2)}` : '',
          '',
          'Admin action: review the listing, contact the reporter if needed, then update the report status in the admin dashboard.'
        ].filter(Boolean).join('\n'),
        replyTo: reporterContact && isValidEmail(reporterContact) ? reporterContact : undefined
      });

      if (reporterContact && isValidEmail(reporterContact)) {
        userDelivery = await sendSupportEmail({
          to: reporterContact,
          subject: 'We received your makaug listing report',
          text: [
            'Thank you for reporting this issue to makaug.',
            '',
            'Our team will investigate the listing and take the right action. We may contact you if we need more information.',
            '',
            `Report ID: ${report.id}`,
            `Property Reference: ${propertyReference}`,
            `Reason: ${reason}`,
            '',
            `For urgent safety concerns, WhatsApp us here: ${whatsappUrl}`,
            `Email: ${supportEmail}`
          ].join('\n')
        });
      }
    } catch (emailError) {
      logger.warn('Listing report email notification failed', {
        reportId: report.id,
        error: emailError.message || 'email_failed'
      });
    }

    await Promise.allSettled([
      logEmailEvent(db, {
        eventType: 'fraud_report_received',
        recipientEmail: reporterContact && isValidEmail(reporterContact) ? reporterContact : null,
        recipientRole: 'reporter',
        templateKey: 'fraud_report_received',
        subject: 'We received your makaug listing report',
        status: notificationStatusFromDelivery(userDelivery),
        relatedLeadId: lead?.id || null,
        failureReason: userDelivery?.error || userDelivery?.reason || null,
        sentAt: userDelivery?.sent ? new Date() : null
      }),
      logEmailEvent(db, {
        eventType: 'new_fraud_report',
        recipientEmail: supportEmail,
        recipientRole: 'admin',
        templateKey: 'admin_alert',
        subject: `[makaug] Listing report received • ${reason}`,
        status: notificationStatusFromDelivery(adminDelivery),
        relatedLeadId: lead?.id || null,
        failureReason: adminDelivery?.error || adminDelivery?.reason || null,
        sentAt: adminDelivery?.sent ? new Date() : null
      }),
      logNotification(db, {
        recipientEmail: reporterContact && isValidEmail(reporterContact) ? reporterContact : null,
        recipientPhone: reporterContact && isValidPhone(reporterContact) ? reporterContact : null,
        channel: 'in_app',
        type: 'fraud_report_received',
        status: 'logged',
        payloadSummary: { report_id: report.id, property_reference: propertyReference, reason },
        relatedLeadId: lead?.id || null
      }),
      logNotification(db, {
        recipientEmail: supportEmail,
        channel: 'in_app',
        type: 'new_fraud_report',
        status: 'logged',
        payloadSummary: { report_id: report.id, property_reference: propertyReference, reason },
        relatedLeadId: lead?.id || null
      })
    ]);

    return res.status(201).json({
      ok: true,
      data: {
        ...report,
        reference: report.id,
        lead_linked: Boolean(lead?.id),
        follow_up_degraded: Boolean(leadLinkError)
      }
    });
  } catch (error) {
    return next(error);
  }
}

async function handleLookingForProperty(req, res, next) {
  try {
    const fullName = cleanText(req.body.name);
    const phone = cleanText(req.body.phone);
    const email = cleanText(req.body.email);
    const requirements = cleanText(req.body.requirements || req.body.description);

    const errors = [];
    if (!fullName) errors.push('name is required');
    if (!phone) errors.push('phone is required');
    if (!requirements) errors.push('requirements are required');
    if (phone && !isValidPhone(phone)) errors.push('phone is invalid');
    if (email && !isValidEmail(email)) errors.push('email is invalid');

    if (errors.length) {
      return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });
    }

    const inserted = await db.query(
      `INSERT INTO property_requests (
        full_name,
        phone,
        email,
        preferred_locations,
        listing_type,
        max_budget,
        requirements
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, created_at`,
      [
        fullName,
        phone,
        email || null,
        cleanText(req.body.preferred_locations) || null,
        cleanText(req.body.listing_type) || null,
        toNullableInt(req.body.max_budget),
        requirements
      ]
    );

    const request = inserted.rows[0];
    const lead = await createLead(db, {
      source: cleanText(req.body.source) || 'property_need_request',
      leadType: 'enquiry',
      category: cleanText(req.body.listing_type) || null,
      location: cleanText(req.body.preferred_locations) || null,
      budget: toNullableInt(req.body.max_budget),
      message: requirements,
      contact: {
        name: fullName,
        phone,
        email: email || null,
        preferredContactChannel: 'whatsapp',
        roleType: 'property_seeker',
        locationInterest: cleanText(req.body.preferred_locations) || null,
        categoryInterest: cleanText(req.body.listing_type) || null,
        budgetRange: cleanText(req.body.max_budget) || null
      },
      activityType: 'property_need_request_created',
      metadata: {
        property_request_id: request.id
      }
    });
    captureLearningEvent({
      eventName: 'property_request_submitted',
      source: cleanText(req.body.source) || 'website',
      channel: 'web',
      sessionId: `property_request:${request.id}`,
      externalUserId: phone || email || fullName,
      inputText: requirements,
      responseText: 'Property request saved for makaug follow-up.',
      payload: {
        id: request.id,
        full_name: fullName,
        phone,
        email: email || null,
        preferred_locations: cleanText(req.body.preferred_locations) || null,
        listing_type: cleanText(req.body.listing_type) || null,
        max_budget: toNullableInt(req.body.max_budget),
        source: cleanText(req.body.source) || 'website'
      },
      entities: {
        location: cleanText(req.body.preferred_locations) || null,
        budget_ugx: toNullableInt(req.body.max_budget),
        listing_type: cleanText(req.body.listing_type) || null
      },
      dedupeKey: `property_request:${request.id}`,
      requestIp: req.ip,
      userAgent: req.get('user-agent')
    });

    await logNotification(db, {
      recipientPhone: phone,
      recipientEmail: email || null,
      channel: 'in_app',
      type: 'property_need_request_created',
      status: 'logged',
      payloadSummary: {
        property_request_id: request.id,
        listing_type: cleanText(req.body.listing_type) || null,
        preferred_locations: cleanText(req.body.preferred_locations) || null
      },
      relatedLeadId: lead?.id || null
    });

    return res.status(201).json({ ok: true, data: request });
  } catch (error) {
    return next(error);
  }
}

async function handleHelpRequest(req, res, next) {
  try {
    const name = cleanText(req.body.name);
    const email = cleanText(req.body.email);
    const phone = cleanText(req.body.phone);
    const topic = cleanText(req.body.topic) || 'Help';
    const message = cleanText(req.body.message);
    const preferredContact = cleanText(req.body.preferred_contact || req.body.preferredContact) || 'WhatsApp';

    const errors = [];
    if (!name) errors.push('name is required');
    if (!email) errors.push('email is required');
    if (!phone) errors.push('phone is required');
    if (!message) errors.push('message is required');
    if (email && !isValidEmail(email)) errors.push('email is invalid');
    if (phone && !isValidPhone(phone)) errors.push('phone is invalid');
    if (errors.length) return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });

    const lead = await createLead(db, {
      source: cleanText(req.body.source) || 'help_centre',
      leadType: 'support',
      category: topic,
      message,
      priority: topic.toLowerCase().includes('fraud') ? 'high' : 'normal',
      contact: {
        name,
        email,
        phone,
        preferredContactChannel: preferredContact,
        roleType: 'support'
      },
      metadata: {
        topic,
        preferred_contact: preferredContact
      }
    });

    const supportEmail = getSupportEmail();
    const whatsappUrl = getSupportWhatsappUrl();
    const userSubject = 'We received your makaug help request';
    const adminSubject = `[makaug] Help request received • ${topic}`;
    let userDelivery = { sent: false, reason: 'no_email_provider_configured' };
    let adminDelivery = { sent: false, reason: 'no_email_provider_configured' };

    try {
      userDelivery = await sendSupportEmail({
        to: email,
        subject: userSubject,
        text: [
          `Hello ${name},`,
          '',
          'Thank you for contacting the makaug Help Centre.',
          `Topic: ${topic}`,
          `Reference: ${lead?.id || 'logged'}`,
          '',
          'Our team will review your message and contact you using your preferred channel.',
          `WhatsApp support: ${whatsappUrl}`,
          '',
          'makaug'
        ].join('\n')
      });
      adminDelivery = await sendSupportEmail({
        to: supportEmail,
        subject: adminSubject,
        text: [
          'A makaug Help Centre request was submitted.',
          '',
          `Reference: ${lead?.id || 'logged'}`,
          `Name: ${name}`,
          `Email: ${email}`,
          `Phone: ${phone}`,
          `Topic: ${topic}`,
          `Preferred contact: ${preferredContact}`,
          '',
          message
        ].join('\n'),
        replyTo: email
      });
    } catch (emailError) {
      logger.warn('Help request email notification failed', { error: emailError.message, leadId: lead?.id || null });
    }

    await Promise.allSettled([
      logEmailEvent(db, {
        eventType: 'help_request_submitted',
        recipientEmail: email,
        recipientRole: 'user',
        templateKey: 'help_request',
        subject: userSubject,
        status: notificationStatusFromDelivery(userDelivery),
        relatedLeadId: lead?.id || null,
        failureReason: userDelivery?.error || userDelivery?.reason || null,
        sentAt: userDelivery?.sent ? new Date() : null
      }),
      logEmailEvent(db, {
        eventType: 'new_help_request',
        recipientEmail: supportEmail,
        recipientRole: 'admin',
        templateKey: 'admin_alert',
        subject: adminSubject,
        status: notificationStatusFromDelivery(adminDelivery),
        relatedLeadId: lead?.id || null,
        failureReason: adminDelivery?.error || adminDelivery?.reason || null,
        sentAt: adminDelivery?.sent ? new Date() : null
      }),
      logNotification(db, {
        recipientEmail: email,
        recipientPhone: phone,
        channel: 'email',
        type: 'help_request_submitted',
        status: notificationStatusFromDelivery(userDelivery),
        payloadSummary: { topic, lead_id: lead?.id || null },
        relatedLeadId: lead?.id || null,
        failureReason: userDelivery?.error || userDelivery?.reason || null,
        sentAt: userDelivery?.sent ? new Date() : null
      }),
      logNotification(db, {
        recipientEmail: supportEmail,
        channel: 'in_app',
        type: 'new_help_request',
        status: 'logged',
        payloadSummary: { topic, lead_id: lead?.id || null, name },
        relatedLeadId: lead?.id || null
      })
    ]);

    return res.status(201).json({ ok: true, data: { id: lead?.id || null, status: 'received' } });
  } catch (error) {
    return next(error);
  }
}

async function handleCareerInterest(req, res, next) {
  try {
    const name = cleanText(req.body.name || req.body.full_name);
    const email = cleanText(req.body.email);
    const phone = cleanText(req.body.phone);
    const roleInterest = cleanText(req.body.role_interest || req.body.roleInterest) || 'General interest';
    const coverNote = cleanText(req.body.cover_note || req.body.coverNote || req.body.message) || null;
    const cvUrl = cleanText(req.body.cv_url || req.body.cvUrl) || null;
    const preferredContact = cleanText(req.body.preferred_contact || req.body.preferredContact) || 'email';

    const errors = [];
    if (!name) errors.push('name is required');
    if (!email) errors.push('email is required');
    if (!roleInterest) errors.push('role_interest is required');
    if (email && !isValidEmail(email)) errors.push('email is invalid');
    if (phone && !isValidPhone(phone)) errors.push('phone is invalid');
    if (cvUrl && !/^https?:\/\//i.test(cvUrl)) errors.push('cv_url must be a secure document link');
    if (errors.length) return res.status(400).json({ ok: false, error: 'Validation failed', details: errors });

    const supportEmail = getSupportEmail();
    const whatsappUrl = getSupportWhatsappUrl();
    const lead = await createLead(db, {
      source: cleanText(req.body.source) || 'careers_page',
      leadType: 'career',
      category: roleInterest,
      message: [
        coverNote || 'Career interest submitted.',
        cvUrl ? `CV link: ${cvUrl}` : ''
      ].filter(Boolean).join('\n'),
      priority: 'normal',
      contact: {
        name,
        email,
        phone: phone || null,
        preferredContactChannel: preferredContact,
        roleType: 'career_applicant'
      },
      activityType: 'career_interest_submitted',
      metadata: {
        role_interest: roleInterest,
        cv_url: cvUrl,
        preferred_contact: preferredContact
      }
    });

    const userSubject = 'We received your makaug career interest';
    const adminSubject = `[makaug] Career interest received • ${roleInterest}`;
    let userDelivery = { sent: false, reason: 'no_email_provider_configured' };
    let adminDelivery = { sent: false, reason: 'no_email_provider_configured' };

    try {
      userDelivery = await sendSupportEmail({
        to: email,
        subject: userSubject,
        text: [
          `Hello ${name},`,
          '',
          'Thank you for sharing your career interest with makaug.',
          `Role interest: ${roleInterest}`,
          `Reference: ${lead?.id || 'logged'}`,
          '',
          'Our team will review your details and contact you if there is a suitable next step.',
          `For updates or corrections, WhatsApp makaug: ${whatsappUrl}`,
          '',
          'makaug'
        ].join('\n')
      });
      adminDelivery = await sendSupportEmail({
        to: supportEmail,
        subject: adminSubject,
        text: [
          'A career interest form was submitted on makaug.com.',
          '',
          `Reference: ${lead?.id || 'logged'}`,
          `Name: ${name}`,
          `Email: ${email}`,
          `Phone: ${phone || '-'}`,
          `Role interest: ${roleInterest}`,
          `Preferred contact: ${preferredContact}`,
          cvUrl ? `CV link: ${cvUrl}` : 'CV link: -',
          '',
          coverNote || 'No cover note provided.'
        ].join('\n'),
        replyTo: email
      });
    } catch (emailError) {
      logger.warn('Career interest email notification failed', { error: emailError.message, leadId: lead?.id || null });
    }

    await Promise.allSettled([
      logEmailEvent(db, {
        eventType: 'career_interest_submitted',
        recipientEmail: email,
        recipientRole: 'career_applicant',
        templateKey: 'career_interest',
        subject: userSubject,
        status: notificationStatusFromDelivery(userDelivery),
        relatedLeadId: lead?.id || null,
        failureReason: userDelivery?.error || userDelivery?.reason || null,
        sentAt: userDelivery?.sent ? new Date() : null
      }),
      logEmailEvent(db, {
        eventType: 'new_career_interest',
        recipientEmail: supportEmail,
        recipientRole: 'admin',
        templateKey: 'admin_alert',
        subject: adminSubject,
        status: notificationStatusFromDelivery(adminDelivery),
        relatedLeadId: lead?.id || null,
        failureReason: adminDelivery?.error || adminDelivery?.reason || null,
        sentAt: adminDelivery?.sent ? new Date() : null
      }),
      logNotification(db, {
        recipientEmail: email,
        recipientPhone: phone || null,
        channel: 'email',
        type: 'career_interest_submitted',
        status: notificationStatusFromDelivery(userDelivery),
        payloadSummary: { lead_id: lead?.id || null, role_interest: roleInterest },
        relatedLeadId: lead?.id || null,
        failureReason: userDelivery?.error || userDelivery?.reason || null,
        sentAt: userDelivery?.sent ? new Date() : null
      }),
      logNotification(db, {
        recipientEmail: supportEmail,
        channel: 'in_app',
        type: 'new_career_interest',
        status: 'logged',
        payloadSummary: { lead_id: lead?.id || null, role_interest: roleInterest, name },
        relatedLeadId: lead?.id || null
      })
    ]);

    return res.status(201).json({ ok: true, data: { id: lead?.id || null, status: 'received' } });
  } catch (error) {
    return next(error);
  }
}

router.post('/report-listing', handleReportListing);
router.post('/report', handleReportListing);
router.post('/looking-for-property', handleLookingForProperty);
router.post('/looking', handleLookingForProperty);
router.post('/help-request', handleHelpRequest);
router.post('/help', handleHelpRequest);
router.post('/career-interest', handleCareerInterest);
router.post('/careers', handleCareerInterest);

module.exports = router;
