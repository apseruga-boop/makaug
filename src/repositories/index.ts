import { env } from '../config/env';
import { MockAgentAdapter } from './mock/mockAgentAdapter';
import { MockPropertyAdapter } from './mock/mockPropertyAdapter';
import { PostgresAgentAdapter } from './postgres/postgresAgentAdapter';
import { AgentApplicationRepository } from './postgres/agentApplicationRepository';
import { AuditLogRepository } from './postgres/auditLogRepository';
import { LeadRepository } from './postgres/leadRepository';
import { ListingRepository } from './postgres/listingRepository';
import { MessageRepository } from './postgres/messageRepository';
import { MortgageRepository } from './postgres/mortgageRepository';
import { OtpRepository } from './postgres/otpRepository';
import { PostgresPropertyAdapter } from './postgres/postgresPropertyAdapter';
import { ReportRepository } from './postgres/reportRepository';
import { SearchRepository } from './postgres/searchRepository';
import { PostgresSessionRepository } from './postgres/sessionRepository';
import { TranscriptionRepository } from './postgres/transcriptionRepository';

const propertyAdapter = env.useMockRepos ? new MockPropertyAdapter() : new PostgresPropertyAdapter();
const agentAdapter = env.useMockRepos ? new MockAgentAdapter() : new PostgresAgentAdapter();

export const repositories = {
  propertyAdapter,
  agentAdapter,
  sessions: new PostgresSessionRepository(),
  messages: new MessageRepository(),
  listing: new ListingRepository(),
  search: new SearchRepository(),
  otp: new OtpRepository(),
  leads: new LeadRepository(),
  reports: new ReportRepository(),
  mortgage: new MortgageRepository(),
  agentApplications: new AgentApplicationRepository(),
  transcriptions: new TranscriptionRepository(),
  audit: new AuditLogRepository()
};

export type Repositories = typeof repositories;
