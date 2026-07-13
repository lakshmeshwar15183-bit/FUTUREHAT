/**
 * P0: app icon switching must never kill the session / restart activity.
 */
import * as fs from 'fs';
import * as path from 'path';

describe('AppIcon native module safety contract', () => {
  const kt = fs.readFileSync(
    path.join(
      __dirname,
      '../../../android/app/src/main/java/dev/lakshmeshwar/futurehat/AppIconModule.kt',
    ),
    'utf8',
  );
  const plugin = fs.readFileSync(
    path.join(__dirname, '../../../plugins/withAppIcons.js'),
    'utf8',
  );
  const js = fs.readFileSync(path.join(__dirname, '../appIcon.ts'), 'utf8');

  it('uses DONT_KILL_APP when toggling components', () => {
    expect(kt).toMatch(/DONT_KILL_APP/);
  });

  it('enables target before disabling others', () => {
    // Enable call must appear before the disable loop in setIcon.
    const setIcon = kt.slice(kt.indexOf('fun setIcon'));
    const enableIdx = setIcon.indexOf('COMPONENT_ENABLED_STATE_ENABLED');
    const disableIdx = setIcon.indexOf('COMPONENT_ENABLED_STATE_DISABLED');
    expect(enableIdx).toBeGreaterThan(-1);
    expect(disableIdx).toBeGreaterThan(-1);
    expect(enableIdx).toBeLessThan(disableIdx);
  });

  it('no-ops when icon already active', () => {
    expect(kt).toMatch(/activeIconId/);
    expect(kt).toMatch(/if \(current == target\)|if \(activeIconId\(pm\) == target\)/);
  });

  it('plugin template stays enable-first', () => {
    expect(plugin).toMatch(/Enable replacement first|ENABLE the target|Enable the new launcher/i);
    expect(plugin).toMatch(/DONT_KILL_APP/);
  });

  it('JS hydrate skips when already matching', () => {
    expect(js).toMatch(/if \(current === stored\) return/);
  });

  it('JS setAppIcon never throws; shows soft Android toast', () => {
    expect(js).toMatch(/ToastAndroid/);
    expect(js).toMatch(/Launcher icon updated/);
    expect(js).toMatch(/catch/);
  });

  it('Appearance pickAppIcon does not Alert on soft success', () => {
    const appearance = fs.readFileSync(
      path.join(__dirname, '../../screens/AppearanceScreen.tsx'),
      'utf8',
    );
    expect(appearance).toMatch(/Optimistic UI/);
    // Hard failure only
    expect(appearance).toMatch(/if \(!result\.ok && result\.error\)/);
  });
});

describe('Settings footer layout contract', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '../../screens/SettingsScreen.tsx'),
    'utf8',
  );

  it('uses a dedicated aboutFooter stack with clipped mascot box', () => {
    expect(src).toMatch(/aboutFooter/);
    expect(src).toMatch(/overflow:\s*['"]hidden['"]/);
    expect(src).toMatch(/size="xs"/);
  });

  it('applies safe-area aware footer padding', () => {
    expect(src).toMatch(/useSafeAreaInsets/);
    expect(src).toMatch(/footerPad/);
  });

  it('keeps credit and version as separate non-overlapping nodes', () => {
    expect(src).toMatch(/styles\.credit/);
    expect(src).toMatch(/styles\.version/);
    expect(src).toMatch(/numberOfLines=\{1\}/);
  });
});
