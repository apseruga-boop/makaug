import type { MessageInput, OutboundMessage, PropertyCategory, SessionState, TopLevelIntent } from '../types/domain';
import { LanguageService } from './languageService';
import { IntentClassifierService } from './intentClassifier';
import { PropertySearchService } from './propertySearchService';
import { ListingDraftService } from './listingDraftService';
import { AgentService } from './agentService';
import { MortgageService } from './mortgageService';
import { AccountHelpService } from './accountHelpService';
import { SupportEscalationService } from './supportEscalationService';
import { ValidationService } from './validationService';
import { LocationService } from './locationService';
import { OtpService } from './otpService';
import { VoiceTranscriptionService } from './voiceTranscriptionService';
import { MediaUploadService } from './mediaUploadService';
import { repositories } from '../repositories';
import { UrlBuilderService } from './urlBuilderService';
import { ListingReportService } from './listingReportService';
import { PropertyLeadService } from './propertyLeadService';
import { AuditLogger } from './auditLogger';
import { MIN_LISTING_PHOTOS } from '../utils/constants';

const SEARCH_CATEGORIES: PropertyCategory[] = ['sale', 'rent', 'students', 'commercial', 'land'];

function mapCategory(input: string): PropertyCategory | null {
  const normalized = input.trim().toLowerCase();
  const map: Record<string, PropertyCategory> = {
    '1': 'sale',
    sale: 'sale',
    buy: 'sale',
    'for sale': 'sale',
    '2': 'rent',
    rent: 'rent',
    'to rent': 'rent',
    '3': 'students',
    students: 'students',
    student: 'students',
    'student accommodation': 'students',
    '4': 'commercial',
    commercial: 'commercial',
    '5': 'land',
    land: 'land'
  };
  return map[normalized] ?? null;
}

function parsePurpose(input: string): 'buy' | 'rent' | 'browse' | null {
  const normalized = input.trim().toLowerCase();
  if (['buy', 'sale', '1'].includes(normalized)) return 'buy';
  if (['rent', '2'].includes(normalized)) return 'rent';
  if (['browse', '3', 'any'].includes(normalized)) return 'browse';
  return null;
}

function parseMenuSelection(input: string): TopLevelIntent | null {
  const normalized = input.trim().toLowerCase();
  const map: Record<string, TopLevelIntent> = {
    '1': 'property_search',
    '2': 'property_listing',
    '3': 'agent_search',
    '4': 'agent_registration',
    '5': 'mortgage_help',
    '6': 'account_help',
    '7': 'support'
  };
  return map[normalized] ?? null;
}

function appendSupportHint(message: string): string {
  return `${message}\n\nType "main menu" to return.`;
}

export class ConversationStateMachine {
  private readonly language: LanguageService;
  private readonly classifier: IntentClassifierService;
  private readonly propertySearch: PropertySearchService;
  private readonly listingDraft: ListingDraftService;
  private readonly agent: AgentService;
  private readonly mortgage: MortgageService;
  private readonly account: AccountHelpService;
  private readonly support: SupportEscalationService;
  private readonly validation: ValidationService;
  private readonly location: LocationService;
  private readonly otp: OtpService;
  private readonly voice: VoiceTranscriptionService;
  private readonly media: MediaUploadService;
  private readonly urls: UrlBuilderService;
  private readonly reports: ListingReportService;
  private readonly leads: PropertyLeadService;
  private readonly audit: AuditLogger;

  constructor(deps?: {
    language?: LanguageService;
    classifier?: IntentClassifierService;
    propertySearch?: PropertySearchService;
    listingDraft?: ListingDraftService;
    agent?: AgentService;
    mortgage?: MortgageService;
    account?: AccountHelpService;
    support?: SupportEscalationService;
    validation?: ValidationService;
    location?: LocationService;
    otp?: OtpService;
    voice?: VoiceTranscriptionService;
    media?: MediaUploadService;
    urls?: UrlBuilderService;
    reports?: ListingReportService;
    leads?: PropertyLeadService;
    audit?: AuditLogger;
  }) {
    this.language = deps?.language ?? new LanguageService();
    this.classifier = deps?.classifier ?? new IntentClassifierService();
    this.propertySearch = deps?.propertySearch ?? new PropertySearchService();
    this.listingDraft = deps?.listingDraft ?? new ListingDraftService();
    this.agent = deps?.agent ?? new AgentService();
    this.mortgage = deps?.mortgage ?? new MortgageService();
    this.account = deps?.account ?? new AccountHelpService();
    this.support = deps?.support ?? new SupportEscalationService();
    this.validation = deps?.validation ?? new ValidationService();
    this.location = deps?.location ?? new LocationService();
    this.otp = deps?.otp ?? new OtpService();
    this.voice = deps?.voice ?? new VoiceTranscriptionService();
    this.media = deps?.media ?? new MediaUploadService();
    this.urls = deps?.urls ?? new UrlBuilderService();
    this.reports = deps?.reports ?? new ListingReportService();
    this.leads = deps?.leads ?? new PropertyLeadService();
    this.audit = deps?.audit ?? new AuditLogger();
  }

