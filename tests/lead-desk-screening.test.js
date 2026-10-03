'use strict';
// Real rows from the production lead desk (2 Oct 2026): chit-chat and adverts
// must not appear as property demand; real requests must.
const test = require('node:test');
const assert = require('node:assert');
const { judgeDemandLead } = require('../services/leadDeskService');

const keep = (want, area, message) => judgeDemandLead({ want, area, message }).keep;

test('chit-chat, language requests and adverts are not property demand', () => {
  assert.equal(keep('any', '', 'Thanks very much that is a great service'), false);
  assert.equal(keep('any', '', 'Please do'), false);
  assert.equal(keep('any', 'Lunganda', 'Respond in lunganda'), false);
  assert.equal(keep('any', 'Rukiga', 'Can we chat in Rukiga Local language ?'), false);
  assert.equal(keep('rent', 'Kampala', 'Hello 👋 Welcome to Hash Property Consultants. We specialize in premium rentals across Kampala, call us today'), false);
});

test('real requests stay, with a real place when one is given', () => {
  assert.equal(keep('rent', 'Bunga', ''), true);
  assert.equal(keep('commercial', 'Kabalagala', ''), true);
  assert.equal(keep('any', '', 'Nahitaji msaada .natafuta nyumba ya upangaji'), true);
  assert.equal(keep('any', '', 'Hello! by the way, do you have that house yet? I want a house!'), true);
  assert.equal(judgeDemandLead({ want: 'any', area: 'Lubaga Kampala', message: 'Lubaga Kampala' }).area, 'Rubaga');
  assert.equal(judgeDemandLead({ want: 'rent', area: '10:12 Am', message: 'No approved listings found from typed area search.' }).area, null);
});
