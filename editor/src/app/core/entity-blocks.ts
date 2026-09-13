// Bloques de celdas que ocupa una entidad.
//
// Una entidad ocupa "span" celdas por lado a partir de su position, creciendo
// hacia +col y +row: una figura de span 3 en la celda 2,2 cubre de 2,2 a 4,4.
// El motor usa exactamente este criterio (main.cpp) para centrar el sprite y la
// colision, asi que estas cuentas tienen que dar lo mismo de los dos lados: si
// el editor centrara el bloque distinto, una figura grande se veria en un lugar
// al disenar y en otro al jugar.

import { GridPosition } from '../models/level.model';

/** Celdas por lado. Ausente, cero o negativo cuenta como 1, igual que en el motor. */
export function entitySpan(entity: { span?: number }): number {
  return Math.max(1, Math.round(entity.span ?? 1));
}

/**
 * Centro del bloque, en coordenadas de celda. Con span par cae entre dos
 * celdas (x.5). Es el punto donde el motor apoya el sprite y centra la caja.
 */
export function blockCenter(entity: { position: GridPosition; span?: number }): GridPosition {
  const offset = (entitySpan(entity) - 1) / 2;
  return { col: entity.position.col + offset, row: entity.position.row + offset };
}

/** true si los bloques de las dos entidades comparten al menos una celda. */
export function blocksOverlap(
  a: { position: GridPosition; span?: number },
  b: { position: GridPosition; span?: number },
): boolean {
  const spanA = entitySpan(a);
  const spanB = entitySpan(b);
  return (
    a.position.col < b.position.col + spanB &&
    b.position.col < a.position.col + spanA &&
    a.position.row < b.position.row + spanB &&
    b.position.row < a.position.row + spanA
  );
}

/**
 * Corre la posicion lo justo para que un bloque de ese tamano no se salga de
 * la grilla: agrandar una figura pegada al borde la empuja hacia adentro en vez
 * de dejar celdas del bloque fuera del mapa.
 */
export function clampBlockPosition(
  position: GridPosition,
  span: number,
  grid: { width: number; height: number },
): GridPosition {
  return {
    col: Math.min(Math.max(0, position.col), Math.max(0, grid.width - span)),
    row: Math.min(Math.max(0, position.row), Math.max(0, grid.height - span)),
  };
}
