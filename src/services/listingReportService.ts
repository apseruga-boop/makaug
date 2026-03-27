import { repositories } from '../repositories';

export class ListingReportService {
  async create(payload: Record<string, unknown>): Promise<string> {
    return repositories.reports.create(payload);
  }
}
