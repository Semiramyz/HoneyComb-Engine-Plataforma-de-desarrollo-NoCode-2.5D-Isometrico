// Personajes: los cuatro tipos base (jugador, enemigo, NPC, objeto) y el paso
// de un personaje configurado a una entidad del nivel.
//
// QUE ES CADA TIPO EN EL JUEGO, con lo que el runtime sabe hacer hoy:
//
//   Jugador  el motor mueve con las flechas UNICAMENTE a la entidad con id
//            "player_1" (convencion de main.cpp). Por eso el primer jugador
//            que se coloca reclama ese id: uno con otro id se dibuja pero no
//            responde a las teclas. Su "stats.speed" es la velocidad con la que
//            se mueve.
//
//   Enemigo  collider NO solido, a proposito: uno solido frena al jugador ANTES
//            de que los sprites lleguen a solaparse, y entonces on_collision no
//            dispara nunca. Como sensor, chocarlo dispara el evento.
//
//   NPC      igual que el enemigo, con otro "type" para distinguirlos.
//
//   Objeto   pensado para "tocar y que desaparezca": sensor + la accion
//            destroy_entity del catalogo de eventos.
//
// Vida y dano ya viajan en el nivel ("stats") para el sistema de combate.

import { CharacterKind, CharacterPreset } from '../models/character-preset.model';
import {
  ColliderConfig,
  EntityStats,
  GridPosition,
  LevelEntity,
  SourceRect,
} from '../models/level.model';
import { nextFreeId } from './dungeon-layout';

export type CharacterId = CharacterKind;

/** Id que el motor mueve con las flechas. Ver main.cpp. */
export const ENGINE_PLAYER_ID = 'player_1';

export interface CharacterDef {
  id: CharacterId;
  label: string;
  /** El "type" que se guarda en la entidad. Texto libre en el schema. */
  type: string;
  /** Prefijo de los ids autogenerados ("enemy_1", "enemy_2"...). */
  idBase: string;
  /** Ruta relativa a assets/, como la espera AssetResolver del motor. */
  texture: string;
  sourceRect: SourceRect;
  collider: ColliderConfig;
  frames: number;
  frameDuration: number;
  stats: EntityStats;
  /** Color del icono de la paleta y del rectangulo que dibuja el viewport. */
  color: string;
  glyph: string;
  /** Que hace en el juego, para la barra de estado al elegirlo. */
  hint: string;
}

const SPRITE: SourceRect = { x: 0, y: 0, width: 16, height: 16 };

export const CHARACTERS: readonly CharacterDef[] = [
  {
    id: 'player',
    label: 'Jugador',
    type: 'player',
    idBase: 'player',
    texture: 'textures/player.png',
    sourceRect: { ...SPRITE },
    collider: { width: 16, height: 16 },
    // Los mismos dos cuadros de 0.4 s que tenia escrito a mano main.cpp.
    frames: 2,
    frameDuration: 0.4,
    stats: { health: 100, damage: 10, speed: 3 },
    color: '#e08a3c',
    glyph: '☻',
    hint: 'Jugador: el motor lo mueve con las flechas. Solo uno por nivel.',
  },
  {
    id: 'enemy',
    label: 'Enemigo',
    type: 'enemy',
    idBase: 'enemy',
    texture: 'textures/player2.png',
    sourceRect: { ...SPRITE },
    collider: { width: 16, height: 16 },
    frames: 1,
    frameDuration: 0.15,
    stats: { health: 30, damage: 10, speed: 1.5 },
    color: '#c05050',
    glyph: '☠',
    hint: 'Enemigo: al tocarlo dispara "Al colisionar". Tiene vida y daño para el combate.',
  },
  {
    id: 'npc',
    label: 'NPC',
    type: 'npc',
    idBase: 'npc',
    texture: 'textures/player.png',
    sourceRect: { ...SPRITE },
    collider: { width: 16, height: 16 },
    frames: 1,
    frameDuration: 0.15,
    stats: { health: 10, damage: 0, speed: 1 },
    color: '#4772b3',
    glyph: '☺',
    hint: 'NPC: sensor de contacto, igual que el enemigo pero con otro type.',
  },
  {
    id: 'item',
    label: 'Objeto',
    type: 'item',
    idBase: 'item',
    texture: 'textures/player.png',
    sourceRect: { ...SPRITE },
    collider: { width: 16, height: 16 },
    frames: 1,
    frameDuration: 0.15,
    stats: { health: 1, damage: 0, speed: 0 },
    color: '#5f9e4a',
    glyph: '◆',
    hint: 'Objeto: al tocarlo dispara un evento; usalo con la accion "Destruir entidad".',
  },
];

const CHARACTER_BY_ID = new Map<string, CharacterDef>(CHARACTERS.map((def) => [def.id, def]));
const CHARACTER_BY_TYPE = new Map<string, CharacterDef>(CHARACTERS.map((def) => [def.type, def]));

export function isCharacterKind(value: unknown): value is CharacterKind {
  return typeof value === 'string' && CHARACTER_BY_ID.has(value);
}

export function characterDef(id: string): CharacterDef | undefined {
  return CHARACTER_BY_ID.get(id);
}

/**
 * El tipo de personaje de una entidad, por su "type". No se mira la textura:
 * cambiarle el arte a un enemigo es lo primero que uno hace, y sigue siendo un
 * enemigo.
 */
