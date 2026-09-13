import { SHAPES, shapeCollider, shapeDef } from './iso-shapes';

describe('shapeCollider', () => {
  const tile = { tileWidth: 64, tileHeight: 32 };

  it('un cubo bloquea la celda entera, igual que en levels/figuras.json', () => {
    expect(shapeCollider(shapeDef('cube')!, tile)).toEqual({ width: 64, height: 32, solid: true });
  });

  it('un pilar bloquea solo su base angosta', () => {
    expect(shapeCollider(shapeDef('pillar')!, tile)).toEqual({ width: 27, height: 13, solid: true });
  });

  it('las figuras redondas bloquean un poco menos que la casilla', () => {
    expect(shapeCollider(shapeDef('cylinder')!, tile)).toEqual({ width: 52, height: 26, solid: true });
    expect(shapeCollider(shapeDef('sphere')!, tile)).toEqual({ width: 51, height: 26, solid: true });
  });

  it('crece con la cantidad de celdas que ocupa la figura', () => {
    expect(shapeCollider(shapeDef('cube')!, tile, 3)).toEqual({ width: 192, height: 96, solid: true });
    expect(shapeCollider(shapeDef('pillar')!, tile, 2)).toEqual({ width: 54, height: 27, solid: true });
  });

  it('sigue el tamano de tile del nivel', () => {
    expect(shapeCollider(shapeDef('cube')!, { tileWidth: 128, tileHeight: 64 })).toEqual({
      width: 128,
      height: 64,
      solid: true,
    });
  });

  it('toda figura de la paleta tiene una huella de mas de 0 y hasta 1 celda', () => {
    for (const shape of SHAPES) {
      expect(shape.footprint).toBeGreaterThan(0);
      expect(shape.footprint).toBeLessThanOrEqual(1);
    }
  });
});
