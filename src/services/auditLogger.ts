import { repositories } from '../repositories';

export class AuditLogger {
  async log(actorId: string | null, action: string, details: Record<string, unknown>) {
    await repositories.audit.add(actorId, action, details);
  }
}
