import { Level, MapRoom, MapTile } from '../models/level.model';
import {
  buildLayout,
  cellState,
  implicitRoom,
  legacyEdits,
  nextFreeId,
  placeBeside,
  rectBetween,
  roomAt,
  sanitizeRoom,
  shiftLevel,
  sideAnchor,
  sideFacing,
  tunnelAt,
  tunnelFloor,
  tunnelRoute,
} from './dungeon-layout';

const room = (id: string, col: number, row: number, width: number, height: number): MapRoom => ({
  id,
  col,
  row,
  width,
  height,
});

describe('buildLayout: una sala', () => {
  const layout = buildLayout({ width: 5, height: 5 }, [room('a', 1, 1, 3, 3)], [], []);

  it('pone piso en toda la sala', () => {
    expect(layout.tiles.filter((tile) => tile.floor !== false)).toHaveLength(9);
  });

  it('levanta la pared POR FUERA, en el anillo que la rodea', () => {
    const walls = layout.tiles.filter((tile) => tile.wall);
    expect(walls).toHaveLength(16);
    expect(cellState(layout.tiles, 0, 0)).toEqual({ floor: false, wall: true });
    expect(cellState(layout.tiles, 2, 2)).toEqual({ floor: true, wall: false });
  });

  it('escribe solo lo que difiere del default del schema', () => {
    expect(layout.tiles.find((tile) => tile.col === 2 && tile.row === 2)).toEqual({ col: 2, row: 2 });
    expect(layout.tiles.find((tile) => tile.col === 0 && tile.row === 0)).toEqual({
      col: 0,
      row: 0,
      floor: false,
      wall: true,
    });
  });
});

describe('buildLayout: tamano de la grilla', () => {
  it('crece para que la sala entre con su pared', () => {
    const layout = buildLayout({ width: 3, height: 3 }, [room('a', 1, 1, 4, 4)], [], []);
    expect([layout.width, layout.height]).toEqual([6, 6]);
  });

  it('nunca achica una grilla que ya era mas grande', () => {
    const layout = buildLayout({ width: 20, height: 20 }, [room('a', 1, 1, 3, 3)], [], []);
    expect([layout.width, layout.height]).toEqual([20, 20]);
  });
});

describe('tuneles', () => {
  const a = room('a', 1, 1, 3, 3); // centro 2,2
  const b = room('b', 10, 1, 3, 3); // centro 11,2

  it('un tunel de ancho 3 deja 3 celdas caminables', () => {
    const layout = buildLayout({ width: 1, height: 1 }, [a, b], [{ id: 't', from: 'a', to: 'b', width: 3 }], []);
    expect(cellState(layout.tiles, 6, 1).floor).toBe(true);
    expect(cellState(layout.tiles, 6, 2).floor).toBe(true);
    expect(cellState(layout.tiles, 6, 3).floor).toBe(true);
    expect(cellState(layout.tiles, 6, 0)).toEqual({ floor: false, wall: true });
    expect(cellState(layout.tiles, 6, 4)).toEqual({ floor: false, wall: true });
  });

  it('un tunel de ancho 1 es un pasillo de una celda con pared a los dos lados', () => {
    const layout = buildLayout({ width: 1, height: 1 }, [a, b], [{ id: 't', from: 'a', to: 'b', width: 1 }], []);
    expect(cellState(layout.tiles, 6, 2).floor).toBe(true);
    expect(cellState(layout.tiles, 6, 1).wall).toBe(true);
    expect(cellState(layout.tiles, 6, 3).wall).toBe(true);
  });

  it('dobla en L cuando las salas no estan alineadas, sin dejar la esquina abierta', () => {
    const c = room('c', 10, 10, 3, 3); // centro 11,11
    const cells = tunnelFloor(a, c, { width: 1 });
    const has = (col: number, row: number) => cells.some((cell) => cell.col === col && cell.row === row);
    expect(has(6, 2)).toBe(true); // tramo horizontal
    expect(has(11, 2)).toBe(true); // esquina
    expect(has(11, 6)).toBe(true); // tramo vertical
  });

  it('un tunel hacia una sala que no existe no rompe el mapa', () => {
    const layout = buildLayout({ width: 5, height: 5 }, [a], [{ id: 't', from: 'a', to: 'nadie', width: 3 }], []);
    expect(layout.tiles.filter((tile) => tile.floor !== false)).toHaveLength(9);
  });
});

