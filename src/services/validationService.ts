const UGANDA_PHONE_REGEX = /^(?:\+256|256|0)7\d{8}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NIN_REGEX = /^[A-Z0-9]{8,16}$/i;

export class ValidationService {
  sanitize(text: string): string {
    return text.replace(/[<>]/g, '').trim();
  }

  isValidUgandaPhone(phone: string): boolean {
    return UGANDA_PHONE_REGEX.test(phone.replace(/\s+/g, ''));
  }

  normalizeUgandaPhone(phone: string): string {
    const clean = phone.replace(/\s+/g, '');
    if (clean.startsWith('+256')) return clean;
    if (clean.startsWith('256')) return `+${clean}`;
    if (clean.startsWith('0')) return `+256${clean.slice(1)}`;
    return clean;
  }

  isValidEmail(email: string): boolean {
    return EMAIL_REGEX.test(email.trim());
  }

  isValidNin(nin: string): boolean {
    return NIN_REGEX.test(nin.trim());
  }

  isNumberLike(value: string): boolean {
    return /^\d+(?:\.\d+)?$/.test(value.trim());
  }

  parseCurrency(value: string): number | null {
    const numeric = Number(value.replace(/[^0-9.]/g, ''));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }
}
