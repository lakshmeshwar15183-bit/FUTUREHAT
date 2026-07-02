// FUTUREHAT mobile — theme barrel.
export { palettes, spacing, radius, font } from './palettes';
export type { Palette, ThemeMode } from './palettes';
export {
  ThemeProvider,
  useTheme,
  useColors,
  type ThemePreference,
} from './ThemeContext';
export {
  COLOR_THEMES,
  WALLPAPERS,
  resolveThemePalette,
  resolveWallpaperColor,
  type ColorTheme,
  type Wallpaper,
} from './appearance';
