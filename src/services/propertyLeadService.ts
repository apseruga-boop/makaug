import { repositories } from '../repositories';

export class PropertyLeadService {
  async create(payload: Record<string, unknown>): Promise<string> {
    return repositories.leads.create(payload);
  }
}
