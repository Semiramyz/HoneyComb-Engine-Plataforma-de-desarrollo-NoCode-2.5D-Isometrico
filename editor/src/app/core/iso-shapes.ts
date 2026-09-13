// Primitivas de bloqueo del editor: cubos, piramides, rampas y demas.
//
// QUE SON AHORA. Pixeles. Un recorte de assets/textures/shapes.png, igual que
// cualquier otra textura del proyecto. Antes se dibujaban como poligonos en el
// canvas del editor, lo que las hacia invisibles para el juego: el motor no
// sabe dibujar geometria, solo un recorte de una textura (ver el Submit de
// main.cpp y "sourceRect" en schema/level.schema.json). Al pasarlas a pixeles,
// colocar una figura produce una entidad normal y corriente, y el runtime la
// dibuja sin una sola linea de codigo nueva.
//
// DE DONDE SALEN. De tools/gen-shape-sprites.mjs, que en una sola corrida
// escribe el PNG que carga el runtime y core/shape-sheet.ts con esos mismos
// pixeles embebidos para el editor. Este archivo no define geometria: solo le
// pone tipos y ayudantes a esa tabla generada.
//
// COMO SE APOYAN. Cada figura declara un groundOffset (ver el campo homonimo en
// el schema). El motor apoya el borde inferior del sprite en el punto de la
// celda, que es lo correcto para un personaje pero no para un solido que llena
// la casilla: ese tiene que apoyar el CENTRO del rombo de su base, medio tile
// mas abajo. El offset es esa diferencia.

import { ColliderConfig } from '../models/level.model';
import {
  SHAPE_CELLS,
  SHAPE_SHEET_DATA_URL,
  SHAPE_SHEET_HEIGHT,
  SHAPE_SHEET_WIDTH,
  SHAPE_TEXTURE,
  ShapeCell,
} from './shape-sheet';

export { SHAPE_SHEET_DATA_URL, SHAPE_SHEET_HEIGHT, SHAPE_SHEET_WIDTH, SHAPE_TEXTURE };

/** Identificador de primitiva. Es tambien el "type" que se guarda en la entidad. */
export type ShapeId = string;

export type ShapeDef = ShapeCell;

/** Las primitivas disponibles, en el orden en que aparecen en la paleta. */
export const SHAPES: readonly ShapeDef[] = SHAPE_CELLS;

const SHAPE_BY_ID = new Map<string, ShapeDef>(SHAPE_CELLS.map((cell) => [cell.id, cell]));

/** El "type" de una entidad, si nombra una primitiva conocida. */
export function shapeDef(type: string): ShapeDef | undefined {
  return SHAPE_BY_ID.get(type);
}

/**
 * Reconoce una entidad que es una de estas figuras.
 *
 * Mira la TEXTURA y no solo el type: "cube" es texto libre y cualquiera puede
 * llamar asi a una entidad suya con su propio arte. Lo que hace que algo sea
 * una figura de la paleta es que apunte a este sheet.
 */
export function shapeOf(entity: { type: string; texture: string }): ShapeDef | undefined {
  return entity.texture === SHAPE_TEXTURE || entity.texture.endsWith('/' + SHAPE_TEXTURE)
    ? shapeDef(entity.type)
    : undefined;
}

/**
 * El collider de una figura, en el formato del contrato: ancho y alto en
 * pixeles, y solido.
 *
 * COMO LO USA EL MOTOR. Para bloquear, main.cpp divide el collider por el
 * tamano del tile y lo trata como una caja en CELDAS centrada en la casilla.
 * O sea que 64x32 en un tile de 64x32 es exactamente el rombo de una celda,
 * que es lo que traen las figuras de levels/figuras.json.
 *
 * DE DONDE SALE EL TAMANO. De la huella real de cada figura, la misma con la
 * que el generador la dibuja: un cubo llena su casilla, pero un pilar se
 * levanta sobre una base de 0.42 celdas, y bloquearle la casilla entera haria
 * chocar al jugador contra aire.
 *
 * Solido porque una figura es un volumen: se choca contra ella, no se la cruza.
 *
 * "span" es cuantas celdas por lado ocupa la figura agrandada: la huella crece
 * en la misma proporcion, porque el motor agranda el sprite entero.
 */
export function shapeCollider(
  def: ShapeDef,
  tile: { tileWidth: number; tileHeight: number },
  span = 1,
): ColliderConfig {
  return {
    width: Math.max(1, Math.round(def.footprint * span * tile.tileWidth)),
    height: Math.max(1, Math.round(def.footprint * span * tile.tileHeight)),
    solid: true,
  };
}
