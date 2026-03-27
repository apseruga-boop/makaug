import { query } from '../../config/database';
import type { PropertyDataAdapter, PropertySearchInput } from '../interfaces';
import type { SearchResult } from '../../types/domain';

interface PropertyRow {
  id: string;
  title: string;
  description: string;
  area: string;
  district: string;
  price: string | number | null;
  price_period: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  property_type: string | null;
  listing_type: string;
  latitude: number | null;
  longitude: number | null;
}

function formatPrice(price: number | null, period?: string | null): string {
  if (!price) return 'Price on request';
  if (price >= 1_000_000_000) return `USh ${(price / 1_000_000_000).toFixed(1)}B${period ? `/${period}` : ''}`;
  if (price >= 1_000_000) return `USh ${(price / 1_000_000).toFixed(0)}M${period ? `/${period}` : ''}`;
  return `USh ${price.toLocaleString()}${period ? `/${period}` : ''}`;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export class PostgresPropertyAdapter implements PropertyDataAdapter {
  async search(input: PropertySearchInput): Promise<SearchResult[]> {
    const where: string[] = ["status = 'approved'"];
    const params: unknown[] = [];

    if (input.category !== 'any') {
      params.push(input.category === 'students' ? 'student' : input.category);
      where.push(`listing_type = $${params.length}`);
    }

    if (input.area) {
      params.push(`%${input.area}%`);
      where.push(`(area ILIKE $${params.length} OR district ILIKE $${params.length} OR title ILIKE $${params.length})`);
    }

    if (typeof input.budgetMax === 'number') {
      params.push(input.budgetMax);
      where.push(`price <= $${params.length}`);
    }

    if (typeof input.bedsMin === 'number') {
      params.push(input.bedsMin);
      where.push(`COALESCE(bedrooms, 0) >= $${params.length}`);
    }

    if (input.propertyType) {
      params.push(`%${input.propertyType}%`);
      where.push(`COALESCE(property_type, '') ILIKE $${params.length}`);
    }

    const limit = input.limit ?? 5;
    params.push(Math.max(3, Math.min(10, limit)));

    const sql = `
      SELECT id,title,description,area,district,price,price_period,bedrooms,bathrooms,property_type,listing_type,latitude,longitude
      FROM properties
      WHERE ${where.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT $${params.length}
    `;

    const result = await query<PropertyRow>(sql, params);
    const rows = result.rows;

    const mapped = rows.map<SearchResult>((row) => {
      const price = row.price ? Number(row.price) : null;
      const facts = [
        row.bedrooms ? `${row.bedrooms} beds` : null,
        row.bathrooms ? `${row.bathrooms} baths` : null,
        row.property_type ?? null
      ].filter(Boolean) as string[];

      const distanceKm =
        typeof input.lat === 'number' &&
        typeof input.lng === 'number' &&
        typeof row.latitude === 'number' &&
        typeof row.longitude === 'number'
          ? haversine(input.lat, input.lng, row.latitude, row.longitude)
          : undefined;

      return {
        id: row.id,
        title: row.title,
        summary: row.description.slice(0, 120),
        location: row.area,
        district: row.district,
        priceLabel: formatPrice(price, row.price_period),
        keyFacts: facts,
        listingUrl: `https://makaug.com/property/${row.id}`,
        category: (row.listing_type === 'student' ? 'students' : row.listing_type) as SearchResult['category'],
        distanceKm
      };
    });

    if (typeof input.lat === 'number' && typeof input.lng === 'number') {
      mapped.sort((a, b) => (a.distanceKm ?? 9999) - (b.distanceKm ?? 9999));
    }

    return mapped;
  }

  async getById(id: string): Promise<SearchResult | null> {
    const result = await query<PropertyRow>(
      `SELECT id,title,description,area,district,price,price_period,bedrooms,bathrooms,property_type,listing_type,latitude,longitude
       FROM properties WHERE id = $1 LIMIT 1`,
      [id]
    );

    const row = result.rows[0];
    if (!row) return null;

    const price = row.price ? Number(row.price) : null;
    return {
      id: row.id,
      title: row.title,
      summary: row.description.slice(0, 120),
      location: row.area,
      district: row.district,
      priceLabel: formatPrice(price, row.price_period),
      keyFacts: [row.bedrooms ? `${row.bedrooms} beds` : '', row.bathrooms ? `${row.bathrooms} baths` : '', row.property_type ?? '']
        .filter(Boolean),
      listingUrl: `https://makaug.com/property/${row.id}`,
      category: (row.listing_type === 'student' ? 'students' : row.listing_type) as SearchResult['category']
    };
  }
}
