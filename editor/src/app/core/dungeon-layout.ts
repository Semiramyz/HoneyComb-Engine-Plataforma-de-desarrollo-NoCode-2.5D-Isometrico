// Mapa de un nivel armado con grillas (salas) unidas por tuneles.
//
// COMO LLEGA AL JUEGO. El motor no sabe nada de salas ni de tuneles: lee
// "tiles", la lista de celdas con piso y con pared (LevelLoader.cpp), y con eso
// ya dibuja el cuarto y frena al jugador donde no hay piso o hay pared. Este
// modulo traduce las salas, los tuneles y los retoques manuales a esa lista.
// Por eso el mapa funciona al ejecutar sin una sola linea nueva de C++.
//
// LAS REGLAS DE LA TRADUCCION:
//   - Cada sala pone piso en todo su rectangulo.
//   - Cada tunel pone piso en un pasillo de tramos rectos. Arranca en el centro
//     de su sala, o justo afuera del lado elegido, pasa por los puntos que se
//     trazaron a mano, y termina igual en la otra sala. Entre dos puntos va en
//     L. Su ancho son celdas CAMINABLES.
//   - Las paredes van POR FUERA del piso, en cada celda vacia que toca una de
//     piso (tambien en diagonal, para que las esquinas queden cerradas). Asi un
//     tunel de 3 deja pasar por 3 celdas, y no por 1 con dos paredes adentro.
//   - La grilla del nivel crece lo necesario para que todo entre con su pared.
//   - Los retoques ("tileEdits") se aplican al final, encima de todo.
//
// Todo es una funcion pura de los datos: la misma entrada da siempre el mismo
// mapa, que es lo que va a necesitar la generacion con semilla de la parte 3.

import { Level, MapRoom, MapTile, MapTunnel, RoomSide } from '../models/level.model';

interface Cell {
  col: number;
  row: number;
}

interface CellState {
  floor: boolean;
  wall: boolean;
}

const key = (col: number, row: number) => col + ',' + row;

/** Celda central de una sala (la de arriba a la izquierda del centro, si es par). */
export function roomCenter(room: MapRoom): Cell {
  return {
    col: room.col + Math.floor((room.width - 1) / 2),
    row: room.row + Math.floor((room.height - 1) / 2),
  };
}

/** Celda justo afuera del punto medio de un lado: donde un tunel toca la sala. */
export function sideAnchor(room: MapRoom, side: RoomSide): Cell {
  const center = roomCenter(room);
  switch (side) {
    case 'left':
      return { col: room.col - 1, row: center.row };
    case 'right':
      return { col: room.col + room.width, row: center.row };
    case 'top':
      return { col: center.col, row: room.row - 1 };
    case 'bottom':
      return { col: center.col, row: room.row + room.height };
  }
}

export function oppositeSide(side: RoomSide): RoomSide {
  const opposites: Record<RoomSide, RoomSide> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
  return opposites[side];
}

const isColumnSide = (side: RoomSide) => side === 'left' || side === 'right';

/**
 * Las esquinas del recorrido de un tunel, en orden: de su extremo en "from",
 * por los puntos trazados a mano, hasta su extremo en "to". Entre dos
 * esquinas seguidas siempre hay un tramo recto.
 *
 * Entre dos puntos cualesquiera se va en L, y la pregunta es para que lado
 * doblar. La respuesta sale de los lados elegidos: un tunel que sale por la
 * derecha tiene que arrancar yendo a lo ancho, y uno que entra por arriba
 * tiene que llegar bajando. Sin eso, el primer tramo corria pegado a la pared
 * de la sala en vez de alejarse de ella. Si la salida y la llegada piden
 * tramos distintos en el mismo trecho (derecha a izquierda, a distinta
 * altura), no alcanza una L: se arma una Z con dos codos a mitad de camino.
 */
