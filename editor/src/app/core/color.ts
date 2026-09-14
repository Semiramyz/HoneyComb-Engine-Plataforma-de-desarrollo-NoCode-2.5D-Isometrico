// Conversiones de color del selector de fondo (panel "Fondo y colores").
// Aparte de app.ts para poder testearlas sin levantar el componente.

import { RgbColor } from '../models/level.model';

/** Tono en grados [0, 360]; saturacion y brillo en [0, 1]. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** Entero de 0 a 255, que es lo que exige el schema. Basura (NaN) = 0. */
export function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value))) || 0;
}

export function hsvToRgb({ h, s, v }: Hsv): RgbColor {
  const channel = (offset: number) => {
    const k = (offset + h / 60) % 6;
    return clampChannel((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return { r: channel(5), g: channel(3), b: channel(1) };
}

/**
 * Un gris no tiene tono propio: ahi se devuelve "fallbackHue", para que el
 * selector no pierda el tono que se venia usando al pasar por el blanco o el negro.
 */
export function rgbToHsv({ r, g, b }: RgbColor, fallbackHue = 0): Hsv {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const chroma = max - Math.min(red, green, blue);

  let h = fallbackHue;
  if (chroma > 0) {
    if (max === red) {
      h = 60 * (((green - blue) / chroma) % 6);
    } else if (max === green) {
      h = 60 * ((blue - red) / chroma + 2);
    } else {
      h = 60 * ((red - green) / chroma + 4);
    }
    if (h < 0) {
      h += 360;
    }
  }
  return { h, s: max === 0 ? 0 : chroma / max, v: max };
}

export function rgbToHex({ r, g, b }: RgbColor): string {
  return '#' + [r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('');
}

/** Acepta "#rrggbb" o "rrggbb". Cualquier otra cosa = null. */
export function hexToRgb(text: string): RgbColor | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(text.trim());
  if (!match) {
    return null;
  }
  const value = parseInt(match[1], 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}
