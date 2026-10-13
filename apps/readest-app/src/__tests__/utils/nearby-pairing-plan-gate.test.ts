import { describe, expect, test } from 'vitest';

import {
  NEARBY_PAIRING_REQUIRES_PREMIUM,
  isNearbyPairingAllowed,
  isNearbyPairingInPlan,
} from '@/utils/access';

describe('isNearbyPairingInPlan', () => {
  test('any paid plan can pair Nearby BookDrop devices', () => {
    expect(isNearbyPairingInPlan('plus', false)).toBe(true);
    expect(isNearbyPairingInPlan('pro', false)).toBe(true);
    // A storage-only buyer reports `purchase` without being entitled.
    expect(isNearbyPairingInPlan('purchase', false)).toBe(false);
  });

  test('free plan cannot', () => {
    expect(isNearbyPairingInPlan('free', false)).toBe(false);
  });
});

describe('isNearbyPairingAllowed (paywall off in this fork)', () => {
  test('pairing for confirmation-free drops is open to every plan', () => {
    expect(NEARBY_PAIRING_REQUIRES_PREMIUM).toBe(false);
    expect(isNearbyPairingAllowed('free', false)).toBe(true);
    expect(isNearbyPairingAllowed('plus', false)).toBe(true);
    expect(isNearbyPairingAllowed('pro', false)).toBe(true);
    expect(isNearbyPairingAllowed('purchase', false)).toBe(true);
  });

  test('the Full Customization purchase makes no difference either way', () => {
    expect(isNearbyPairingAllowed('free', true)).toBe(true);
    expect(isNearbyPairingAllowed('purchase', true)).toBe(true);
  });

  // The plan membership helper is what the switch gates; keep it honest so
  // flipping the switch back on restores the upstream behaviour intact.
  test('plan membership is unchanged by the switch', () => {
    expect(isNearbyPairingInPlan('free', false)).toBe(false);
    expect(isNearbyPairingInPlan('plus', false)).toBe(true);
    expect(isNearbyPairingInPlan('free', true)).toBe(true);
  });
});
