// Objetos, armas y ataques: los valores por defecto, la validacion de lo que
// se lee de disco y el paso de un objeto de la biblioteca a un nivel.
//
// COMO VIAJA UN OBJETO. La biblioteca del proyecto (items.json, junto a
// characters.json) es donde se crean y editan. Un nivel no la lee: cuando algo
// del nivel referencia un objeto -- colocarlo, darselo al jugador de entrada,
// que lo suelte un enemigo, que lo venda un NPC, un evento -- el editor COPIA
// la definicion a "items" del nivel (withItemDefs). Es el mismo trato que los
// personajes configurados: el nivel se juega solo, y cambiar la biblioteca
// despues no altera lo ya armado hasta que se vuelva a elegir el objeto.
//
// Las distancias van en celdas, igual que en el motor (loader/ItemDefs.hpp).

import {
  AbilityDef,
  AttackDef,
  AttackPattern,
  ItemDef,
  ItemKind,
  WeaponCategory,
} from '../models/item.model';
import { EventDefinition, GridPosition, Level, LevelEntity } from '../models/level.model';
import { nextFreeId } from './dungeon-layout';

/** Campo de un ataque que el formulario puede mostrar, ademas de dano y pausa. */
export type AttackField = 'range' | 'width' | 'angle' | 'radius' | 'speed' | 'delay' | 'pierce' | 'heal';

export interface PatternDef {
  id: AttackPattern;
  label: string;
  /** La categoria donde tiene sentido primero. Cualquier arma puede usar cualquiera. */
  category: WeaponCategory;
  glyph: string;
  hint: string;
  /** Los campos que usa esta forma: los demas no se muestran ni se guardan. */
  fields: readonly AttackField[];
}

export const ATTACK_PATTERNS: readonly PatternDef[] = [
  {
    id: 'line',
    label: 'Lineal',
    category: 'melee',
    glyph: '━',
    hint: 'Golpe en línea recta hacia donde apunta el mouse.',
    fields: ['range', 'width'],
  },
  {
    id: 'area',
    label: 'Área',
    category: 'melee',
    glyph: '◎',
    hint: 'Golpea todo alrededor del personaje, en cualquier dirección.',
    fields: ['range', 'heal'],
  },
  {
    id: 'cone',
    label: 'Reloj',
    category: 'melee',
    glyph: '◔',
    hint: 'Sector de reloj abierto hacia donde apunta el mouse.',
    fields: ['range', 'angle'],
  },
  {
    id: 'projectile',
    label: 'Proyectil',
    category: 'ranged',
    glyph: '➶',
    hint: 'Sale hacia el mouse en línea recta y golpea al primero que toca (o atraviesa).',
    fields: ['range', 'speed', 'width', 'pierce'],
  },
  {
    id: 'remote_area',
    label: 'Área remota',
    category: 'ranged',
    glyph: '⊚',
    hint: 'Cae en el punto del mouse, hasta el alcance máximo, tras una demora marcada en el piso.',
    fields: ['range', 'radius', 'delay', 'heal'],
  },
  {
    id: 'explosive',
    label: 'Explosivo',
    category: 'ranged',
    glyph: '✹',
    hint: 'Proyectil que explota con daño de área al chocar o al llegar a su distancia máxima.',
    fields: ['range', 'speed', 'width', 'radius', 'heal'],
  },
];

const PATTERN_BY_ID = new Map<string, PatternDef>(ATTACK_PATTERNS.map((def) => [def.id, def]));

export function isAttackPattern(value: unknown): value is AttackPattern {
  return typeof value === 'string' && PATTERN_BY_ID.has(value);
}

export function patternDef(pattern: AttackPattern): PatternDef {
  return PATTERN_BY_ID.get(pattern) as PatternDef;
}

export interface AttackFieldDef {
  label: string;
  hint: string;
  step: number;
  min: number;
  max?: number;
}

/** Etiqueta y limites de cada campo. "range" cambia de nombre segun la forma (ver rangeLabel). */
export const ATTACK_FIELDS: Record<Exclude<AttackField, 'pierce'>, AttackFieldDef> = {
  range: { label: 'Alcance', hint: 'En celdas', step: 0.1, min: 0.1 },
  width: { label: 'Ancho', hint: 'En celdas', step: 0.1, min: 0.1 },
  angle: { label: 'Apertura (°)', hint: 'Grados del sector de reloj', step: 5, min: 5, max: 360 },
  radius: { label: 'Radio del área', hint: 'En celdas', step: 0.1, min: 0.1 },
  speed: { label: 'Velocidad', hint: 'Celdas por segundo', step: 0.5, min: 0.5 },
  delay: { label: 'Demora (s)', hint: 'Segundos hasta que cae', step: 0.05, min: 0 },
  heal: { label: 'Cura a quien lanza', hint: 'Vida si queda dentro del efecto', step: 1, min: 0 },
};

