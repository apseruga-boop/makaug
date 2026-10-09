'use strict';

// /brokers used to ship an empty "loading" grid, so crawlers saw no agent
// links at all. Render the first 24 public agents into the HTML.

const { addPublicAgentEligibilityFilters } = require('./publicAgentEligibilityService');
const { escapeHtml } = require('./agentBadge');

const BROKER_SSR_LIMIT = 24;

async function loadBrokerCards(db, limit = BROKER_SSR_LIMIT) {
  const filters = ['a.status = $1'];
  const values = ['approved'];
  addPublicAgentEligibilityFilters(filters, values, 'a');
  values.push(limit);
  const result = await db.query(
    `SELECT a.id, a.full_name, a.company_name, a.districts_covered,
            COALESCE(p.active_listings, 0) AS listings_count
       FROM agents a
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS active_listings
         FROM properties p
         WHERE p.agent_id = a.id AND p.status = 'approved'
       ) p ON true
      WHERE ${filters.join(' AND ')}
        AND COALESCE(p.active_listings, 0) > 0
      ORDER BY COALESCE(p.active_listings, 0) DESC, a.created_at DESC
      LIMIT $${values.length}`,
    values
  );
  return result.rows;
}

function renderBrokerCardsHtml(rows = []) {
  const cards = rows.slice(0, BROKER_SSR_LIMIT).map((row) => {
    const name = String(row.full_name || row.company_name || 'makaug agent').trim();
    const company = row.company_name && row.company_name !== name ? String(row.company_name).trim() : '';
    const districts = (Array.isArray(row.districts_covered) ? row.districts_covered : []).filter(Boolean).slice(0, 3).join(', ');
    const count = Number(row.listings_count || 0);
    return `<article class="rounded-2xl border border-green-100 bg-white p-5">
              <h2 class="font-black text-lg"><a href="/agents/${encodeURIComponent(row.id)}" class="text-green-900 hover:underline">${escapeHtml(name)}</a></h2>
              ${company ? `<p class="text-sm text-gray-600">${escapeHtml(company)}</p>` : ''}
              ${districts ? `<p class="text-sm text-gray-600">Covers ${escapeHtml(districts)}</p>` : ''}
              <p class="text-sm font-bold text-green-800 mt-1">${count} live ${count === 1 ? 'listing' : 'listings'}</p>
            </article>`;
  });
  return cards.join('\n            ');
}

// Replaces the "directory loading" placeholder inside #brokers-grid. The page
// script still rebuilds the grid on load. No match leaves the HTML untouched.
function injectBrokerCards(html, rows = []) {
  if (!rows.length) return html;
  const pattern = /(<div id="brokers-grid"[^>]*>)\s*<div class="rounded-2xl[^"]*"[^>]*>[\s\S]*?<\/p>\s*<\/div>/;
  if (!pattern.test(html)) return html;
  return html.replace(pattern, (_m, open) => `${open}\n            ${renderBrokerCardsHtml(rows)}`);
}

module.exports = { loadBrokerCards, renderBrokerCardsHtml, injectBrokerCards, BROKER_SSR_LIMIT };
