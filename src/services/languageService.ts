import { openai } from '../config/openai';
import { SUPPORTED_LANGUAGES, TOP_LEVEL_MENU } from '../utils/constants';
import type { SupportedLanguage } from '../types/domain';

type PhraseKey =
  | 'choose_language'
  | 'language_set'
  | 'main_menu'
  | 'unknown'
  | 'ask_search_purpose'
  | 'ask_search_category'
  | 'ask_area_or_location'
  | 'ask_budget'
  | 'search_no_results'
  | 'search_more_actions'
  | 'ask_listing_category'
  | 'ask_title'
  | 'ask_district'
  | 'ask_city'
  | 'ask_area'
  | 'ask_address_optional'
  | 'ask_price'
  | 'ask_description'
  | 'ask_location_pin'
  | 'ask_photos'
  | 'listing_need_more_photos'
  | 'listing_preview_ready'
  | 'listing_verification_intro'
  | 'ask_full_name'
  | 'ask_phone'
  | 'otp_sent'
  | 'otp_invalid'
  | 'ask_email'
  | 'ask_nin'
  | 'ask_nid_upload'
  | 'ask_consent'
  | 'listing_submitted'
  | 'ask_agent_search'
  | 'ask_agent_registration_track'
  | 'agent_registered_limit'
  | 'agent_not_registered_limit'
  | 'mortgage_intro'
  | 'account_help_intro'
  | 'support_intro'
  | 'report_intro'
  | 'voice_low_confidence'
  | 'cmd_hint';

const ENGLISH: Record<PhraseKey, string> = {
  choose_language:
    'Welcome to MakaUg WhatsApp Assistant. Choose your language:\n1. English\n2. Luganda\n3. Kiswahili\n4. Acholi\n5. Runyankole\n6. Rukiga\n7. Lusoga',
  language_set: 'Language saved. You can type "change language" any time.',
  main_menu: `What would you like to do?\n${TOP_LEVEL_MENU.join('\n')}`,
  unknown: 'I did not fully understand that. I can still help. Please choose from the menu below.',
  ask_search_purpose: 'Are you looking to buy, rent, or browse? (buy/rent/browse)',
  ask_search_category: 'Choose category: For Sale, To Rent, Students, Commercial, Land.',
  ask_area_or_location: 'Share area name or send your current WhatsApp location pin.',
  ask_budget: 'What is your budget in UGX?',
  search_no_results: 'No exact matches yet. I can widen area, adjust budget, connect agent, or capture your property request.',
  search_more_actions: 'Reply with: more options | refine area | change budget | change property type | connect to agent | view more',
  ask_listing_category: 'Which category are you listing? (For Sale, To Rent, Students, Commercial, Land)',
  ask_title: 'Send a short property title.',
  ask_district: 'Which district is the property in?',
  ask_city: 'Which city/town is it in?',
  ask_area: 'Which area/neighbourhood?',
  ask_address_optional: 'Share full street address (optional).',
  ask_price: 'What is the asking price in UGX?',
  ask_description: 'Write a clear description (features, condition, nearby landmarks).',
  ask_location_pin: 'Send property location pin or type location. I will confirm area and district.',
  ask_photos:
    'Upload at least 3 photos (recommended order: front/exterior, living room, bedroom). You can send up to 20 photos.',
  listing_need_more_photos: 'You need at least 3 photos before continuing.',
  listing_preview_ready: 'Preview ready. Reply: submit | edit title | edit price | edit description | edit location',
  listing_verification_intro: 'Before final submission, we need identity verification.',
  ask_full_name: 'What is your full legal name?',
  ask_phone: 'Enter your Uganda phone number (+2567XXXXXXXX).',
  otp_sent: 'OTP sent. Reply with the 6-digit code.',
  otp_invalid: 'OTP invalid. Reply with the correct code or type RESEND.',
  ask_email: 'Enter your email address.',
  ask_nin: 'Enter your NIN (National ID Number).',
  ask_nid_upload: 'Upload a clear photo of your National ID. PDFs are not accepted. Take a picture and upload the photo.',
  ask_consent: 'Do you consent to anti-fraud review checks and manual listing review? Reply YES to continue.',
  listing_submitted:
    'Your listing has been submitted for review. We will contact you on WhatsApp or email within 24 hours. Ref: {ref}.',
  ask_agent_search: 'Tell me area/district and purpose (buying, renting, selling, listing).',
  ask_agent_registration_track: 'Are you Registered or Not registered yet?',
  agent_registered_limit: 'Registered agents can list up to 20 properties and appear as Registered.',
  agent_not_registered_limit: 'Not registered agents can list up to 5 properties and appear as Not Registered.',
  mortgage_intro: 'I can estimate monthly repayment and affordability. Send property price in UGX.',
  account_help_intro: 'I can help with sign in, sign up, saved properties, alerts, and password reset.',
  support_intro: 'You can always contact support at +256 770 646 879 or info@makaug.com',
  report_intro: 'Share listing link/ID and what looks suspicious. You can also upload screenshots/documents.',
  voice_low_confidence:
    'I may have heard this incorrectly: "{transcript}". Reply YES to continue or send text/voice again.',
  cmd_hint: 'Global commands: back, edit, main menu, start again, change language, help.'
};

function pack(overrides: Partial<Record<PhraseKey, string>>): Record<PhraseKey, string> {
  return { ...ENGLISH, ...overrides };
}

