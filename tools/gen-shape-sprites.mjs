// =============================================================================
// Generador del spritesheet de primitivas isometricas
// =============================================================================
//
// Rasteriza las figuras de bloqueo (cubo, piramide, rampa, ...) a PIXELES y
// escribe dos cosas, que tienen que salir siempre de la misma corrida:
//
//   assets/textures/shapes.png            <- lo que carga el RUNTIME
//   editor/src/app/core/shape-sheet.ts    <- los mismos pixeles + la tabla de
//                                            recortes, para el EDITOR
//
// POR QUE ASI. El motor no sabe dibujar geometria: dibuja un recorte de una
// textura (ver el Submit de main.cpp y sourceRect en schema/level.schema.json).
// Entonces, para que una primitiva exista de verdad en el juego, tiene que ser
// pixeles en un PNG y nada mas -- ningun campo nuevo en el schema, ninguna
// linea nueva de C++.
//
// Y POR QUE EL .TS. El editor tiene que dibujar EXACTAMENTE los mismos pixeles
// que el runtime, o el nivel se veria distinto en cada lado. Embebiendo el PNG
// en el bundle se logra eso sin darle al editor acceso binario al disco, y sin
// que la paleta quede vacia cuando todavia no hay un proyecto abierto.
//
// Uso:  node tools/gen-shape-sprites.mjs
//
// Es la UNICA fuente de verdad de estas figuras: editar el PNG a mano lo
// desincroniza del .ts. Para cambiar una figura se cambia SHAPES aca y se
// vuelve a correr.
// =============================================================================

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Medidas ----------------------------------------------------------------
//
// El sheet se genera para el tile estandar del proyecto (64x32, la proporcion
// 2:1 del pixel art isometrico; ver los defaults de grid en el schema).
const TILE_W = 64;
const TILE_H = 32;
const HALF_W = TILE_W / 2; // 32
const HALF_H = TILE_H / 2; // 16

// Alto de un cubo, y unidad en la que se miden las figuras. En 2:1 el lado
// vertical de un cubo mide medio tile de ancho, y asi las tres caras dan un
// cubo que se lee como cubo.
const CUBE = HALF_W; // 32

// Celda del sheet. El alto lo fija la figura mas alta (el pilar: 2 cubos mas
// el medio rombo de su base y el de su tapa) redondeado hacia arriba.
const CELL_W = 64;
const CELL_H = 96;
const COLS = 4;
// Separacion entre celdas. No hace falta para que el recorte salga bien (el
// motor y el editor muestrean sin filtrado), pero deja el sheet legible al
// abrirlo en un editor de imagenes y evita cualquier sangrado si algun dia se
// activa el filtrado bilineal.
const GUTTER = 2;

// Linea de suelo dentro de la celda: la Y del CENTRO del rombo de la base, que
// es el punto con el que la figura se apoya en su casilla. El medio rombo de
// adelante queda por debajo, ocupando las ultimas filas de la celda.
const GROUND_Y = CELL_H - 1 - HALF_H; // 79

// Cuanto hay que BAJAR el sprite respecto de donde lo pondria la regla de
// entidad del runtime (borde de abajo del sprite en el ancla de la celda).
//
// El runtime dibuja en  ancla.y - alto + groundOffset,  asi que el centro del
// rombo de la base cae en  ancla.y - alto + GROUND_Y + groundOffset.  Para que
// eso sea exactamente el ancla -- que es donde el runtime centra el piso --,
// el offset tiene que ser la distancia de la linea de suelo al borde inferior.
//
// Un personaje no declara el campo (queda en 0) y se sigue dibujando con los
// pies en el ancla, como siempre.
const GROUND_OFFSET = CELL_H - GROUND_Y; // 17

// --- Paleta -----------------------------------------------------------------
//
// Gris de arcilla, el criterio del material por defecto de Blender: un neutro
// que deja ver la forma sin competir con el arte real que venga despues.
const BASE = [157, 157, 157];
// Brillo por cara, con la luz entrando de arriba a la izquierda. Sin estos tres
// valores las caras se funden en una mancha plana y se pierde el volumen.
const FACE_TOP = 1.3;
const FACE_LEFT = 0.86;
const FACE_RIGHT = 0.58;
// Contorno: un gris bien oscuro (no negro puro) que despega la figura del fondo
// del viewport sin ensuciar la silueta.
const OUTLINE = [58, 58, 58, 255];

