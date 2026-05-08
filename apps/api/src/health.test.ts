import { describe, expect, it } from 'vitest';
import { buildApp } from './index.js';

describe('GET /api/health', () => {
  it('returns 200 with phase-0-placeholder status', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'phase-0-placeholder' });
    await app.close();
  });
});
