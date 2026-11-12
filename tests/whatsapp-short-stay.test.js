'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const svc = require('../services/whatsappShortStayService');
const { resolveWhatsappLocation, whatsappLocationPrompt } = require('../services/whatsappLocationResolverService');

const NIN = 'CM90012345678A';
const JPEG = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString('base64')}`;
const S = svc.STEP;

/**
 * A WhatsApp conversation against the real flow, with stand-ins for the
 * database, the short-stay services and the property listing's kit (its
 * prompts come back as <key>, so a test can see which one was used). `send`
 * carries the session between messages as whatsapp_sessions would.
 */
function conversation({
  phone = '256772123456',
  agent = null,
  agentIdOnFile = null,
  contactName = 'Amina N',
  createError = null,
  feeIncluded = null
} = {}) {
  const state = { step: 'main_menu', shortStay: null };
  const calls = { create: [], photos: [], copied: [], storedIds: [], notices: [] };
  const replies = [];
  const db = {
    query: async (sql, params = []) => {
      if (/UPDATE whatsapp_sessions/.test(sql)) {
        state.step = params[1];
        state.shortStay = params[2] === 'null' ? null : JSON.parse(params[2]);
        return { rows: [] };
      }
      if (/FROM agents/.test(sql)) return { rows: agent ? [agent] : [] };
      return { rows: [] };
    }
  };
  let stored = 0;
  const seen = new Set();
  function kitFor(photos = []) {
    return {
      t: (key) => `<${key}>`,
      contactPrompt: (number) => `<contact ${number}>`,
      photos: {
        min: 2,
        max: 10,
        // The property listing's validateAndStoreListingPhotos, in miniature.
        store: async (draft) => {
          const kept = [...draft.photos];
          const outcomes = [];
          for (const item of photos) {
            if (item.reject) { outcomes.push({ status: 'rejected', validation: { verdict: 'non_property' } }); continue; }
            if (seen.has(item.data_url)) { outcomes.push({ status: 'duplicate' }); continue; }
            seen.add(item.data_url);
            stored += 1;
            kept.push(`https://media.test/whatsapp-listings/photos/p${stored}.jpg`);
            outcomes.push({ status: 'accepted', count: kept.length });
          }
          calls.photos.push(photos.length);
          return { photos: kept, photoHashes: [], photoPerceptualHashes: [], photoValidation: [], outcomes };
        },
        checklist: (count) => `<checklist ${count}>`,
        accepted: (count) => `<accepted ${count}>`,
        enough: (count) => `<enough ${count}>`,
        duplicate: (count) => `<duplicate ${count}>`,
        rejected: (count, verdict) => `<rejected ${count} ${verdict}>`,
        complete: (count) => `<complete ${count}>`
      }
    };
  }
  const baseDeps = {
    db,
    env: { PUBLIC_SITE_URL: 'https://makaug.com' },
    now: () => new Date(conversation.now || '2026-11-12T08:00:00Z'),
    logger: { warn() {}, error() {} },
    intakeEnabled: () => true,
    pricing: () => ({ ownerMonthly: 20000, agentMonthly: 50000 }),
    resolveLocation: resolveWhatsappLocation,
    locationPrompt: whatsappLocationPrompt,
    createListing: async (payload, context) => {
      calls.create.push({ payload, context });
      if (createError) {
        const error = typeof createError === 'function' ? createError(calls.create.length) : createError;
        if (error) throw error;
      }
      return {
        id: '11111111-2222-3333-4444-555555555555',
        reference: 'ST-000321',
        listing_fee_included_in_agent_plan: feeIncluded == null ? Boolean(agent) : feeIncluded
      };
    },
    attachPhoto: async (listingId, dataUrl) => { calls.copied.push({ listingId, dataUrl }); return { photo_count: calls.copied.length }; },
    photoDataUrl: async (url) => `data:image/jpeg;base64,${Buffer.from(url).toString('base64')}`,
    idUploadPath: (listingId) => `/list-property?type=short_stay&stid=${listingId}&t=signed`,
    agentIdOnFile: async () => agentIdOnFile,
    storePrivateIdPhoto: async (dataUrl) => {
      calls.storedIds.push(dataUrl);
      return 's3://makaug-private/short-stays/whatsapp/identity/id.jpg';
    },
    validNin: (value) => /^(CM|CF|PM|PF)[A-Z0-9]{12}$/.test(value),
    candidateDataUrl: async (candidate) => candidate.dataUrl,
    notifyStaff: async (notice) => { calls.notices.push(notice); }
  };
  async function send(body, extra = {}) {
    const photos = extra.photos || [];
    const result = await svc.handleShortStayWhatsapp({
      phone,
      body,
      step: extra.step || state.step,
      session: { session_data: { short_stay: state.shortStay } },
      contactName,
      photoCandidates: photos,
      mediaCandidates: extra.media || [],
      mediaUrl: extra.mediaUrl || '',
      mediaType: extra.mediaType || (photos.length ? 'image/jpeg' : ''),
      conversationControl: extra.control || null
    }, { ...baseDeps, kit: kitFor(photos) });
    if (result.handled) replies.push(result.message);
    return result;
  }
  return { send, state, calls, replies };
}

