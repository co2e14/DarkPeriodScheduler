function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  return rgb ? `rgba(${rgb.join(', ')}, ${alpha})` : hex;
}

/** Black or white, whichever reads better on the given background. */
export function readableText(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return '#fff';
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? '#1a1b1e' : '#ffffff';
}

export const STAGE_PALETTE = [
  '#4c6ef5', '#12b886', '#fab005', '#fd7e14', '#e64980',
  '#be4bdb', '#15aabf', '#40c057', '#7950f2', '#fa5252',
];