export function tunnelRoute(
  from: MapRoom,
  to: MapRoom,
  tunnel: Pick<MapTunnel, 'fromSide' | 'toSide' | 'path'>,
): Cell[] {
  const start = tunnel.fromSide ? sideAnchor(from, tunnel.fromSide) : roomCenter(from);
  const end = tunnel.toSide ? sideAnchor(to, tunnel.toSide) : roomCenter(to);
  const points: Cell[] = [start, ...(tunnel.path ?? []), end];
  const route: Cell[] = [points[0]];

  for (let index = 0; index < points.length - 1; index += 1) {
    const p = points[index];
    const q = points[index + 1];
    // "h" = primero a lo ancho (columnas) y despues a lo alto; "v" al reves.
    const leaving = index === 0 && tunnel.fromSide ? (isColumnSide(tunnel.fromSide) ? 'h' : 'v') : null;
    const arriving =
      index === points.length - 2 && tunnel.toSide ? (isColumnSide(tunnel.toSide) ? 'v' : 'h') : null;

    if (leaving && arriving && leaving !== arriving && p.col !== q.col && p.row !== q.row) {
      if (leaving === 'h') {
        const middle = Math.round((p.col + q.col) / 2);
        route.push({ col: middle, row: p.row }, { col: middle, row: q.row });
      } else {
        const middle = Math.round((p.row + q.row) / 2);
        route.push({ col: p.col, row: middle }, { col: q.col, row: middle });
      }
    } else {
      const bend = leaving ?? arriving ?? 'h';
      route.push(bend === 'h' ? { col: q.col, row: p.row } : { col: p.col, row: q.row });
    }
    route.push(q);
  }
  return route;
}

/**
 * Celdas de piso de un tunel: cada tramo recto de su recorrido, ensanchado
 * alrededor de su eje. Cada tramo se estira tambien a lo largo lo mismo que a
 * lo ancho, y eso es lo que deja llenas las esquinas donde dobla.
 */
export function tunnelFloor(
  from: MapRoom,
  to: MapRoom,
  tunnel: Pick<MapTunnel, 'width' | 'fromSide' | 'toSide' | 'path'>,
): Cell[] {
  const span = Math.max(1, Math.round(tunnel.width) || 1);
  const low = -Math.floor((span - 1) / 2);
  const high = low + span - 1;
  const route = tunnelRoute(from, to, tunnel);
  const cells: Cell[] = [];

  for (let index = 0; index < route.length - 1; index += 1) {
    const a = route[index];
    const b = route[index + 1];
    for (let col = Math.min(a.col, b.col) + low; col <= Math.max(a.col, b.col) + high; col += 1) {
      for (let row = Math.min(a.row, b.row) + low; row <= Math.max(a.row, b.row) + high; row += 1) {
        cells.push({ col, row });
      }
    }
  }
  return cells;
}

export interface MapLayout {
  /** Ancho que tiene que tener la grilla del nivel: nunca menos que el que ya tenia. */
  width: number;
  height: number;
  /** Lo que va a "tiles" en el JSON: solo celdas con piso o con pared. */
  tiles: MapTile[];
}

export function buildLayout(
  grid: { width: number; height: number },
  rooms: readonly MapRoom[],
  tunnels: readonly MapTunnel[],
  edits: readonly MapTile[],
): MapLayout {
  // --- Piso: salas y tuneles ----------------------------------------------
  // Las coordenadas negativas se descartan: la grilla del motor empieza en 0.
  const floor = new Map<string, Cell>();
  const addFloor = (col: number, row: number) => {
    if (col >= 0 && row >= 0) {
      floor.set(key(col, row), { col, row });
    }
  };

  for (const room of rooms) {
    for (let col = room.col; col < room.col + room.width; col += 1) {
      for (let row = room.row; row < room.row + room.height; row += 1) {
        addFloor(col, row);
      }
    }
  }

  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  for (const tunnel of tunnels) {
    const from = roomsById.get(tunnel.from);
    const to = roomsById.get(tunnel.to);
    // Un tunel hacia una sala que ya no existe no dibuja nada, en vez de
    // romper el mapa entero.
    if (!from || !to) {
      continue;
    }
    for (const cell of tunnelFloor(from, to, tunnel)) {
      addFloor(cell.col, cell.row);
    }
  }

  // --- Tamano: todo el piso, mas una celda para su pared ------------------
  let width = grid.width;
  let height = grid.height;
  for (const cell of floor.values()) {
    width = Math.max(width, cell.col + 2);
    height = Math.max(height, cell.row + 2);
  }

  // --- Paredes: toda celda vacia que toca piso -----------------------------
  const cells = new Map<string, Cell & CellState>();
  for (const cell of floor.values()) {
    cells.set(key(cell.col, cell.row), { ...cell, floor: true, wall: false });
  }
  for (const cell of floor.values()) {
    for (let dc = -1; dc <= 1; dc += 1) {
      for (let dr = -1; dr <= 1; dr += 1) {
        const col = cell.col + dc;
        const row = cell.row + dr;
        if (col < 0 || row < 0 || col >= width || row >= height || floor.has(key(col, row))) {
          continue;
        }
        cells.set(key(col, row), { col, row, floor: false, wall: true });
      }
    }
  }

  // --- Retoques manuales, encima de todo -----------------------------------
  // Cada retoque pisa solo lo que declara: uno que dice "wall: true" pone una
  // pared y deja el piso de esa celda como estaba.
  for (const edit of edits) {
    if (edit.col < 0 || edit.row < 0 || edit.col >= width || edit.row >= height) {
      continue;
    }
    const base = cells.get(key(edit.col, edit.row)) ?? {
      col: edit.col,
      row: edit.row,
      floor: false,
      wall: false,
    };
    cells.set(key(edit.col, edit.row), {
      col: edit.col,
      row: edit.row,
      floor: edit.floor ?? base.floor,
      wall: edit.wall ?? base.wall,
    });
  }

  // --- Salida en el formato del contrato -----------------------------------
  // Solo las claves que difieren del default del schema (floor true, wall
  // false), y ordenado por fila y columna para que el JSON se lea y se diffee.
  const tiles = [...cells.values()]
    .filter((cell) => cell.floor || cell.wall)
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((cell) => {
      const tile: MapTile = { col: cell.col, row: cell.row };
      if (!cell.floor) {
        tile.floor = false;
      }
      if (cell.wall) {
        tile.wall = true;
      }
      return tile;
    });

  return { width, height, tiles };
}

