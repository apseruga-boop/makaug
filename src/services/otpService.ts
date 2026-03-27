import twilio from 'twilio';
import { env } from '../config/env';
import { OtpRepository } from '../repositories/postgres/otpRepository';

export class OtpService {
  private readonly repo: OtpRepository;
  private readonly twilioClient = env.twilioSid && env.twilioToken ? twilio(env.twilioSid, env.twilioToken) : null;

  constructor(repo = new OtpRepository()) {
    this.repo = repo;
  }

  private generateOtp(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  async sendOtp(phone: string): Promise<void> {
    const code = this.generateOtp();
    await this.repo.create(phone, code, 10);

    if (!env.otpEnabled) return;

    if (this.twilioClient && env.twilioFrom) {
      await this.twilioClient.messages.create({
        to: phone,
        from: env.twilioFrom,
        body: `MakaUg verification code: ${code}. Valid for 10 minutes.`
      });
      return;
    }

    // eslint-disable-next-line no-console
    console.log(`[OTP] ${phone}: ${code}`);
  }

  async resendOtp(phone: string): Promise<void> {
    await this.sendOtp(phone);
  }

  async verifyOtp(phone: string, code: string): Promise<boolean> {
    if (code === env.otpBypassCode && env.nodeEnv !== 'production') return true;
    return this.repo.verify(phone, code);
  }
}
