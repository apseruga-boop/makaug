import { ReverseGeocodingAdapter } from '../adapters/reverseGeocodingAdapter';
import { findCoordinates, getCitiesByDistrict, getDistrictsByRegion, getNeighborhoods } from '../data/ugandaLocations';
import type { GeoPoint } from '../types/domain';

export class LocationService {
  constructor(private readonly reverseAdapter = new ReverseGeocodingAdapter()) {}

  async fromSharedLocation(lat: number, lng: number): Promise<GeoPoint> {
    const reverse = await this.reverseAdapter.reverse(lat, lng);
    return {
      lat,
      lng,
      addressLine: reverse?.displayName,
      district: reverse?.district,
      area: reverse?.area ?? reverse?.city
    };
  }

  suggestDistricts(region: string): string[] {
    return getDistrictsByRegion(region);
  }

  suggestCities(district: string): string[] {
    return getCitiesByDistrict(district);
  }

  suggestNeighborhoods(district: string, city: string): string[] {
    return getNeighborhoods(district, city);
  }

  inferCoordinates(region?: string, district?: string, city?: string, neighborhood?: string): GeoPoint | null {
    const coords = findCoordinates(region, district, city, neighborhood);
    if (!coords) return null;
    return { lat: coords.lat, lng: coords.lng, district, area: neighborhood || city };
  }
}