export function characterOf(entity: { type: string }): CharacterDef | undefined {
  return CHARACTER_BY_TYPE.get(entity.type);
}

/** Vida, dano y velocidad por defecto para una entidad sin "stats". */
export function defaultStatsFor(type: string): EntityStats {
  const def = CHARACTER_BY_TYPE.get(type);
  return def ? { ...def.stats } : { health: 100, damage: 0, speed: 3 };
}

// --- Personajes configurados -------------------------------------------------

const BASE_PREFIX = 'base-';

/** Id del personaje base de un tipo, el que existe siempre aunque no se haya guardado nada. */
export function basePresetId(kind: CharacterKind): string {
  return BASE_PREFIX + kind;
}

export function isBasePreset(id: string): boolean {
  return id.startsWith(BASE_PREFIX);
}

/** El tipo base visto como un personaje configurado mas, para que la paleta los trate igual. */
export function presetFromArchetype(def: CharacterDef): CharacterPreset {
  return {
    id: basePresetId(def.id),
    name: def.label,
    kind: def.id,
    texture: def.texture,
    sourceRect: { ...def.sourceRect },
    frames: def.frames,
    frameDuration: def.frameDuration,
    scale: 1,
    collider: { ...def.collider },
    stats: { ...def.stats },
  };
}

/**
 * Id para un personaje nuevo a partir de su nombre: minusculas, sin tildes, y
 * lo que no sea letra o numero pasa a "_". Si ya existe, se le agrega _2, _3...
 * Queda legible a proposito: es el prefijo de los ids de sus entidades
 * ("esqueleto_1") y lo que se lee en los eventos del nivel.
 */
export function presetIdFromName(name: string, taken: Iterable<string>): string {
  const slug =
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'personaje';
  const used = new Set(taken);
  if (!used.has(slug) && !isBasePreset(slug)) {
    return slug;
  }
  let index = 2;
  while (used.has(slug + '_' + index)) {
    index += 1;
  }
  return slug + '_' + index;
}

/**
 * Un personaje leido de characters.json, con todo lo que falte completado con
 * los valores de su tipo y los numeros llevados a rangos validos. El archivo
 * se puede editar a mano, y un campo roto no tiene que tirar abajo el panel.
 */
export function normalizePreset(raw: unknown): CharacterPreset {
  const data = (raw ?? {}) as Partial<CharacterPreset>;
  const kind = isCharacterKind(data.kind) ? data.kind : 'enemy';
  const base = presetFromArchetype(CHARACTER_BY_ID.get(kind) as CharacterDef);
  const number = (value: unknown, fallback: number, min: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(min, value) : fallback;

  const rect = data.sourceRect ?? base.sourceRect;
  const collider = data.collider ?? base.collider;
  const stats = data.stats ?? base.stats;
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : base.name;

  return {
    id: typeof data.id === 'string' && data.id ? data.id : presetIdFromName(name, []),
    name,
    kind,
    texture: typeof data.texture === 'string' && data.texture ? data.texture : base.texture,
    sourceRect: {
      x: number(rect.x, 0, 0),
      y: number(rect.y, 0, 0),
      width: number(rect.width, base.sourceRect.width, 1),
      height: number(rect.height, base.sourceRect.height, 1),
    },
    frames: Math.round(number(data.frames, base.frames, 1)),
    frameDuration: number(data.frameDuration, base.frameDuration, 0.01),
    scale: number(data.scale, 1, 0.1),
    collider: {
      width: number(collider.width, base.collider.width, 1),
      height: number(collider.height, base.collider.height, 1),
      solid: collider.solid === true ? true : undefined,
    },
    stats: {
      health: number(stats.health, base.stats.health, 0),
      damage: number(stats.damage, base.stats.damage, 0),
      speed: number(stats.speed, base.stats.speed, 0),
    },
  };
}

/**
 * La entidad que se coloca en el nivel a partir de un personaje configurado.
 * Se COPIAN sus valores: el nivel tiene que poder abrirse y jugarse solo, sin
 * characters.json, y cambiar el personaje despues no toca lo ya colocado.
 *
 * Solo se escribe lo que difiere del default del schema (un cuadro, escala 1),
 * para que el JSON de un personaje simple siga siendo corto.
 */
export function entityFromPreset(
  preset: CharacterPreset,
  position: GridPosition,
  takenIds: ReadonlySet<string>,
): LevelEntity {
  const def = CHARACTER_BY_ID.get(preset.kind) as CharacterDef;
  const idBase = isBasePreset(preset.id) ? def.idBase : preset.id;
  const claimsPlayerId = preset.kind === 'player' && !takenIds.has(ENGINE_PLAYER_ID);

  const entity: LevelEntity = {
    id: claimsPlayerId ? ENGINE_PLAYER_ID : nextFreeId(idBase, takenIds),
    type: def.type,
    position: { col: position.col, row: position.row },
    texture: preset.texture,
    sourceRect: { ...preset.sourceRect },
    collider: { ...preset.collider },
    stats: { ...preset.stats },
  };
  if (!isBasePreset(preset.id)) {
    entity.preset = preset.id;
  }
  if (preset.frames > 1) {
    entity.frames = preset.frames;
    entity.frameDuration = preset.frameDuration;
  }
  if (preset.scale !== 1) {
    entity.scale = preset.scale;
  }
  return entity;
}
