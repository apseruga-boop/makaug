import { MOCK_LISTINGS } from '../../data/mockListings';
import type { PropertyDataAdapter, PropertySearchInput } from '../interfaces';
import type { SearchResult } from '../../types/domain';

function includes(haystack: string, needle?: string): boolean {
  if (!needle) return true;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export class MockPropertyAdapter implements PropertyDataAdapter {
  async search(input: PropertySearchInput): Promise<SearchResult[]> {
    const filtered = MOCK_LISTINGS.filter((listing) => {
      const categoryMatch = input.category === 'any' ? true : listing.category === input.category;
      const areaMatch = includes(`${listing.location} ${listing.district} ${listing.title}`, input.area || input.district);
      return categoryMatch && areaMatch;
    });

    return filtered.slice(0, input.limit ?? 5);
  }

  async getById(id: string): Promise<SearchResult | null> {
    return MOCK_LISTINGS.find((item) => item.id === id) ?? null;
  }
}
