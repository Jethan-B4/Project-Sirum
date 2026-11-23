// Color helpers for adaptive foreground selection.

function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Choose the foreground with the higher contrast against a solid background. */
export function contrastText(bg: string): string {
  const luminance = relativeLuminance(bg) + 0.05;
  return luminance / 0.05 >= 1.05 / luminance ? '#000000' : '#ffffff';
}

/** Select a blue suited to the reader's own background, including custom themes. */
export function linkColor(bg: string): string {
  const background = relativeLuminance(bg) + 0.05;
  const dark = '#00266b';
  const light = '#9ecaff';
  if (background / (relativeLuminance(dark) + 0.05) >= 4.5) return dark;
  if ((relativeLuminance(light) + 0.05) / background >= 4.5) return light;
  const navy = '#000019';
  return background / (relativeLuminance(navy) + 0.05) >= 4.5 ? navy : '#fafdff';
}
