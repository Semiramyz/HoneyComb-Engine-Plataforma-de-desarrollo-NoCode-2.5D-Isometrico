import { blockCenter, blocksOverlap, clampBlockPosition, entitySpan } from './entity-blocks';

const at = (col: number, row: number, span?: number) => ({ position: { col, row }, span });

describe('entitySpan', () => {
  it('sin span ocupa una casilla', () => {
    expect(entitySpan({})).toBe(1);
  });

  it('un valor invalido cuenta como 1, igual que en el motor', () => {
    expect(entitySpan({ span: 0 })).toBe(1);
    expect(entitySpan({ span: -3 })).toBe(1);
  });
});

describe('blockCenter', () => {
  it('con span 1 es la misma celda', () => {
    expect(blockCenter(at(2, 5))).toEqual({ col: 2, row: 5 });
  });

  it('con span par cae entre dos celdas', () => {
    expect(blockCenter(at(2, 2, 2))).toEqual({ col: 2.5, row: 2.5 });
  });

  it('con span 3 es la celda del medio del bloque', () => {
    expect(blockCenter(at(2, 2, 3))).toEqual({ col: 3, row: 3 });
  });
});

describe('blocksOverlap', () => {
  it('dos casillas iguales se superponen', () => {
    expect(blocksOverlap(at(1, 1), at(1, 1))).toBe(true);
  });

  it('casillas vecinas no se superponen', () => {
    expect(blocksOverlap(at(1, 1), at(2, 1))).toBe(false);
  });

  it('un bloque grande alcanza a una casilla que cae adentro', () => {
    expect(blocksOverlap(at(1, 1, 3), at(3, 3))).toBe(true);
  });

  it('un bloque grande no alcanza a la casilla justo despues de su borde', () => {
    expect(blocksOverlap(at(1, 1, 3), at(4, 1))).toBe(false);
  });
});

describe('clampBlockPosition', () => {
  const grid = { width: 8, height: 8 };

  it('deja igual un bloque que ya entra', () => {
    expect(clampBlockPosition({ col: 2, row: 2 }, 3, grid)).toEqual({ col: 2, row: 2 });
  });

  it('empuja hacia adentro un bloque que se saldria del borde', () => {
    expect(clampBlockPosition({ col: 6, row: 7 }, 3, grid)).toEqual({ col: 5, row: 5 });
  });
});
