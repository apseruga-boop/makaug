import { describe, expect, it, vi } from 'vitest';
import { ConversationStateMachine } from '../services/conversationStateMachine';
import type { MessageInput, OutboundMessage, SearchResult, SessionState } from '../types/domain';

function baseSession(overrides?: Partial<SessionState>): SessionState {
  return {
    userId: '+256700000000',
    language: 'en',
    currentIntent: null,
    currentStep: 'language_select',
    data: {},
    otpVerified: false,
    paused: false,
    ...overrides
  };
}

function msg(type: MessageInput['type'], text?: string): MessageInput {
  return {
    userId: '+256700000000',
    waMessageId: `wa_${Math.random()}`,
    timestamp: Date.now(),
    type,
    text,
    raw: {}
  };
}

function listResult(category: SearchResult['category']): SearchResult {
  return {
    id: 'p1',
    title: 'Sample',
    summary: 'sample',
    location: 'Kampala',
    district: 'Kampala',
    priceLabel: 'USh 1M',
    keyFacts: ['2 beds'],
    listingUrl: 'https://makaug.com/property/p1',
    category
  };
}

function makeMachine(options?: {
  searchResults?: SearchResult[];
  otpValid?: boolean;
  transcription?: string;
  lowConfidence?: boolean;
}) {
  const photos: Array<{ media_url: string; slot_key: string | null }> = [];

  const listingDraft = {
    saveDraft: vi.fn(async () => 'draft-1'),
    addPhoto: vi.fn(async (_draftId: string, photoUrl: string, slot?: string) => {
      photos.push({ media_url: photoUrl, slot_key: slot ?? null });
    }),
    getPhotos: vi.fn(async () => photos),
    requiredPhotoGuide: vi.fn(() => ['front', 'living', 'bedroom']),
    buildPreview: vi.fn(() => 'PREVIEW'),
    validateBeforeSubmit: vi.fn(async () => []),
    submit: vi.fn(async () => ({ submissionId: 'sub-1', referenceNo: 'MK-123ABC' }))
  };

  const machine = new ConversationStateMachine({
    classifier: { classify: vi.fn(async () => 'property_search') } as never,
    propertySearch: {
      search: vi.fn(async () => ({ results: options?.searchResults ?? [listResult('rent')], requestId: 'req-1' })),
      formatResults: vi.fn((results: SearchResult[]) => results.map((r) => r.title).join(',')),
      browseLink: vi.fn(() => 'https://makaug.com/#page-rent?area=Kampala')
    } as never,
    listingDraft: listingDraft as never,
    agent: {
      search: vi.fn(async () => [{
        id: 'a1',
        name: 'James',
        registrationStatus: 'registered' as const,
        company: 'Prime',
        areaCovered: 'Kampala',
        specialties: ['Residential'],
        languages: ['English'],
        profileUrl: 'https://makaug.com/agent/a1'
      }]),
      formatAgents: vi.fn(() => 'AGENTS'),
      registerApplication: vi.fn(async () => 'app-1')
    } as never,
    mortgage: {
      estimateAndStore: vi.fn(async () => ({
        enquiryId: 'm1',
        estimate: {
          monthlyRepayment: 1200000,
          depositAmount: 50000000,
          loanAmount: 200000000,
          affordabilityNote: 'OK',
          disclaimer: 'Indicative'
        }
      }))
    } as never,
    otp: {
      sendOtp: vi.fn(async () => {}),
      resendOtp: vi.fn(async () => {}),
      verifyOtp: vi.fn(async () => options?.otpValid ?? true)
    } as never,
    voice: {
      transcribeFromMediaId: vi.fn(async () => ({
        transcript: options?.transcription ?? 'find rental in kampala',
        confidence: options?.lowConfidence ? 0.5 : 0.9,
        language: 'en'
      }))
    } as never,
    reports: {
      create: vi.fn(async () => 'case-1')
    } as never,
    leads: {
      create: vi.fn(async () => 'lead-1')
    } as never,
    audit: {
      log: vi.fn(async () => {})
    } as never
  });

  return { machine, listingDraft, photos };
}

async function run(machine: ConversationStateMachine, session: SessionState, input: MessageInput): Promise<{ state: SessionState; replies: OutboundMessage[] }> {
  return machine.handle(session, input);
}

