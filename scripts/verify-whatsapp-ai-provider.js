#!/usr/bin/env node
require('dotenv').config();

const {
  classifyWhatsappIntent,
  detectWhatsappLanguage,
  extractNaturalPropertyQuery,
  suggestWhatsappAssistantReply,
  transcribeAudioFromDataUrl
} = require('../services/aiService');
const { getProviderMeta, isLlmEnabled } = require('../services/llmProvider');

async function main() {
  const provider = getProviderMeta();
  console.log('LLM provider:', {
    enabled: isLlmEnabled(),
    provider: provider.provider,
    baseURL: provider.baseURL,
    hasApiKey: provider.hasApiKey
  });

  const samples = [
    { text: 'Natafuta shamba Mbale', sessionLanguage: 'en', fallbackType: 'land' },
    { text: 'Noonya enju ya rent e Kampala', sessionLanguage: 'lg', fallbackType: 'rent' },
    { text: 'Find me an agent in Wakiso', sessionLanguage: 'en', fallbackType: 'any' },
    { text: 'Respond in Luganda', sessionLanguage: 'en', fallbackType: 'any' }
  ];

  for (const sample of samples) {
    const language = await detectWhatsappLanguage({
      text: sample.text,
      sessionLanguage: sample.sessionLanguage,
      step: 'main_menu'
    });
    const intent = await classifyWhatsappIntent({
      text: sample.text,
      language: language.language || sample.sessionLanguage,
      step: 'main_menu',
      sessionData: {}
    });
    const filters = await extractNaturalPropertyQuery({
      text: sample.text,
      language: language.language || sample.sessionLanguage,
      fallbackType: sample.fallbackType
    });
    console.log('\nSample:', sample.text);
    console.log({ language, intent, filters });
  }

  const reply = await suggestWhatsappAssistantReply({
    userMessage: 'I am outside Uganda and need help finding a student room near Makerere',
    intent: 'property_search',
    language: 'en',
    source: 'verify_whatsapp_ai_provider',
    context: {
      assistantRole: 'friendly property assistant in the user pocket',
      preferredLink: 'https://makaug.com/#page-students',
      supportedActions: ['search approved listings', 'save the request for follow-up', 'drive users back to MakaUg']
    }
  });
  console.log('\nAssistant reply sample:', reply);

  if (process.env.WHATSAPP_AI_VERIFY_AUDIO_DATA_URL) {
    const tx = await transcribeAudioFromDataUrl(
      process.env.WHATSAPP_AI_VERIFY_AUDIO_DATA_URL,
      process.env.WHATSAPP_AI_VERIFY_AUDIO_MIME_TYPE || 'audio/ogg'
    );
    console.log('\nAudio transcription sample:', tx);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
