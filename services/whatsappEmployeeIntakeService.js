const EMPLOYEE_INTAKE_TRIGGER = 'Agent 007';

const EMPLOYEE_INTAKE_STEPS = Object.freeze([
  'employee_intake_role',
  'employee_agent_existing',
  'employee_agent_lookup',
  'employee_agent_confirm',
  'employee_new_agent_details',
  'employee_customer_details',
  'employee_identity_photo',
  'employee_agent_logo',
  'employee_intake_confirm',
  'employee_intake_fix',
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
function looksLikePropertyCaption(value = '') {
  const clean = cleanText(value);
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
    customer: ['2', 'customer', 'new customer', 'owner', 'property owner', 'normal person']
  });
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
  logoReceived = null
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
  lines.push('', 'Is this correct?', '', '1 — Yes, continue', '2 — No, something needs changing');
  return lines.join('\n');
}

function employeePropertyCountPrompt() {
  return 'How many properties are you sending in this batch?\n\n1 — One property\n2 — Multiple properties';
}

function splitDetails(value = '') {
  const raw = String(value || '').trim();
  const parts = raw.includes('|')
    ? raw.split('|')
    : raw.split(/\r?\n/);
  return parts.map(cleanText).filter(Boolean);
}

function parseNewAgentDetails(value = '') {
  const parts = splitDetails(value);
  if (parts.length < 3 || parts.length > 4) return null;
  const [fullName = '', phone = ''] = parts;
  const company = parts.length === 4 ? parts[2] : 'Independent agent';
  const district = parts.length === 4 ? parts[3] : parts[2];
  if (!fullName || digits(phone).length < 8 || !district) return null;
  return {
    fullName,
    phone: cleanText(phone),
    company: company || 'Independent agent',
    district
  };
}

function parseCustomerDetails(value = '') {
  const [fullName = '', phone = '', location = ''] = splitDetails(value);
  if (!fullName || digits(phone).length < 8 || !location) return null;
  return { fullName, phone: cleanText(phone), location };
}

function employeeRolePrompt() {
  return '🔐 *makaug employee intake*\nWhat are you loading?\n\n1 — Agent\n2 — New customer';
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
  parseIdentityLaterRequest,
  parseIntakeConfirmation,
  parseIntakeFixChoice,
  parseSkipRequest,
  employeeRolePrompt,
  looksLikePropertyCaption,
  isEmployeeIntakeCancel,
  isEmployeeIntakeComplete,
  isEmployeeIntakeStep,
  isEmployeeIntakeTrigger,
  parseCustomerDetails,
  parseEmployeeRole,
  parseNewAgentDetails,
  parsePropertyBatchMode,
  parseYesNo
};