/** Que significa "range" en cada forma. */
export function rangeLabel(pattern: AttackPattern): string {
  switch (pattern) {
    case 'line':
    case 'cone':
      return 'Largo';
    case 'area':
      return 'Radio';
    case 'remote_area':
      return 'Alcance máximo';
    default:
      return 'Distancia máxima';
  }
}

/** Valores de partida de cada forma: jugables tal cual, para ajustar despues. */
export function defaultAttack(pattern: AttackPattern): AttackDef {
  switch (pattern) {
    case 'line':
      return { pattern, damage: 12, cooldown: 0.45, range: 1.8, width: 0.8 };
    case 'area':
      return { pattern, damage: 10, cooldown: 0.6, range: 1.5 };
    case 'cone':
      return { pattern, damage: 12, cooldown: 0.5, range: 1.6, angle: 100 };
    case 'projectile':
      return { pattern, damage: 8, cooldown: 0.5, range: 7, speed: 9, width: 0.4 };
    case 'remote_area':
      return { pattern, damage: 15, cooldown: 1.2, range: 6, radius: 1.5, delay: 0.5 };
    case 'explosive':
      return { pattern, damage: 14, cooldown: 1, range: 6, speed: 7, width: 0.5, radius: 1.6 };
  }
}

/**
 * Cambia la forma de un ataque conservando lo que no depende de ella (dano y
 * pausa). Las medidas vuelven a las de la forma nueva: un "largo" de linea no
 * significa nada como radio de un area remota.
 */
export function withPattern(attack: AttackDef, pattern: AttackPattern): AttackDef {
  return { ...defaultAttack(pattern), damage: attack.damage, cooldown: attack.cooldown };
}

export function defaultWeapon(category: WeaponCategory) {
  return { category, attack: defaultAttack(category === 'melee' ? 'cone' : 'projectile') };
}

export function defaultAbility(category: WeaponCategory): AbilityDef {
  return category === 'melee'
    ? { name: 'Giro cargado', hitsRequired: 3, activation: 'auto', resetAfter: 3, attack: { ...defaultAttack('area'), damage: 25, range: 2 } }
    : { name: 'Disparo cargado', hitsRequired: 4, activation: 'manual', resetAfter: 0, attack: { ...defaultAttack('explosive'), damage: 25 } };
}

export interface ItemKindDef {
  id: ItemKind;
  label: string;
  glyph: string;
  color: string;
  hint: string;
}

export const ITEM_KINDS: readonly ItemKindDef[] = [
  { id: 'weapon', label: 'Arma', glyph: '⚔', color: '#b07a3c', hint: 'Va al inventario del jugador; se elige con las teclas 1 a 9.' },
  { id: 'healing', label: 'Curación', glyph: '✚', color: '#5f9e4a', hint: 'Cura al juntarla. Con la vida llena se queda en el piso.' },
  { id: 'coin', label: 'Moneda', glyph: '●', color: '#c9a227', hint: 'Suma monedas para comprarle a los NPC con tienda.' },
];

export function itemKindDef(kind: ItemKind): ItemKindDef {
  return ITEM_KINDS.find((def) => def.id === kind) as ItemKindDef;
}

/** Un objeto nuevo sin guardar, de ese tipo. */
export function newItemDraft(kind: ItemKind, category: WeaponCategory = 'melee'): ItemDef {
  const base: ItemDef = {
    id: '',
    name: kind === 'weapon' ? (category === 'melee' ? 'Nueva espada' : 'Nuevo arco') : kind === 'healing' ? 'Poción' : 'Moneda',
    kind,
    texture: 'textures/player.png',
    sourceRect: { x: 0, y: 0, width: 16, height: 16 },
  };
  if (kind === 'weapon') {
    base.weapon = defaultWeapon(category);
  } else if (kind === 'healing') {
    base.heal = 25;
  } else {
    base.value = 1;
  }
  return base;
}

const finite = (value: unknown, fallback: number, min: number, max = Infinity) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/**
 * Un ataque leido de disco, con la forma validada, los numeros en rango y SOLO
 * los campos que usa su forma: el JSON queda con lo que el motor lee.
 */
export function normalizeAttack(raw: unknown): AttackDef {
  const data = (raw ?? {}) as Partial<AttackDef>;
  const pattern = isAttackPattern(data.pattern) ? data.pattern : 'area';
  const defaults = defaultAttack(pattern);
  const attack: AttackDef = {
    pattern,
    damage: finite(data.damage, defaults.damage, 0),
    cooldown: finite(data.cooldown, defaults.cooldown, 0),
    range: finite(data.range, defaults.range, 0.1),
  };
  for (const field of patternDef(pattern).fields) {
    if (field === 'pierce') {
      if (data.pierce === true) {
        attack.pierce = true;
      }
      continue;
    }
    const limits = ATTACK_FIELDS[field];
    const fallback = defaults[field] ?? 0;
    const value = finite(data[field], fallback, limits.min, limits.max);
    // heal es opcional de verdad: 0 no se escribe.
    if (field === 'heal' && value === 0) {
      continue;
    }
    attack[field] = value;
  }
  return attack;
}