/**
 * Piso y pared de una celda segun una lista de "tiles". Una celda que no esta
 * en la lista es vacio: el motor no la pisa ni la dibuja.
 */
export function cellState(tiles: readonly MapTile[], col: number, row: number): CellState {
  const tile = tiles.find((candidate) => candidate.col === col && candidate.row === row);
  return tile ? { floor: tile.floor !== false, wall: tile.wall === true } : { floor: false, wall: false };
}

/**
 * La sala equivalente a un nivel de una sola grilla: todo menos el anillo del
 * borde, que es donde el motor pone la pared en esos niveles. Asi, pasar un
 * nivel viejo a mapa no cambia nada de lo que se juega.
 */
export function implicitRoom(grid: { width: number; height: number }): MapRoom {
  return {
    id: 'sala_1',
    col: grid.width > 2 ? 1 : 0,
    row: grid.height > 2 ? 1 : 0,
    width: Math.max(1, grid.width - 2),
    height: Math.max(1, grid.height - 2),
  };
}

/**
 * Los retoques que hay que guardar para que un nivel viejo, al pasar a mapa,
 * conserve lo que se edito a mano con Piso y Pared.
 *
 * Compara por lo que IMPORTA al jugar, no por los datos crudos: en un nivel
 * viejo la pared del borde es "piso con pared", y en el mapa es "pared sin
 * piso". Las dos bloquean y se ven igual, asi que no cuentan como retoque; si
 * contaran, todo nivel viejo arrastraria su borde entero como retoques.
 */
export function legacyEdits(
  grid: { width: number; height: number },
  legacyTiles: readonly MapTile[] | undefined,
  room: MapRoom,
): MapTile[] {
  if (!legacyTiles) {
    return [];
  }
  const generated = buildLayout(grid, [room], [], []).tiles;
  const walkable = (state: CellState) => state.floor && !state.wall;
  const edits: MapTile[] = [];

  for (let row = 0; row < grid.height; row += 1) {
    for (let col = 0; col < grid.width; col += 1) {
      const before = cellState(legacyTiles, col, row);
      const after = cellState(generated, col, row);
      if (walkable(before) !== walkable(after) || before.wall !== after.wall) {
        edits.push({ col, row, floor: before.floor, wall: before.wall });
      }
    }
  }
  return edits;
}

/**
 * Deja una sala con numeros validos: enteros, tamano de al menos 1, y posicion
 * de al menos 1 para que su pared de arriba y de la izquierda entre en la
 * grilla (la grilla crece hacia la derecha y hacia abajo, no hacia atras).
 */
export function sanitizeRoom(room: MapRoom): MapRoom {
  const whole = (value: number) => Math.round(value) || 0;
  return {
    id: room.id,
    col: Math.max(1, whole(room.col)),
    row: Math.max(1, whole(room.row)),
    width: Math.max(1, whole(room.width)),
    height: Math.max(1, whole(room.height)),
  };
}