const shade = (factor) => [
  ...BASE.map((channel) => Math.max(0, Math.min(255, Math.round(channel * factor)))),
  255,
];

// --- Las figuras ------------------------------------------------------------
//
// height y width son las mismas unidades que usaba la version procedural:
// height en cubos, width como escala de la huella sobre la celda.
const SHAPES = [
  { id: 'cube', label: 'Cubo', height: 1, width: 1 },
  { id: 'pyramid', label: 'Piramide', height: 1.5, width: 1 },
  { id: 'ramp', label: 'Rampa', height: 1, width: 1 },
  { id: 'slab', label: 'Losa', height: 0.25, width: 1 },
  { id: 'cylinder', label: 'Cilindro', height: 1, width: 0.82 },
  { id: 'cone', label: 'Cono', height: 1.5, width: 0.82 },
  { id: 'sphere', label: 'Esfera', height: 1, width: 0.8 },
  { id: 'pillar', label: 'Pilar', height: 2, width: 0.42 },
];

// --- Lienzo de pixeles ------------------------------------------------------

const ROWS = Math.ceil(SHAPES.length / COLS);
const SHEET_W = (CELL_W + GUTTER) * COLS - GUTTER;
const SHEET_H = (CELL_H + GUTTER) * ROWS - GUTTER;
const pixels = new Uint8Array(SHEET_W * SHEET_H * 4); // RGBA, arranca transparente

function setPixel(x, y, rgba) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= SHEET_W || py >= SHEET_H) return;
  const offset = (py * SHEET_W + px) * 4;
  pixels[offset] = rgba[0];
  pixels[offset + 1] = rgba[1];
  pixels[offset + 2] = rgba[2];
  pixels[offset + 3] = rgba[3];
}

function getAlpha(x, y) {
  if (x < 0 || y < 0 || x >= SHEET_W || y >= SHEET_H) return 0;
  return pixels[(y * SHEET_W + x) * 4 + 3];
}

/**
 * Rellena un poligono convexo por barrido de scanlines.
 *
 * El barrido va por CENTRO de pixel (y + 0.5) a proposito: es lo que hace que
 * un rombo 2:1 salga con el escalonado limpio de dos pixeles de ancho por uno
 * de alto que caracteriza al pixel art isometrico, en vez de un borde con
 * escalones de tamano irregular.
 */
function fillPolygon(points, rgba) {
  const ys = points.map((p) => p.y);
  const yStart = Math.max(0, Math.floor(Math.min(...ys)));
  const yEnd = Math.min(SHEET_H - 1, Math.ceil(Math.max(...ys)));

  for (let y = yStart; y <= yEnd; y += 1) {
    const scan = y + 0.5;
    const crossings = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      // La arista cruza la scanline si scan cae entre sus dos Y.
      if (a.y <= scan && b.y > scan) {
        crossings.push(a.x + ((scan - a.y) / (b.y - a.y)) * (b.x - a.x));
      } else if (b.y <= scan && a.y > scan) {
        crossings.push(b.x + ((scan - b.y) / (a.y - b.y)) * (a.x - b.x));
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.round(crossings[i]);
      const to = Math.round(crossings[i + 1]) - 1;
      for (let x = from; x <= to; x += 1) setPixel(x, y, rgba);
    }
  }
}

/** Elipse rellena, para las bases y tapas de las figuras redondas. */
function fillEllipse(cx, cy, rx, ry, rgba) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const half = rx * Math.sqrt(1 - dy * dy);
    for (let x = Math.round(cx - half); x < Math.round(cx + half); x += 1) {
      setPixel(x, y, rgba);
    }
  }
}

function fillCircle(cx, cy, r, rgba) {
  fillEllipse(cx, cy, r, r, rgba);
}

/**
 * Contorno de 1px alrededor de la silueta de una celda.
 *
 * Se calcula DESPUES de pintar la figura y mirando el alpha: cualquier pixel
 * transparente pegado a uno opaco se vuelve contorno. Asi el borde sigue la
 * silueta real, sin tener que enumerar las aristas de cada figura -- y una
 * figura nueva lo hereda gratis.
 */
