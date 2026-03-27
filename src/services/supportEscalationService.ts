import { SUPPORT_CONTACT } from '../utils/constants';

export class SupportEscalationService {
  getFallbackMessage(): string {
    return [
      'I can connect you to human support.',
      `Phone: ${SUPPORT_CONTACT.phone}`,
      `Email: ${SUPPORT_CONTACT.email}`,
      'You can also type: main menu'
    ].join('\n');
  }
}