/** Primer id libre de la forma "base_N". */
export function nextFreeId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let index = 1;
  while (used.has(base + '_' + index)) {
    index += 1;
  }
  return base + '_' + index;
}

// --- Ayudas para las herramientas de mapa del viewport ----------------------

/** La sala que contiene esa celda, si hay una. */
export function roomAt(rooms: readonly MapRoom[], cell: Cell): MapRoom | undefined {
  return rooms.find(
    (room) =>
      cell.col >= room.col &&
      cell.col < room.col + room.width &&
      cell.row >= room.row &&
      cell.row < room.row + room.height,
  );
}

/** El tunel que pasa por esa celda, si hay uno. */
export function tunnelAt(
  rooms: readonly MapRoom[],
  tunnels: readonly MapTunnel[],
  cell: Cell,
): MapTunnel | undefined {
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  return tunnels.find((tunnel) => {
    const from = roomsById.get(tunnel.from);
    const to = roomsById.get(tunnel.to);
    return (
      !!from &&
      !!to &&
      tunnelFloor(from, to, tunnel).some((floor) => floor.col === cell.col && floor.row === cell.row)
    );
  });
}

/**
 * El lado de una sala que mira hacia un punto. Sirve para deducir por donde
 * sale un tunel trazado a mano: por el lado que da al primer punto marcado.
 * Si el punto cae adentro de la sala, el lado mas cercano.
 */
export function sideFacing(room: MapRoom, point: Cell): RoomSide {
  if (point.col < room.col) {
    return 'left';
  }
  if (point.col >= room.col + room.width) {
    return 'right';
  }
  if (point.row < room.row) {
    return 'top';
  }
  if (point.row >= room.row + room.height) {
    return 'bottom';
  }
  const distances: [RoomSide, number][] = [
    ['left', point.col - room.col],
    ['right', room.col + room.width - 1 - point.col],
    ['top', point.row - room.row],
    ['bottom', room.row + room.height - 1 - point.row],
  ];
  return distances.reduce((best, current) => (current[1] < best[1] ? current : best))[0];
}

/**
 * Donde va una sala de ese tamano pegada a otra, de un lado, dejando "gap"
 * celdas libres en el medio. Puede dar negativo (a la izquierda o arriba de
 * una sala del borde): quien la agrega corre el mapa para hacerle lugar.
 */
export function placeBeside(
  anchor: MapRoom,
  side: RoomSide,
  size: { width: number; height: number },
  gap: number,
): Cell {
  switch (side) {
    case 'right':
      return { col: anchor.col + anchor.width + gap, row: anchor.row };
    case 'left':
      return { col: anchor.col - gap - size.width, row: anchor.row };
    case 'bottom':
      return { col: anchor.col, row: anchor.row + anchor.height + gap };
    case 'top':
      return { col: anchor.col, row: anchor.row - gap - size.height };
  }
}

/** El rectangulo entre dos celdas, en cualquier direccion en que se haya arrastrado. */
export function rectBetween(a: Cell, b: Cell): { col: number; row: number; width: number; height: number } {
  return {
    col: Math.min(a.col, b.col),
    row: Math.min(a.row, b.row),
    width: Math.abs(a.col - b.col) + 1,
    height: Math.abs(a.row - b.row) + 1,
  };
}

/**
 * Corre el mapa entero: salas, trazados de tunel, retoques y entidades. La
 * grilla del motor empieza en 0 y no puede crecer hacia atras, asi que ubicar
 * una sala a la izquierda o arriba del mapa se resuelve corriendo todo lo demas
 * hacia el otro lado. Las entidades van con el mapa para seguir paradas donde
 * estaban respecto de sus salas.
 */
export function shiftLevel(level: Level, deltaCol: number, deltaRow: number): Level {
  const move = <T extends { col: number; row: number }>(cell: T): T => ({
    ...cell,
    col: cell.col + deltaCol,
    row: cell.row + deltaRow,
  });
  return {
    ...level,
    rooms: level.rooms?.map(move),
    tunnels: level.tunnels?.map((tunnel) => (tunnel.path ? { ...tunnel, path: tunnel.path.map(move) } : tunnel)),
    tileEdits: level.tileEdits?.map(move),
    entities: level.entities.map((entity) => ({ ...entity, position: move(entity.position) })),
  };
}
