import { describe, expect, it } from 'vitest';
import { harnessLoaded } from './index.js';

describe('packages/contract-tests harness', () => {
  it('reports harness loaded', () => {
    expect(harnessLoaded()).toBe(true);
  });
});
