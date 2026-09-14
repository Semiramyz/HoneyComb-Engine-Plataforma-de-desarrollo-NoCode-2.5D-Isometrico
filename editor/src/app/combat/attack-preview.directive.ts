import { Directive, ElementRef, effect, inject, input } from '@angular/core';

import { Point, attackPreview } from '../core/items';
import { AttackDef } from '../models/item.model';

/**
 * Hacia donde apunta la vista previa, en celdas: hacia la DERECHA de la
 * pantalla. En isometrico eso es +columna y -fila a la vez.
 */
const AIM: Point = { x: Math.SQRT1_2, y: -Math.SQRT1_2 };

/** Pixeles por celda como mucho: un ataque chico no tiene que llenar el recuadro. */
const MAX_SCALE = 30;
const PADDING = 14;

/**
 * Dibuja en un <canvas> la forma de un ataque tal como la resuelve el motor:
 * `<canvas [appAttackPreview]="attack" width="260" height="150">`.
 *
 * Es una directiva y no un componente porque no tiene markup propio: solo
 * pinta el canvas que ya esta en la plantilla de App, y asi ese canvas conserva
 * los estilos de app.scss.
 */
@Directive({ selector: 'canvas[appAttackPreview]' })
export class AttackPreviewDirective {
  readonly attack = input.required<AttackDef>({ alias: 'appAttackPreview' });
  private readonly host = inject<ElementRef<HTMLCanvasElement>>(ElementRef);

  constructor() {
    effect(() => drawAttackPreview(this.host.nativeElement, this.attack()));
  }
}

/** Proyeccion isometrica con un tile de 2x1 unidades, la proporcion estandar 2:1. */
function iso(point: Point): Point {
  return { x: point.x - point.y, y: (point.x + point.y) / 2 };
}

export function drawAttackPreview(canvas: HTMLCanvasElement, attack: AttackDef): void {
  // jsdom (los tests) no implementa canvas: getContext devuelve null.
  const ctx = canvas.getContext?.('2d');
  if (!ctx) {
    return;
  }
  const { width, height } = canvas;
  ctx.fillStyle = '#262626';
  ctx.fillRect(0, 0, width, height);

  const shapes = attackPreview(attack, AIM);
  const gridPoints = [{ x: 0, y: 0 }, ...shapes.flatMap((shape) => shape.points)];
  const projected = gridPoints.map(iso);
  const minX = Math.min(...projected.map((point) => point.x));
  const maxX = Math.max(...projected.map((point) => point.x));
  const minY = Math.min(...projected.map((point) => point.y));
  const maxY = Math.max(...projected.map((point) => point.y));
  const scale = Math.min(
    (width - PADDING * 2) / Math.max(1, maxX - minX),
    (height - PADDING * 2) / Math.max(0.5, maxY - minY),
    MAX_SCALE,
  );
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const toCanvas = (point: Point) => {
    const projectedPoint = iso(point);
    return {
      x: (projectedPoint.x - centerX) * scale + width / 2,
      y: (projectedPoint.y - centerY) * scale + height / 2,
    };
  };

  // Grilla de fondo: los bordes de las celdas que cubre la forma, mas una.
  const cols = gridPoints.map((point) => point.x);
  const rows = gridPoints.map((point) => point.y);
  const fromCol = Math.floor(Math.min(...cols)) - 1;
  const toCol = Math.ceil(Math.max(...cols)) + 1;
  const fromRow = Math.floor(Math.min(...rows)) - 1;
  const toRow = Math.ceil(Math.max(...rows)) + 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let col = fromCol; col <= toCol; col += 1) {
    const from = toCanvas({ x: col + 0.5, y: fromRow + 0.5 });
    const to = toCanvas({ x: col + 0.5, y: toRow + 0.5 });
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  for (let row = fromRow; row <= toRow; row += 1) {
    const from = toCanvas({ x: fromCol + 0.5, y: row + 0.5 });
    const to = toCanvas({ x: toCol + 0.5, y: row + 0.5 });
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();

  for (const shape of shapes) {
    ctx.beginPath();
    shape.points.forEach((point, index) => {
      const { x, y } = toCanvas(point);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.closePath();
    if (shape.style === 'hit') {
      ctx.fillStyle = 'rgba(255, 214, 110, 0.35)';
      ctx.fill();
      ctx.strokeStyle = '#ffd66e';
      ctx.setLineDash([]);
    } else if (shape.style === 'path') {
      ctx.fillStyle = 'rgba(120, 190, 255, 0.22)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 190, 255, 0.9)';
      ctx.setLineDash([4, 3]);
    } else {
      ctx.strokeStyle = 'rgba(200, 200, 200, 0.55)';
      ctx.setLineDash([4, 4]);
    }
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Quien ataca, y hacia donde apunta.
  const origin = toCanvas({ x: 0, y: 0 });
  ctx.fillStyle = '#e08a3c';
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '10px Inter, "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(230, 230, 230, 0.6)';
  ctx.fillText('mouse →', width - 52, 14);
}