let photoSerial = 0;
const photo = (extra = {}) => ({ data_url: `${JPEG}#${(photoSerial += 1)}`, mime_type: 'image/jpeg', ...extra });

/** An owner, from "list my short stay" to the photos being done and the name given. */
async function ownerToContact(c) {
  await c.send('I want to list my apartment for short stays');
  await c.send('1');
  await c.send('Cosy 2-bedroom apartment in Kololo');
  await c.send('4');
  await c.send('150k');
  await c.send('Bright apartment with wifi, parking and a balcony over the city.');
  await c.send('No parties after 10pm');
  await c.send('', { photos: [photo(), photo()] });
  await c.send('DONE');
  await c.send('OK');
}

test('host requests start the flow; guests and everything else are left alone', () => {
  for (const text of [
    'I want to list my apartment for short stays',
    'How do I post my airbnb?',
    'list my guest house',
    'I have an apartment I let by the night',
    'Can I advertise a short stay here?'
  ]) assert.ok(svc.isListShortStayRequest(text), text);
  for (const text of [
    'I need a short stay in Kololo for 2 nights',
    'my budget is 100k per night',
    'looking for an airbnb in Ntinda',
    'Do you have short stays in Kololo?',
    '3 bedroom house for rent in Kira'
  ]) assert.ok(!svc.isListShortStayRequest(text), text);
  assert.ok(svc.isBareShortStayKeyword('SHORT STAY'));
  assert.ok(!svc.isBareShortStayKeyword('short stay in Kololo'));
});

test('reading owner or agent, rooms, guests, prices and the National ID number', () => {
  assert.strictEqual(svc.parseOwnership('1'), 'owner');
  assert.strictEqual(svc.parseOwnership('I am an agent'), 'agent');
  assert.strictEqual(svc.parseOwnership('maybe'), '');
  assert.deepStrictEqual(svc.parseRoomsGuests('2 bedrooms, 4 guests'), { bedrooms: 2, max_guests: 4 });
  assert.deepStrictEqual(svc.parseRoomsGuests('studio for 2'), { bedrooms: 0, max_guests: 2 });
  assert.strictEqual(svc.parseCount('four'), 4);
  assert.strictEqual(svc.parseCount('99'), null);
  assert.deepStrictEqual(svc.parseNightly('150,000'), { amount: 150000 });
  assert.deepStrictEqual(svc.parseNightly('UGX 150k per night'), { amount: 150000 });
  assert.deepStrictEqual(svc.parseNightly('POA'), { poa: true });
  assert.deepStrictEqual(svc.parseNightly('80,000,000'), { tooHigh: true });
  assert.strictEqual(svc.extractNin(`my nin ${NIN.toLowerCase()}`), NIN);
  assert.strictEqual(svc.extractNin('cm 9001 2345 678a'), NIN);
  assert.strictEqual(svc.extractNin('front of my id'), '');
  assert.strictEqual(svc.redactIdNumbers(`it is ${NIN}`), 'it is [ID number]');
});

