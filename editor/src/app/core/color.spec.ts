import { clampChannel, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from './color';

describe('hsvToRgb', () => {
  it('convierte los colores puros', () => {
    expect(hsvToRgb({ h: 0, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb({ h: 120, s: 1, v: 1 })).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsvToRgb({ h: 240, s: 1, v: 1 })).toEqual({ r: 0, g: 0, b: 255 });
  });

  it('trata 360 grados igual que 0', () => {
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('sin saturacion da un gris del brillo pedido', () => {
    expect(hsvToRgb({ h: 200, s: 0, v: 0.5 })).toEqual({ r: 128, g: 128, b: 128 });
  });
});

describe('rgbToHsv', () => {
  it('vuelve al mismo RGB', () => {
    const color = { r: 52, g: 101, b: 164 };
    expect(hsvToRgb(rgbToHsv(color))).toEqual(color);
  });

  it('en un gris conserva el tono que se le pasa', () => {
    expect(rgbToHsv({ r: 90, g: 90, b: 90 }, 210).h).toBe(210);
  });

  it('el negro no tiene saturacion', () => {
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
  });
});

describe('hex', () => {
  it('rellena con ceros cada canal', () => {
    expect(rgbToHex({ r: 5, g: 0, b: 255 })).toBe('#0500ff');
  });

  it('lee con y sin numeral', () => {
    expect(hexToRgb('#F5f5F5')).toEqual({ r: 245, g: 245, b: 245 });
    expect(hexToRgb('102030')).toEqual({ r: 16, g: 32, b: 48 });
  });

  it('rechaza lo que no es un color de 6 digitos', () => {
    expect(hexToRgb('#fff')).toBeNull();
    expect(hexToRgb('azul')).toBeNull();
  });
});

describe('clampChannel', () => {
  it('redondea y recorta a 0..255', () => {
    expect(clampChannel(300)).toBe(255);
    expect(clampChannel(-4)).toBe(0);
    expect(clampChannel(12.6)).toBe(13);
    expect(clampChannel(NaN)).toBe(0);
  });
});
