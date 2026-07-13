// Lumixo mobile — theme barrel (design system + motion).
export {
  palettes,
  spacing,
  radius,
  font,
  elevation,
  iconSize,
  touch,
  density,
  lineHeight,
} from './palettes';
export type { Palette, ThemeMode } from './palettes';
export {
  motion,
  ease,
  timingOpen,
  timingClose,
  timingSheetOpen,
  timingSheetClose,
  animateLayoutSoft,
  enableLayoutAnimations,
  listPerf,
} from './motion';
export {
  ThemeProvider,
  useTheme,
  useColors,
} from './ThemeContext';
export {
  resolveThemeMode,
  isValidThemePreference,
  type ThemePreference,
} from './themeMode';
export {
  COLOR_THEMES,
  WALLPAPERS,
  resolveThemePalette,
  resolveWallpaperColor,
  type ColorTheme,
  type Wallpaper,
} from './appearance';