  async handle(session: SessionState, input: MessageInput): Promise<{ state: SessionState; replies: OutboundMessage[] }> {
    let workingInput = input;

    if (input.type === 'audio' && input.mediaId) {
      const transcription = await this.voice.transcribeFromMediaId(input.mediaId);
      if (transcription) {
        try {
          await repositories.transcriptions.create({
            userPhone: session.userId,
            waMessageId: input.waMessageId,
            transcript: transcription.transcript,
            confidence: transcription.confidence,
            language: transcription.language,
            mediaUrl: transcription.mediaUrl
          });
        } catch {
          // non-blocking audit write
        }

        if (transcription.confidence < 0.65) {
          const lowConfidence = await this.language.t(session.language, 'voice_low_confidence', {
            transcript: transcription.transcript || '...'
          });
          return { state: session, replies: [{ text: lowConfidence }] };
        }

        workingInput = {
          ...input,
          type: 'text',
          text: transcription.transcript
        };
      }
    }

    const global = await this.handleGlobalCommands(session, workingInput);
    if (global) return global;

    if (session.currentStep === 'language_select') {
      return this.handleLanguageSelection(session, workingInput);
    }

    if (session.currentStep === 'main_menu' || session.currentIntent === null) {
      return this.handleMainMenu(session, workingInput);
    }

    switch (session.currentIntent) {
      case 'property_search':
        return this.handlePropertySearch(session, workingInput);
      case 'property_listing':
        return this.handlePropertyListing(session, workingInput);
      case 'agent_search':
        return this.handleAgentSearch(session, workingInput);
      case 'agent_registration':
        return this.handleAgentRegistration(session, workingInput);
      case 'mortgage_help':
        return this.handleMortgage(session, workingInput);
      case 'account_help':
      case 'saved_properties':
        return this.handleAccount(session);
      case 'report_listing':
        return this.handleListingReport(session, workingInput);
      case 'looking_for_property_lead':
        return this.handleLeadCapture(session, workingInput);
      case 'support':
      case 'unknown':
      default:
        return this.handleSupport(session);
    }
  }

  async firstMessage(): Promise<OutboundMessage> {
    return { text: await this.language.t('en', 'choose_language') };
  }

  private getText(input: MessageInput): string {
    return this.validation.sanitize(input.text || input.interactiveTitle || '').trim();
  }

  private async handleGlobalCommands(
    session: SessionState,
    input: MessageInput
  ): Promise<{ state: SessionState; replies: OutboundMessage[] } | null> {
    const text = this.getText(input).toLowerCase();
    if (!text) return null;

    if (text === 'main menu' || text === 'menu') {
      session.currentIntent = null;
      session.currentStep = 'main_menu';
      const menuText = await this.language.t(session.language, 'main_menu');
      return { state: session, replies: [{ text: menuText }] };
    }

    if (text === 'start again') {
      session.currentIntent = null;
      session.currentStep = 'language_select';
      session.data = {};
      session.otpVerified = false;
      const choose = await this.language.t(session.language, 'choose_language');
      return { state: session, replies: [{ text: choose }] };
    }

    if (text === 'change language') {
      session.currentStep = 'language_select';
      const choose = await this.language.t(session.language, 'choose_language');
      return { state: session, replies: [{ text: choose }] };
    }

    if (text === 'help') {
      return this.handleSupport(session);
    }

    if (text === 'back') {
      if (session.currentIntent === 'property_listing') {
        session.currentStep = 'listing_collect';
        const msg = await this.language.t(session.language, 'ask_title');
        return { state: session, replies: [{ text: msg }] };
      }
      session.currentStep = 'main_menu';
      const menuText = await this.language.t(session.language, 'main_menu');
      return { state: session, replies: [{ text: menuText }] };
    }

    return null;
  }

  private async handleLanguageSelection(session: SessionState, input: MessageInput) {
    const text = this.getText(input);
    const selected = this.language.parseLanguageChoice(text);

    if (!selected) {
      return { state: session, replies: [{ text: await this.language.t('en', 'choose_language') }] };
    }

    session.language = selected;
    session.currentStep = 'main_menu';

    await this.audit.log(session.userId, 'language.selected', { language: selected });

    return {
      state: session,
      replies: [
        { text: await this.language.t(selected, 'language_set') },
        { text: await this.language.t(selected, 'main_menu') }
      ]
    };
  }

