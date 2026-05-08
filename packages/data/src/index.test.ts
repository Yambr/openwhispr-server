import { describe, expect, it } from 'vitest';
import { isPlaceholder } from './index.js';

describe('packages/data placeholder', () => {
  it('returns true', () => {
    expect(isPlaceholder()).toBe(true);
  });
});