function outlineCell(cellX, cellY) {
  // Alpha CONFINADO a la celda: fuera de ella cuenta como vacio. Sin esto una
  // celda ve los pixeles de la de al lado y le pinta contorno adentro -- eso
  // metia una mota oscura en la primera fila de las figuras de la fila de
  // abajo, que en el juego se veria como suciedad sobre el sprite.
  const alphaInCell = (x, y) => {
    if (x < cellX || y < cellY || x >= cellX + CELL_W || y >= cellY + CELL_H) return 0;
    return getAlpha(x, y);
  };

  const edits = [];
  for (let y = cellY; y < cellY + CELL_H; y += 1) {
    for (let x = cellX; x < cellX + CELL_W; x += 1) {
      if (alphaInCell(x, y) !== 0) continue;
      const touchesShape =
        alphaInCell(x - 1, y) > 0 || alphaInCell(x + 1, y) > 0 ||
        alphaInCell(x, y - 1) > 0 || alphaInCell(x, y + 1) > 0;
      if (touchesShape) edits.push([x, y]);
    }
  }
  // En una segunda pasada: si se pintara sobre la marcha, el contorno recien
  // puesto contaria como "figura" y el borde crecería solo.
  for (const [x, y] of edits) setPixel(x, y, OUTLINE);
}

// --- Dibujo de cada figura --------------------------------------------------

function drawShape(def, cellX, cellY) {
  const rx = HALF_W * def.width;
  const ry = HALF_H * def.width;
  const height = CUBE * def.height;

  const cx = cellX + CELL_W / 2;
  const cy = cellY + GROUND_Y;

  // Rombo de la base, en sentido horario desde la punta de arriba.
  const T = { x: cx, y: cy - ry };
  const R = { x: cx + rx, y: cy };
  const B = { x: cx, y: cy + ry };
  const L = { x: cx - rx, y: cy };
  const up = (p) => ({ x: p.x, y: p.y - height });

  const top = shade(FACE_TOP);
  const left = shade(FACE_LEFT);
  const right = shade(FACE_RIGHT);

  switch (def.id) {
    // Cubo, losa y pilar son la misma construccion con distinto alto y ancho:
    // dos caras verticales al frente y la tapa encima.
    case 'cube':
    case 'slab':
    case 'pillar':
      fillPolygon([L, B, up(B), up(L)], left);
      fillPolygon([B, R, up(R), up(B)], right);
      fillPolygon([up(T), up(R), up(B), up(L)], top);
      break;

    case 'pyramid': {
      const apex = { x: cx, y: cy - height };
      fillPolygon([L, B, apex], left);
      fillPolygon([B, R, apex], right);
      break;
    }

    // Rampa: al ras en la arista de adelante (B-L) y elevada en la de atras
    // (T-R). La cara inclinada es el plano por el que se sube.
    case 'ramp':
      fillPolygon([L, B, up(R), up(T)], top);
      fillPolygon([B, R, up(R)], right);
      break;

    // Las redondas se arman por capas: base, cuerpo, tapa. La mitad inferior de
    // la elipse de la base asoma bajo el cuerpo y da la curvatura de apoyo.
    case 'cylinder':
      fillEllipse(cx, cy, rx, ry, right);
      fillPolygon(
        [
          { x: cx - rx, y: cy - height }, { x: cx + rx, y: cy - height },
          { x: cx + rx, y: cy }, { x: cx - rx, y: cy },
        ],
        left,
      );
      fillEllipse(cx, cy - height, rx, ry, top);
      break;

    case 'cone':
      fillEllipse(cx, cy, rx, ry, right);
      fillPolygon(
        [{ x: cx - rx, y: cy }, { x: cx + rx, y: cy }, { x: cx, y: cy - height }],
        left,
      );
      break;

    // La esfera no tiene caras planas que sombrear, asi que el volumen se hace
    // con BANDAS concentricas corridas hacia la luz -- la forma clasica de
    // sombrear una esfera en pixel art. Con dos tonos el brillo se lee como un
    // disco pegado encima; con cuatro y radios decrecientes, como una curva.
    case 'sphere': {
      const radius = rx;
      const center = { x: cx, y: cy - radius * 0.85 };

      fillEllipse(cx, cy, rx * 0.9, ry * 0.9, [40, 40, 40, 90]);

      // De la banda mas oscura (todo el disco) a la mas clara (el reflejo).
      const bands = [
        { factor: FACE_RIGHT, radius: 1, offset: 0 },
        { factor: 0.78, radius: 0.88, offset: 0.1 },
        { factor: 1.0, radius: 0.68, offset: 0.22 },
        { factor: FACE_TOP, radius: 0.4, offset: 0.38 },
      ];
      for (const band of bands) {
        fillCircle(
          center.x - radius * band.offset,
          center.y - radius * band.offset,
          radius * band.radius,
          shade(band.factor),
        );
      }
      break;
    }

    default:
      throw new Error('Figura sin dibujo: ' + def.id);
  }

  outlineCell(cellX, cellY);
}

