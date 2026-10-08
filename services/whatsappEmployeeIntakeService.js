// The agent plan fee, from the rate card (config/pricing.js).
const PRICING = require('../config/pricing');
const AGENT_PLAN_FEE_LABEL = PRICING.ugx(PRICING.agent_subscription.amount_ugx);

const EMPLOYEE_INTAKE_TRIGGER = 'Agent 007';

const EMPLOYEE_INTAKE_STEPS = Object.freeze([
  'employee_intake_role',
  'employee_pitch_contact',
  'employee_pay_link_who',
  'employee_pay_link_lookup',
  'employee_pay_link_confirm',
  'employee_pay_link_prospect',
  'employee_agent_existing',
  'employee_agent_lookup',
  'employee_agent_confirm',
  'employee_new_agent_details',
  'employee_customer_details',
  'employee_identity_photo',
  'employee_agent_logo',
  'employee_intake_confirm',
  'employee_intake_fix',
  'employee_agent_pay_link',
  'employee_property_count',
  'employee_property_media'
]);

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanEmployeePropertyCaption(value = '') {
  const lines = String(value || '')
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((line) => cleanText(line))
    .filter(Boolean)
    .filter((line) => !/^(?:forwarded(?:\s+many\s+times)?|forwarded\s+message)$/i.test(line));
  return cleanText(lines.join(' '))
    .replace(/^(?:forwarded(?:\s+many\s+times)?|forwarded\s+message)\s*[:\-–—]?\s*/i, '')
    .trim();
}