  private async handleMainMenu(session: SessionState, input: MessageInput) {
    const text = this.getText(input);
    let intent = parseMenuSelection(text);

    if (!intent && text) {
      intent = await this.classifier.classify(text);
    }

    if (!intent || intent === 'unknown') {
      return {
        state: session,
        replies: [
          { text: await this.language.t(session.language, 'unknown') },
          { text: await this.language.t(session.language, 'main_menu') }
        ]
      };
    }

    session.currentIntent = intent;

    switch (intent) {
      case 'property_search':
        session.currentStep = 'search_purpose';
        session.data = {};
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_search_purpose') }] };
      case 'property_listing':
        session.currentStep = 'listing_category';
        session.data = {};
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_listing_category') }] };
      case 'agent_search':
        session.currentStep = 'agent_search_collect';
        session.data = { agentStage: 'area' };
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_agent_search') }] };
      case 'agent_registration':
        session.currentStep = 'agent_registration_collect';
        session.data = { agentRegStage: 'track' };
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_agent_registration_track') }] };
      case 'mortgage_help':
        session.currentStep = 'mortgage_collect';
        session.data = { mortgageStage: 'price' };
        return { state: session, replies: [{ text: await this.language.t(session.language, 'mortgage_intro') }] };
      case 'account_help':
      case 'saved_properties':
        return this.handleAccount(session);
      case 'report_listing':
        session.currentStep = 'report_collect';
        session.data = { reportStage: 'listingRef' };
        return { state: session, replies: [{ text: await this.language.t(session.language, 'report_intro') }] };
      case 'support':
      default:
        return this.handleSupport(session);
    }
  }

  private async handlePropertySearch(session: SessionState, input: MessageInput) {
    const text = this.getText(input);
    const data = session.data;

    if (session.currentStep === 'search_purpose') {
      const purpose = parsePurpose(text);
      if (!purpose) {
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_search_purpose') }] };
      }
      data.purpose = purpose;
      session.currentStep = 'search_category';
      return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_search_category') }] };
    }

    if (session.currentStep === 'search_category') {
      const category = mapCategory(text);
      if (!category) {
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_search_category') }] };
      }
      data.category = category;
      session.currentStep = 'search_area';
      return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_area_or_location') }] };
    }

    if (session.currentStep === 'search_area') {
      if (input.type === 'location' && input.location) {
        data.lat = input.location.lat;
        data.lng = input.location.lng;
        data.area = input.location.area || input.location.addressLine || 'Current location';
      } else if (!text) {
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_area_or_location') }] };
      } else {
        data.area = text;
      }

      session.currentStep = 'search_budget';
      return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_budget') }] };
    }

    if (session.currentStep === 'search_budget') {
      const budget = this.validation.parseCurrency(text);
      if (!budget) {
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_budget') }] };
      }

      data.budget = budget;
      session.currentStep = 'search_filters';
      return {
        state: session,
        replies: [{ text: 'Optional filters: send like "beds 2, type apartment" or type SKIP.' }]
      };
    }

    if (session.currentStep === 'search_filters') {
      if (text.toLowerCase() !== 'skip') {
        const bedMatch = text.match(/beds?\s*(\d+)/i);
        const typeMatch = text.match(/type\s*([a-zA-Z\s]+)/i);
        if (bedMatch) data.bedsMin = Number(bedMatch[1]);
        if (typeMatch) data.propertyType = typeMatch[1].trim();
      }

      const { results } = await this.propertySearch.search({
        userPhone: session.userId,
        purpose: data.purpose as 'buy' | 'rent' | 'browse',
        category: (data.category as PropertyCategory) ?? 'sale',
        area: data.area as string,
        budget: data.budget as number,
        bedsMin: (data.bedsMin as number | undefined) ?? undefined,
        propertyType: (data.propertyType as string | undefined) ?? undefined,
        lat: (data.lat as number | undefined) ?? undefined,
        lng: (data.lng as number | undefined) ?? undefined
      });

      data.lastResults = results;

      if (!results.length) {
        session.currentIntent = 'looking_for_property_lead';
        session.currentStep = 'lead_collect';
        session.data = {
          ...data,
          leadStage: 'name'
        };

        return {
          state: session,
          replies: [
            { text: await this.language.t(session.language, 'search_no_results') },
            { text: 'Would you like us to find one for you? Reply YES to continue.' }
          ]
        };
      }

      const formatted = this.propertySearch.formatResults(results);
      const browse = this.propertySearch.browseLink((data.category as PropertyCategory) || 'sale', (data.area as string) || 'Kampala');

      session.currentStep = 'main_menu';
      session.currentIntent = null;

      return {
        state: session,
        replies: [
          { text: formatted },
          { text: `View more in this area: ${browse}` },
          { text: await this.language.t(session.language, 'search_more_actions') }
        ]
      };
    }

    session.currentStep = 'search_purpose';
    return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_search_purpose') }] };
  }

