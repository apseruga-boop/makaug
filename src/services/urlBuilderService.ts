import { env } from '../config/env';
import type { PropertyCategory } from '../types/domain';

export class UrlBuilderService {
  private readonly base = env.publicBaseUrl.replace(/\/+$/, '');

  listing(id: string): string {
    return `${this.base}/property/${encodeURIComponent(id)}`;
  }

  area(category: PropertyCategory | 'any', area: string): string {
    const page =
      category === 'sale'
        ? 'sale'
        : category === 'rent'
          ? 'rent'
          : category === 'students'
            ? 'students'
            : category === 'commercial'
              ? 'commercial'
              : category === 'land'
                ? 'land'
                : 'sale';

    return `${this.base}/#page-${page}?area=${encodeURIComponent(area)}`;
  }

  broker(id: string): string {
    return `${this.base}/agent/${encodeURIComponent(id)}`;
  }

  brokers(): string {
    return `${this.base}/#page-brokers`;
  }

  mortgage(): string {
    return `${this.base}/#page-mortgage`; // existing frontend hash route convention
  }

  account(): string {
    return `${this.base}/account`;
  }

  signIn(): string {
    return `${this.base}/signin`;
  }

  savedProperties(): string {
    return `${this.base}/saved`;
  }

  forgotPassword(): string {
    return `${this.base}/forgot-password`;
  }

  reportListing(): string {
    return `${this.base}/report-listing`;
  }

  support(): string {
    return `${this.base}/support`;
  }
}
