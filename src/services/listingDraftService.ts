import { repositories } from '../repositories';
import { MIN_LISTING_PHOTOS } from '../utils/constants';
import type { PropertyCategory } from '../types/domain';

export interface ListingDraftData {
  category?: PropertyCategory;
  purpose?: 'sale' | 'rent';
  title?: string;
  region?: string;
  district?: string;
  city?: string;
  area?: string;
  neighborhood?: string;
  address?: string;
  price?: number;
  pricePeriod?: string;
  description?: string;
  lat?: number;
  lng?: number;
  locationAddress?: string;
  fields?: Record<string, unknown>;
  photos?: Array<{ url: string; slot?: string }>;
  verification?: Record<string, unknown>;
}

export class ListingDraftService {
  async saveDraft(userPhone: string, draft: ListingDraftData): Promise<string> {
    return repositories.listing.upsertDraft(userPhone, draft as Record<string, unknown>);
  }

  async addPhoto(draftId: string, photoUrl: string, slot?: string): Promise<void> {
    await repositories.listing.addMedia(draftId, { type: 'image', url: photoUrl, slot });
  }

  async getPhotos(draftId: string): Promise<Array<{ media_url: string; slot_key: string | null }>> {
    return repositories.listing.listMedia(draftId);
  }

  requiredPhotoGuide(category: PropertyCategory): string[] {
    if (category === 'land') {
      return ['Front road access', 'Center of plot', 'Boundary marker'];
    }
    if (category === 'commercial') {
      return ['Building front', 'Interior workspace', 'Entrance/parking'];
    }
    return ['Front / exterior', 'Living room', 'Bedroom'];
  }

  validateDraftForPreview(draft: ListingDraftData): string[] {
    const missing: string[] = [];
    if (!draft.category) missing.push('category');
    if (!draft.title) missing.push('title');
    if (!draft.district) missing.push('district');
    if (!draft.area && !draft.neighborhood) missing.push('area');
    if (!draft.price) missing.push('price');
    if (!draft.description) missing.push('description');
    return missing;
  }

  async validateBeforeSubmit(draftId: string, draft: ListingDraftData): Promise<string[]> {
    const missing = this.validateDraftForPreview(draft);
    const photos = await this.getPhotos(draftId);
    if (photos.length < MIN_LISTING_PHOTOS) {
      missing.push('photos');
    }

    const verification = draft.verification || {};
    if (!verification.fullName) missing.push('full name');
    if (!verification.phone) missing.push('phone');
    if (!verification.email) missing.push('email');
    if (!verification.nin) missing.push('NIN');
    if (!verification.idDocUrl) missing.push('national ID upload');
    if (!verification.otpVerified) missing.push('OTP verification');
    if (!verification.consentAccepted) missing.push('consent');

    return missing;
  }

  async submit(draftId: string, draft: ListingDraftData): Promise<{ submissionId: string; referenceNo: string }> {
    const result = await repositories.listing.submit(draftId, draft as Record<string, unknown>);
    return {
      submissionId: result.id,
      referenceNo: result.refNo
    };
  }

  buildPreview(draft: ListingDraftData, photoCount: number): string {
    const keyFacts: string[] = [];
    const fields = draft.fields ?? {};

    for (const key of ['subtype', 'bedrooms', 'bathrooms', 'size', 'titleType', 'roomType', 'landType']) {
      if (fields[key] !== undefined && fields[key] !== null && String(fields[key]).trim()) {
        keyFacts.push(`${key}: ${fields[key]}`);
      }
    }

    return [
      '*Listing Preview*',
      `Title: ${draft.title ?? '-'}`,
      `Category: ${draft.category ?? '-'}`,
      `Location: ${draft.area || draft.neighborhood || '-'}${draft.city ? `, ${draft.city}` : ''}`,
      `District: ${draft.district ?? '-'}`,
      `Price: ${draft.price ? `USh ${draft.price.toLocaleString()}` : '-'}`,
      `Description: ${draft.description ?? '-'}`,
      `Key facts: ${keyFacts.length ? keyFacts.join(' | ') : '-'}`,
      `Photos uploaded: ${photoCount}`,
      `Contact: ${String((draft.verification || {}).phone || '-')}`
    ].join('\n');
  }
}
