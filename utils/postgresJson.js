'use strict';

function replaceLoneSurrogates(value = '') {
  const text = String(value ?? '');
  let repaired = '';

  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);

    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const nextCodeUnit = text.charCodeAt(index + 1);
      if (nextCodeUnit >= 0xDC00 && nextCodeUnit <= 0xDFFF) {
        repaired += text[index] + text[index + 1];
        index += 1;
      } else {
        repaired += '\uFFFD';
      }
      continue;
    }

    if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      repaired += '\uFFFD';
      continue;
    }

    repaired += text[index];
  }

  return repaired;
}

function truncateUnicode(value = '', maxCodePoints = 0) {
  const limit = Math.max(0, Number(maxCodePoints) || 0);
  if (!limit) return '';
  return Array.from(replaceLoneSurrogates(value)).slice(0, limit).join('');
}

function postgresSafeJsonStringify(value) {
  return JSON.stringify(value, (_key, item) => (
    typeof item === 'string' ? replaceLoneSurrogates(item) : item
  ));
}

module.exports = {
  postgresSafeJsonStringify,
  replaceLoneSurrogates,
  truncateUnicode,
};
