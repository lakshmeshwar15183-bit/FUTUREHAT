/**
 * Pure OEM notification guidance (Jest-friendly — no React Native imports).
 */

export type OemFamily =
  | 'xiaomi'
  | 'oppo'
  | 'vivo'
  | 'realme'
  | 'oneplus'
  | 'samsung'
  | 'motorola'
  | 'google'
  | 'huawei'
  | 'other'
  | 'ios';

export interface OemGuide {
  family: OemFamily;
  brandLabel: string;
  aggressive: boolean;
  title: string;
  body: string;
  steps: string[];
}

export function getOemGuide(family: OemFamily): OemGuide {
  switch (family) {
    case 'xiaomi':
      return {
        family,
        brandLabel: 'Xiaomi / Redmi / POCO',
        aggressive: true,
        title: 'Allow Lumixo to run in the background',
        body: 'Xiaomi devices often pause apps. Without these settings, messages may not arrive when Lumixo is closed.',
        steps: [
          'Open App info → Battery saver → No restrictions',
          'Enable Autostart for Lumixo',
          'Lock Lumixo in Recents (pull down the card) so it is not cleared',
        ],
      };
    case 'oppo':
    case 'realme':
      return {
        family,
        brandLabel: family === 'realme' ? 'Realme' : 'OPPO',
        aggressive: true,
        title: 'Allow background activity',
        body: 'This phone may stop Lumixo after a few minutes. Turn off battery restrictions so calls and messages still ring.',
        steps: [
          'App info → Battery → Allow background activity',
          'Disable any “Optimize battery use” for Lumixo',
          'Allow Autostart if shown',
        ],
      };
    case 'vivo':
      return {
        family,
        brandLabel: 'vivo',
        aggressive: true,
        title: 'Keep Lumixo active',
        body: 'vivo may restrict background apps. Allow high background power consumption for reliable notifications.',
        steps: [
          'App info → Battery → High background power consumption → Allow',
          'Enable Autostart if available',
        ],
      };
    case 'oneplus':
      return {
        family,
        brandLabel: 'OnePlus',
        aggressive: true,
        title: 'Disable battery optimization',
        body: 'OnePlus OxygenOS can delay or drop notifications for optimized apps.',
        steps: [
          'App info → Battery usage → Don’t optimize / Unrestricted',
          'Turn off Advanced optimization for Lumixo if present',
        ],
      };
    case 'samsung':
      return {
        family,
        brandLabel: 'Samsung',
        aggressive: true,
        title: 'Allow unrestricted battery',
        body: 'Samsung’s Adaptive battery can pause apps you open less often.',
        steps: [
          'App info → Battery → Unrestricted',
          'Settings → Apps → Lumixo → remove from Sleeping apps / Deep sleeping apps',
        ],
      };
    case 'motorola':
      return {
        family,
        brandLabel: 'Motorola',
        aggressive: false,
        title: 'Battery optimization',
        body: 'Set Lumixo to unrestricted battery so alerts still arrive when the app is closed.',
        steps: ['App info → Battery → Unrestricted'],
      };
    case 'huawei':
      return {
        family,
        brandLabel: 'Huawei / Honor',
        aggressive: true,
        title: 'Manual manage launch',
        body: 'Huawei may block background work unless launch is managed manually.',
        steps: [
          'App launch → Manage manually → enable Auto-launch, Secondary launch, Run in background',
        ],
      };
    case 'google':
      return {
        family,
        brandLabel: 'Google Pixel',
        aggressive: false,
        title: 'Unrestricted battery (optional)',
        body: 'Pixels usually deliver FCM well. If notifications lag, set battery to Unrestricted.',
        steps: ['App info → App battery usage → Unrestricted'],
      };
    case 'ios':
      return {
        family,
        brandLabel: 'iPhone',
        aggressive: false,
        title: 'Allow notifications',
        body: 'iOS delivers push alerts when notifications are allowed for Lumixo.',
        steps: ['Settings → Lumixo → Notifications → Allow Notifications'],
      };
    default:
      return {
        family: 'other',
        brandLabel: 'Android',
        aggressive: true,
        title: 'Background battery',
        body: 'Some phones pause apps to save battery. Allow unrestricted battery so Lumixo can notify you when closed.',
        steps: ['App info → Battery → Unrestricted / No restrictions'],
      };
  }
}

/** Map manufacturer/brand string → family. */
export function oemFamilyFromBrand(brandRaw: string): OemFamily {
  const b = brandRaw.trim().toLowerCase();
  if (!b) return 'other';
  if (/xiaomi|redmi|poco|mi\b/.test(b)) return 'xiaomi';
  if (/oppo/.test(b)) return 'oppo';
  if (/vivo/.test(b)) return 'vivo';
  if (/realme/.test(b)) return 'realme';
  if (/oneplus|one plus/.test(b)) return 'oneplus';
  if (/samsung/.test(b)) return 'samsung';
  if (/motorola|moto/.test(b)) return 'motorola';
  if (/google|pixel/.test(b)) return 'google';
  if (/huawei|honor/.test(b)) return 'huawei';
  return 'other';
}
