import { describe, it, expect, vi, afterEach } from 'vitest';
import { jwtDecode } from 'jwt-decode';
import {
  CUSTOM_TRANSLATOR_REQUIRES_PREMIUM,
  getCustomizationPurchased,
  isCustomizationAllowed,
  isCustomTranslatorAllowed,
  isCustomTranslatorInPlan,
  isSelfHosted,
} from '@/utils/access';

vi.mock('jwt-decode', () => ({ jwtDecode: vi.fn() }));

const mockToken = (claims: Record<string, unknown>) => {
  (jwtDecode as unknown as ReturnType<typeof vi.fn>).mockReturnValue(claims);
  return 'token';
};

describe('getCustomizationPurchased', () => {
  it('reads the claim minted by custom_access_token_hook', () => {
    expect(getCustomizationPurchased(mockToken({ customization_purchased: true }))).toBe(true);
  });

  it('is false when the claim is absent, so old tokens do not unlock it', () => {
    expect(getCustomizationPurchased(mockToken({ plan: 'free' }))).toBe(false);
  });
});

describe('isCustomizationAllowed', () => {
  it('allows an explicit purchase on any plan', () => {
    expect(isCustomizationAllowed('free', true)).toBe(true);
  });

  it('allows subscription tiers without a separate purchase', () => {
    expect(isCustomizationAllowed('plus', false)).toBe(true);
    expect(isCustomizationAllowed('pro', false)).toBe(true);
  });

  // `getUserProfilePlan` reports 'purchase' for anyone holding ANY one-time
  // purchase, which is how a storage add-on presents. Treating that as
  // entitlement would hand Full Customization to every storage buyer.
  it('does not treat a storage-only buyer as entitled', () => {
    expect(isCustomizationAllowed('purchase', false)).toBe(false);
  });

  it('denies a free user who has not bought it', () => {
    expect(isCustomizationAllowed('free', false)).toBe(false);
  });
});

// A self-hosted deployment has no store to buy from, and the operator already
// runs the infrastructure the paywall funds, so everything is unlocked.
describe('self-hosted deployments', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is off by default', () => {
    expect(isSelfHosted()).toBe(false);
  });

  it('unlocks premium for a signed-in free user with no purchase', () => {
    vi.stubEnv('SELF_HOSTED', 'true');
    expect(isCustomizationAllowed('free', false)).toBe(true);
  });

  it('unlocks premium with no login at all, where the plan reads free', () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true');
    expect(isCustomizationAllowed('free', false)).toBe(true);
  });

  // `??` stops at an empty string, so a blank SELF_HOSTED would mask the
  // public variable and silently re-lock a self-hosted deployment.
  it('falls through an explicitly empty SELF_HOSTED', () => {
    vi.stubEnv('SELF_HOSTED', '');
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true');
    expect(isSelfHosted()).toBe(true);
  });
});

// Upstream's plan membership for custom translators (the user's own LLM
// endpoint or DeepL key). The reader decides from the session token alone, so
// a signed-out reader is locked unless the deployment is self-hosted. This is
// what CUSTOM_TRANSLATOR_REQUIRES_PREMIUM gates; keep it honest so flipping
// the switch back on restores upstream behaviour intact.
describe('isCustomTranslatorInPlan', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows a subscriber', () => {
    expect(isCustomTranslatorInPlan(mockToken({ plan: 'plus' }))).toBe(true);
  });

  it('allows a free user who bought Full Customization', () => {
    expect(isCustomTranslatorInPlan(mockToken({ customization_purchased: true }))).toBe(true);
  });

  it('denies a free user and a storage-only buyer', () => {
    expect(isCustomTranslatorInPlan(mockToken({ plan: 'free' }))).toBe(false);
    expect(
      isCustomTranslatorInPlan(mockToken({ plan: 'free', storage_purchased_bytes: 1e9 })),
    ).toBe(false);
  });

  it('denies a signed-out reader', () => {
    expect(isCustomTranslatorInPlan(null)).toBe(false);
  });

  it('allows a signed-out reader on a self-hosted deployment', () => {
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED', 'true');
    expect(isCustomTranslatorInPlan(null)).toBe(true);
  });
});

// The paywall is off in this fork: a custom translator runs on the user's own
// API key and talks to the provider straight from the device.
describe('isCustomTranslatorAllowed (paywall off in this fork)', () => {
  it('is open to every plan, signed in or not', () => {
    expect(CUSTOM_TRANSLATOR_REQUIRES_PREMIUM).toBe(false);
    expect(isCustomTranslatorAllowed(mockToken({ plan: 'free' }))).toBe(true);
    expect(isCustomTranslatorAllowed(mockToken({ plan: 'plus' }))).toBe(true);
    expect(isCustomTranslatorAllowed(null)).toBe(true);
  });
});
