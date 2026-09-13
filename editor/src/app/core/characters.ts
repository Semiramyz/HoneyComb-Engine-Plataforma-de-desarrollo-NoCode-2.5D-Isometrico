// Arquetipos de personaje de la paleta: jugador, enemigo, NPC y objeto.
//
// QUE SON. Atajos para crear una entidad NORMAL con todos sus campos ya puestos
// como el runtime los espera. El contrato no tiene ningun concepto de
// "personaje": lo que sale de aca es una entidad igual a cualquier otra de
// schema/level.schema.json, y por eso el motor no necesita saber nada nuevo
// para que funcionen. La paleta ahorra el trabajo de acertar a mano el type, el
// recorte, el collider y el clip de animacion.
//
// QUE HACE CADA UNA EN EL JUEGO, con lo que el runtime ya sabe hacer hoy:
//
//   Jugador  el motor mueve con las flechas UNICAMENTE a la entidad con id
//            "player_1" (es la convencion que busca main.cpp). Por eso este
//            arquetipo reclama ese id si esta libre: un "jugador" con otro id
//            se dibuja, pero no responde a las teclas. Lleva ademas el clip
//            "player_idle", que es el unico que main.cpp registra.
//
//   Enemigo  collider NO solido, y es a proposito: un collider solido frena al
//            jugador ANTES de que los sprites lleguen a solaparse, y entonces
//            on_collision no dispara nunca. Como sensor, chocarlo si dispara el
//            evento, y ahi se le cuelga lo que se quiera desde el panel Eventos.
//
//   NPC      igual que el enemigo. Cambia el "type" para poder distinguirlos en
//            el outliner y al elegir entidades en los eventos.
//
//   Objeto   pensado para "tocar y que desaparezca": sensor + la accion
//            destroy_entity que ya declara schema/event_catalog.json.

import { ColliderConfig, SourceRect } from '../models/level.model';

export type CharacterId = 'player' | 'enemy' | 'npc' | 'item';

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
  /** Clip registrado en AnimationSystem. Ausente = el sprite queda quieto. */
  animation?: string;
  /** Color del icono de la paleta y del rectangulo que dibuja el viewport. */
  color: string;
  /** Glifo del icono: lo unico que distingue a un arquetipo de otro de un vistazo. */
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
    animation: 'player_idle',
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
    color: '#c05050',
    glyph: '☠',
    hint: 'Enemigo: al tocarlo dispara "Al colisionar". Enganchale acciones en Eventos.',
  },
  {
    id: 'npc',
    label: 'NPC',
    type: 'npc',
    idBase: 'npc',
    texture: 'textures/player.png',
    sourceRect: { ...SPRITE },
    collider: { width: 16, height: 16 },
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
    color: '#5f9e4a',
    glyph: '◆',
    hint: 'Objeto: al tocarlo dispara un evento; usalo con la accion "Destruir entidad".',
  },
];

const CHARACTER_BY_ID = new Map<string, CharacterDef>(CHARACTERS.map((def) => [def.id, def]));
const CHARACTER_BY_TYPE = new Map<string, CharacterDef>(CHARACTERS.map((def) => [def.type, def]));

export function characterDef(id: string): CharacterDef | undefined {
  return CHARACTER_BY_ID.get(id);
}

/**
 * El arquetipo que le corresponde al "type" de una entidad, si hay uno.
 *
 * Se mira solo el type y no la textura (al reves que en las figuras, ver
 * shapeOf): un personaje puede tener el arte que sea -- cambiarle la textura es
 * justamente lo primero que uno hace -- y aun asi sigue siendo un enemigo.
 */
export function characterOf(entity: { type: string }): CharacterDef | undefined {
  return CHARACTER_BY_TYPE.get(entity.type);
}