test('an owner lists a short stay with the property listing\'s questions, in its order, and it reaches the desk', async () => {
  const c = conversation();
  const steps = [];
  const go = async (body, extra) => { const r = await c.send(body, extra); steps.push(r.nextStep); return r; };

  const start = await go('I want to list my apartment for short stays');
  // Fees said plainly before anything else, then the property listing's first question.
  assert.match(start.message, /UGX 20,000 a month once approved: no free days, no commission/);
  assert.match(start.message, /<askOwnership>/);
  await go('1');
  const titled = await go('Cosy 2-bedroom apartment in Kololo');
  // The title already said where and how many bedrooms: not asked again.
  assert.match(titled.message, /Kololo, Kampala \| 2 bedrooms/);
  await go('4');
  await go('150k');
  await go('Bright apartment with wifi, parking and a balcony over the city.');
  await go('No parties after 10pm');
  const first = await go('', { photos: [photo()] });
  assert.strictEqual(first.message, '<accepted 1>');
  const enough = await go('', { photos: [photo()] });
  assert.strictEqual(enough.message, '<enough 2>');
  const done = await go('DONE');
  assert.match(done.message, /<complete 2>/);
  await go('OK'); // the name WhatsApp shows
  const contact = await go('YES');
  assert.match(contact.message, /<askSelfie>/);
  assert.match(contact.message, /reply \*LATER\*/);
  const idPhoto = await go(`NIN ${NIN}`, { photos: [photo()] });
  assert.strictEqual(idPhoto.sensitive, true);
  assert.doesNotMatch(idPhoto.message, new RegExp(NIN));
  const final = await go('AGREE');

  assert.deepStrictEqual(steps, [
    S.ownership, S.title, S.guests, S.price, S.description, S.rules, S.photos, S.photos, S.photos,
    S.name, S.contact, S.idPhoto, S.terms, 'submitted'
  ]);
  const { payload, context } = c.calls.create[0];
  assert.deepStrictEqual({
    title: payload.title, district: payload.district, area: payload.area, bedrooms: payload.bedrooms,
    max_guests: payload.max_guests, nightly: payload.base_nightly_ugx, poa: payload.price_on_application,
    rules: payload.house_rules, name: payload.host_name, phone: payload.host_phone, whatsapp: payload.host_whatsapp,
    type: payload.host_type, rtl: payload.right_to_let_declared, terms: payload.terms_accepted, from: payload.listed_from,
    kind: payload.id_kind, number: payload.id_number, doc: payload.id_document_url
  }, {
    title: 'Cosy 2-bedroom apartment in Kololo', district: 'Kampala', area: 'Kololo', bedrooms: 2,
    max_guests: 4, nightly: 150000, poa: false, rules: 'No parties after 10pm', name: 'Amina N',
    phone: '256772123456', whatsapp: '256772123456', type: 'owner', rtl: true, terms: true, from: 'whatsapp',
    kind: 'national_id', number: NIN, doc: 's3://makaug-private/short-stays/whatsapp/identity/id.jpg'
  });
  assert.strictEqual(context.listedVia, 'whatsapp');
  assert.match(context.acquisitionNotes, /number ending 456/);
  assert.doesNotMatch(context.acquisitionNotes, /772123456/);
  // Nothing reached the desk until AGREE; then the photos went in through the short-stay pipeline.
  assert.strictEqual(c.calls.create.length, 1);
  assert.strictEqual(c.calls.copied.length, 2);
  assert.ok(c.calls.copied.every((p) => p.listingId === '11111111-2222-3333-4444-555555555555' && /^data:image\/jpeg/.test(p.dataUrl)));
  // Staff are told, as for a property.
  assert.deepStrictEqual(
    { reference: c.calls.notices[0].reference, photos: c.calls.notices[0].photoCount, id: c.calls.notices[0].idStatus },
    { reference: 'ST-000321', photos: 2, id: 'received' }
  );
  assert.match(final.message, /Your short stay has been submitted/);
  assert.match(final.message, /Reference: \*ST-000321\*/);
  assert.match(final.message, /📸 2 photos/);
  assert.match(final.message, /We have your National ID\. Your listing shows \*ID still pending\* until our team has checked it/);
  assert.match(final.message, /UGX 20,000 a month keeps it live\. No free days, and makaug takes no commission/);
  assert.strictEqual(c.state.step, 'submitted');
  assert.strictEqual(c.state.shortStay, null);
  for (const message of c.replies) {
    assert.doesNotMatch(message, new RegExp(NIN), 'the ID number is never repeated back');
    assert.doesNotMatch(message, /passport|driving permit/i, 'only a National ID is asked for');
  }
});