describe('conversation state machine', () => {
  it('handles greeting and language selection', async () => {
    const { machine } = makeMachine();
    const session = baseSession();
    const response = await run(machine, session, msg('text', '1'));

    expect(response.state.language).toBe('en');
    expect(response.state.currentStep).toBe('main_menu');
    expect(response.replies.length).toBeGreaterThan(1);
  });

  it('handles rent search flow', async () => {
    const { machine } = makeMachine({ searchResults: [listResult('rent')] });
    const session = baseSession({ currentStep: 'main_menu' });

    await run(machine, session, msg('text', '1'));
    await run(machine, session, msg('text', 'rent'));
    await run(machine, session, msg('text', 'rent'));
    await run(machine, session, msg('text', 'Kampala'));
    await run(machine, session, msg('text', '2000000'));
    const final = await run(machine, session, msg('text', 'skip'));

    expect(final.replies[0].text).toContain('Sample');
    expect(final.state.currentStep).toBe('main_menu');
  });

  it('handles buy flow', async () => {
    const { machine } = makeMachine({ searchResults: [listResult('sale')] });
    const session = baseSession({ currentStep: 'main_menu' });

    await run(machine, session, msg('text', '1'));
    await run(machine, session, msg('text', 'buy'));
    await run(machine, session, msg('text', 'sale'));
    await run(machine, session, msg('text', 'Ntinda'));
    await run(machine, session, msg('text', '350000000'));
    const final = await run(machine, session, msg('text', 'skip'));

    expect(final.replies[0].text).toContain('Sample');
  });

  it('handles location sharing flow', async () => {
    const { machine } = makeMachine();
    const session = baseSession({ currentStep: 'search_area', currentIntent: 'property_search', data: { category: 'rent', purpose: 'rent' } });

    const response = await run(machine, session, {
      ...msg('location'),
      location: { lat: 0.34, lng: 32.58, area: 'Kampala' }
    });

    expect(response.state.currentStep).toBe('search_budget');
    expect(response.state.data.area).toBe('Kampala');
  });

  it('handles no results and lead capture', async () => {
    const { machine } = makeMachine({ searchResults: [] });
    const session = baseSession({ currentStep: 'main_menu' });

    await run(machine, session, msg('text', '1'));
    await run(machine, session, msg('text', 'rent'));
    await run(machine, session, msg('text', 'rent'));
    await run(machine, session, msg('text', 'Kampala'));
    await run(machine, session, msg('text', '500000'));
    const noResults = await run(machine, session, msg('text', 'skip'));

    expect(noResults.state.currentIntent).toBe('looking_for_property_lead');

    await run(machine, session, msg('text', 'yes'));
    await run(machine, session, msg('text', 'John Doe'));
    await run(machine, session, msg('text', '+256770000000'));
    await run(machine, session, msg('text', 'skip'));
    const done = await run(machine, session, msg('text', 'need close to road'));
    expect(done.replies[0].text).toContain('Lead ref');
  });

  it('handles listing happy path', async () => {
    const { machine } = makeMachine();
    const session = baseSession({ currentStep: 'main_menu' });

    await run(machine, session, msg('text', '2'));
    await run(machine, session, msg('text', 'sale'));
    await run(machine, session, msg('text', '3 bed house'));
    await run(machine, session, msg('text', 'Kampala'));
    await run(machine, session, msg('text', 'Kampala'));
    await run(machine, session, msg('text', 'Ntinda'));
    await run(machine, session, msg('text', 'Street 1'));
    await run(machine, session, msg('text', '300000000'));
    await run(machine, session, msg('text', 'Great home'));
    await run(machine, session, msg('text', 'subtype=house;bedrooms=3;bathrooms=2'));
    await run(machine, session, msg('text', 'Ntinda Kampala'));
    await run(machine, session, { ...msg('image'), mediaId: 'im1' });
    await run(machine, session, { ...msg('image'), mediaId: 'im2' });
    await run(machine, session, { ...msg('image'), mediaId: 'im3' });
    await run(machine, session, msg('text', 'done'));
    await run(machine, session, msg('text', 'submit'));
    await run(machine, session, msg('text', 'John Doe'));
    await run(machine, session, msg('text', '+256770000000'));
    await run(machine, session, msg('text', '123456'));
    await run(machine, session, msg('text', 'john@example.com'));
    await run(machine, session, msg('text', 'CM12345678ABCD'));
    await run(machine, session, { ...msg('image'), mediaId: 'doc1', mimeType: 'image/jpeg', fileName: 'national-id.jpg' });
    const final = await run(machine, session, msg('text', 'YES'));

    expect(final.replies[0].text).toContain('submitted for review');
  });

  it('blocks listing submission when photos are missing', async () => {
    const { machine } = makeMachine();
    const session = baseSession({ currentIntent: 'property_listing', currentStep: 'listing_photos', data: { draftId: 'd1', listing: { category: 'sale' } } });

    const response = await run(machine, session, msg('text', 'DONE'));
    expect(response.replies[0].text).toContain('at least 3 photos');
  });

  it('supports preview edit flow', async () => {
    const { machine } = makeMachine();
    const session = baseSession({ currentIntent: 'property_listing', currentStep: 'listing_preview', data: { listingStage: 'preview', listing: {} } });

    const response = await run(machine, session, msg('text', 'edit price'));
    expect(response.state.currentStep).toBe('listing_collect');
    expect(response.replies[0].text).toContain('updated price');
  });

  it('handles OTP failure', async () => {
    const { machine } = makeMachine({ otpValid: false });
    const session = baseSession({
      currentIntent: 'property_listing',
      currentStep: 'listing_verification',
      data: { verificationStage: 'otp', listing: { verification: { phone: '+256770000000' } } }
    });

    const response = await run(machine, session, msg('text', '111111'));
    expect(response.replies[0].text).toContain('OTP invalid');
  });

  it('validates invalid NIN', async () => {
    const { machine } = makeMachine();
    const session = baseSession({
      currentIntent: 'property_listing',
      currentStep: 'listing_verification',
      data: { verificationStage: 'nin', listing: { verification: {} } }
    });

    const response = await run(machine, session, msg('text', '123'));
    expect(response.replies[0].text).toContain('Invalid NIN');
  });

  it('rejects PDF uploads for National ID verification', async () => {
    const { machine } = makeMachine();
    const session = baseSession({
      currentIntent: 'property_listing',
      currentStep: 'listing_verification',
      data: { verificationStage: 'idUpload', listing: { verification: { nin: 'CM12345678ABCD' } } }
    });

    const response = await run(machine, session, { ...msg('document'), mediaId: 'doc1', mimeType: 'application/pdf', fileName: 'national-id.pdf' });
    expect(response.replies[0].text).toContain('PDFs are not accepted');
    expect(response.state.data.verificationStage).toBe('idUpload');
  });

  it('handles voice note flow', async () => {
    const { machine } = makeMachine({ transcription: '1' });
    const session = baseSession({ currentStep: 'main_menu' });

    const response = await run(machine, session, { ...msg('audio'), mediaId: 'aud1' });
    expect(response.state.currentIntent).toBe('property_search');
  });

  it('handles registered agent registration flow', async () => {
    const { machine } = makeMachine();
    const session = baseSession({ currentStep: 'main_menu' });

    await run(machine, session, msg('text', '4'));
    await run(machine, session, msg('text', 'registered'));
    await run(machine, session, msg('text', 'Jane Agent'));
    await run(machine, session, msg('text', 'Agency Ltd'));
    await run(machine, session, msg('text', '+256770000000'));
    await run(machine, session, msg('text', '+256770000001'));
    await run(machine, session, msg('text', 'agent@example.com'));
    await run(machine, session, msg('text', 'Kampala, Wakiso'));
    await run(machine, session, msg('text', 'CM12345678ABCD'));
    await run(machine, session, msg('text', 'AREA/2025/111'));
    const done = await run(machine, session, { ...msg('document'), mediaId: 'cert1' });

    expect(done.replies[0].text).toContain('Application received');
  });

  it('handles not registered agent registration flow', async () => {
    const { machine } = makeMachine();
    const session = baseSession({ currentStep: 'main_menu' });

    await run(machine, session, msg('text', '4'));
    await run(machine, session, msg('text', 'not registered'));
    await run(machine, session, msg('text', 'Jane Agent'));
    await run(machine, session, msg('text', 'Agency Ltd'));
    await run(machine, session, msg('text', '+256770000000'));
    await run(machine, session, msg('text', '+256770000001'));
    await run(machine, session, msg('text', 'agent@example.com'));
    await run(machine, session, msg('text', 'Kampala, Wakiso'));
    const done = await run(machine, session, msg('text', 'CM12345678ABCD'));

    expect(done.replies[0].text).toContain('Application received');
  });

  it('handles mortgage flow', async () => {
    const { machine } = makeMachine();
    const session = baseSession({ currentStep: 'main_menu' });

    await run(machine, session, msg('text', '5'));
    await run(machine, session, msg('text', '250000000'));
    await run(machine, session, msg('text', 'home'));
    await run(machine, session, msg('text', '20'));
    await run(machine, session, msg('text', '20'));
    const done = await run(machine, session, msg('text', '6000000'));

    expect(done.replies[0].text).toContain('Estimated monthly repayment');
  });

  it('handles support fallback', async () => {
    const { machine } = makeMachine();
    const session = baseSession({ currentStep: 'main_menu' });

    const response = await run(machine, session, msg('text', '7'));
    expect(response.replies[0].text.toLowerCase()).toContain('support');
  });

  it('handles listing report flow', async () => {
    const { machine } = makeMachine();
    const session = baseSession({ currentIntent: 'report_listing', currentStep: 'report_collect', data: { reportStage: 'listingRef' } });

    await run(machine, session, msg('text', 'https://makaug.com/property/1'));
    await run(machine, session, msg('text', 'John'));
    await run(machine, session, msg('text', '+256770000000'));
    await run(machine, session, msg('text', 'Fake price'));
    const done = await run(machine, session, msg('text', 'done'));

    expect(done.replies[0].text).toContain('Case ID');
  });
});
