import { env } from '../config/env';

export interface ReverseGeocodeResult {
  displayName: string;
  district?: string;
  area?: string;
  city?: string;
}

export class ReverseGeocodingAdapter {
  async reverse(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
    const url = `${env.reverseGeocodeBaseUrl}?format=jsonv2&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}`;
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'MakaUgWhatsAppBot/1.0 (+https://makaug.com)'
        }
      });

      if (!response.ok) return null;
      const data = (await response.json()) as {
        display_name?: string;
        address?: Record<string, string>;
      };

      return {
        displayName: data.display_name ?? `${lat}, ${lng}`,
        district: data.address?.county || data.address?.state_district,
        area: data.address?.suburb || data.address?.neighbourhood || data.address?.village,
        city: data.address?.city || data.address?.town || data.address?.municipality
      };
    } catch {
      return null;
    }
  }
}
