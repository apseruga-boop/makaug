'use strict';

/**
 * 13 Oct 2026: an agent's video (captionless, caption sent next) was routed to the
 * property he had finished earlier. A moderator had approved it, so attaching
 * failed, the video was dropped and the agent was told it could not be attached.
 * A property that is no longer pending must stop being "current"; the media is
 * held for the caption that follows.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const src = fs.readFileSync(path.join(__dirname, '../routes/whatsapp.js'), 'utf8');

test('a failed attach to a no-longer-pending property holds the media instead of dropping it', () => {
  const start = src.indexOf("/no longer pending|changed status/i");
  assert(start > 0, 'handler for a closed current property is missing');
  const block = src.slice(start, start + 900);
  assert(block.includes('data.current_property_id = null'), 'the closed property must stop being current');
  assert(block.includes('rememberEmployeePendingMedia(data, storedMedia'), 'the media must be kept');
  assert(block.includes('replaceEmployeeSession'), 'and persisted in the session');
});

test('attachEmployeeReviewMedia still rejects a property that is not pending', () => {
  assert(src.includes("'The current employee intake property is no longer pending'"));
});
