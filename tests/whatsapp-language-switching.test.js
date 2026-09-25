'use strict';

/**
 * Ronald's conversation was set to Luganda, and after that nothing he wrote in
 * English could get it back. He sent "Hello" and received a paragraph of
 * Luganda; he sent "I want a standard single house in lweza" and received
 * nothing at all.
 *
 * Getting back to English was a one-way door:
 *
 *   if (nextLang === 'en' && currentLang !== 'en' && source !== 'ai_explicit_language') return false;
 *
 * The door was there for a real reason. English is detected partly by property
 * words — house, rent, plot, agent — that Luganda, Swahili, Runyankole and the
 * rest borrow wholesale, so "Nfunira agent e Wakiso" trips the English rule.
 * Refusing every switch to English was the blunt way to stop that.
 *
 * The fix measures instead of refusing. English confidence now comes from the
 * small words a sentence can only really be carrying if it is English — i, the,
 * want, in, for — so a real English sentence clears 0.92 and a Luganda sentence
 * with one borrowed noun does not. These tests pin both halves: English gets out
 * of the door, and the thing the door was protecting against still cannot.
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  detectLanguageFromText,
  englishTextConfidence,
  resolveDetectedLanguage,
  shouldAdoptDetectedLanguage
} = require('../routes/whatsapp').__test;

const fromLuganda = (text, sessionStep = 'main_menu') => shouldAdoptDetectedLanguage({
  sessionLang: 'lg',
  sessionStep,
  detectedLanguage: resolveDetectedLanguage({ text, sessionLang: 'lg' })
});

test('the exact message Ronald sent switches the conversation back to English', () => {
  assert.strictEqual(fromLuganda('Hello'), true);
  assert.strictEqual(fromLuganda('I want a standard single house in lweza'), true);
});

test('ordinary English sentences get out of a Luganda conversation', () => {
  const sentences = [
    'hi',
    'Hello there',
    'Good morning',
    'Do you have any 2 bedroom in Kira for rent',
    'Can you show me plots for sale in Gayaza please',
    'I am looking for a house to rent',
    'thanks, send me the details'
  ];
  for (const sentence of sentences) {
    assert.strictEqual(fromLuganda(sentence), true, `"${sentence}" should read as English`);
  }
});

test('a Luganda sentence carrying a borrowed English noun does not', () => {
  const sentences = [
    'Nfunira agent e Wakiso',
    'Njagala ennyumba ya rent e Lweza',
    'Nsobola okufuna plot e Gayaza',
    'Oli otya',
    'Gyebale ko'
  ];
  for (const sentence of sentences) {
    assert.strictEqual(fromLuganda(sentence), false, `"${sentence}" is not English`);
  }
});

test('a bare property keyword is not enough to change anyone language', () => {
  // These are the words every language on the list borrows. On their own they
  // must not move the conversation, in either direction.
  for (const word of ['house', 'rent', 'plot', 'agent', 'land', 'lweza']) {
    assert.strictEqual(fromLuganda(word), false, `"${word}" alone must not switch to English`);
  }
});

test('English confidence is measured from the small words, not the nouns', () => {
  assert.ok(englishTextConfidence('hello') >= 0.95, 'a plain greeting is unambiguous');
  assert.ok(englishTextConfidence('i want a house in lweza') >= 0.92, 'three function words is a sentence');
  assert.ok(englishTextConfidence('house rent plot') < 0.92, 'borrowed nouns alone prove nothing');
});

test('switching away from English is unchanged', () => {
  const adopt = (text) => shouldAdoptDetectedLanguage({
    sessionLang: 'en',
    sessionStep: 'main_menu',
    detectedLanguage: resolveDetectedLanguage({ text, sessionLang: 'en' })
  });
  assert.strictEqual(adopt('Oli otya'), true, 'a Luganda greeting still turns the conversation Luganda');
  assert.strictEqual(adopt('Habari, nataka nyumba'), true, 'and Swahili still turns it Swahili');
  assert.strictEqual(adopt('Hello'), false, 'English in an English conversation is not a change');
});

test('asking in words still beats the heuristic', () => {
  // "speak English" arrives as ai_explicit_language and must never be second
  // guessed by a confidence score.
  assert.strictEqual(shouldAdoptDetectedLanguage({
    sessionLang: 'lg',
    sessionStep: 'listing_price',
    detectedLanguage: { code: 'en', confidence: 0.4, source: 'ai_explicit_language' }
  }), true);
});

test('the English rule reports a confidence rather than a fixed number', () => {
  const strong = detectLanguageFromText('I want a standard single house in lweza');
  const weak = detectLanguageFromText('house');
  assert.strictEqual(strong.code, 'en');
  assert.strictEqual(weak.code, 'en');
  assert.ok(strong.confidence > weak.confidence,
    'a sentence must score higher than a single borrowed word, or the door is back');
});