test('the ID can wait: LATER goes straight to AGREE, the stay is still submitted, with the private link', async () => {
  const c = conversation();
  await ownerToContact(c);
  await c.send('YES');
  const later = await c.send('LATER');
  assert.strictEqual(later.nextStep, S.terms);
  assert.match(later.message, /Reply \*AGREE\* to send it for review/);
  const final = await c.send('agree');
  const { payload } = c.calls.create[0];
  assert.strictEqual(payload.id_kind, undefined);
  assert.strictEqual(payload.id_document_url, undefined);
  assert.match(final.message, /No ID yet: your listing shows \*ID still pending\*/);
  assert.match(final.message, /private link \(it works for 30 days, keep it to yourself\): https:\/\/makaug\.com\/list-property\?type=short_stay&stid=/);
  assert.strictEqual(c.calls.notices[0].idStatus, 'pending');
});

test('nothing is wasted: a number without a photo, or a photo without a number, still goes to staff', async () => {
  const numberFirst = conversation();
  await ownerToContact(numberFirst);
  await numberFirst.send('YES');
  const kept = await numberFirst.send(NIN);
  assert.strictEqual(kept.nextStep, S.idPhoto);
  assert.match(kept.message, /National ID number saved/);
  assert.doesNotMatch(kept.message, new RegExp(NIN));
  await numberFirst.send('LATER');
  await numberFirst.send('AGREE');
  assert.strictEqual(numberFirst.calls.create[0].payload.id_number, NIN);
  assert.strictEqual(numberFirst.calls.create[0].payload.id_document_url, undefined);

  const photoOnly = conversation();
  await ownerToContact(photoOnly);
  await photoOnly.send('YES');
  const askNumber = await photoOnly.send('', { photos: [photo()] });
  assert.strictEqual(askNumber.nextStep, S.idNumber);
  const wrong = await photoOnly.send('CM123');
  assert.match(wrong.message, /<invalidNin>/);
  assert.doesNotMatch(wrong.message, /CM123/);
  await photoOnly.send('later');
  await photoOnly.send('AGREE');
  assert.strictEqual(photoOnly.calls.create[0].payload.id_number, undefined);
  assert.match(photoOnly.calls.create[0].payload.id_document_url, /^s3:\/\//);

  // A photo sent while another question is open is kept for the listing.
  const early = conversation();
  await early.send('I want to list my apartment for short stays');
  const atOwnership = await early.send('', { photos: [photo()] });
  assert.strictEqual(atOwnership.nextStep, S.ownership);
  assert.match(atOwnership.message, /Photo saved \(1 so far\)/);
  assert.strictEqual(early.state.shortStay.photos.length, 1);
});

test('an approved agent with an ID on file: plan fee, no owner/name/number/ID questions', async () => {
  const agent = { id: 'agent-1', user_id: 'user-9', full_name: 'Kato Brian', email: 'kato@example.com', phone: '+256772123456' };
  const c = conversation({ agent, agentIdOnFile: { id: 'agent-1' } });
  const start = await c.send('SHORT STAY');
  assert.strictEqual(start.nextStep, S.title);
  assert.match(start.message, /Kato: the same steps as listing a property/);
  assert.match(start.message, /included in your agent plan \(UGX 50,000 a month\)/);
  await c.send('3 bedroom villa in Kira');
  await c.send('6');
  await c.send('POA');
  await c.send('Family villa with a garden and a pool, 20 minutes from Kampala.');
  await c.send('none');
  await c.send('', { photos: [photo(), photo(), photo()] });
  const terms = await c.send('DONE');
  assert.strictEqual(terms.nextStep, S.terms);
  assert.match(terms.message, /have the owner's permission to let it/);
  const final = await c.send('AGREE');
  const { payload, context } = c.calls.create[0];
  assert.strictEqual(payload.host_type, 'agent');
  assert.strictEqual(payload.host_name, 'Kato Brian');
  assert.strictEqual(payload.host_email, 'kato@example.com');
  assert.strictEqual(payload.price_on_application, true);
  assert.strictEqual(payload.id_kind, undefined);
  assert.strictEqual(context.hostAgentId, 'agent-1');
  assert.strictEqual(context.hostUserId, 'user-9');
  assert.match(final.message, /already on file from your agent account/);
  assert.match(final.message, /included in your agent plan/);

  // Without an ID on file, the agent is asked for the National ID after the photos.
  const d = conversation({ agent, agentIdOnFile: null });
  await d.send('SHORT STAY');
  await d.send('3 bedroom villa in Kira');
  await d.send('6');
  await d.send('POA');
  await d.send('Family villa with a garden and a pool, 20 minutes from Kampala.');
  await d.send('none');
  await d.send('', { photos: [photo(), photo()] });
  assert.strictEqual((await d.send('DONE')).nextStep, S.idPhoto);
});

test('"short stay" on its own asks list or find; option 6 on the listing menu starts the same questions', async () => {
  const c = conversation();
  assert.strictEqual((await c.send('short stay')).nextStep, S.pick);
  const find = await c.send('2');
  assert.strictEqual(find.nextStep, 'main_menu');
  assert.match(find.message, /makaug\.com\/short-term/);

  const d = conversation();
  await d.send('short stay');
  assert.strictEqual((await d.send('1')).nextStep, S.ownership);

  const e = conversation();
  const fromMenu = await e.send('6', { step: 'listing_type' });
  assert.strictEqual(fromMenu.nextStep, S.ownership);
  assert.match(fromMenu.message, /✅ \*Short stay\* \(by the night\)\.\n\n<askOwnership>/);
});

test('never takes over another flow: guests, a listing in progress, a staff intake, photos posted with a caption, a paused chat', async () => {
  const c = conversation();
  assert.strictEqual((await c.send('I need a short stay in Kololo for 2 nights')).handled, false);
  assert.strictEqual((await c.send('5')).handled, false, 'a 5 from someone who is not an agent is not ours');
  const description = await c.send('My apartment is a short stay by the night, fully furnished', { step: 'description' });
  assert.strictEqual(description.handled, false);
  assert.strictEqual(description.resetStep, null);
  assert.strictEqual((await c.send('We have an airbnb apartment in Kololo for 150k per night', { step: 'employee_property_media' })).handled, false);
  assert.strictEqual((await c.send('Posting my airbnb in Kololo, 150k per night', { photos: [photo()] })).handled, false);
  assert.strictEqual((await c.send('list my airbnb', { control: { ai_mode: 'off' } })).handled, false);
  assert.strictEqual(c.calls.create.length, 0);
});

test('cancelling before AGREE sends nothing; NO at the end keeps the answers for a later AGREE', async () => {
  const c = conversation();
  await c.send('list my short stay');
  await c.send('1');
  const cancelled = await c.send('CANCEL');
  assert.strictEqual(cancelled.nextStep, 'main_menu');
  assert.match(cancelled.message, /Nothing was sent for review/);
  assert.strictEqual(c.state.shortStay, null);

  const d = conversation();
  await ownerToContact(d);
  await d.send('YES');
  await d.send('LATER');
  const no = await d.send('NO');
  assert.strictEqual(no.nextStep, S.terms);
  assert.match(no.message, /nothing has been submitted/);
  await d.send('AGREE');
  assert.strictEqual(d.calls.create.length, 1);
});

test('photos: the property listing\'s checks decide; DONE needs the minimum', async () => {
  const c = conversation();
  await c.send('I want to list my apartment for short stays');
  await c.send('1');
  await c.send('Cosy 2-bedroom apartment in Kololo');
  await c.send('4');
  await c.send('150k');
  await c.send('Bright apartment with wifi, parking and a balcony over the city.');
  await c.send('none');
  const rejected = await c.send('', { photos: [photo({ reject: true })] });
  assert.strictEqual(rejected.message, '<rejected 0 non_property>');
  const tooFew = await c.send('DONE');
  assert.match(tooFew.message, /<needExactlyFivePhotos>/);
  const one = photo();
  await c.send('', { photos: [one] });
  assert.strictEqual((await c.send('', { photos: [one] })).message, '<duplicate 1>');
});

test('numbers: YES keeps the WhatsApp number; NO or a foreign WhatsApp number asks for a Ugandan one', async () => {
  const c = conversation();
  await ownerToContact(c);
  const no = await c.send('NO');
  assert.strictEqual(no.nextStep, S.phone);
  assert.match((await c.send('12345')).message, /does not look like a Ugandan mobile number/);
  await c.send('0772 555 444');
  await c.send('LATER');
  await c.send('AGREE');
  assert.strictEqual(c.calls.create[0].payload.host_phone, '0772 555 444');

  const foreign = conversation({ phone: '447757000111' });
  await ownerToContact(foreign);
  assert.strictEqual(foreign.state.step, S.phone);
});

test('a refusal from the server sends the host back to the answer to fix; a failure keeps everything for another AGREE', async () => {
  const phoneError = Object.assign(new Error('Listing submission is not valid'), {
    status: 400,
    details: ['A reachable Ugandan phone number is required, for example 0780 863 394.']
  });
  const c = conversation({ createError: (n) => (n === 1 ? phoneError : null) });
  await ownerToContact(c);
  await c.send('YES');
  await c.send('LATER');
  const refused = await c.send('AGREE');
  assert.strictEqual(refused.nextStep, S.phone);
  await c.send('0772 555 444');
  const final = await c.send('AGREE');
  assert.match(final.message, /submitted/);

  const d = conversation({ createError: (n) => (n === 1 ? new Error('database is down') : null) });
  await ownerToContact(d);
  await d.send('YES');
  await d.send('LATER');
  const failed = await d.send('AGREE');
  assert.strictEqual(failed.nextStep, S.terms);
  assert.match(failed.message, /your answers are kept/);
  assert.match((await d.send('AGREE')).message, /submitted/);
});

test('a short description keeps the host\'s words and adds the facts', () => {
  const text = svc.descriptionFor({ description: 'Clean and quiet.', bedrooms: 0, area: 'Kololo', district: 'Kampala', max_guests: 2 });
  assert.strictEqual(text, 'Clean and quiet. Studio short stay in Kololo, Kampala, for up to 2 guests.');
  assert.ok(text.length >= 40);
});

test('a flow left for a day is dropped; SHORT STAY then starts again', async () => {
  const c = conversation();
  conversation.now = '2026-11-12T08:00:00Z';
  await c.send('list my airbnb');
  conversation.now = '2026-11-13T09:00:00Z';
  const later = await c.send('3 bedroom house for rent in Kira');
  assert.strictEqual(later.handled, false);
  assert.strictEqual(later.resetStep, 'main_menu');
  assert.strictEqual(c.state.shortStay, null);
  const again = await c.send('SHORT STAY', { step: S.title });
  conversation.now = null;
  assert.strictEqual(again.nextStep, S.pick);
});

test('a PDF is refused for the ID; a photo is asked for', async () => {
  const c = conversation();
  await ownerToContact(c);
  await c.send('YES');
  const pdf = await c.send('', { media: [{ mime_type: 'application/pdf' }], mediaType: 'application/pdf' });
  assert.strictEqual(pdf.nextStep, S.idPhoto);
  assert.match(pdf.message, /<sendSelfiePhotoOnly>/);
});

test('mid-flow, "3" bedrooms, "2 4", "confirm" or "AGREE" answer us, not a guest\'s booking or the weekly check-in', async () => {
  assert.ok(svc.answersShortStayQuestion(S.ownership, '1'));
  assert.ok(svc.answersShortStayQuestion(S.bedrooms, '3'));
  assert.ok(svc.answersShortStayQuestion(S.bedrooms, '2 4'));
  assert.ok(svc.answersShortStayQuestion(S.guests, '4'));
  assert.ok(svc.answersShortStayQuestion(S.terms, 'confirm'));
  assert.ok(svc.answersShortStayQuestion(S.terms, 'AGREE'));
  assert.ok(svc.answersShortStayQuestion(S.contact, 'YES'));
  assert.ok(svc.answersShortStayQuestion(S.pick, '2'));
  assert.ok(!svc.answersShortStayQuestion(S.photos, '3'));
  assert.ok(!svc.answersShortStayQuestion('main_menu', '1'));

  const now = Date.parse('2026-11-12T08:00:00Z');
  const fresh = '2026-11-12T07:55:00Z';
  const at = (step, askedAt, lastMessageAt = null) => ({
    query: async () => ({ rows: [{ current_step: step, asked_at: askedAt, last_message_at: lastMessageAt }] })
  });
  const phone = '256772123456';
  assert.strictEqual(await svc.isAnsweringShortStay(at(S.bedrooms, fresh), phone, '3', { now }), true);
  assert.strictEqual(await svc.isAnsweringShortStay(at(S.ownership, fresh), phone, '1', { now }), true);
  assert.strictEqual(await svc.isAnsweringShortStay(at(S.terms, fresh), phone, 'confirm', { now }), true);
  // A reply that names the request still goes to it.
  assert.strictEqual(await svc.isAnsweringShortStay(at(S.ownership, fresh), phone, '1 MKS-AB12CD', { now }), false);
  assert.strictEqual(await svc.isAnsweringShortStay(at(S.bedrooms, fresh), phone, '3 K7', { now }), false);
  // Not an answer to this step, a day-old flow, or no flow: the booking checks run as before.
  assert.strictEqual(await svc.isAnsweringShortStay(at(S.photos, fresh), phone, '3', { now }), false);
  assert.strictEqual(await svc.isAnsweringShortStay(at(S.bedrooms, '2026-11-11T07:00:00Z'), phone, '3', { now }), false);
  assert.strictEqual(await svc.isAnsweringShortStay(at('main_menu', fresh), phone, '1', { now }), false);
  // "List or find" keeps no draft: the time of the last message counts.
  assert.strictEqual(await svc.isAnsweringShortStay(at(S.pick, null, new Date('2026-11-12T07:58:00Z')), phone, '1', { now }), true);
  let queried = false;
  await svc.isAnsweringShortStay({ query: async () => { queried = true; return { rows: [] }; } }, phone, 'x'.repeat(60), { now });
  assert.strictEqual(queried, false);
});

test('a "list or find" question left for a day is not answered by a stray "1"', async () => {
  const saved = [];
  const db = { query: async (sql, params) => { if (/UPDATE whatsapp_sessions/.test(sql)) saved.push(params[1]); return { rows: [] }; } };
  const result = await svc.handleShortStayWhatsapp({
    phone: '256772123456',
    body: '1',
    step: S.pick,
    session: { last_message_at: new Date('2026-11-10T08:00:00Z'), session_data: {} }
  }, { db, now: () => new Date('2026-11-12T08:00:00Z'), intakeEnabled: () => true });
  assert.strictEqual(result.handled, false);
  assert.strictEqual(result.resetStep, 'main_menu');
  assert.deepStrictEqual(saved, ['main_menu']);
});

test('stored listing photos are read back for the short-stay pipeline: data URLs as they are, nothing that is not an image', async () => {
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]);
  const fetchImpl = async () => ({ ok: true, arrayBuffer: async () => jpegBytes });
  assert.strictEqual(await svc.storedPhotoDataUrl(JPEG, { fetchImpl }), JPEG);
  const fromHttps = await svc.storedPhotoDataUrl('https://cdn.example.com/photo.jpg', { fetchImpl });
  assert.strictEqual(fromHttps, `data:image/jpeg;base64,${jpegBytes.toString('base64')}`);
  const pdfFetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('%PDF-1.4') });
  await assert.rejects(() => svc.storedPhotoDataUrl('https://cdn.example.com/doc.pdf', { fetchImpl: pdfFetch }), /not_an_image/);
  await assert.rejects(() => svc.storedPhotoDataUrl('whatsapp-web://inline-image-1', { fetchImpl }), /unreadable/);
});