  private async handleLeadCapture(session: SessionState, input: MessageInput) {
    const text = this.getText(input);
    const data = session.data;
    const stage = String(data.leadStage || 'confirm');

    if (stage === 'confirm') {
      if (!['yes', 'y', '1', 'ok', 'okay'].includes(text.toLowerCase())) {
        session.currentIntent = null;
        session.currentStep = 'main_menu';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'main_menu') }] };
      }
      data.leadStage = 'name';
      return { state: session, replies: [{ text: 'Please share your full name.' }] };
    }

    if (stage === 'name') {
      data.leadName = text;
      data.leadStage = 'phone';
      return { state: session, replies: [{ text: 'Share your phone number.' }] };
    }

    if (stage === 'phone') {
      if (!this.validation.isValidUgandaPhone(text)) {
        return { state: session, replies: [{ text: 'Please enter a valid Uganda phone number.' }] };
      }
      data.leadPhone = this.validation.normalizeUgandaPhone(text);
      data.leadStage = 'email';
      return { state: session, replies: [{ text: 'Email (optional). Reply SKIP to skip.' }] };
    }

    if (stage === 'email') {
      if (text.toLowerCase() !== 'skip' && !this.validation.isValidEmail(text)) {
        return { state: session, replies: [{ text: 'Please enter a valid email or SKIP.' }] };
      }
      data.leadEmail = text.toLowerCase() === 'skip' ? null : text;
      data.leadStage = 'notes';
      return { state: session, replies: [{ text: 'Any extra notes? (preferred area, budget flexibility, etc.)' }] };
    }

    if (stage === 'notes') {
      data.leadNotes = text;

      const id = await this.leads.create({
        name: data.leadName,
        phone: data.leadPhone,
        email: data.leadEmail,
        preferredArea: data.area,
        purpose: data.purpose,
        category: data.category,
        budget: data.budget,
        notes: data.leadNotes
      });

      session.currentIntent = null;
      session.currentStep = 'main_menu';

      return {
        state: session,
        replies: [
          { text: `Thanks. Your request has been captured. Lead ref: ${id}` },
          { text: await this.language.t(session.language, 'main_menu') }
        ]
      };
    }

    data.leadStage = 'confirm';
    return { state: session, replies: [{ text: 'Would you like us to find one for you? Reply YES to continue.' }] };
  }

  private async handlePropertyListing(session: SessionState, input: MessageInput) {
    const text = this.getText(input);
    const data = session.data as Record<string, unknown>;
    const listing = (data.listing as Record<string, unknown>) ?? {};
    data.listing = listing;

    if (session.currentStep === 'listing_category') {
      const category = mapCategory(text);
      if (!category) {
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_listing_category') }] };
      }
      listing.category = category;
      data.listingStage = 'title';
      session.currentStep = 'listing_collect';
      return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_title') }] };
    }

    if (session.currentStep === 'listing_collect') {
      const stage = String(data.listingStage || 'title');

      if (stage === 'title') {
        listing.title = text;
        data.listingStage = 'district';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_district') }] };
      }

      if (stage === 'district') {
        listing.district = text;
        data.listingStage = 'city';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_city') }] };
      }

      if (stage === 'city') {
        listing.city = text;
        data.listingStage = 'area';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_area') }] };
      }

      if (stage === 'area') {
        listing.area = text;
        data.listingStage = 'address';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_address_optional') }] };
      }

      if (stage === 'address') {
        listing.address = text;
        data.listingStage = 'price';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_price') }] };
      }

      if (stage === 'price') {
        const price = this.validation.parseCurrency(text);
        if (!price) return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_price') }] };
        listing.price = price;
        data.listingStage = 'description';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_description') }] };
      }

      if (stage === 'description') {
        listing.description = text;
        data.listingStage = 'category_fields';
        const category = String(listing.category || 'sale');
        return {
          state: session,
          replies: [
            {
              text:
                category === 'sale'
                  ? 'For Sale fields: subtype, bedrooms, bathrooms, size, title_type, year_built(optional). Send as: subtype=house; bedrooms=3; bathrooms=2; size=220sqm; title_type=freehold'
                  : category === 'rent'
                    ? 'To Rent fields: subtype, bedrooms, bathrooms, size, deposit, contract_months, furnishing, price_period. Send as key=value pairs.'
                    : category === 'students'
                      ? 'Students fields: room_type, university_nearby, price_period(monthly/semester), amenities, house_rules(optional).'
                      : category === 'commercial'
                        ? 'Commercial fields: subtype, floor_area, parking(optional), intent(sale/rent), deposit(if rent), contract_length(if rent).'
                        : 'Land fields: land_type, size_value, size_unit, title_type.'
            }
          ]
        };
      }

      if (stage === 'category_fields') {
        const parsedFields: Record<string, string> = {};
        text.split(';').forEach((part) => {
          const [k, v] = part.split('=').map((s) => s?.trim());
          if (k && v) parsedFields[k] = v;
        });
        listing.fields = parsedFields;
        data.listingStage = 'location';
        session.currentStep = 'listing_location';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_location_pin') }] };
      }
    }

    if (session.currentStep === 'listing_location') {
      if (input.type === 'location' && input.location) {
        listing.lat = input.location.lat;
        listing.lng = input.location.lng;
        const resolved = await this.location.fromSharedLocation(input.location.lat, input.location.lng);
        listing.locationAddress = resolved.addressLine;
        if (!listing.district && resolved.district) listing.district = resolved.district;
        if (!listing.area && resolved.area) listing.area = resolved.area;
      } else {
        listing.locationAddress = text;
        const inferred = this.location.inferCoordinates(
          String(listing.region || ''),
          String(listing.district || ''),
          String(listing.city || ''),
          String(listing.area || '')
        );
        if (inferred) {
          listing.lat = inferred.lat;
          listing.lng = inferred.lng;
        }
      }

      data.listingStage = 'photos';
      session.currentStep = 'listing_photos';

      const draftId = await this.listingDraft.saveDraft(session.userId, listing as never);
      data.draftId = draftId;

      return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_photos') }] };
    }

    if (session.currentStep === 'listing_photos') {
      const draftId = String(data.draftId || '');
      if (!draftId) {
        session.currentStep = 'listing_collect';
        data.listingStage = 'title';
        return { state: session, replies: [{ text: 'Session expired, let us start listing again. Send title.' }] };
      }

      if (input.type === 'image' && input.mediaId) {
        const slotOrder = this.listingDraft.requiredPhotoGuide((listing.category as PropertyCategory) || 'sale');
        const existing = await this.listingDraft.getPhotos(draftId);
        const nextSlot = slotOrder[Math.min(existing.length, slotOrder.length - 1)] || `Extra ${existing.length + 1}`;
        let storedRef = `whatsapp-media:${input.mediaId}`;
        try {
          const path = `listings/${session.userId.replace(/\D/g, '')}/${draftId}/photo-${existing.length + 1}.jpg`;
          const stored = await this.media.persistWhatsAppMedia(input.mediaId, path, false);
          storedRef = stored.publicUrl || stored.internalRef;
        } catch {
          // fallback to whatsapp media ref
        }
        await this.listingDraft.addPhoto(draftId, storedRef, nextSlot);

        const updated = await this.listingDraft.getPhotos(draftId);
        const needs = Math.max(0, MIN_LISTING_PHOTOS - updated.length);

        return {
          state: session,
          replies: [
            {
              text:
                needs > 0
                  ? `Photo saved (${updated.length}). Please send ${needs} more photo(s). Next suggested slot: ${nextSlot}`
                  : `Photo saved (${updated.length}). You can send more or type DONE to continue.`
            }
          ]
        };
      }

      if (text.toLowerCase() === 'done') {
        const photos = await this.listingDraft.getPhotos(draftId);
        if (photos.length < MIN_LISTING_PHOTOS) {
          return { state: session, replies: [{ text: await this.language.t(session.language, 'listing_need_more_photos') }] };
        }

        session.currentStep = 'listing_preview';
        const preview = this.listingDraft.buildPreview(listing as never, photos.length);
        return {
          state: session,
          replies: [{ text: preview }, { text: await this.language.t(session.language, 'listing_preview_ready') }]
        };
      }

      return {
        state: session,
        replies: [{ text: 'Send photo(s) now, or type DONE when finished.' }]
      };
    }

    if (session.currentStep === 'listing_preview') {
      const lowered = text.toLowerCase();
      if (lowered.startsWith('edit')) {
        if (lowered.includes('title')) {
          data.listingStage = 'title';
          session.currentStep = 'listing_collect';
          return { state: session, replies: [{ text: 'Send updated title.' }] };
        }
        if (lowered.includes('price')) {
          data.listingStage = 'price';
          session.currentStep = 'listing_collect';
          return { state: session, replies: [{ text: 'Send updated price.' }] };
        }
        if (lowered.includes('description')) {
          data.listingStage = 'description';
          session.currentStep = 'listing_collect';
          return { state: session, replies: [{ text: 'Send updated description.' }] };
        }
        if (lowered.includes('location')) {
          session.currentStep = 'listing_location';
          return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_location_pin') }] };
        }
      }

      if (lowered === 'submit') {
        session.currentStep = 'listing_verification';
        data.verificationStage = 'fullName';
        listing.verification = listing.verification || {};

        return {
          state: session,
          replies: [
            { text: await this.language.t(session.language, 'listing_verification_intro') },
            { text: await this.language.t(session.language, 'ask_full_name') }
          ]
        };
      }

      return { state: session, replies: [{ text: await this.language.t(session.language, 'listing_preview_ready') }] };
    }

    if (session.currentStep === 'listing_verification') {
      const stage = String(data.verificationStage || 'fullName');
      const verification = (listing.verification as Record<string, unknown>) || {};
      listing.verification = verification;

      if (stage === 'fullName') {
        verification.fullName = text;
        data.verificationStage = 'phone';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_phone') }] };
      }

      if (stage === 'phone') {
        if (!this.validation.isValidUgandaPhone(text)) {
          return { state: session, replies: [{ text: 'Invalid phone format. Use +2567XXXXXXXX.' }] };
        }
        const normalized = this.validation.normalizeUgandaPhone(text);
        verification.phone = normalized;
        await this.otp.sendOtp(normalized);
        data.verificationStage = 'otp';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'otp_sent') }] };
      }

      if (stage === 'otp') {
        if (text.toLowerCase() === 'resend') {
          await this.otp.resendOtp(String(verification.phone));
          return { state: session, replies: [{ text: await this.language.t(session.language, 'otp_sent') }] };
        }

        const valid = await this.otp.verifyOtp(String(verification.phone), text);
        if (!valid) {
          return { state: session, replies: [{ text: await this.language.t(session.language, 'otp_invalid') }] };
        }

        verification.otpVerified = true;
        session.otpVerified = true;
        data.verificationStage = 'email';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_email') }] };
      }

      if (stage === 'email') {
        if (!this.validation.isValidEmail(text)) {
          return { state: session, replies: [{ text: 'Please provide a valid email address.' }] };
        }
        verification.email = text;
        data.verificationStage = 'nin';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_nin') }] };
      }

      if (stage === 'nin') {
        if (!this.validation.isValidNin(text)) {
          return { state: session, replies: [{ text: 'Invalid NIN format. Try again.' }] };
        }
        verification.nin = text.toUpperCase();
        data.verificationStage = 'idUpload';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_nid_upload') }] };
      }

      if (stage === 'idUpload') {
        const mimeType = String(input.mimeType || '').toLowerCase();
        const fileName = String(input.fileName || '').toLowerCase();
        const isPdf = mimeType.includes('pdf') || fileName.endsWith('.pdf');
        if (input.type !== 'image' || !input.mediaId || isPdf) {
          return { state: session, replies: [{ text: 'Please upload a photo of your National ID. PDFs are not accepted. Take a picture and upload the photo.' }] };
        }

        let idDocRef = `whatsapp-media:${input.mediaId}`;
        try {
          const path = `verification/${session.userId.replace(/\D/g, '')}/${String(data.draftId || 'draft')}/nid-${Date.now()}`;
          const stored = await this.media.persistWhatsAppMedia(input.mediaId, path, true);
          idDocRef = stored.internalRef;
        } catch {
          // fallback to whatsapp media ref
        }

        verification.idDocUrl = idDocRef;
        data.verificationStage = 'consent';
        return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_consent') }] };
      }

      if (stage === 'consent') {
        if (!['yes', 'y', 'agree', 'i agree'].includes(text.toLowerCase())) {
          return { state: session, replies: [{ text: 'Please reply YES to continue.' }] };
        }

        verification.consentAccepted = true;

        const draftId = String(data.draftId || '');
        const validationErrors = await this.listingDraft.validateBeforeSubmit(draftId, listing as never);
        if (validationErrors.length) {
          return {
            state: session,
            replies: [{ text: `Cannot submit yet. Missing: ${validationErrors.join(', ')}` }]
          };
        }

        await this.listingDraft.saveDraft(session.userId, listing as never);
        const submitted = await this.listingDraft.submit(draftId, listing as never);

        await this.audit.log(session.userId, 'listing.submitted', {
          draftId,
          submissionId: submitted.submissionId,
          category: listing.category
        });

        session.currentStep = 'main_menu';
        session.currentIntent = null;
        data.listing = {};

        return {
          state: session,
          replies: [
            {
              text: await this.language.t(session.language, 'listing_submitted', {
                ref: submitted.referenceNo
              })
            },
            {
              text:
                'Create your MakaUg account to track views, saves, enquiries, get alerts, and manage listings faster.\n' +
                `${this.urls.account()}`
            },
            { text: await this.language.t(session.language, 'main_menu') }
          ]
        };
      }
    }

    session.currentStep = 'listing_category';
    return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_listing_category') }] };
  }

  private async handleAgentSearch(session: SessionState, input: MessageInput) {
    const text = this.getText(input);
    const data = session.data;
    const stage = String(data.agentStage || 'area');

    if (stage === 'area') {
      data.agentArea = text;
      data.agentStage = 'purpose';
      return { state: session, replies: [{ text: 'Purpose: buying, renting, selling, or listing?' }] };
    }

    if (stage === 'purpose') {
      data.agentPurpose = text;
      data.agentStage = 'registered';
      return { state: session, replies: [{ text: 'Registered agents first? Reply YES or NO.' }] };
    }

    if (stage === 'registered') {
      const registeredOnly = ['yes', 'y', '1'].includes(text.toLowerCase());
      const agents = await this.agent.search({
        area: data.agentArea as string,
        purpose: data.agentPurpose as string,
        registeredOnly
      });

      session.currentIntent = null;
      session.currentStep = 'main_menu';

      if (!agents.length) {
        return {
          state: session,
          replies: [{ text: `No agent match yet. View all agents here: ${this.urls.brokers()}` }, { text: await this.language.t(session.language, 'main_menu') }]
        };
      }

      return {
        state: session,
        replies: [{ text: this.agent.formatAgents(agents) }, { text: await this.language.t(session.language, 'main_menu') }]
      };
    }

    data.agentStage = 'area';
    return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_agent_search') }] };
  }

  private async handleAgentRegistration(session: SessionState, input: MessageInput) {
    const text = this.getText(input);
    const data = session.data;
    const payload = (data.agentRegistration as Record<string, unknown>) ?? {};
    data.agentRegistration = payload;
    const stage = String(data.agentRegStage || 'track');

    if (stage === 'track') {
      const normalized = text.toLowerCase();
      if (['registered', '1', 'yes'].includes(normalized)) {
        payload.registrationTrack = 'registered';
        data.agentRegStage = 'fullName';
        return {
          state: session,
          replies: [{ text: await this.language.t(session.language, 'agent_registered_limit') }, { text: 'Full legal name?' }]
        };
      }

      if (['not registered', '2', 'no', 'not registered yet'].includes(normalized)) {
        payload.registrationTrack = 'not_registered';
        data.agentRegStage = 'fullName';
        return {
          state: session,
          replies: [{ text: await this.language.t(session.language, 'agent_not_registered_limit') }, { text: 'Full legal name?' }]
        };
      }

      return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_agent_registration_track') }] };
    }

    if (stage === 'fullName') {
      payload.fullName = text;
      data.agentRegStage = 'agency';
      return { state: session, replies: [{ text: 'Agency/company name?' }] };
    }

    if (stage === 'agency') {
      payload.agencyName = text;
      data.agentRegStage = 'phone';
      return { state: session, replies: [{ text: 'Phone number?' }] };
    }

    if (stage === 'phone') {
      if (!this.validation.isValidUgandaPhone(text)) {
        return { state: session, replies: [{ text: 'Invalid Uganda phone format.' }] };
      }
      payload.phone = this.validation.normalizeUgandaPhone(text);
      data.agentRegStage = 'whatsapp';
      return { state: session, replies: [{ text: 'WhatsApp number?' }] };
    }

    if (stage === 'whatsapp') {
      if (!this.validation.isValidUgandaPhone(text)) {
        return { state: session, replies: [{ text: 'Invalid Uganda phone format.' }] };
      }
      payload.whatsapp = this.validation.normalizeUgandaPhone(text);
      data.agentRegStage = 'email';
      return { state: session, replies: [{ text: 'Email address?' }] };
    }

    if (stage === 'email') {
      if (!this.validation.isValidEmail(text)) {
        return { state: session, replies: [{ text: 'Invalid email format.' }] };
      }
      payload.email = text;
      data.agentRegStage = 'areas';
      return { state: session, replies: [{ text: 'Areas covered? (comma separated)' }] };
    }

    if (stage === 'areas') {
      payload.areasCovered = text;
      data.agentRegStage = 'nin';
      return { state: session, replies: [{ text: 'NIN?' }] };
    }

    if (stage === 'nin') {
      if (!this.validation.isValidNin(text)) {
        return { state: session, replies: [{ text: 'Invalid NIN format.' }] };
      }
      payload.nin = text.toUpperCase();

      if (payload.registrationTrack === 'registered') {
        data.agentRegStage = 'licence';
        return { state: session, replies: [{ text: 'AREA Uganda licence number?' }] };
      }

      const id = await this.agent.registerApplication(payload);
      session.currentIntent = null;
      session.currentStep = 'main_menu';
      return {
        state: session,
        replies: [
          { text: `Application received. Ref: ${id}. We will review and contact you soon.` },
          { text: await this.language.t(session.language, 'main_menu') }
        ]
      };
    }

    if (stage === 'licence') {
      payload.licenceNumber = text;
      data.agentRegStage = 'licenceDoc';
      return { state: session, replies: [{ text: 'Upload AREA certificate (PDF/image).' }] };
    }

    if (stage === 'licenceDoc') {
      if (!['document', 'image'].includes(input.type) || !input.mediaId) {
        return { state: session, replies: [{ text: 'Please upload AREA certificate as image or PDF.' }] };
      }
      let certRef = `whatsapp-media:${input.mediaId}`;
      try {
        const path = `agent-applications/${session.userId.replace(/\D/g, '')}/area-cert-${Date.now()}`;
        const stored = await this.media.persistWhatsAppMedia(input.mediaId, path, true);
        certRef = stored.internalRef;
      } catch {
        // fallback
      }
      payload.licenceCertificateUrl = certRef;
      const id = await this.agent.registerApplication(payload);
      session.currentIntent = null;
      session.currentStep = 'main_menu';
      return {
        state: session,
        replies: [
          { text: `Application received. Ref: ${id}. Registered track submitted for review.` },
          { text: await this.language.t(session.language, 'main_menu') }
        ]
      };
    }

    data.agentRegStage = 'track';
    return { state: session, replies: [{ text: await this.language.t(session.language, 'ask_agent_registration_track') }] };
  }

  private async handleMortgage(session: SessionState, input: MessageInput) {
    const text = this.getText(input);
    const data = session.data;
    const stage = String(data.mortgageStage || 'price');

    if (stage === 'price') {
      const price = this.validation.parseCurrency(text);
      if (!price) return { state: session, replies: [{ text: 'Enter a valid property price in UGX.' }] };
      data.propertyPrice = price;
      data.mortgageStage = 'purpose';
      return { state: session, replies: [{ text: 'Property purpose? (home, investment, land, commercial)' }] };
    }

    if (stage === 'purpose') {
      data.propertyPurpose = text;
      data.mortgageStage = 'deposit';
      return { state: session, replies: [{ text: 'Deposit percentage? (e.g. 20)' }] };
    }

    if (stage === 'deposit') {
      const percent = Number(text.replace(/[^0-9.]/g, ''));
      if (!Number.isFinite(percent) || percent <= 0 || percent >= 100) {
        return { state: session, replies: [{ text: 'Enter a valid deposit percentage between 1 and 99.' }] };
      }
      data.depositPercent = percent;
      data.mortgageStage = 'term';
      return { state: session, replies: [{ text: 'Loan term in years?' }] };
    }

    if (stage === 'term') {
      const years = Number(text.replace(/[^0-9]/g, ''));
      if (!Number.isFinite(years) || years < 1 || years > 40) {
        return { state: session, replies: [{ text: 'Enter valid years (1-40).' }] };
      }
      data.termYears = years;
      data.mortgageStage = 'income';
      return { state: session, replies: [{ text: 'Household monthly income (optional). Reply SKIP to skip.' }] };
    }

    if (stage === 'income') {
      const income = text.toLowerCase() === 'skip' ? undefined : this.validation.parseCurrency(text) ?? undefined;
      const { estimate } = await this.mortgage.estimateAndStore({
        userPhone: session.userId,
        propertyPrice: Number(data.propertyPrice),
        propertyPurpose: String(data.propertyPurpose || 'home'),
        depositPercent: Number(data.depositPercent),
        termYears: Number(data.termYears),
        householdIncome: income
      });

      session.currentIntent = null;
      session.currentStep = 'main_menu';

      return {
        state: session,
        replies: [
          {
            text:
              `Estimated monthly repayment: USh ${Math.round(estimate.monthlyRepayment).toLocaleString()}\n` +
              `Deposit: USh ${Math.round(estimate.depositAmount).toLocaleString()}\n` +
              `Loan amount: USh ${Math.round(estimate.loanAmount).toLocaleString()}\n` +
              `${estimate.affordabilityNote}\n` +
              `${estimate.disclaimer}\n` +
              `Compare lenders: ${this.urls.mortgage()}`
          },
          { text: await this.language.t(session.language, 'main_menu') }
        ]
      };
    }

    data.mortgageStage = 'price';
    return { state: session, replies: [{ text: await this.language.t(session.language, 'mortgage_intro') }] };
  }

  private async handleAccount(session: SessionState) {
    session.currentIntent = null;
    session.currentStep = 'main_menu';

    return {
      state: session,
      replies: [
        { text: await this.language.t(session.language, 'account_help_intro') },
        { text: this.account.getMessage() },
        { text: await this.language.t(session.language, 'main_menu') }
      ]
    };
  }

  private async handleListingReport(session: SessionState, input: MessageInput) {
    const text = this.getText(input);
    const data = session.data;
    const stage = String(data.reportStage || 'listingRef');

    if (stage === 'listingRef') {
      data.reportListingRef = text;
      data.reportStage = 'name';
      return { state: session, replies: [{ text: 'Your full name?' }] };
    }

    if (stage === 'name') {
      data.reportName = text;
      data.reportStage = 'phone';
      return { state: session, replies: [{ text: 'Your phone number?' }] };
    }

    if (stage === 'phone') {
      if (!this.validation.isValidUgandaPhone(text)) {
        return { state: session, replies: [{ text: 'Invalid Uganda phone number format.' }] };
      }
      data.reportPhone = this.validation.normalizeUgandaPhone(text);
      data.reportStage = 'details';
      return { state: session, replies: [{ text: 'Describe the issue details.' }] };
    }

    if (stage === 'details') {
      data.reportDetails = text;
      data.reportEvidence = [];
      data.reportStage = 'evidence';
      return { state: session, replies: [{ text: 'Upload screenshot/document evidence, or type SKIP.' }] };
    }

    if (stage === 'evidence') {
      const evidence = (data.reportEvidence as string[]) ?? [];
      if ((input.type === 'image' || input.type === 'document') && input.mediaId) {
        let evidenceRef = `whatsapp-media:${input.mediaId}`;
        try {
          const path = `reports/${session.userId.replace(/\D/g, '')}/evidence-${Date.now()}`;
          const stored = await this.media.persistWhatsAppMedia(input.mediaId, path, true);
          evidenceRef = stored.internalRef;
        } catch {
          // fallback
        }
        evidence.push(evidenceRef);
        data.reportEvidence = evidence;
        return { state: session, replies: [{ text: `Evidence received (${evidence.length}). Send more or type DONE.` }] };
      }

      if (text.toLowerCase() === 'skip' || text.toLowerCase() === 'done') {
        const id = await this.reports.create({
          listingRef: data.reportListingRef,
          name: data.reportName,
          phone: data.reportPhone,
          details: data.reportDetails,
          evidence
        });

        session.currentIntent = null;
        session.currentStep = 'main_menu';

        return {
          state: session,
          replies: [
            { text: `Thanks. Report case received. Case ID: ${id}. Our safety team will review.` },
            { text: `${this.urls.reportListing()} | Support: +256 770 646 879` },
            { text: await this.language.t(session.language, 'main_menu') }
          ]
        };
      }

      return { state: session, replies: [{ text: 'Upload evidence or type DONE.' }] };
    }

    data.reportStage = 'listingRef';
    return { state: session, replies: [{ text: await this.language.t(session.language, 'report_intro') }] };
  }

  private async handleSupport(session: SessionState) {
    session.currentIntent = null;
    session.currentStep = 'main_menu';

    return {
      state: session,
      replies: [
        { text: await this.language.t(session.language, 'support_intro') },
        { text: appendSupportHint(this.support.getFallbackMessage()) },
        { text: await this.language.t(session.language, 'main_menu') }
      ]
    };
  }
}
