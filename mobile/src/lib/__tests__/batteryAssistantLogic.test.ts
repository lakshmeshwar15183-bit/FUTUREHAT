/**
 * Pure tests for battery assistant OEM mapping + copy contracts.
 * Does not import batteryAssistant.ts (pulls react-native into Jest).
 */
import {
  oemFamilyFromBrand,
  oemNeedsProactiveBatteryAssist,
  getOemGuide,
} from '../oemNotifGuides';
import * as fs from 'fs';
import * as path from 'path';

describe('battery assistant product copy (source)', () => {
  const assistSrc = fs.readFileSync(path.join(__dirname, '../batteryAssistant.ts'), 'utf8');

  it('defines success and soft-decline copy', () => {
    expect(assistSrc).toMatch(/Background activity enabled/);
    expect(assistSrc).toMatch(/You're all set/);
    expect(assistSrc).toMatch(/may occasionally be delayed/);
    expect(assistSrc).toMatch(/neverAsk/);
    expect(assistSrc).toMatch(/remindAfter/);
  });
});

describe('proactive OEM policy', () => {
  const proactive = ['xiaomi', 'oppo', 'realme', 'vivo', 'oneplus', 'samsung', 'huawei'] as const;
  const quiet = ['google', 'motorola', 'nothing', 'other', 'ios'] as const;

  it('proactive brands need assist', () => {
    for (const f of proactive) {
      expect(oemNeedsProactiveBatteryAssist(f)).toBe(true);
    }
  });

  it('quiet brands do not auto-prompt', () => {
    for (const f of quiet) {
      expect(oemNeedsProactiveBatteryAssist(f)).toBe(false);
    }
  });
});

describe('Realme device detection (user test device)', () => {
  it('maps Realme brand strings', () => {
    expect(oemFamilyFromBrand('realme')).toBe('realme');
    expect(oemFamilyFromBrand('Realme')).toBe('realme');
    expect(getOemGuide('realme').brandLabel).toMatch(/Realme/i);
    expect(getOemGuide('realme').aggressive).toBe(true);
  });
});

describe('BatteryAssistant UI source contracts', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../components/BatteryAssistant.tsx'),
    'utf8',
  );

  it('has Open Settings primary CTA and auto resume check', () => {
    expect(src).toMatch(/Open Settings/);
    expect(src).toMatch(/watchBatteryStatusOnResume/);
    expect(src).toMatch(/Remind me later/);
    expect(src).toMatch(/Don.?t ask again|neverAsk|setBatteryAssistantNeverAsk/);
  });

  it('shows success copy and soft decline path', () => {
    expect(src).toMatch(/BATTERY_SUCCESS_COPY|Background activity enabled/);
    expect(src).toMatch(/BATTERY_SOFT_DECLINE_COPY|You.re all set/);
  });
});
