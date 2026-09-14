import { ItemDef } from '../models/item.model';
import { Level } from '../models/level.model';
import {
  attackPreview,
  describeAttack,
  entityFromItem,
  itemIdFromName,
  missingItemIds,
  normalizeAttack,
  normalizeItem,
  referencedItemIds,
  withItemDefs,
  withPattern,
} from './items';

const sword: ItemDef = {
  id: 'espada',
  name: 'Espada',
  kind: 'weapon',
  texture: 'textures/shapes.png',
  sourceRect: { x: 0, y: 0, width: 16, height: 16 },
  weapon: { category: 'melee', attack: { pattern: 'cone', damage: 12, cooldown: 0.4, range: 1.6, angle: 100 } },
};

const potion: ItemDef = {
  id: 'pocion',
  name: 'Poción',
  kind: 'healing',
  texture: 'textures/shapes.png',
  sourceRect: { x: 0, y: 0, width: 16, height: 16 },
  heal: 30,
};

function level(partial: Partial<Level>): Level {
  return {
    name: 'n',
    grid: { width: 10, height: 10, tileWidth: 64, tileHeight: 32 },
    entities: [],
    events: [],
    ...partial,
  };
}

describe('normalizeAttack', () => {
  it('deja solo los campos que usa su forma', () => {
    const attack = normalizeAttack({ pattern: 'line', damage: 5, cooldown: 1, range: 2, width: 1, angle: 45, radius: 3 });
    expect(attack).toEqual({ pattern: 'line', damage: 5, cooldown: 1, range: 2, width: 1 });
  });

  it('una forma desconocida cae en area en vez de romper', () => {
    expect(normalizeAttack({ pattern: 'laser', damage: 1, cooldown: 1, range: 1 }).pattern).toBe('area');
  });

  it('lleva los numeros a rango', () => {
    const attack = normalizeAttack({ pattern: 'cone', damage: -3, cooldown: -1, range: 0, angle: 900 });
    expect(attack.damage).toBe(0);
    expect(attack.cooldown).toBe(0);
    expect(attack.range).toBe(0.1);
    expect(attack.angle).toBe(360);
  });

  it('completa con el default de la forma lo que falta', () => {
    const attack = normalizeAttack({ pattern: 'remote_area', damage: 9, cooldown: 1, range: 4 });
    expect(attack.radius).toBe(1.5);
    expect(attack.delay).toBe(0.5);
  });

  it('no escribe una curacion en 0 ni un pierce en false', () => {
    const area = normalizeAttack({ pattern: 'area', damage: 1, cooldown: 1, range: 1, heal: 0 });
    expect('heal' in area).toBe(false);
    const arrow = normalizeAttack({ pattern: 'projectile', damage: 1, cooldown: 1, range: 1, pierce: false });
    expect('pierce' in arrow).toBe(false);
  });
});

describe('withPattern', () => {
  it('cambia la forma pero conserva dano y pausa', () => {
    const changed = withPattern({ pattern: 'line', damage: 40, cooldown: 2, range: 3, width: 1 }, 'explosive');
    expect(changed.pattern).toBe('explosive');
    expect(changed.damage).toBe(40);
    expect(changed.cooldown).toBe(2);
    expect(changed.radius).toBeGreaterThan(0);
    expect('width' in changed && changed.width).toBe(0.5);
  });
});

describe('normalizeItem', () => {
  it('un arma conserva su habilidad, normalizada', () => {
    const item = normalizeItem({
      ...sword,
      weapon: {
        ...sword.weapon,
        ability: { hitsRequired: 0, activation: 'rara', attack: { pattern: 'area', damage: 20, cooldown: 1, range: 2 } },
      },
    });
    expect(item.weapon?.ability).toEqual({
      name: 'Habilidad',
      hitsRequired: 1,
      activation: 'auto',
      resetAfter: 0,
      attack: { pattern: 'area', damage: 20, cooldown: 1, range: 2 },
    });
  });

  it('solo guarda el campo de su tipo', () => {
    const item = normalizeItem({ ...potion, weapon: sword.weapon, value: 3 });
    expect(item.heal).toBe(30);
    expect('weapon' in item).toBe(false);
    expect('value' in item).toBe(false);
  });

  it('una moneda vale al menos 1, entero', () => {
    expect(normalizeItem({ id: 'm', name: 'M', kind: 'coin', value: 0.4 }).value).toBe(1);
    expect(normalizeItem({ id: 'm', name: 'M', kind: 'coin', value: 4.6 }).value).toBe(5);
  });

  it('un tipo desconocido cae en moneda', () => {
    expect(normalizeItem({ id: 'x', name: 'X', kind: 'llave' }).kind).toBe('coin');
  });
});