const TRANSLATIONS: Record<SupportedLanguage, Record<PhraseKey, string>> = {
  en: pack({}),
  lg: pack({
    language_set: 'Olulimi luterekeddwa. Oyinza okuwandiika "change language" buli kaseera.',
    main_menu: `Oyagala kukola ki?\n${TOP_LEVEL_MENU.join('\n')}`,
    unknown: 'Sikitegedde bulungi. Naye nnyinza okukuyamba. Londa okuva ku menu.',
    ask_search_purpose: 'Onoonya kugula, kukodisa, oba kulambula? (buy/rent/browse)',
    support_intro: 'Oyinziza okuyita support ku +256 770 646 879 oba info@makaug.com'
  }),
  sw: pack({
    language_set: 'Lugha imehifadhiwa. Unaweza kuandika "change language" wakati wowote.',
    main_menu: `Ungependa kufanya nini?\n${TOP_LEVEL_MENU.join('\n')}`,
    unknown: 'Sijaelewa kikamilifu. Bado naweza kusaidia. Chagua kutoka menyu.',
    ask_search_purpose: 'Unatafuta kununua, kupanga, au kuvinjari? (buy/rent/browse)',
    support_intro: 'Unaweza kuwasiliana na support: +256 770 646 879 au info@makaug.com'
  }),
  ac: pack({
    language_set: 'Dhok itye keken. I twero cako lok ki "change language".',
    main_menu: `I mito timo ngo?\n${TOP_LEVEL_MENU.join('\n')}`,
    unknown: 'Pe atamo maber. Tim ber iyer ki menu.',
    support_intro: 'Support: +256 770 646 879 onyo info@makaug.com'
  }),
  ny: pack({
    language_set: 'Orurimi ruterekirwe. Osobora kuhindura obwire bwona.',
    main_menu: `Noyenda kukora ki?\n${TOP_LEVEL_MENU.join('\n')}`,
    unknown: 'Tinkyetegire gye. Ninyija kukuhwera, hitamo omu menu.',
    support_intro: 'Support: +256 770 646 879 or info@makaug.com'
  }),
  rn: pack({
    language_set: 'Rukiga translation is not fully available yet, so MakaUg will use English fallback rather than guessing another language.',
    main_menu: ENGLISH.main_menu,
    unknown: ENGLISH.unknown,
    support_intro: ENGLISH.support_intro
  }),
  sm: pack({
    language_set: 'Olulimi luterekeddwa. Osobola okukuhindura buli kaseera.',
    main_menu: `Oyagala okukola ki?\n${TOP_LEVEL_MENU.join('\n')}`,
    unknown: 'Sikitegedde bulungi. Londa okuva ku menu.',
    support_intro: 'Support: +256 770 646 879 oba info@makaug.com'
  })
};

const languageMap: Record<string, SupportedLanguage> = {
  '1': 'en',
  english: 'en',
  en: 'en',
  '2': 'lg',
  luganda: 'lg',
  lg: 'lg',
  '3': 'sw',
  kiswahili: 'sw',
  sw: 'sw',
  '4': 'ac',
  ach: 'ac',
  acholi: 'ac',
  ac: 'ac',
  '5': 'ny',
  rnynk: 'ny',
  runyankore: 'ny',
  runyankole: 'ny',
  ny: 'ny',
  '6': 'rn',
  rkg: 'rn',
  rukiga: 'rn',
  rn: 'rn',
  '7': 'sm',
  lus: 'sm',
  xog: 'sm',
  lusoga: 'sm',
  sm: 'sm'
};

export class LanguageService {
  private readonly dynamicCache = new Map<string, string>();

  parseLanguageChoice(input: string): SupportedLanguage | null {
    const key = input.trim().toLowerCase();
    return languageMap[key] ?? null;
  }

  isSupported(code: string): code is SupportedLanguage {
    return SUPPORTED_LANGUAGES.some((lang) => lang.code === code);
  }

  async t(language: SupportedLanguage, key: PhraseKey, vars?: Record<string, string | number>): Promise<string> {
    const translated = TRANSLATIONS[language][key];
    return this.interpolate(translated, vars);
  }

  async translateAny(language: SupportedLanguage, text: string): Promise<string> {
    if (language === 'en') return text;

    const cacheKey = `${language}:${text}`;
    const fromCache = this.dynamicCache.get(cacheKey);
    if (fromCache) return fromCache;

    if (!openai) return text;

    try {
      const response = await openai.responses.create({
        model: 'gpt-4o-mini',
        input: [
          {
            role: 'system',
            content:
              'Translate the user text to the requested Ugandan language only. Keep formatting, links, and list numbering. Return translation only. Rukiga and Runyankole are not Kinyarwanda; do not substitute Kinyarwanda. If you cannot confidently translate to the requested language, return the original English text.'
          },
          {
            role: 'user',
            content: `Language: ${language}. Text: ${text}`
          }
        ]
      });

      const translated = response.output_text?.trim() || text;
      this.dynamicCache.set(cacheKey, translated);
      return translated;
    } catch {
      return text;
    }
  }

  private interpolate(template: string, vars?: Record<string, string | number>): string {
    if (!vars) return template;
    let text = template;
    for (const [key, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${key}}`, String(value));
    }
    return text;
  }
}

export type { PhraseKey };