/** Un objeto leido de items.json (o de un nivel), completado y en rango. */
export function normalizeItem(raw: unknown): ItemDef {
  const data = (raw ?? {}) as Partial<ItemDef>;
  const kind: ItemKind = data.kind === 'weapon' || data.kind === 'healing' || data.kind === 'coin' ? data.kind : 'coin';
  const base = newItemDraft(kind, data.weapon?.category === 'ranged' ? 'ranged' : 'melee');
  const rect = data.sourceRect ?? base.sourceRect;
  const item: ItemDef = {
    id: typeof data.id === 'string' && data.id ? data.id : itemIdFromName(data.name ?? base.name, []),
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : base.name,
    kind,
    texture: typeof data.texture === 'string' && data.texture ? data.texture : base.texture,
    sourceRect: {
      x: finite(rect.x, 0, 0),
      y: finite(rect.y, 0, 0),
      width: finite(rect.width, 16, 1),
      height: finite(rect.height, 16, 1),
    },
  };
  const scale = finite(data.scale, 1, 0.1);
  if (scale !== 1) {
    item.scale = scale;
  }
  if (kind === 'weapon') {
    const weapon = data.weapon;
    item.weapon = {
      category: weapon?.category === 'ranged' ? 'ranged' : 'melee',
      attack: weapon?.attack ? normalizeAttack(weapon.attack) : (base.weapon as NonNullable<ItemDef['weapon']>).attack,
    };
    if (weapon?.ability) {
      const ability = weapon.ability;
      item.weapon.ability = {
        name: typeof ability.name === 'string' && ability.name.trim() ? ability.name.trim() : 'Habilidad',
        hitsRequired: Math.round(finite(ability.hitsRequired, 3, 1, 99)),
        activation: ability.activation === 'manual' ? 'manual' : 'auto',
        resetAfter: finite(ability.resetAfter, 0, 0),
        attack: normalizeAttack(ability.attack),
      };
    }
  } else if (kind === 'healing') {
    item.heal = finite(data.heal, 25, 0);
  } else {
    item.value = Math.round(finite(data.value, 1, 1));
  }
  return item;
}

/**
 * Id para un objeto nuevo a partir de su nombre: minusculas, sin tildes, lo que
 * no sea letra o numero pasa a "_", y _2, _3... si ya existe. Queda legible
 * porque es lo que se lee en los eventos y el prefijo de sus entidades.
 */
export function itemIdFromName(name: string, taken: Iterable<string>): string {
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'objeto';
  const used = new Set(taken);
  if (!used.has(slug)) {
    return slug;
  }
  let index = 2;
  while (used.has(slug + '_' + index)) {
    index += 1;
  }
  return slug + '_' + index;
}

/** Ids de objeto que usa un parametro de evento de tipo item_ref ("item"). */
function eventItemIds(events: readonly EventDefinition[]): string[] {
  const steps = events.flatMap((event) => [event.trigger, ...(event.conditions ?? []), ...event.actions]);
  return steps.map((step) => step.params['item']).filter((id): id is string => typeof id === 'string' && id !== '');
}

/** Todo id de objeto que el nivel referencia: entidades, inventario, drops, tiendas y eventos. */
export function referencedItemIds(level: Pick<Level, 'entities' | 'events'>): Set<string> {
  const ids = new Set<string>();
  for (const entity of level.entities) {
    for (const id of [
      entity.item,
      entity.weapon,
      ...(entity.inventory?.items ?? []),
      ...(entity.drops ?? []).map((drop) => drop.item),
      ...(entity.shop?.items ?? []).map((entry) => entry.item),
    ]) {
      if (id) {
        ids.add(id);
      }
    }
  }
  for (const id of eventItemIds(level.events)) {
    ids.add(id);
  }
  return ids;
}

/** Copia (o actualiza) definiciones en "items" del nivel, por id. */
export function withItemDefs<T extends Pick<Level, 'items'>>(level: T, defs: readonly ItemDef[]): T {
  if (defs.length === 0) {
    return level;
  }
  const replaced = new Map(defs.map((def) => [def.id, structuredClone(def)]));
  const kept = (level.items ?? []).filter((item) => !replaced.has(item.id));
  return { ...level, items: [...kept, ...replaced.values()] };
}

/** Objetos referenciados que el nivel todavia no define: el motor no los va a encontrar. */
export function missingItemIds(level: Level): string[] {
  const defined = new Set((level.items ?? []).map((item) => item.id));
  return [...referencedItemIds(level)].filter((id) => !defined.has(id));
}

