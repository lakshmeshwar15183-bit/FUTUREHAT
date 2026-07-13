/**
 * Follow System theme resolution + live-sync contracts (WhatsApp-class).
 */
import {
  DEFAULT_THEME_PREFERENCE,
  resolveThemeMode,
  isValidThemePreference,
  normalizeSystemScheme,
} from '../../theme/themeMode';
import * as fs from 'fs';
import * as path from 'path';

describe('DEFAULT_THEME_PREFERENCE', () => {
  it('is Follow System (like WhatsApp)', () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe('system');
  });
});

describe('resolveThemeMode', () => {
  it('follows system light', () => {
    expect(resolveThemeMode('system', 'light')).toBe('light');
  });

  it('follows system dark only when OS reports dark', () => {
    expect(resolveThemeMode('system', 'dark')).toBe('dark');
  });

  it('treats null/undefined system as light (OEM-safe; phone light must stay light)', () => {
    expect(resolveThemeMode('system', null)).toBe('light');
    expect(resolveThemeMode('system', undefined)).toBe('light');
  });

  it('honors forced light/dark/amoled (user Settings choice) and IGNORES OS', () => {
    expect(resolveThemeMode('light', 'dark')).toBe('light');
    expect(resolveThemeMode('dark', 'light')).toBe('dark');
    expect(resolveThemeMode('amoled', 'light')).toBe('amoled');
  });
});

describe('normalizeSystemScheme', () => {
  it('only returns dark for explicit dark', () => {
    expect(normalizeSystemScheme('dark')).toBe('dark');
    expect(normalizeSystemScheme('light')).toBe('light');
    expect(normalizeSystemScheme(null)).toBe('light');
    expect(normalizeSystemScheme(undefined)).toBe('light');
  });
});

describe('isValidThemePreference', () => {
  it('accepts system light dark amoled', () => {
    expect(isValidThemePreference('system')).toBe(true);
    expect(isValidThemePreference('light')).toBe(true);
    expect(isValidThemePreference('dark')).toBe(true);
    expect(isValidThemePreference('amoled')).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isValidThemePreference('')).toBe(false);
    expect(isValidThemePreference('auto')).toBe(false);
    expect(isValidThemePreference(null)).toBe(false);
  });
});

describe('default preference source contract', () => {
  it('ThemeContext defaults via DEFAULT_THEME_PREFERENCE (system)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../theme/ThemeContext.tsx'),
      'utf8',
    );
    expect(src).toMatch(/useState<ThemePreference>\(DEFAULT_THEME_PREFERENCE\)/);
    expect(src).toMatch(/subscribeSystemScheme/);
    // Display mode must not come from server (device-local like WhatsApp).
    expect(src).toMatch(/never display mode/i);
  });

  it('systemScheme bridge listens to native + Appearance + AppState', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../theme/systemScheme.ts'),
      'utf8',
    );
    expect(src).toMatch(/LumixoSystemTheme/);
    expect(src).toMatch(/systemColorSchemeChanged/);
    expect(src).toMatch(/Appearance\.addChangeListener/);
    expect(src).toMatch(/AppState\.addEventListener/);
    expect(src).toMatch(/setSystemChrome/);
  });

  it('app.json uses automatic userInterfaceStyle', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../app.json'),
      'utf8',
    );
    expect(src).toMatch(/"userInterfaceStyle":\s*"automatic"/);
  });

  it('Android MainActivity forwards uiMode config changes', () => {
    const src = fs.readFileSync(
      path.join(
        __dirname,
        '../../../android/app/src/main/java/dev/lakshmeshwar/futurehat/MainActivity.kt',
      ),
      'utf8',
    );
    expect(src).toMatch(/onConfigurationChanged/);
    expect(src).toMatch(/SystemThemeModule\.emitConfiguration/);
    expect(src).toMatch(/onResume/);
  });

  it('AndroidManifest keeps uiMode in configChanges (no activity recreate)', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    expect(src).toMatch(/android:configChanges="[^"]*uiMode/);
  });

  it('does not force dark premium palettes over light mode', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../theme/appearance.ts'),
      'utf8',
    );
    expect(src).toMatch(/base\.isLight/);
    expect(src).toMatch(/keep light surfaces|Light \/ system-light/i);
  });
});
