import { describe, expect, it } from 'vitest';
import { isPlaceholder } from './index.js';

describe('packages/litellm-client placeholder', () => {
  it('returns true', () => {
    expect(isPlaceholder()).toBe(true);
  });
});