/**
 * La entidad que se coloca al arrastrar un objeto a la grilla: type "item", la
 * referencia al objeto y su sprite. Collider sensor (no solido) para que
 * ademas dispare "Al colisionar" como cualquier objeto.
 */
export function entityFromItem(def: ItemDef, position: GridPosition, takenIds: ReadonlySet<string>): LevelEntity {
  const entity: LevelEntity = {
    id: nextFreeId(def.id, takenIds),
    type: 'item',
    item: def.id,
    position: { col: position.col, row: position.row },
    texture: def.texture,
    sourceRect: { ...def.sourceRect },
    collider: { width: 16, height: 16 },
  };
  if (def.scale && def.scale !== 1) {
    entity.scale = def.scale;
  }
  return entity;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Resumen de una linea: "Reloj 100° · 1.6 celdas · 12 daño · cada 0.5 s". */
export function describeAttack(attack: AttackDef): string {
  const parts = [patternDef(attack.pattern).label];
  if (attack.pattern === 'cone') {
    parts[0] += ' ' + round(attack.angle ?? 90) + '°';
  }
  parts.push(round(attack.range) + ' celdas');
  if (attack.pattern === 'remote_area' || attack.pattern === 'explosive') {
    parts.push('radio ' + round(attack.radius ?? 1.5));
  }
  parts.push(round(attack.damage) + ' daño');
  parts.push('cada ' + round(attack.cooldown) + ' s');
  return parts.join(' · ');
}

// --- Vista previa ------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

/**
 * Una forma de la vista previa, en celdas desde el centro de quien ataca:
 *   hit    lo que golpea
 *   path   por donde viaja un proyectil
 *   range  hasta donde se puede apuntar (solo contorno)
 */
export interface PreviewShape {
  style: 'hit' | 'path' | 'range';
  points: Point[];
}

const SEGMENTS = 32;

function circle(center: Point, radius: number): Point[] {
  return Array.from({ length: SEGMENTS }, (_, index) => {
    const angle = (2 * Math.PI * index) / SEGMENTS;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
}

function strip(from: Point, direction: Point, length: number, width: number): Point[] {
  const side = { x: (-direction.y * width) / 2, y: (direction.x * width) / 2 };
  const end = { x: from.x + direction.x * length, y: from.y + direction.y * length };
  return [
    { x: from.x + side.x, y: from.y + side.y },
    { x: end.x + side.x, y: end.y + side.y },
    { x: end.x - side.x, y: end.y - side.y },
    { x: from.x - side.x, y: from.y - side.y },
  ];
}

/**
 * La forma que dibuja un ataque apuntando en "direction" (normalizada). Es la
 * MISMA geometria que resuelve engine/game/Combat.cpp, para que la vista
 * previa del editor diga la verdad sobre lo que golpea en el juego.
 */
export function attackPreview(attack: AttackDef, direction: Point): PreviewShape[] {
  const origin = { x: 0, y: 0 };
  switch (attack.pattern) {
    case 'line':
      return [{ style: 'hit', points: strip(origin, direction, attack.range, attack.width ?? 0.8) }];
    case 'area':
      return [{ style: 'hit', points: circle(origin, attack.range) }];
    case 'cone': {
      const angle = attack.angle ?? 90;
      if (angle >= 360) {
        return [{ style: 'hit', points: circle(origin, attack.range) }];
      }
      const facing = Math.atan2(direction.y, direction.x);
      const half = ((angle * Math.PI) / 180) / 2;
      const steps = Math.max(4, Math.round((angle / 360) * SEGMENTS));
      const arc = Array.from({ length: steps + 1 }, (_, index) => {
        const current = facing - half + (2 * half * index) / steps;
        return { x: Math.cos(current) * attack.range, y: Math.sin(current) * attack.range };
      });
      return [{ style: 'hit', points: [origin, ...arc] }];
    }
    case 'projectile':
      return [{ style: 'path', points: strip(origin, direction, attack.range, attack.width ?? 0.4) }];
    case 'remote_area': {
      // Apuntado a tres cuartos del alcance, para que se vean las dos cosas.
      const target = { x: direction.x * attack.range * 0.75, y: direction.y * attack.range * 0.75 };
      return [
        { style: 'range', points: circle(origin, attack.range) },
        { style: 'hit', points: circle(target, attack.radius ?? 1.5) },
      ];
    }
    case 'explosive': {
      const impact = attack.range * 0.75;
      const target = { x: direction.x * impact, y: direction.y * impact };
      return [
        { style: 'path', points: strip(origin, direction, impact, attack.width ?? 0.5) },
        { style: 'hit', points: circle(target, attack.radius ?? 1.5) },
      ];
    }
  }
}