test('the WhatsApp pipeline runs the flow first, lends it the property listing\'s kit, and keeps ID numbers out of logs', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');
  const runtime = source.slice(source.indexOf('async function processInboundRuntimeUnlocked'));
  const hook = runtime.indexOf('shortStayWhatsapp.handleShortStayWhatsapp(');
  assert.ok(hook > 0);
  assert.ok(hook < runtime.indexOf('handlePaymentClaimMessage({'), 'before payment claims');
  assert.ok(hook < runtime.indexOf('handleEmployeeWhatsappIntake({'), 'before agent intake, so an agent\'s photos stay with the stay');
  assert.match(runtime, /kit: shortStayListingKit\(\{/);
  assert.match(runtime, /notifyStaff: \(notice\) => notifyStaffOfWhatsappShortStay/);
  assert.match(source, /store: \(draft\) => validateAndStoreListingPhotos\(\{/);
  assert.match(runtime, /body: loggedBodyIsIdAnswer \? shortStayWhatsapp\.redactIdNumbers\(body\) : body/);
  assert.match(runtime, /rawText: shortStay\.sensitive \? shortStayWhatsapp\.redactIdNumbers\(effectiveBody\) : effectiveBody/);
  assert.match(source, /inputText: sensitive\s*\? shortStayWhatsapp\.redactIdNumbers/);
  assert.ok(runtime.indexOf('getSession(phone)') < runtime.indexOf('WhatsApp message from'));
  assert.match(runtime, /isIdStep\(session\.current_step\)\s*\?\s*shortStayWhatsapp\.redactIdNumbers\(body\)/);
  // The staff notice and email show the last 3 digits only.
  const notice = source.slice(source.indexOf('async function notifyStaffOfWhatsappShortStay'), source.indexOf('function parseOwnerReviewForward'));
  assert.match(notice, /number ending \$\{phoneTail/);
  assert.doesNotMatch(notice, /Host: \$\{hostPhone/);
  // The web bridge asks the flow before its booking and check-in replies.
  const bridge = source.slice(source.indexOf("router.post('/web-bridge/inbound'"));
  const guard = bridge.indexOf('isAnsweringShortStay(db, runtimePhone, body)');
  assert.ok(guard > 0 && guard < bridge.indexOf('handleHostStayReply(db'));
  assert.match(bridge, /answeringShortStay \? null : await handleHostStayReply\(db/);
  assert.match(bridge, /answeringShortStay \? null : await handleAgentBookingReply\(db/);
  // The listing menu offers short stays, and so does the agent menu.
  assert.match(source, /5️⃣ Commercial property\\n6️⃣ Short stays \(by the night\)/);
  assert.match(source, /5️⃣ \*List a short stay\* \(by the night\) — reply \*SHORT STAY\*/);
});

test('an agent ID on file is found by the agent record as well as the signed-in account', async () => {
  const { findVerifiedAgentIdentityOnFile } = require('../services/shortTermIdentityService');
  const seen = [];
  const db = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [{ id: 'a-1' }] }; } };
  assert.deepStrictEqual(await findVerifiedAgentIdentityOnFile(db, { agentId: 'a-1' }), { id: 'a-1' });
  assert.deepStrictEqual(seen[0].params, ['', 'a-1']);
  assert.match(seen[0].sql, /a\.id::text = \$2::text/);
  assert.strictEqual(await findVerifiedAgentIdentityOnFile(db, {}), null);
  const createSource = fs.readFileSync(path.join(__dirname, '..', 'services', 'shortTermService.js'), 'utf8');
  assert.match(createSource, /agentId: context\.hostAgentId \|\| ''/);
});
