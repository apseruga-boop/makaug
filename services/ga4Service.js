const logger = require('../config/logger');

function isConfigured() {
  return Boolean(process.env.GA4_MEASUREMENT_ID && process.env.GA4_API_SECRET);
}

async function sendGA4Event({ clientId, eventName, params = {} }) {
  if (!isConfigured()) {
    return { sent: false, reason: 'ga4_not_configured' };
  }

  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;

  const payload = {
    client_id: clientId || `backend.${Date.now()}`,
    events: [
      {
        name: eventName,
        params: {
          engagement_time_msec: 100,
          ...params
        }
      }
    ]
  };

  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const body = await resp.text();
    logger.warn('GA4 event forward failed', {
      status: resp.status,
      body
    });
    return { sent: false, status: resp.status, body };
  }

  return { sent: true };
}

module.exports = {
  isConfigured,
  sendGA4Event
};
