import { describe, expect, test } from 'vitest';

import {
  ABS_OFFLINE_REQUIRES_PREMIUM,
  isAbsOfflineAllowed,
  isAbsOfflineInPlan,
} from '@/utils/access';

describe('isAbsOfflineInPlan', () => {
  test('any paid plan can download Audiobookshelf books for offline use', () => {
    expect(isAbsOfflineInPlan('plus', false)).toBe(true);
    expect(isAbsOfflineInPlan('pro', false)).toBe(true);
    // A storage-only buyer reports `purchase` without being entitled.
    expect(isAbsOfflineInPlan('purchase', false)).toBe(false);
  });

  test('free plan cannot', () => {
    expect(isAbsOfflineInPlan('free', false)).toBe(false);
  });
});

describe('isAbsOfflineAllowed (paywall off in this fork)', () => {
  test('offline Audiobookshelf downloads are open to every plan', () => {
    expect(ABS_OFFLINE_REQUIRES_PREMIUM).toBe(false);
    expect(isAbsOfflineAllowed('free', false)).toBe(true);
    expect(isAbsOfflineAllowed('plus', false)).toBe(true);
    expect(isAbsOfflineAllowed('pro', false)).toBe(true);
    expect(isAbsOfflineAllowed('purchase', false)).toBe(true);
  });

  test('the Full Customization purchase makes no difference either way', () => {
    expect(isAbsOfflineAllowed('free', true)).toBe(true);
    expect(isAbsOfflineAllowed('purchase', true)).toBe(true);
  });

  // The plan membership helper is what the switch gates; keep it honest so
  // flipping the switch back on restores the upstream behaviour intact.
  test('plan membership is unchanged by the switch', () => {
    expect(isAbsOfflineInPlan('free', false)).toBe(false);
    expect(isAbsOfflineInPlan('plus', false)).toBe(true);
    expect(isAbsOfflineInPlan('free', true)).toBe(true);
  });
});
