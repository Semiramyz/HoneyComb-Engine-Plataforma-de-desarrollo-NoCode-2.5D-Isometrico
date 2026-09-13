// GENERADO POR tools/gen-shape-sprites.mjs -- NO EDITAR A MANO.
//
// Los mismos pixeles que assets/textures/shapes.png, embebidos para que el
// editor dibuje exactamente lo que va a dibujar el runtime. Para cambiar una
// figura se edita SHAPES en el generador y se lo vuelve a correr, que reescribe
// el PNG y este archivo de una sola pasada.

/** Ruta de la textura tal como va en el nivel (relativa a assets/). */
export const SHAPE_TEXTURE = 'textures/shapes.png';

/** Medidas del sheet, para recortar una celda por CSS en la paleta. */
export const SHAPE_SHEET_WIDTH = 262;
export const SHAPE_SHEET_HEIGHT = 194;

/** El sheet embebido, para dibujar en el canvas del editor. */
export const SHAPE_SHEET_DATA_URL =
  'data:image/png;base64,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';

export interface ShapeCell {
  id: string;
  label: string;
  /** Alto en cubos. Informativo: el runtime solo usa el sourceRect. */
  height: number;
  /** Recorte dentro del sheet, tal cual va en el "sourceRect" del nivel. */
  sourceRect: { x: number; y: number; width: number; height: number };
  /**
   * Cuanto baja el sprite respecto de la regla de entidad del runtime, para
   * que el rombo de su base apoye en la casilla. Va tal cual en el
   * "groundOffset" del nivel; ver el calculo en el generador.
   */
  groundOffset: number;
}

export const SHAPE_CELLS: readonly ShapeCell[] = [
  {
    id: 'cube',
    label: 'Cubo',
    height: 1,
    sourceRect: { x: 0, y: 0, width: 64, height: 96 },
    groundOffset: 17,
  },
  {
    id: 'pyramid',
    label: 'Piramide',
    height: 1.5,
    sourceRect: { x: 66, y: 0, width: 64, height: 96 },
    groundOffset: 17,
  },
  {
    id: 'ramp',
    label: 'Rampa',
    height: 1,
    sourceRect: { x: 132, y: 0, width: 64, height: 96 },
    groundOffset: 17,
  },
  {
    id: 'slab',
    label: 'Losa',
    height: 0.25,
    sourceRect: { x: 198, y: 0, width: 64, height: 96 },
    groundOffset: 17,
  },
  {
    id: 'cylinder',
    label: 'Cilindro',
    height: 1,
    sourceRect: { x: 0, y: 98, width: 64, height: 96 },
    groundOffset: 17,
  },
  {
    id: 'cone',
    label: 'Cono',
    height: 1.5,
    sourceRect: { x: 66, y: 98, width: 64, height: 96 },
    groundOffset: 17,
  },
  {
    id: 'sphere',
    label: 'Esfera',
    height: 1,
    sourceRect: { x: 132, y: 98, width: 64, height: 96 },
    groundOffset: 17,
  },
  {
    id: 'pillar',
    label: 'Pilar',
    height: 2,
    sourceRect: { x: 198, y: 98, width: 64, height: 96 },
    groundOffset: 17,
  },
];
