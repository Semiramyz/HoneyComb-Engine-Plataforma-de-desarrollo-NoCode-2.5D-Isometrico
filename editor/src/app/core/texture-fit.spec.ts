import { fitTextureSize, usesNearestNeighbor } from './texture-fit';

describe('fitTextureSize', () => {
  it('no toca una imagen que ya entra en el tile', () => {
    expect(fitTextureSize(32, 16, 64)).toEqual({ width: 32, height: 16, scaled: false });
  });

  it('deja igual una imagen justo del ancho del tile', () => {
    expect(fitTextureSize(64, 64, 64)).toEqual({ width: 64, height: 64, scaled: false });
  });

  it('reduce una captura de pantalla conservando la proporcion', () => {
    expect(fitTextureSize(2377, 1837, 64)).toEqual({ width: 64, height: 49, scaled: true });
  });

  it('usa el lado mas largo aunque sea el alto', () => {
    expect(fitTextureSize(100, 400, 64)).toEqual({ width: 16, height: 64, scaled: true });
  });

  it('nunca deja un lado en cero', () => {
    expect(fitTextureSize(10, 5000, 64)).toEqual({ width: 1, height: 64, scaled: true });
  });
});

describe('usesNearestNeighbor', () => {
  it('conserva los bordes duros del pixel art reducido a la mitad', () => {
    expect(usesNearestNeighbor(128, fitTextureSize(128, 128, 64))).toBe(true);
  });

  it('suaviza una captura reducida muchas veces', () => {
    expect(usesNearestNeighbor(2377, fitTextureSize(2377, 1837, 64))).toBe(false);
  });

  it('suaviza aunque el factor sea entero si es grande', () => {
    expect(usesNearestNeighbor(512, fitTextureSize(512, 512, 64))).toBe(false);
  });
});
