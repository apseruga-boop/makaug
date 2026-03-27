import { UrlBuilderService } from './urlBuilderService';

export class AccountHelpService {
  constructor(private readonly urls = new UrlBuilderService()) {}

  getLinks(): Record<string, string> {
    return {
      signIn: this.urls.signIn(),
      account: this.urls.account(),
      saved: this.urls.savedProperties(),
      forgot: this.urls.forgotPassword()
    };
  }

  getMessage(): string {
    const links = this.getLinks();
    return [
      'Account help:',
      `• Sign in: ${links.signIn}`,
      `• Create account: ${links.account}`,
      `• Saved properties: ${links.saved}`,
      `• Forgot password: ${links.forgot}`
    ].join('\n');
  }
}