// --- Codificacion PNG (sin dependencias) ------------------------------------
//
// Un PNG minimo es: firma + IHDR + IDAT + IEND. Cada chunk lleva su longitud,
// su tipo, sus datos y un CRC32. Se escribe a mano para que generar el sheet no
// meta una dependencia de npm en un repo que hoy no tiene ninguna para esto.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // color type 6 = RGBA
  // compresion 0, filtro 0, entrelazado 0 -> los tres bytes ya en cero

  // Cada scanline va precedida por su byte de filtro. Se usa 0 (sin filtro):
  // son imagenes chicas y de colores planos, y el filtrado no compensa la
  // complejidad extra aca.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    rgba.subarray(y * width * 4, (y + 1) * width * 4).forEach((byte, i) => {
      raw[rowStart + 1 + i] = byte;
    });
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Corrida ----------------------------------------------------------------

const cells = SHAPES.map((def, index) => {
  const cellX = (index % COLS) * (CELL_W + GUTTER);
  const cellY = Math.floor(index / COLS) * (CELL_H + GUTTER);
  drawShape(def, cellX, cellY);
  return { ...def, x: cellX, y: cellY };
});

const png = encodePng(SHEET_W, SHEET_H, pixels);
const pngPath = join(ROOT, 'assets', 'textures', 'shapes.png');
mkdirSync(dirname(pngPath), { recursive: true });
writeFileSync(pngPath, png);

const tsPath = join(ROOT, 'editor', 'src', 'app', 'core', 'shape-sheet.ts');
const entries = cells
  .map(
    (cell) =>
      `  {\n` +
      `    id: '${cell.id}',\n` +
      `    label: '${cell.label}',\n` +
      `    height: ${cell.height},\n` +
      `    sourceRect: { x: ${cell.x}, y: ${cell.y}, width: ${CELL_W}, height: ${CELL_H} },\n` +
      `    groundOffset: ${GROUND_OFFSET},\n` +
      `  },`,
  )
  .join('\n');

writeFileSync(
  tsPath,
  `// GENERADO POR tools/gen-shape-sprites.mjs -- NO EDITAR A MANO.
//
// Los mismos pixeles que assets/textures/shapes.png, embebidos para que el
// editor dibuje exactamente lo que va a dibujar el runtime. Para cambiar una
// figura se edita SHAPES en el generador y se lo vuelve a correr, que reescribe
// el PNG y este archivo de una sola pasada.

/** Ruta de la textura tal como va en el nivel (relativa a assets/). */
export const SHAPE_TEXTURE = 'textures/shapes.png';

/** Medidas del sheet, para recortar una celda por CSS en la paleta. */
export const SHAPE_SHEET_WIDTH = ${SHEET_W};
export const SHAPE_SHEET_HEIGHT = ${SHEET_H};

/** El sheet embebido, para dibujar en el canvas del editor. */
export const SHAPE_SHEET_DATA_URL =
  'data:image/png;base64,${png.toString('base64')}';

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
${entries}
];
`,
);

console.log('PNG   ' + pngPath + '  (' + SHEET_W + 'x' + SHEET_H + ', ' + png.length + ' bytes)');
console.log('TS    ' + tsPath);
for (const cell of cells) {
  console.log(
    '  ' + cell.id.padEnd(9) + ' recorte ' + `${cell.x},${cell.y} ${CELL_W}x${CELL_H}`,
  );
}
