// Genera levels/figuras.json: el nivel de prueba de las primitivas.
//
// Existe como script y no como archivo escrito a mano por dos motivos:
//
//   1. Los recortes salen de la tabla GENERADA (editor/src/app/core/shape-sheet.ts),
//      asi que no pueden quedar desfasados del PNG si se regenera el sheet.
//   2. Es facil pisar este nivel sin querer desde el editor (basta guardar
//      teniendolo abierto en una version vieja). Volver a tenerlo es correr
//      esto, no reescribirlo a mano.
//
// Uso:  node tools/gen-figuras-level.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Recortes, leidos de la tabla generada ----------------------------------
const sheetSource = readFileSync(
  join(ROOT, 'editor', 'src', 'app', 'core', 'shape-sheet.ts'),
  'utf8',
);
const cells = [
  ...sheetSource.matchAll(
    /id: '(\w+)',[\s\S]*?sourceRect: \{ x: (\d+), y: (\d+), width: (\d+), height: (\d+) \},\s*groundOffset: (\d+),\s*footprint: ([\d.]+),/g,
  ),
].map((m) => ({
  id: m[1],
  x: +m[2],
  y: +m[3],
  w: +m[4],
  h: +m[5],
  groundOffset: +m[6],
  footprint: +m[7],
}));

if (cells.length === 0) {
  throw new Error('No se pudo leer shape-sheet.ts: corre antes gen-shape-sprites.mjs');
}

// --- Medidas del nivel ------------------------------------------------------
//
// La grilla es 8x8 y NO se declara "tiles", asi que el motor genera piso
// completo mas una pared en todo el perimetro (col/row 0 y 7). El area jugable
// es el interior, 1..6.
//
// Que haya paredes de verdad es lo que evita que el jugador se frene con el
// clamp del borde de la grilla, que lo dejaria parado justo en el CENTRO del
// tile del borde. Con pared, se frena cuando su collider la toca. Y para que
// las paredes bloqueen hace falta declarar "visuals.wall": el motor condiciona
// la colision a que exista la textura.
const GRID = 8;
const INTERIOR_FIRST = 1;
const INTERIOR_LAST = GRID - 2; // 6

// Las figuras van cada dos celdas dentro del interior, para que se distingan.
const positions = [
  [1, 1], [3, 1], [5, 1],
  [1, 3], [3, 3], [5, 3],
  [1, 5], [3, 5],
];

const player = {
  id: 'player_1',
  type: 'player',
  position: { col: 5, row: 5 },
  texture: 'textures/player.png',
  sourceRect: { x: 0, y: 0, width: 16, height: 16 },
  animation: 'player_idle',
  collider: { width: 16, height: 16 },
};

const entities = [
  player,
  ...cells.map((cell, index) => ({
    id: cell.id + '_1',
    type: cell.id,
    position: { col: positions[index][0], row: positions[index][1] },
    texture: 'textures/shapes.png',
    sourceRect: { x: cell.x, y: cell.y, width: cell.w, height: cell.h },
    groundOffset: cell.groundOffset,
    // La misma cuenta que shapeCollider() en el editor: la huella de la base,
    // en pixeles de un tile de 64x32, y solida. Sin collider las figuras se
    // dibujaban pero el jugador las atravesaba.
    collider: {
      width: Math.max(1, Math.round(cell.footprint * 64)),
      height: Math.max(1, Math.round(cell.footprint * 32)),
      solid: true,
    },
  })),
];

// --- Comprobaciones antes de escribir ---------------------------------------
// Baratas, y cubren los dos errores que ya se colaron una vez: una entidad
// dentro del anillo de paredes, y dos entidades con el mismo id.
for (const entity of entities) {
  const { col, row } = entity.position;
  if (col < INTERIOR_FIRST || col > INTERIOR_LAST || row < INTERIOR_FIRST || row > INTERIOR_LAST) {
    throw new Error(`"${entity.id}" cae en el anillo de paredes: ${col},${row}`);
  }
}
const ids = entities.map((entity) => entity.id);
const repetidos = ids.filter((id, index) => ids.indexOf(id) !== index);
if (repetidos.length > 0) {
  throw new Error('ids repetidos: ' + [...new Set(repetidos)].join(', '));
}

// --- Escritura --------------------------------------------------------------
// Se arma el texto a mano y no con JSON.stringify para que los objetos chicos
// queden en una linea, como en levels/test_level.json: asi el archivo se lee
// y se versiona sin pelear con 6 lineas por cada "position".
const one = (object) => JSON.stringify(object).replace(/","/g, '", "').replace(/[{]/, '{ ').replace(/[}]$/, ' }').replace(/,"/g, ', "').replace(/":/g, '": ');

const entityBlock = (entity) => {
  const lines = [
    '      "id": ' + JSON.stringify(entity.id) + ',',
    '      "type": ' + JSON.stringify(entity.type) + ',',
    '      "position": ' + one(entity.position) + ',',
    '      "texture": ' + JSON.stringify(entity.texture) + ',',
    '      "sourceRect": ' + one(entity.sourceRect) + ',',
  ];
  if (entity.animation) lines.push('      "animation": ' + JSON.stringify(entity.animation) + ',');
  if (entity.groundOffset !== undefined) lines.push('      "groundOffset": ' + entity.groundOffset + ',');
  if (entity.collider) lines.push('      "collider": ' + one(entity.collider) + ',');
  // La ultima propiedad no lleva coma.
  lines[lines.length - 1] = lines[lines.length - 1].replace(/,$/, '');
  return '    {\n' + lines.join('\n') + '\n    }';
};

const text = [
  '{',
  '  "name": "prueba_figuras",',
  `  "grid": { "width": ${GRID}, "height": ${GRID}, "tileWidth": 64, "tileHeight": 32 },`,
  '  "visuals": {',
  '    "floor": {',
  '      "texture": "textures/floor.png",',
  '      "sourceRect": { "x": 0, "y": 0, "width": 64, "height": 64 }',
  '    },',
  '    "wall": {',
  '      "texture": "textures/wall.png",',
  '      "sourceRect": { "x": 0, "y": 0, "width": 32, "height": 32 }',
  '    }',
  '  },',
  '  "entities": [',
  entities.map(entityBlock).join(',\n'),
  '  ],',
  '  "events": []',
  '}',
].join('\n');

// Ultimo control: que lo escrito sea JSON valido de verdad.
JSON.parse(text);

const target = join(ROOT, 'levels', 'figuras.json');
writeFileSync(target, text + '\n');
console.log(
  'escrito ' + target + '  (grilla ' + GRID + 'x' + GRID +
  ', ' + entities.length + ' entidades, interior ' + INTERIOR_FIRST + '..' + INTERIOR_LAST + ')',
);
