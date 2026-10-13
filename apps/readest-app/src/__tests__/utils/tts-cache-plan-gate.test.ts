import { describe, expect, test } from 'vitest';

import { TTS_CACHE_REQUIRES_PREMIUM, isTTSCacheAllowed, isTTSCacheInPlan } from '@/utils/access';

describe('isTTSCacheInPlan', () => {
  test('any paid plan can use the offline TTS audio cache', () => {
    expect(isTTSCacheInPlan('plus', false)).toBe(true);
    expect(isTTSCacheInPlan('pro', false)).toBe(true);
    // A storage-only buyer reports `purchase` without being entitled.
    expect(isTTSCacheInPlan('purchase', false)).toBe(false);
  });

  test('free plan cannot', () => {
    expect(isTTSCacheInPlan('free', false)).toBe(false);
  });
});

describe('isTTSCacheAllowed (paywall off in this fork)', () => {
  test('downloading TTS audio for offline playback is open to every plan', () => {
    expect(TTS_CACHE_REQUIRES_PREMIUM).toBe(false);
    expect(isTTSCacheAllowed('free', false)).toBe(true);
    expect(isTTSCacheAllowed('plus', false)).toBe(true);
    expect(isTTSCacheAllowed('pro', false)).toBe(true);
    expect(isTTSCacheAllowed('purchase', false)).toBe(true);
  });

  // Upstream also entitles anyone who bought Full Customization outright. With
  // the switch off that distinction cannot change the answer any more, so the
  // invariant worth pinning is that nothing gates the row either way.
  test('the Full Customization purchase makes no difference either way', () => {
    expect(isTTSCacheAllowed('free', true)).toBe(true);
    expect(isTTSCacheAllowed('purchase', true)).toBe(true);
  });

  // The plan membership helper is what the switch gates; keep it honest so
  // flipping the switch back on restores the upstream behaviour intact,
  // customization unlock included.
  test('plan membership is unchanged by the switch', () => {
    expect(isTTSCacheInPlan('free', false)).toBe(false);
    expect(isTTSCacheInPlan('plus', false)).toBe(true);
    expect(isTTSCacheInPlan('free', true)).toBe(true);
    expect(isTTSCacheInPlan('purchase', false)).toBe(false);
  });
});
