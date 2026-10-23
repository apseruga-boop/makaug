'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');
const acorn = require('acorn');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/makaug-app.js'), 'utf8');
const ast = acorn.parse(source, { ecmaVersion: 'latest' });
const fn = (name) => ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id && node.id.name === name);
const code = (name) => {
  const node = fn(name);
  assert.ok(node, name);
  return source.slice(node.start, node.end);
};

const PROPERTY_ID = '6927c520-ca3f-4f45-8004-d562d119cac0';
const AGENT_ID = '5674f6cb-37a0-4e1e-904f-06e03ec401ab';

test('the property page paints the booking shell from the listing payload and does not wait on the directory', () => {
  const openDetail = code('openDetail');
  const hydrate = openDetail.indexOf('await hydratePropertyDetailForUi');
  const prime = openDetail.indexOf('primePropertyListingBooking(');
  assert.ok(prime > 0 && prime < hydrate, 'the listing-booking request starts before property hydration finishes');
  assert.match(openDetail, /resolvedDetailBroker\(p\) \|\| brokerFromPropertyAgent\(p\)/);
  assert.match(openDetail, /propertyBookingSkeletonHtml\(\)/);
  assert.match(openDetail, /mountPropertyBookingPanel\(/);
  assert.doesNotMatch(openDetail, /scheduleDetailAgentLookup\(/);
  assert.match(code('propertyBookingPanelHtml'), /data-booking-visible="1"/);
  assert.match(code('propertyBookingPanelHtml'), /property-booking-skeleton/);
  assert.match(code('propertyBookingSkeletonHtml'), /Book a viewing/);
  assert.match(code('primePropertyListingBooking'), /\/listing-booking\?listing_id=/);
  assert.match(code('initAgentBookingPanel'), /primePropertyListingBooking\(agentId, listingId\)/);
  assert.match(code('initAgentBookingPanel'), /\/booking-options/);
  const profile = code('openBrokerProfile');
  assert.match(profile, /initAgentBookingPanel\(b\.id\)/);
  assert.match(profile, /brokerAboutParagraphs\(b\)/);
  assert.match(code('renderAgentProfileListingGrid'), /propCard\(listing\)/);
  assert.doesNotMatch(profile, /listing-booking/);
});

test('a cold property route defers the agent directory until the booking card can paint', async () => {
  const calls = [];
  const context = {
    window: {
      location: { pathname: `/property/${PROPERTY_ID}` },
      setTimeout(fn) { calls.push(['timer', typeof fn]); return 7; },
      clearTimeout() { calls.push(['clear']); },
      requestIdleCallback(fn) { calls.push(['idle', typeof fn]); }
    },
    brokerDirectoryDeferTimer: 0,
    apiRequest: async (url) => { calls.push(['api', url]); return { data: [] }; },
    releaseDeferredBrokerDirectory() { calls.push(['release']); }
  };
  vm.createContext(context);
  vm.runInContext(code('refreshBrokersFromApi'), context);
  const deferred = await vm.runInContext('refreshBrokersFromApi({ silent: true })', context);
  assert.equal(deferred, false);
  assert.deepEqual(calls, [['timer', 'function']]);
  assert.equal(calls.some((row) => row[0] === 'api'), false);
});

test('listing-booking reads one approved property and its agent, not the catalogue', () => {
  const route = fs.readFileSync(path.join(root, 'routes/agents.js'), 'utf8');
  const start = route.indexOf("router.get('/:id/listing-booking'");
  const end = route.indexOf("router.get('/:id/booking-options'");
  assert.ok(start > 0 && end > start);
  const handler = route.slice(start, end);
  assert.match(handler, /listing-booking:card/);
  assert.match(handler, /p\.id = \$1/);
  assert.match(handler, /p\.agent_id = \$2/);
  assert.match(handler, /LIMIT 1/);
  assert.match(handler, /profile_photo_url/);
  assert.match(handler, /verified_by_makaug/);
  assert.match(handler, /image_url/);
  assert.doesNotMatch(handler, /LIMIT 40/);
  assert.doesNotMatch(handler, /st_listing/);
  assert.doesNotMatch(handler, /loadAgentPublicSummary/);
});

test('the booking shell strings are already translated in all nine languages', () => {
  const keys = ['Book a viewing', 'Book with', 'Your name', 'Phone number', 'Send request', 'Never pay before viewing', 'Viewing', 'Callback', 'Question', 'Offer'];
  for (const lang of ['lg', 'sw', 'ac', 'ny', 'rn', 'sm', 'am', 'ar']) {
    const pack = JSON.parse(fs.readFileSync(path.join(root, 'assets/i18n', `site-${lang}.json`), 'utf8'));
    for (const key of keys) {
      assert.ok(pack.phrases[key] && pack.phrases[key] !== key, `${lang} translates ${key}`);
    }
    assert.ok(pack.patterns.some((row) => row[0] === '^Book with (.+)$'), `${lang} translates Book with a name`);
  }
});

test('a missing listing-booking agent removes the booking panel and offers MakaUG contact', () => {
  const mount = code('mountPropertyBookingPanel');
  assert.ok(mount.indexOf('hideMissingAgentBookingPanel()') < mount.indexOf('initAgentBookingPanel('));
  assert.match(mount, /if \(!data\?\.agent\)/);
  assert.match(code('makaugListingContactLink'), /MAKAUG_SUPPORT_WHATSAPP/);
  assert.match(code('hideMissingAgentBookingPanel'), /makaugListingContactLink\(property\)/);
  assert.match(code('openDetail'), /data-broker-profile-action="profile"/);
  assert.match(code('openDetail'), /data-broker-profile-action="share"/);

  function makeNode(tag) {
    const node = {
      tag,
      id: '',
      className: '',
      innerHTML: '',
      parent: null,
      attributes: {},
      children: [],
      setAttribute(name, value) { this.attributes[name] = String(value); },
      getAttribute(name) { return this.attributes[name]; },
      get parentElement() { return this.parent; },
      remove() {
        if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
        this.parent = null;
      },
      replaceWith(next) {
        if (!this.parent) return;
        const index = this.parent.children.indexOf(this);
        next.parent = this.parent;
        this.parent.children.splice(index, 1, next);
        this.parent = null;
      },
      querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
      },
      querySelectorAll(selector) {
        const found = [];
        const walk = (current) => {
          current.children.forEach((child) => {
            found.push(child);
            walk(child);
          });
        };
        walk(this);
        return found.filter((child) => selectorMatches(child, selector));
      },
      insertAdjacentHTML(position, html) {
        const child = makeNode('a');
        child.outerHTML = html;
        if (html.includes('data-makaug-contact')) child.setAttribute('data-makaug-contact', '1');
        const href = html.match(/href="([^"]+)"/);
        if (href) child.setAttribute('href', href[1].replace(/&amp;/g, '&'));
        if (position === 'beforebegin' && this.parent) {
          const index = this.parent.children.indexOf(this);
          child.parent = this.parent;
          this.parent.children.splice(index, 0, child);
        } else {
          child.parent = this;
          this.children.push(child);
        }
      }
    };
    return node;
  }
  function selectorMatches(node, selector) {
    if (selector === '#property-booking-panel') return node.id === 'property-booking-panel';
    if (selector === '#detail-save-btn') return node.id === 'detail-save-btn';
    if (selector === '#page-detail .detail-broker-profile-link') return node.className.split(/\s+/).includes('detail-broker-profile-link');
    if (selector === '#page-detail .sticky') return node.className.split(/\s+/).includes('sticky');
    if (selector === '#page-detail [data-broker-profile-action]') return Boolean(node.getAttribute('data-broker-profile-action'));
    if (selector === '[data-makaug-contact]') return node.getAttribute('data-makaug-contact') === '1';
    return false;
  }
  const page = makeNode('div');
  page.id = 'page-detail';
  const card = makeNode('div');
  card.className = 'sticky top-24';
  card.parent = page;
  page.children.push(card);
  const profile = makeNode('a');
  profile.className = 'detail-broker-profile-link flex';
  profile.setAttribute('href', '/agents/f1932d42-eddd-4bae-904d-b883600113ee');
  profile.innerHTML = '<span class="font-semibold">Segawa Frederick Kevin SFK</span>';
  profile.parent = card;
  const panel = makeNode('div');
  panel.id = 'property-booking-panel';
  panel.parent = card;
  const share = makeNode('button');
  share.setAttribute('data-broker-profile-action', 'share');
  share.parent = card;
  const view = makeNode('a');
  view.setAttribute('data-broker-profile-action', 'profile');
  view.setAttribute('href', '/agents/f1932d42-eddd-4bae-904d-b883600113ee');
  view.parent = card;
  const save = makeNode('button');
  save.id = 'detail-save-btn';
  save.parent = card;
  card.children.push(profile, panel, share, view, save);
  const documentStub = {
    getElementById(id) {
      return page.querySelectorAll('*').concat(page.querySelectorAll('#property-booking-panel')).find((node) => node.id === id)
        || [page, card, profile, panel, share, view, save].find((node) => node.id === id)
        || null;
    },
    querySelector(selector) { return page.querySelector(selector); },
    querySelectorAll(selector) { return page.querySelectorAll(selector); },
    createElement() { return makeNode('div'); }
  };
  const context = {
    document: documentStub,
    activeDetailPropertyId: PROPERTY_ID,
    findPropertyForUi() {
      return { id: PROPERTY_ID, title: '4-Bed property for sale in Kitende' };
    },
    getPropertyShareUrl() { return `https://makaug.com/property/${PROPERTY_ID}`; },
    buildWhatsAppUrl(phone, text) { return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`; },
    adminAttr(value) { return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); },
    translatePropertyUi(text) { return text; },
    MAKAUG_SUPPORT_WHATSAPP: '256780863394'
  };
  vm.createContext(context);
  vm.runInContext(`${code('makaugListingContactLink')}\n${code('hideMissingAgentBookingPanel')}\nhideMissingAgentBookingPanel();`, context);
  assert.equal(card.children.includes(panel), false);
  assert.equal(card.children.includes(share), false);
  assert.equal(card.children.includes(view), false);
  assert.equal(card.children.includes(profile), false);
  assert.equal(card.querySelector('.detail-broker-profile-link'), null);
  const contact = card.querySelector('[data-makaug-contact]');
  assert.ok(contact);
  assert.match(contact.getAttribute('href'), /wa\.me\/256780863394/);
  assert.match(decodeURIComponent(contact.getAttribute('href')), /Kitende/);
  assert.equal(card.children.includes(save), true);
});

test('an inline property agent is enough to name the booking panel before the directory loads', () => {
  const context = {
    result: null
  };
  vm.createContext(context);
  vm.runInContext(`${code('brokerFromPropertyAgent')}\nresult = brokerFromPropertyAgent(${JSON.stringify({
    id: PROPERTY_ID,
    agent: AGENT_ID,
    agent_name: 'Francis Isabirye',
    agent_company: 'Isabirye Homes',
    agent_phone: '+256772000111',
    agent_whatsapp: '256772000111'
  })});`, context);
  assert.equal(context.result.id, AGENT_ID);
  assert.equal(context.result.name, 'Francis Isabirye');
  assert.equal(context.result.company, 'Isabirye Homes');
  assert.equal(context.result.phone, '+256772000111');
  assert.equal(context.result.whatsapp, '256772000111');
});