function employeePriceLabel(facts = {}) {
  const metadata = facts.priceMetadata && typeof facts.priceMetadata === 'object'
    ? facts.priceMetadata
    : {};
  const currency = cleanText(metadata.price_original_currency || metadata.price_currency || 'UGX').toUpperCase();
  const amount = Number(metadata.price_original || metadata.price || facts.price || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return `${currency} ${Math.round(amount).toLocaleString('en-GB')}`;
}

function employeeListingLabel(listingType = '') {
  return ({
    sale: 'Property for sale',
    rent: 'Rental property',
    land: 'Land for sale',
    commercial: 'Commercial property',
    student: 'Student accommodation'
  })[cleanText(listingType).toLowerCase()] || 'Property listing';
}

function sentence(value = '') {
  const text = cleanText(value);
  if (!text) return '';
  const capitalized = `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function buildEmployeePublicDescription({
  caption = '',
  facts = {},
  listerName = '',
  videoCount = 0,
  keyFrameCount = 0
} = {}) {
  const cleanCaption = cleanEmployeePropertyCaption(caption);
  const location = [facts.locationPatch?.area, facts.locationPatch?.district]
    .map(cleanText)
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(', ');
  const price = employeePriceLabel(facts);
  const lead = `${employeeListingLabel(facts.listingType)}${location ? ` in ${location}` : ''}${price ? `, listed at ${price}` : ''}.`;
  const sourceDetail = cleanCaption ? sentence(cleanCaption) : '';
  const videoDetail = Number(videoCount) > 0
    ? `Watch ${Number(videoCount) === 1 ? 'the attached video tour' : `the ${Number(videoCount)} attached video tours`}${Number(keyFrameCount) > 0 ? ` and browse ${Number(keyFrameCount)} extracted key image${Number(keyFrameCount) === 1 ? '' : 's'}` : ''} before enquiring.`
    : '';
  const contact = cleanText(listerName)
    ? `Contact ${cleanText(listerName)} to confirm current availability, full specifications and viewing arrangements.`
    : 'Contact the listed agent to confirm current availability, full specifications and viewing arrangements.';
  return [lead, sourceDetail, videoDetail, contact].filter(Boolean).join(' ').slice(0, 2000);
}

function digits(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function isEmployeeIntakeTrigger(value = '') {
  return cleanText(value).toLowerCase() === EMPLOYEE_INTAKE_TRIGGER.toLowerCase();
}

function isEmployeeIntakeStep(value = '') {
  return EMPLOYEE_INTAKE_STEPS.includes(String(value || '').trim());
}

function isEmployeeIntakeComplete(value = '') {
  // Keep the command exact so captions containing the word "complete" are not
  // closed accidentally, while accepting the small mobile-keyboard typos seen
  // in real employee batches.
  return /^(?:complete|completed|done|clomplete|complte|compelete)(?:\s+(?:complete|completed|done|clomplete|complte|compelete))?$/i.test(cleanText(value));
}

/**
 * Walking away from an unfinished batch.
 *
 * COMPLETE only closes a batch that is actually finishable. When it refuses —
 * a property still missing its media, say — there was previously no way out at
 * all, and anything typed instead got stored as that property's caption. An
 * employee who wrote "Close the batch" ended up creating a property called
 * "Close the batch". This is the exit.
 */
function isEmployeeIntakeCancel(value = '') {
  const clean = cleanText(value).toLowerCase().replace(/[.!]+$/, '');
  return /^(?:cancel|cancel (?:the )?batch|close (?:the )?batch|end (?:the )?batch|stop|stop (?:the )?batch|exit|quit|abort|leave|nevermind|never mind|start over|restart)$/i.test(clean);
}

/**
 * Does this text look like it is describing a property at all?
 *
 * Any message at the media step that was not COMPLETE used to be saved as the
 * pending caption, so ordinary conversation — "close the batch", "hello",
 * "thanks" — silently became a phantom property with no media, which then
 * blocked the batch from ever completing. A caption has to carry at least one
 * property signal: a keyword, a number of rooms, a price, or a size.
 */

/**
 * The Luganda and Swahili words agents actually write, turned into the English
 * the caption parser reads. Used for understanding only — the agent's own words
 * are what get stored and shown to the moderator.
 *
 *   "Ennyumba ya kupangisa e Ntinda, ebisenge bisatu, 800k buli mwezi"
 *     -> "house for rent e Ntinda, 3 bedrooms, 800k per month"
 *   "Nyumba ya kupangisha Ntinda, vyumba 3, shilingi laki nane kwa mwezi"
 *     -> "house for rent Ntinda, 3 bedrooms, UGX 800000 per month"
 */
const LOCAL_NUMBER_WORDS = {
  // Swahili
  moja: 1, mbili: 2, tatu: 3, nne: 4, tano: 5, sita: 6, saba: 7, nane: 8, tisa: 9, kumi: 10,
  // Luganda
  emu: 1, kimu: 1, kimú: 1, bibiri: 2, bbiri: 2, bisatu: 3, ssatu: 3, bina: 4, nnya: 4,
  bitaano: 5, ttaano: 5, mukaaga: 6, musanvu: 7, munaana: 8, mwenda: 9, kkumi: 10
};
const LOCAL_NUMBER_RE = `(?:\\d+(?:[.,]\\d+)?|${Object.keys(LOCAL_NUMBER_WORDS).join('|')})`;

function localNumber(token = '') {
  const t = String(token || '').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LOCAL_NUMBER_WORDS, t)) return LOCAL_NUMBER_WORDS[t];
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function withEnglishPropertyTerms(value = '') {
  let text = String(value || '');
  if (!text) return text;
  const before = text;
  // Money first, while the number words are still words.
  const money = (multiplier) => (_m, n) => {
    const v = localNumber(n);
    return v ? ` UGX ${Math.round(v * multiplier)} ` : _m;
  };
  text = text
    .replace(new RegExp(`\\blaki\\s+(${LOCAL_NUMBER_RE})\\b`, 'gi'), money(100000))
    .replace(new RegExp(`\\b(?:milioni|million[iy]?|obukadde|bukadde)\\s+(${LOCAL_NUMBER_RE})\\b`, 'gi'), money(1000000))
    .replace(/\b(?:akakadde|kakadde)(?:\s+kamu)?\b/gi, ' UGX 1000000 ')
    .replace(new RegExp(`\\b(?:emitwalo|mitwalo)\\s+(${LOCAL_NUMBER_RE})\\b`, 'gi'), money(10000))
    .replace(/\b(?:shilingi|shillingi|ssente|sente)\b(?!\s+UGX)/gi, ' UGX ')
    .replace(/\bUGX\s+UGX\b/g, 'UGX');
  // Rooms: "ebisenge bisatu", "vyumba 3", "vyumba vitatu".
  text = text.replace(
    new RegExp(`\\b(?:ebisenge|bisenge|ebisenge\\s+by'?okwebakamu|vyumba|vyumba\\s+vya\\s+kulala)\\s+(?:vi|bi)?(${LOCAL_NUMBER_RE})\\b`, 'gi'),
    (_m, n) => { const v = localNumber(n); return v ? ` ${v} bedrooms ` : _m; }
  );
  const swaps = [
    [/\b(?:ya\s+)?(?:o?ku?pangisa|okupangisa|kupangisha|inapangishwa|ya\s+kodi|eby'?okupangisa|ppangisa)\b/gi, ' for rent '],
    [/\b(?:ya\s+|ery'?|eky'?|ey'?)?(?:okutunda|kutunda|etundibwa|kitundibwa|kuuza|(?:ki|i|li|zi|vi)nauzwa|ya\s+kuuza)\b/gi, ' for sale '],
    [/\b(?:ettaka|kiwanja|viwanja|shamba)\b/gi, ' land plot '],
    [/\b(?:ennyumba|enyumba|nyumba)\b/gi, ' house '],
    [/\b(?:edduuka|dduuka|duuka|duka|maduka)\b/gi, ' shop '],
    [/\b(?:buli\s+mwezi|kwa\s+mwezi|omwezi|mwezi)\b/gi, ' per month ']
  ];
  for (const [re, english] of swaps) text = text.replace(re, english);
  if (text === before) return before;
  return text.replace(/\s+/g, ' ').replace(/\s+([,.])/g, '$1').trim();
}

function looksLikePropertyCaption(value = '') {
  const clean = cleanText(withEnglishPropertyTerms(value));
  if (!clean) return false;
  if (/\b(?:property|house|home|mansion|bungalow|villa|townhouse|apartments?|flats?|condo|rentals?|units?|land|plots?|acres?|decimals?|commercial|shops?|offices?|warehouses?|hostels?|bedrooms?|bathrooms?|selling|for sale|for rent|to let|rent|sale)\b/i.test(clean)) return true;
  if (/\b\d+\s*(?:bed|bedroom|br|bath|bathroom)\b/i.test(clean)) return true;
  // A price: 600m, 450k, UGX 200,000,000, $600k
  if (/(?:ugx|usd|shs|\$|£|€)\s*[\d,.]+|\b[\d,.]+\s*(?:m|k|bn|million|billion)\b/i.test(clean)) return true;
  return false;
}

function employeeIntakePhoneAllowed(phone, {
  ownerAuthorized = false,
  allowlist = process.env.WHATSAPP_EMPLOYEE_INTAKE_NUMBERS || ''
} = {}) {
  if (ownerAuthorized) return true;
  const normalizedPhone = digits(phone);
  const allowed = String(allowlist || '')
    .split(/[,;\r\n]+/)
    .map(digits)
    .filter((candidate) => candidate.length >= 8);
  if (!allowed.length) return true;
  return allowed.some((candidate) => normalizedPhone === candidate || normalizedPhone.endsWith(candidate));
}

function choice(value, options = {}) {
  const input = cleanText(value).toLowerCase();
  for (const [answer, aliases] of Object.entries(options)) {
    if (aliases.some((alias) => input === String(alias).toLowerCase())) return answer;
  }
  return '';
}

function parseEmployeeRole(value = '') {
  return choice(value, {
    agent: ['1', 'agent', 'an agent', 'broker'],
    customer: ['2', 'customer', 'new customer', 'owner', 'property owner', 'normal person'],
    // Not a property at all: an employee standing in front of somebody who might
    // become an agent, who needs the pitch film before anything else happens.
    pitch: ['3', 'video', 'send video', 'agent video', 'pitch', 'send the video', 'invite'],
    // No properties and no pitch either: somebody has agreed to pay and is
    // waiting for the link.
    pay_link: ['4', 'pay', 'payment', 'pay link', 'payment link', 'send payment link', 'send pay link', 'send the payment link', 'invoice']
  });
}

/**
 * Registered agent, or somebody who is not on makaug yet?
 *
 * The two answers are genuinely different errands. A registered agent has a
 * profile, so the link can be attached to it and the payment lands against
 * their subscription. A prospect has nothing, so they need the joining film in
 * the same breath as the link — a bare payment link from a number they do not
 * know is indistinguishable from a scam.
 */
function employeePayLinkWhoPrompt(feeLabel = AGENT_PLAN_FEE_LABEL) {
  return `\u{1F4B3} *Send a payment link* — ${feeLabel} a month.\n\nWho is it for?\n\n`
    + '1 — An agent *already registered* on makaug.com\n'
    + '2 — A *new prospect* — not registered yet (they get the joining video with the link)\n\n'
    + 'Type *CANCEL* to stop.';
}

function parsePayLinkWho(value = '') {
  return choice(value, {
    registered: ['1', 'registered', 'yes', 'existing', 'already registered', 'agent', 'registered agent'],
    prospect: ['2', 'prospect', 'new', 'new prospect', 'not registered', 'no', 'new agent']
  });
}

function employeePayLinkLookupPrompt() {
  return 'Could you please confirm the name of the agent?\n\nSend their exact name or their makaug agent number.';
}

function employeePayLinkProspectPrompt(feeLabel = AGENT_PLAN_FEE_LABEL) {
  return `\u{1F4B3} *New prospect* — they get the joining video and the ${feeLabel} payment link together.\n\n`
    + 'Send their details like this:\n\n*Name | phone number*\n\n'
    + 'For example: Kato Brian | 0772123456\n\nType *CANCEL* to stop.';
}

/**
 * "Name | phone" for the person the film is going to. The same shape as the
 * other details prompts in this flow, minus everything a prospect does not have
 * yet — no district, no company, no ID.
 */
function parsePitchContact(value = '') {
  const parts = splitDetails(value).map(trimFieldEdges).filter(Boolean);
  if (parts.length < 2) return null;
  const [fullName, phone] = parts;
  const digits = String(phone || '').replace(/\D/g, '');
  if (!fullName || digits.length < 8) return null;
  return { fullName, phone };
}

/**
 * Asked once, right after a new agent is created, because approval can be days
 * later and whoever approves will not know what was agreed on the doorstep.
 */
function employeeAgentPayLinkPrompt(agentName = '', feeLabel = AGENT_PLAN_FEE_LABEL) {
  const who = String(agentName || '').trim() || 'this agent';
  return `\u{1F4B3} *Payment* \u2014 ${who} pays ${feeLabel} a month.\n\nShall I send them the payment link as soon as they are approved?\n\n1 \u2014 Yes, send it on approval\n2 \u2014 No, I will handle the payment myself`;
}

function parsePayLinkChoice(value = '') {
  return choice(value, {
    yes: ['1', 'yes', 'y', 'send', 'send it', 'ok', 'okay', 'yeah'],
    no: ['2', 'no', 'n', 'later', 'not now', 'skip', 'i will']
  });
}

function employeePitchContactPrompt() {
  return '🎬 *Send the makaug agent video*\n\nWho should it go to?\n\nSend their details like this:\n\n*Name | phone number*\n\nFor example: Kato Brian | 0772123456\n\nType *CANCEL* to stop.';
}

function parseYesNo(value = '') {
  return choice(value, {
    yes: ['1', 'yes', 'y', 'already registered', 'on website'],
    no: ['2', 'no', 'n', 'new agent', 'not registered']
  });
}

function parsePropertyBatchMode(value = '') {
  return choice(value, {
    single: ['1', 'single', 'one', 'one property', 'single property'],
    multiple: ['2', 'multiple', 'many', 'several', 'multiple properties', 'more than one']
  });
}

/**
 * Agents at a brand-new platform often will not hand over an ID on the spot.
 * Refusing to go further loses the listings; the honest answer is to let them
 * say LATER, record it, and make staff chase the ID before approval.
 */
function parseIdentityLaterRequest(value = '') {
  const text = cleanText(value).toLowerCase().replace(/[.!]+$/, '');
  if (!text) return false;
  return /^(?:later|share later|send later|send it later|id later|no id|not now|skip|skip id|skip for now|will send later|i will send later|we will send later|he will send later|she will send later|they will send later|no id for now)$/.test(text);
}

function parseIntakeConfirmation(value = '') {
  return choice(value, {
    yes: ['1', 'yes', 'y', 'correct', 'confirm', 'confirmed', 'ok', 'okay', 'proceed', 'continue'],
    no: ['2', 'no', 'n', 'wrong', 'incorrect', 'change', 'edit', 'fix']
  });
}

/**
 * The Quickway batch was loaded against the wrong answer to the very first
 * question — "agent" was meant, "new customer" was sent — so no agent profile
 * was ever created, nothing reached the approval queue and nothing could go
 * live. The confirmation caught it in writing; the only thing missing was a way
 * to change that answer without starting the batch again.
 */
function parseIntakeFixChoice(value = '') {
  return choice(value, {
    details: ['1', 'details', 'name', 'phone', 'location', 'district'],
    role: ['2', 'role', 'agent', 'owner', 'customer', 'private owner', 'who'],
    logo: ['3', 'logo', 'photo', 'picture', 'profile photo']
  });
}

/** Only read after a search has already come back empty. */
function parseAgentLookupChoice(value = '') {
  return choice(value, {
    search: ['1', 'search', 'search again', 'try again', 'again'],
    new: ['2', 'new', 'new agent', 'add', 'add them', 'not registered', 'add new']
  });
}

function parseSkipRequest(value = '') {
  const text = cleanText(value).toLowerCase().replace(/[.!]+$/, '');
  if (!text) return false;
  return /^(?:skip|no logo|no photo|none|no|later|skip logo|skip for now|do not have one|dont have one|don't have one|not now)$/.test(text);
}

function employeeAgentLogoPrompt(agentName = '') {
  const name = cleanText(agentName) || 'this agent';
  const possessive = /s$/i.test(name) ? `${name}’` : `${name}’s`;
  return `🖼 Now send ${possessive} logo or profile photo. It is what people see on their makaug profile and next to their listings.\n\nReply *SKIP* if there is no logo yet — staff can add one from the dashboard later.`;
}

function employeeIntakeFixPrompt({ role = 'agent', hasLogo = false } = {}) {
  const lines = ['What needs changing?', '', '1 — The details (name, phone, location)'];
  lines.push(role === 'agent'
    ? '2 — This is a *private owner*, not an agent'
    : '2 — This is an *agent*, not a private owner');
  if (role === 'agent') lines.push(`3 — The ${hasLogo ? 'logo' : 'logo (none sent yet)'}`);
  return lines.join('\n');
}

/** The check an employee sees before any property is sent. */
function employeeIntakeConfirmPrompt({
  role = 'agent',
  fullName = '',
  phone = '',
  company = '',
  district = '',
  identityReceived = false,
  profileLine = '',
  logoReceived = null,
  warningLine = ''
} = {}) {
  const lines = [
    '📋 *Please confirm before we start*',
    '',
    `👤 Name: ${cleanText(fullName) || '—'}`,
    `📞 Phone: ${cleanText(phone) || '—'}`
  ];
  if (role === 'agent' && cleanText(company)) lines.push(`🏢 Company: ${cleanText(company)}`);
  if (cleanText(district)) lines.push(`${role === 'agent' ? '📍 Primary district' : '📍 Property location'}: ${cleanText(district)}`);
  lines.push(`🪪 ID: ${identityReceived ? 'received and stored privately' : '*not supplied yet* — staff will chase it before approval'}`);
  if (logoReceived !== null) {
    lines.push(`🖼 Logo: ${logoReceived ? 'received — it goes on their profile' : 'none yet — staff can add one later'}`);
  }
  if (cleanText(profileLine)) lines.push(`📂 ${cleanText(profileLine)}`);
  if (cleanText(warningLine)) lines.push('', `⚠️ ${cleanText(warningLine)}`);
  lines.push('', 'Is this correct?', '', '1 — Yes, continue', '2 — No, something needs changing');
  return lines.join('\n');
}

function employeePropertyCountPrompt() {
  return 'How many properties are you sending in this batch?\n\n1 — One property\n2 — Multiple properties';
}

/**
 * People type the separator they were shown even when they are already using
 * new lines, so real submissions arrive as "Kimuli Brian/ ⏎ 0774505232/ ⏎
 * Kampala" or "Tuyisengye innocent ⏎ /0708020927 ⏎ /Kampala". Keeping those
 * strays produced an agent literally called "Kimuli Brian/" with the phone
 * "0774505232/" — a number nothing can dial, match or link a listing by. Any
 * separator character left clinging to the edge of a field is dropped.
 */
function trimFieldEdges(value = '') {
  return cleanText(value).replace(/^[\s/\\|,;:·•\-–—]+/, '').replace(/[\s/\\|,;:·•\-–—]+$/, '');
}

function splitDetails(value = '') {
  const raw = String(value || '').trim();
  const parts = raw.includes('|')
    ? raw.split('|')
    : raw.split(/\r?\n/);
  return parts.map(trimFieldEdges).filter(Boolean);
}

function parseNewAgentDetails(value = '') {
  const parts = splitDetails(value);
  if (parts.length < 3 || parts.length > 4) return null;
  const [fullName = '', phone = ''] = parts;
  const company = parts.length === 4 ? parts[2] : 'Independent agent';
  const district = parts.length === 4 ? parts[3] : parts[2];
  if (!fullName || digits(phone).length < 8 || !district) return null;
  return {
    fullName: trimFieldEdges(fullName),
    phone: trimFieldEdges(phone),
    company: trimFieldEdges(company) || 'Independent agent',
    district: trimFieldEdges(district)
  };
}

function parseCustomerDetails(value = '') {
  const [fullName = '', phone = '', location = ''] = splitDetails(value);
  if (!fullName || digits(phone).length < 8 || !location) return null;
  return {
    fullName: trimFieldEdges(fullName),
    phone: trimFieldEdges(phone),
    location: trimFieldEdges(location)
  };
}

/**
 * The single most expensive answer in this flow. "2" here means the listings
 * belong to the person who owns them, so no agent profile is created and
 * nothing links the listings to anybody. It was being chosen for agents over
 * and over, so the question now says what each answer costs.
 */
function employeeRolePrompt(feeLabel = AGENT_PLAN_FEE_LABEL) {
  return '🔐 *makaug employee intake*\nWho do these properties belong to?\n\n1 — An *agent or broker* (they get a makaug profile, and every property is listed under it)\n2 — A *private owner* selling their own property (no agent profile is created)\n\n3 — No properties yet — *send someone the makaug agent video* (what we are, how to list, what it costs)'
    + `\n4 — No properties yet — *send a payment link* (${feeLabel} a month, to a registered agent or a new prospect)`;
}

function employeeAgentExistingPrompt() {
  return 'Is the agent already registered on makaug.com?\n\n1 — Yes\n2 — No';
}

function employeeMediaPrompt(subjectName = '', batchMode = 'multiple') {
  const subject = cleanText(subjectName) || 'this person';
  if (batchMode === 'single') {
    return `✅ ${subject} is ready for *one property*. Send its first photo, video or document with the property type, exact location and price in the caption. Send any additional media without a new property caption and it will stay attached to that property.\n\nWhen the property is finished, type *COMPLETE*. It will stay in staff review until a moderator approves it.\n\nTo stop without finishing, type *CANCEL*.`;
  }
  return `✅ ${subject} is ready for *multiple properties*. Start each property by sending its first photo, video or document with the property type, exact location and price in the caption. Additional media without a new full property caption stays attached to the current property. A new full property caption starts the next property.\n\nYou can send property 1, 2, 3 and continue through the whole batch. Only when every property is finished, type *COMPLETE*. Everything will stay in staff review until a moderator approves it.\n\nTo stop without finishing, type *CANCEL*.`;
}

module.exports = {
  EMPLOYEE_INTAKE_STEPS,
  EMPLOYEE_INTAKE_TRIGGER,
  buildEmployeePublicDescription,
  cleanEmployeePropertyCaption,
  employeeAgentExistingPrompt,
  employeeAgentLogoPrompt,
  employeeIntakePhoneAllowed,
  employeeIntakeConfirmPrompt,
  employeeIntakeFixPrompt,
  employeeMediaPrompt,
  employeePropertyCountPrompt,
  parseAgentLookupChoice,
  parseIdentityLaterRequest,
  parseIntakeConfirmation,
  parseIntakeFixChoice,
  parseSkipRequest,
  employeeRolePrompt,
  employeePitchContactPrompt,
  employeeAgentPayLinkPrompt,
  employeePayLinkWhoPrompt,
  employeePayLinkLookupPrompt,
  employeePayLinkProspectPrompt,
  parsePayLinkWho,
  parsePayLinkChoice,
  parsePitchContact,
  looksLikePropertyCaption,
  withEnglishPropertyTerms,
  isEmployeeIntakeCancel,
  isEmployeeIntakeComplete,
  isEmployeeIntakeStep,
  isEmployeeIntakeTrigger,
  parseCustomerDetails,
  parseEmployeeRole,
  parseNewAgentDetails,
  parsePropertyBatchMode,
  parseYesNo,
  trimFieldEdges
};
