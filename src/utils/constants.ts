import type { SupportedLanguage } from '../types/domain';

export const SUPPORTED_LANGUAGES: Array<{ code: SupportedLanguage; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'lg', label: 'Luganda' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'ac', label: 'Acholi' },
  { code: 'ny', label: 'Runyankole' },
  { code: 'rn', label: 'Rukiga' },
  { code: 'sm', label: 'Lusoga' }
];

export const TOP_LEVEL_MENU = [
  '1. Find a property',
  '2. List a property',
  '3. Find an agent',
  '4. Register as an agent',
  '5. Mortgage Finder',
  '6. My account / saved properties',
  '7. Help / support'
];

export const GLOBAL_COMMANDS = ['back', 'edit', 'main menu', 'start again', 'change language', 'help'];

export const SUPPORT_CONTACT = {
  phone: '+256 770 646 879',
  email: 'info@makaug.com'
};

export const DEFAULT_BASE_URL = 'https://makaug.com';

export const UGANDA_REGIONS = ['Central', 'Eastern', 'Northern', 'Western'];

export const DEFAULT_TEST_OTP = '123456';

export const MAX_LISTING_PHOTOS = 20;
export const MIN_LISTING_PHOTOS = 3;
