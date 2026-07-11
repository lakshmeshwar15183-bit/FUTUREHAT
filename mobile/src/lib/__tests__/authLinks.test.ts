/**
 * P0 smoke: password-reset helpers never embed localhost when SITE_URL is set.
 */
jest.mock('react-native', () => ({
  Platform: { OS: 'android', select: (o: any) => o.android },
}));

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `futurehat://${path}`,
}));

jest.mock('expo-constants', () => ({
  appOwnership: 'standalone',
  expoConfig: { extra: {} },
}));

describe('resetPasswordRedirectUrl', () => {
  const OLD = process.env.EXPO_PUBLIC_SITE_URL;

  afterEach(() => {
    if (OLD === undefined) delete process.env.EXPO_PUBLIC_SITE_URL;
    else process.env.EXPO_PUBLIC_SITE_URL = OLD;
    jest.resetModules();
  });

  it('prefers HTTPS site URL when set', () => {
    process.env.EXPO_PUBLIC_SITE_URL = 'https://futurehat-app.netlify.app';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resetPasswordRedirectUrl } = require('../authLinks');
    const url = resetPasswordRedirectUrl() as string;
    expect(url).toBe('https://futurehat-app.netlify.app/reset-password');
    expect(url).not.toMatch(/localhost|127\.0\.0\.1|exp:\/\//i);
  });

  it('strips trailing slash on site URL', () => {
    process.env.EXPO_PUBLIC_SITE_URL = 'https://futurehat-app.netlify.app/';
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resetPasswordSiteUrl } = require('../authLinks');
    expect(resetPasswordSiteUrl()).toBe('https://futurehat-app.netlify.app/reset-password');
  });

  it('falls back to app scheme when site URL unset', () => {
    delete process.env.EXPO_PUBLIC_SITE_URL;
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resetPasswordRedirectUrl } = require('../authLinks');
    const url = resetPasswordRedirectUrl() as string;
    expect(url).toMatch(/^futurehat:\/\//);
    expect(url).not.toMatch(/localhost|exp:\/\//i);
  });
});

describe('parseRecoveryLink', () => {
  it('parses fragment tokens', () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parseRecoveryLink } = require('../authLinks');
    const r = parseRecoveryLink(
      'https://example.com/reset-password#access_token=aaa&refresh_token=bbb&type=recovery',
    );
    expect(r).toEqual({ accessToken: 'aaa', refreshToken: 'bbb' });
  });

  it('returns null for non-recovery links', () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { parseRecoveryLink } = require('../authLinks');
    expect(parseRecoveryLink('https://example.com/')).toBeNull();
  });
});
