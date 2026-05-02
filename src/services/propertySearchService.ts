import { repositories } from '../repositories';
import type { PropertyCategory, SearchResult } from '../types/domain';
import { UrlBuilderService } from './urlBuilderService';

export interface PropertySearchPayload {
  userPhone: string;
  purpose?: 'buy' | 'rent' | 'browse';
  category: PropertyCategory | 'any';
  area?: string;
  district?: string;
  budget?: number;
  bedsMin?: number;
  propertyType?: string;
  lat?: number;
  lng?: number;
}

export class PropertySearchService {
  constructor(private readonly urls = new UrlBuilderService()) {}

  async search(payload: PropertySearchPayload): Promise<{ results: SearchResult[]; requestId: string }> {
    const requestId = await repositories.search.saveRequest(payload as unknown as Record<string, unknown>);

    const results = await repositories.propertyAdapter.search({
      category: payload.category,
      area: payload.area,
      district: payload.district,
      budgetMax: payload.budget,
      bedsMin: payload.bedsMin,
      propertyType: payload.propertyType,
      lat: payload.lat,
      lng: payload.lng,
      limit: 5
    });

    await repositories.search.cacheResults(requestId, results);
    return { results, requestId };
  }

  formatResults(results: SearchResult[]): string {
    return results
      .map((r, index) => {
        const facts = r.keyFacts.length ? ` | ${r.keyFacts.join(' | ')}` : '';
        return `${index + 1}) *${r.title}*\n${r.location}, ${r.district}\n${r.priceLabel}${facts}\n${r.listingUrl}`;
      })
      .join('\n\n');
  }

  browseLink(category: PropertyCategory | 'any', area: string): string {
    return this.urls.area(category, area);
  }
}
