// Espejo exacto de engine/systems/iso_grid/IsoGridSystem.{hpp,cpp}. Si la
// formula de proyeccion cambia de un lado, tiene que cambiar del otro --
// editor y runtime deben ubicar la grilla isometrica de la misma forma
// exacta, o lo que el diseñador ve en el canvas no coincidiria con lo que
// el motor termina dibujando.

export interface GridCoord {
  col: number;
  row: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export class IsoProjection {
  constructor(
    private readonly tileWidth: number,
    private readonly tileHeight: number,
  ) {}

  /** Celda de grilla (col, row) -> posicion en pantalla, sin offset de camara. */
  gridToScreen(coord: GridCoord): ScreenPoint {
    const halfW = this.tileWidth / 2;
    const halfH = this.tileHeight / 2;
    return {
      x: (coord.col - coord.row) * halfW,
      y: (coord.col + coord.row) * halfH,
    };
  }

  /** Posicion en pantalla -> celda de grilla bajo ese punto (para clicks del canvas). */
  screenToGrid(point: ScreenPoint): GridCoord {
    const halfW = this.tileWidth / 2;
    const halfH = this.tileHeight / 2;
    const colF = (point.x / halfW + point.y / halfH) / 2;
    const rowF = (point.y / halfH - point.x / halfW) / 2;
    return { col: Math.floor(colF), row: Math.floor(rowF) };
  }

  isValidCoord(coord: GridCoord, gridWidth: number, gridHeight: number): boolean {
    return coord.col >= 0 && coord.col < gridWidth && coord.row >= 0 && coord.row < gridHeight;
  }
}
