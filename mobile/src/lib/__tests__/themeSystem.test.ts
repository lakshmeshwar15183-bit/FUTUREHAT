/**
 * Follow System theme resolution (WhatsApp-class default).
 */
import { resolveThemeMode, isValidThemePreference } from '../../theme/themeMode';
import * as fs from 'fs';
import * as path from 'path';

describe('resolveThemeMode', () => {
  it('follows system light', () => {
    expect(resolveThemeMode('system', 'light')).toBe('light');
  });

  it('follows system dark', () => {
    expect(resolveThemeMode('system', 'dark')).toBe('dark');
  });

  it('treats null system as dark (safe OLED default)', () => {
    expect(resolveThemeMode('system', null)).toBe('dark');
  });

  it('honors forced light/dark/amoled', () => {
    expect(resolveThemeMode('light', 'dark')).toBe('light');
    expect(resolveThemeMode('dark', 'light')).toBe('dark');
    expect(resolveThemeMode('amoled', 'light')).toBe('amoled');
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
  it('ThemeContext defaults to system not dark', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../theme/ThemeContext.tsx'),
      'utf8',
    );
    expect(src).toMatch(/useState<ThemePreference>\('system'\)/);
    expect(src).toMatch(/Appearance\.addChangeListener/);
  });

  it('app.json uses automatic userInterfaceStyle', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../../app.json'),
      'utf8',
    );
    expect(src).toMatch(/"userInterfaceStyle":\s*"automatic"/);
  });
});
