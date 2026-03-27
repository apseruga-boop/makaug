export type SupportedLanguage = 'en' | 'lg' | 'sw' | 'ac' | 'ny' | 'rn' | 'sm';

export type TopLevelIntent =
  | 'property_search'
  | 'property_listing'
  | 'agent_search'
  | 'agent_registration'
  | 'mortgage_help'
  | 'account_help'
  | 'saved_properties'
  | 'support'
  | 'report_listing'
  | 'looking_for_property_lead'
  | 'unknown';

export type PropertyCategory = 'sale' | 'rent' | 'students' | 'commercial' | 'land';

export type SearchPurpose = 'buy' | 'rent' | 'browse';

export type SessionStep =
  | 'language_select'
  | 'main_menu'
  | 'search_purpose'
  | 'search_category'
  | 'search_area'
  | 'search_budget'
  | 'search_filters'
  | 'listing_category'
  | 'listing_collect'
  | 'listing_location'
  | 'listing_photos'
  | 'listing_preview'
  | 'listing_verification'
  | 'agent_search_collect'
  | 'agent_registration_collect'
  | 'mortgage_collect'
  | 'account_help'
  | 'report_collect'
  | 'lead_collect'
  | 'support'
  | 'idle';

export interface GeoPoint {
  lat: number;
  lng: number;
  addressLine?: string;
  district?: string;
  area?: string;
}

export interface MessageInput {
  userId: string;
  waMessageId: string;
  fromName?: string;
  timestamp: number;
  type: 'text' | 'interactive' | 'location' | 'image' | 'document' | 'audio' | 'unknown';
  text?: string;
  interactiveId?: string;
  interactiveTitle?: string;
  location?: GeoPoint;
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  raw: unknown;
}

export interface OutboundMessage {
  text: string;
  quickReplies?: Array<{ id: string; title: string }>;
  meta?: Record<string, unknown>;
}

export interface SessionState {
  userId: string;
  language: SupportedLanguage;
  currentIntent: TopLevelIntent | null;
  currentStep: SessionStep;
  data: Record<string, unknown>;
  otpVerified: boolean;
  paused: boolean;
}

export interface SearchResult {
  id: string;
  title: string;
  summary: string;
  location: string;
  district: string;
  priceLabel: string;
  keyFacts: string[];
  imageUrl?: string;
  listingUrl: string;
  category: PropertyCategory;
  distanceKm?: number;
}

export interface BrokerResult {
  id: string;
  name: string;
  company?: string;
  phone?: string;
  whatsapp?: string;
  areaCovered?: string;
  specialties?: string[];
  languages?: string[];
  registrationStatus: 'registered' | 'not_registered';
  profileUrl?: string;
}

export interface MortgageEstimate {
  monthlyRepayment: number;
  depositAmount: number;
  loanAmount: number;
  affordabilityNote: string;
  disclaimer: string;
}