describe('retoques manuales', () => {
  it('se aplican encima y pisan solo lo que declaran', () => {
    const edits: MapTile[] = [{ col: 2, row: 2, wall: true }];
    const layout = buildLayout({ width: 5, height: 5 }, [room('a', 1, 1, 3, 3)], [], edits);
    expect(cellState(layout.tiles, 2, 2)).toEqual({ floor: true, wall: true });
  });
});

describe('pasar un nivel viejo a mapa', () => {
  const grid = { width: 10, height: 10 };

  it('el area actual pasa a ser sala_1, sin el anillo del borde', () => {
    expect(implicitRoom(grid)).toEqual({ id: 'sala_1', col: 1, row: 1, width: 8, height: 8 });
  });

  // Lo que escribe la herramienta Piso/Pared en un nivel viejo: todo piso y
  // pared en el borde.
  const legacy: MapTile[] = [];
  for (let row = 0; row < 10; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      legacy.push({ col, row, floor: true, wall: col === 0 || row === 0 || col === 9 || row === 9 });
    }
  }

  it('un nivel sin retoques no arrastra ninguno', () => {
    expect(legacyEdits(grid, legacy, implicitRoom(grid))).toEqual([]);
  });

  it('un nivel que nunca uso Piso/Pared tampoco', () => {
    expect(legacyEdits(grid, undefined, implicitRoom(grid))).toEqual([]);
  });

  it('conserva una celda que se habia sacado a mano', () => {
    const edited = legacy.map((tile) => (tile.col === 4 && tile.row === 4 ? { ...tile, floor: false } : tile));
    expect(legacyEdits(grid, edited, implicitRoom(grid))).toEqual([{ col: 4, row: 4, floor: false, wall: false }]);
  });
});

describe('tuneles con lados y trazado a mano', () => {
  const a = room('a', 1, 1, 3, 3); // centro 2,2
  const b = room('b', 10, 1, 3, 3); // centro 11,2
  const has = (cells: { col: number; row: number }[], col: number, row: number) =>
    cells.some((cell) => cell.col === col && cell.row === row);

  it('el extremo de un lado es la celda justo afuera de su punto medio', () => {
    expect(sideAnchor(a, 'right')).toEqual({ col: 4, row: 2 });
    expect(sideAnchor(a, 'left')).toEqual({ col: 0, row: 2 });
    expect(sideAnchor(a, 'top')).toEqual({ col: 2, row: 0 });
    expect(sideAnchor(a, 'bottom')).toEqual({ col: 2, row: 4 });
  });

  it('de derecha a izquierda a la misma altura queda un pasillo recto', () => {
    const route = tunnelRoute(a, b, { fromSide: 'right', toSide: 'left' });
    expect(route.every((cell) => cell.row === 2)).toBe(true);
  });

  it('entre lados enfrentados a distinta altura arma una Z que entra de frente', () => {
    const c = room('c', 10, 8, 3, 3); // lado izquierdo: 9,9
    expect(tunnelRoute(a, c, { fromSide: 'right', toSide: 'left' })).toEqual([
      { col: 4, row: 2 },
      { col: 7, row: 2 },
      { col: 7, row: 9 },
      { col: 9, row: 9 },
    ]);
  });

  it('sale alejandose de la pared del lado elegido, no pegado a ella', () => {
    const c = room('c', 10, 10, 3, 3); // centro 11,11
    const route = tunnelRoute(a, c, { fromSide: 'bottom' });
    // Sale por abajo (2,4): el primer codo baja por la columna 2, no corre por la fila 4.
    expect(route[1]).toEqual({ col: 2, row: 11 });
  });

  it('pasa por los puntos marcados a mano, en orden', () => {
    const cells = tunnelFloor(a, b, { width: 1, path: [{ col: 2, row: 8 }, { col: 11, row: 8 }] });
    expect(has(cells, 2, 6)).toBe(true);
    expect(has(cells, 6, 8)).toBe(true);
    expect(has(cells, 11, 5)).toBe(true);
    expect(has(cells, 6, 2)).toBe(false);
  });

  it('el lado que mira hacia un punto', () => {
    expect(sideFacing(a, { col: 8, row: 2 })).toBe('right');
    expect(sideFacing(a, { col: 2, row: -3 })).toBe('top');
    expect(sideFacing(a, { col: 2, row: 3 })).toBe('bottom');
  });

  it('encuentra la grilla y el tunel bajo una celda', () => {
    const tunnels = [{ id: 't', from: 'a', to: 'b', width: 1 }];
    expect(roomAt([a, b], { col: 2, row: 2 })?.id).toBe('a');
    expect(roomAt([a, b], { col: 6, row: 2 })).toBeUndefined();
    expect(tunnelAt([a, b], tunnels, { col: 6, row: 2 })?.id).toBe('t');
    expect(tunnelAt([a, b], tunnels, { col: 6, row: 5 })).toBeUndefined();
  });
});