describe('referencedItemIds', () => {
  it('junta lo que usan entidades y eventos', () => {
    const ids = referencedItemIds(
      level({
        entities: [
          {
            id: 'player_1',
            type: 'player',
            position: { col: 0, row: 0 },
            texture: 't',
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
            inventory: { items: ['espada'] },
          },
          {
            id: 'enemy_1',
            type: 'enemy',
            position: { col: 1, row: 0 },
            texture: 't',
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
            weapon: 'arco',
            drops: [{ item: 'moneda', chance: 0.5 }],
          },
          {
            id: 'npc_1',
            type: 'npc',
            position: { col: 2, row: 0 },
            texture: 't',
            sourceRect: { x: 0, y: 0, width: 1, height: 1 },
            shop: { items: [{ item: 'pocion', price: 3 }] },
          },
        ],
        events: [{ trigger: { type: 'on_ability_used', params: { item: 'baston' } }, actions: [] }],
      }),
    );
    expect([...ids].sort()).toEqual(['arco', 'baston', 'espada', 'moneda', 'pocion']);
  });
});

describe('withItemDefs', () => {
  it('reemplaza por id y conserva los demas', () => {
    const renamed = { ...sword, name: 'Espada larga' };
    const result = withItemDefs(level({ items: [sword, potion] }), [renamed]);
    expect(result.items?.map((item) => item.name).sort()).toEqual(['Espada larga', 'Poción']);
  });

  it('copia la definicion: editar la biblioteca despues no toca el nivel', () => {
    const result = withItemDefs(level({}), [sword]);
    expect(result.items?.[0]).toEqual(sword);
    expect(result.items?.[0]).not.toBe(sword);
  });
});

describe('missingItemIds', () => {
  it('avisa lo referenciado que el nivel no define', () => {
    const current = level({
      items: [sword],
      entities: [
        {
          id: 'enemy_1',
          type: 'enemy',
          position: { col: 1, row: 0 },
          texture: 't',
          sourceRect: { x: 0, y: 0, width: 1, height: 1 },
          weapon: 'espada',
          drops: [{ item: 'pocion', chance: 1 }],
        },
      ],
    });
    expect(missingItemIds(current)).toEqual(['pocion']);
  });
});

describe('entityFromItem', () => {
  it('coloca un objeto para juntar con su sprite y un sensor', () => {
    const entity = entityFromItem(potion, { col: 2, row: 3 }, new Set(['pocion_1']));
    expect(entity).toEqual({
      id: 'pocion_2',
      type: 'item',
      item: 'pocion',
      position: { col: 2, row: 3 },
      texture: 'textures/shapes.png',
      sourceRect: { x: 0, y: 0, width: 16, height: 16 },
      collider: { width: 16, height: 16 },
    });
  });
});

describe('attackPreview', () => {
  const right = { x: 1, y: 0 };

  it('el reloj sale del centro y su arco queda a la distancia del largo', () => {
    const [shape] = attackPreview({ pattern: 'cone', damage: 1, cooldown: 1, range: 2, angle: 90 }, right);
    expect(shape.points[0]).toEqual({ x: 0, y: 0 });
    for (const point of shape.points.slice(1)) {
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(2);
      expect(Math.abs(Math.atan2(point.y, point.x))).toBeLessThanOrEqual(Math.PI / 4 + 1e-9);
    }
  });

  it('el area remota muestra el alcance y el impacto', () => {
    const shapes = attackPreview({ pattern: 'remote_area', damage: 1, cooldown: 1, range: 4, radius: 1 }, right);
    expect(shapes.map((shape) => shape.style)).toEqual(['range', 'hit']);
    const hit = shapes[1].points;
    const center = {
      x: hit.reduce((sum, point) => sum + point.x, 0) / hit.length,
      y: hit.reduce((sum, point) => sum + point.y, 0) / hit.length,
    };
    expect(center.x).toBeCloseTo(3);
    expect(center.y).toBeCloseTo(0);
  });

  it('la linea tiene el ancho y el largo del ataque', () => {
    const [shape] = attackPreview({ pattern: 'line', damage: 1, cooldown: 1, range: 3, width: 1 }, right);
    const xs = shape.points.map((point) => point.x);
    const ys = shape.points.map((point) => point.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1);
  });
});

describe('describeAttack', () => {
  it('resume la forma, las medidas y el ritmo', () => {
    expect(describeAttack(sword.weapon!.attack)).toBe('Reloj 100° · 1.6 celdas · 12 daño · cada 0.4 s');
  });
});

describe('itemIdFromName', () => {
  it('queda legible y no repite', () => {
    expect(itemIdFromName('Bastón de Fuego', [])).toBe('baston_de_fuego');
    expect(itemIdFromName('Espada', ['espada'])).toBe('espada_2');
    expect(itemIdFromName('¿?', [])).toBe('objeto');
  });
});
