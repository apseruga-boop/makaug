const EMPLOYEE_INTAKE_TRIGGER = 'Agent 007';

const EMPLOYEE_INTAKE_STEPS = Object.freeze([
  'employee_intake_role',
  'employee_agent_existing',
  'employee_agent_lookup',
  'employee_agent_confirm',
  'employee_new_agent_details',
  'employee_customer_details',
  'employee_identity_photo',
  'employee_property_count',
  'employee_property_media'
]);

function cleanText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
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
  return /^(?:complete|completed|done)(?:\s+(?:complete|completed|done))?$/i.test(cleanText(value));
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
  const [fullName = '', phone = '', company = '', district = ''] = splitDetails(value);
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
  return '🔐 *MakaUG employee intake*\nWhat are you loading?\n\n1 — Agent\n2 — New customer';
}

function employeeAgentExistingPrompt() {
  return 'Is the agent already registered on makaug.com?\n\n1 — Yes\n2 — No';
}

function employeeMediaPrompt(subjectName = '', batchMode = 'multiple') {
  const subject = cleanText(subjectName) || 'this person';
  if (batchMode === 'single') {
    return `✅ ${subject} is ready for *one property*. Send its first photo, video or document with the property type, exact location and price in the caption. Send any additional media without a new property caption and it will stay attached to that property.\n\nWhen the property is finished, type *COMPLETE*. It will stay in staff review until a moderator approves it.`;
  }
  return `✅ ${subject} is ready for *multiple properties*. Start each property by sending its first photo, video or document with the property type, exact location and price in the caption. Additional media without a new full property caption stays attached to the current property. A new full property caption starts the next property.\n\nYou can send property 1, 2, 3 and continue through the whole batch. Only when every property is finished, type *COMPLETE*. Everything will stay in staff review until a moderator approves it.`;
}

module.exports = {
  EMPLOYEE_INTAKE_STEPS,
  EMPLOYEE_INTAKE_TRIGGER,
  employeeAgentExistingPrompt,
  employeeIntakePhoneAllowed,
  employeeMediaPrompt,
  employeePropertyCountPrompt,
  employeeRolePrompt,
  isEmployeeIntakeComplete,
  isEmployeeIntakeStep,
  isEmployeeIntakeTrigger,
  parseCustomerDetails,
  parseEmployeeRole,
  parseNewAgentDetails,
  parsePropertyBatchMode,
  parseYesNo
};
