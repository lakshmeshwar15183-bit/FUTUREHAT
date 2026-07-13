/**
 * OEM detection + guide content (pure module — no RN).
 */
import { getOemGuide, oemFamilyFromBrand, type OemFamily } from '../oemNotifGuides';

const FAMILIES: OemFamily[] = [
  'xiaomi',
  'oppo',
  'vivo',
  'realme',
  'oneplus',
  'samsung',
  'motorola',
  'google',
  'huawei',
  'nothing',
  'other',
  'ios',
];

describe('getOemGuide', () => {
  it('returns steps for every OEM family', () => {
    for (const f of FAMILIES) {
      const g = getOemGuide(f);
      expect(g.family).toBe(f === 'other' ? 'other' : f);
      expect(g.title.length).toBeGreaterThan(4);
      expect(g.body.length).toBeGreaterThan(10);
      expect(g.steps.length).toBeGreaterThan(0);
    }
  });

  it('marks aggressive OEMs that need proactive guidance', () => {
    expect(getOemGuide('xiaomi').aggressive).toBe(true);
    expect(getOemGuide('oppo').aggressive).toBe(true);
    expect(getOemGuide('realme').aggressive).toBe(true);
    expect(getOemGuide('vivo').aggressive).toBe(true);
    expect(getOemGuide('samsung').aggressive).toBe(true);
    expect(getOemGuide('oneplus').aggressive).toBe(true);
    expect(getOemGuide('google').aggressive).toBe(false);
    expect(getOemGuide('nothing').aggressive).toBe(false);
    expect(getOemGuide('motorola').aggressive).toBe(false);
    expect(getOemGuide('other').aggressive).toBe(false);
    expect(getOemGuide('ios').aggressive).toBe(false);
  });

  it('mentions autostart or battery on Chinese OEMs', () => {
    const x = getOemGuide('xiaomi');
    const joined = [...x.steps, x.body].join(' ').toLowerCase();
    expect(
      joined.includes('autostart') || joined.includes('battery') || joined.includes('restrict'),
    ).toBe(true);
  });
});

describe('oemFamilyFromBrand', () => {
  it('maps common brands', () => {
    expect(oemFamilyFromBrand('Xiaomi')).toBe('xiaomi');
    expect(oemFamilyFromBrand('Redmi')).toBe('xiaomi');
    expect(oemFamilyFromBrand('POCO')).toBe('xiaomi');
    expect(oemFamilyFromBrand('Realme')).toBe('realme');
    expect(oemFamilyFromBrand('OPPO')).toBe('oppo');
    expect(oemFamilyFromBrand('vivo')).toBe('vivo');
    expect(oemFamilyFromBrand('iQOO')).toBe('vivo');
    expect(oemFamilyFromBrand('samsung')).toBe('samsung');
    expect(oemFamilyFromBrand('OnePlus')).toBe('oneplus');
    expect(oemFamilyFromBrand('Google')).toBe('google');
    expect(oemFamilyFromBrand('Nothing')).toBe('nothing');
    expect(oemFamilyFromBrand('Motorola')).toBe('motorola');
    expect(oemFamilyFromBrand('unknown-phone')).toBe('other');
  });
});