describe('ubicar grillas', () => {
  const anchor = room('a', 5, 5, 4, 3);
  const size = { width: 2, height: 6 };

  it('pegada a otra de cada lado, dejando el hueco pedido', () => {
    expect(placeBeside(anchor, 'right', size, 4)).toEqual({ col: 13, row: 5 });
    expect(placeBeside(anchor, 'left', size, 4)).toEqual({ col: -1, row: 5 });
    expect(placeBeside(anchor, 'bottom', size, 4)).toEqual({ col: 5, row: 12 });
    expect(placeBeside(anchor, 'top', size, 4)).toEqual({ col: 5, row: -5 });
  });

  it('el rectangulo dibujado, arrastrando en cualquier direccion', () => {
    expect(rectBetween({ col: 6, row: 2 }, { col: 3, row: 5 })).toEqual({ col: 3, row: 2, width: 4, height: 4 });
  });

  it('correr el mapa mueve salas, trazados, retoques y entidades juntos', () => {
    const level: Level = {
      name: 'n',
      grid: { width: 5, height: 5, tileWidth: 64, tileHeight: 32 },
      entities: [
        { id: 'e', type: 'x', position: { col: 1, row: 1 }, texture: 't', sourceRect: { x: 0, y: 0, width: 1, height: 1 } },
      ],
      events: [],
      rooms: [room('a', 1, 1, 2, 2)],
      tunnels: [{ id: 't', from: 'a', to: 'a', width: 1, path: [{ col: 3, row: 3 }] }],
      tileEdits: [{ col: 2, row: 2, wall: true }],
    };
    const shifted = shiftLevel(level, 2, 1);
    expect(shifted.rooms?.[0]).toMatchObject({ col: 3, row: 2 });
    expect(shifted.tunnels?.[0].path).toEqual([{ col: 5, row: 4 }]);
    expect(shifted.tileEdits).toEqual([{ col: 4, row: 3, wall: true }]);
    expect(shifted.entities[0].position).toEqual({ col: 3, row: 2 });
  });
});

describe('lo que exige el motor', () => {
  // LevelLoader.cpp rechaza el nivel entero si una celda de "tiles" cae fuera
  // de la grilla. Es la unica regla del mapa que, rota, deja el juego sin abrir.
  it('toda celda cae dentro de la grilla que devuelve el mapa', () => {
    const rooms = [room('a', 1, 1, 5, 4), room('b', 12, 9, 3, 6)];
    const layout = buildLayout(
      { width: 4, height: 4 },
      rooms,
      [{ id: 't', from: 'a', to: 'b', width: 3 }],
      [{ col: 30, row: 30, floor: true }],
    );
    for (const tile of layout.tiles) {
      expect(tile.col).toBeGreaterThanOrEqual(0);
      expect(tile.row).toBeGreaterThanOrEqual(0);
      expect(tile.col).toBeLessThan(layout.width);
      expect(tile.row).toBeLessThan(layout.height);
    }
  });
});

describe('sanitizeRoom y nextFreeId', () => {
  it('deja lugar para la pared de arriba y de la izquierda', () => {
    expect(sanitizeRoom(room('a', 0, -2, 0, 3.6))).toEqual({ id: 'a', col: 1, row: 1, width: 1, height: 4 });
  });

  it('elige el primer id libre', () => {
    expect(nextFreeId('sala', ['sala_1', 'sala_2'])).toBe('sala_3');
  });
});
