'use strict';

/**
 * Changing a conversation from the WhatsApp inbox — status, category,
 * assignment, whether the bot answers it — answered 500 on every single field.
 *
 * Two SQL faults, both invisible until the statement was actually run:
 *
 *  1. The category parameter is read twice, once as a column value and once by
 *     the CASE that decides whether the category was set by hand. Uncast, those
 *     two uses deduce different types and PostgreSQL rejects the statement as
 *     an ambiguous parameter (42P08).
 *  2. Inside ON CONFLICT DO UPDATE, a bare `metadata` could mean the row that
 *     is there or the one being inserted, so merging onto it failed as an
 *     ambiguous column reference (42702).
 *
 * These are caught by building the statement and asking PostgreSQL to parse it,
 * which is the only thing that would have caught them. With no database to hand
 * the test says so and passes rather than pretending to have checked.
 */

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert');

const HAS_DB = Boolean(process.env.DATABASE_URL);

// The connection pool holds the event loop open, so the run would never end.
after(async () => {
  if (!HAS_DB) return;
  await require('../config/database').pool.end().catch(() => {});
});

test('every conversation control field can actually be saved', async (t) => {
  if (!HAS_DB) {
    t.skip('no DATABASE_URL: this needs a real PostgreSQL to parse the statement');
    return;
  }
  const { updateWhatsappConversationControl } = require('../services/whatsappConversationService');
  const phone = `25670000${String(Date.now()).slice(-4)}`;

  const patches = [
    ['status', { status: 'resolved' }],
    ['category', { category: 'support' }],
    ['priority', { priority: 'high' }],
    ['ai_mode', { ai_mode: 'off' }],
    ['assigned_to', { assigned_to: 'ronald' }],
    ['admin_notes', { admin_notes: 'ghost number from the linked-device bug' }],
    ['last_summary', { last_summary: 'see the real conversation' }],
    ['tags', { tags: ['ghost', 'fixed'] }],
    ['metadata', { metadata: { note: 'first' } }],
    ['metadata merges', { metadata: { second: 'yes' } }],
    ['all at once', {
      status: 'archived',
      category: 'fraud_report',
      priority: 'low',
      ai_mode: 'copilot',
      assigned_to: '',
      admin_notes: 'x',
      last_summary: 'y',
      tags: [],
      metadata: { note: 'z' }
    }]
  ];

  for (const [what, patch] of patches) {
    const row = await updateWhatsappConversationControl(phone, patch, 'contract-test');
    assert.ok(row && row.phone, `saving ${what} must return the row`);
  }

  const finalRow = await updateWhatsappConversationControl(phone, {}, 'contract-test');
  assert.strictEqual(finalRow.status, 'archived');
  assert.strictEqual(finalRow.category, 'fraud_report');
  assert.strictEqual(finalRow.priority, 'low');
  assert.strictEqual(finalRow.ai_mode, 'copilot');
  assert.strictEqual(finalRow.metadata.note, 'z');
  assert.strictEqual(finalRow.metadata.second, 'yes',
    'metadata merges onto what is already there rather than replacing it');
});

test('a conversation that has no control row yet is created, not refused', async (t) => {
  if (!HAS_DB) {
    t.skip('no DATABASE_URL: this needs a real PostgreSQL to parse the statement');
    return;
  }
  const { updateWhatsappConversationControl } = require('../services/whatsappConversationService');
  const phone = `25671111${String(Date.now()).slice(-4)}`;
  const row = await updateWhatsappConversationControl(phone, { status: 'needs_human', category: 'fraud_report' }, 'contract-test');
  assert.strictEqual(row.status, 'needs_human');
  assert.strictEqual(row.category, 'fraud_report');
  assert.strictEqual(row.category_source, 'manual', 'a category chosen by a person is marked as chosen by a person');
});

test('the statement casts the parameter the CASE reads twice', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'services', 'whatsappConversationService.js'), 'utf8');
  assert.match(source, /CASE WHEN \$\$\{idx \+ 1\}::text IS NULL/,
    'the CASE must read a cast parameter, or PostgreSQL cannot type it');
  assert.match(source, /COALESCE\(whatsapp_conversation_state\.metadata/,
    'the metadata merge must name the table it merges onto');
});
