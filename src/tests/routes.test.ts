import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/database', () => ({
  dbHealthcheck: vi.fn(async () => '2026-01-01T00:00:00Z')
}));

import { createApp } from '../app';

describe('http routes', () => {
  it('returns health status', async () => {
    const app = createApp();
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it('verifies whatsapp webhook challenge', async () => {
    const app = createApp();
    const response = await request(app)
      .get('/api/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'makaug-verify-token', 'hub.challenge': 'abc123' });

    expect(response.status).toBe(200);
    expect(response.text).toBe('abc123');
  });
});
