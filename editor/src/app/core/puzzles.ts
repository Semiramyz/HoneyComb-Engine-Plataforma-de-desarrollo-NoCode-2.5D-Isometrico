// Puzzles de sala: el asistente que arma los eventos de "esta sala bloquea el
// paso hasta que...".
//
// Un puzzle no es nada nuevo para el motor: son eventos comunes del catalogo
// mas entidades "puerta" que se muestran y se ocultan. Lo que hace este archivo
// es componerlos bien, que a mano es facil equivocarse:
//
//   Cerrar al entrar (opcional)
//     Cuando: Al entrar a la zona          Si: la marca del puzzle NO esta activa
//     Entonces: Mostrar cada puerta
//
//   Resolver
//     Cuando: vencer al jefe / juntar objetos / limpiar la zona
//     Entonces: Ocultar cada puerta, Activar la marca, Mostrar mensaje
//
// La marca es lo que evita que volver a entrar a una sala ya resuelta cierre
// las puertas otra vez. Con "cerrar al entrar" las puertas arrancan ocultas
// (hidden) para que se pueda pasar; sin eso arrancan visibles y bloquean desde
// el principio.

import { EventDefinition, EventStep, LevelEntity } from '../models/level.model';

export type PuzzleKind = 'boss' | 'collect' | 'clear_zone';

export interface PuzzleKindDef {
  id: PuzzleKind;
  label: string;
  hint: string;
}

export const PUZZLE_KINDS: readonly PuzzleKindDef[] = [
  { id: 'clear_zone', label: 'Eliminar a los enemigos de la zona', hint: 'Se abre cuando caen todos los enemigos que arrancan dentro de la sala o zona.' },
  { id: 'boss', label: 'Vencer a un jefe', hint: 'Se abre cuando cae el enemigo elegido, que queda marcado como jefe (barra de vida grande).' },
  { id: 'collect', label: 'Completar la recolección', hint: 'Se abre al juntar la cantidad de objetos pedida (0 = todos los colocados en el nivel).' },
];

export interface PuzzleDraft {
  kind: PuzzleKind;
  /** Sala o zona. Obligatoria para limpiar la zona y para cerrar al entrar. */
  zone: string;
  /** Enemigo jefe (kind boss). */
  boss: string;
  /** Objeto a juntar (kind collect). Vacio = cualquiera. */
  item: string;
  /** Cuantos (kind collect). 0 = todos los colocados. */
  count: number;
  /** Entidades que bloquean el paso hasta resolverlo. */
  gates: string[];
  /** Las puertas aparecen recien cuando el jugador entra a la zona. */
  lockOnEnter: boolean;
  /** Texto al resolverlo. Vacio = sin mensaje. */
  message: string;
}

export interface PuzzlePlan {
  events: EventDefinition[];
  /** Cambios a entidades: las puertas (hidden) y el jefe (boss). */
  entityChanges: { id: string; changes: Partial<LevelEntity> }[];
  /** Marca con la que el puzzle recuerda que ya se resolvio. */
  flag: string;
}

/** Lo que falta para poder crear el puzzle, o null si esta completo. */
export function validatePuzzle(draft: PuzzleDraft): string | null {
  if (draft.kind === 'clear_zone' && !draft.zone) {
    return 'Elegí la sala o zona que hay que limpiar.';
  }
  if (draft.kind === 'boss' && !draft.boss) {
    return 'Elegí el enemigo que hace de jefe.';
  }
  if (draft.lockOnEnter && !draft.zone) {
    return 'Para cerrar las puertas al entrar hace falta elegir la sala o zona.';
  }
  if (draft.gates.length === 0) {
    return 'Elegí al menos una entidad que bloquee el paso (una pared, una puerta).';
  }
  return null;
}

/** Nombre de marca estable y legible a partir de lo que resuelve el puzzle. */
export function puzzleFlag(draft: PuzzleDraft): string {
  const subject = draft.zone || (draft.kind === 'boss' ? draft.boss : draft.item || 'objetos');
  return 'puzzle_' + subject.replace(/[^A-Za-z0-9]+/g, '_') + '_resuelto';
}

function solvedTrigger(draft: PuzzleDraft): EventStep {
  switch (draft.kind) {
    case 'boss':
      return { type: 'on_entity_destroyed', params: { entity: draft.boss } };
    case 'collect':
      return { type: 'on_items_collected', params: { item: draft.item, count: Math.max(0, Math.round(draft.count)) } };
    case 'clear_zone':
      return { type: 'on_zone_cleared', params: { zone: draft.zone } };
  }
}

export function buildPuzzle(draft: PuzzleDraft): PuzzlePlan {
  const flag = puzzleFlag(draft);
  const events: EventDefinition[] = [];

  if (draft.lockOnEnter) {
    events.push({
      trigger: { type: 'on_player_enter_zone', params: { zone: draft.zone } },
      conditions: [{ type: 'flag_is_not_set', params: { flag } }],
      actions: draft.gates.map((entity) => ({ type: 'show_entity', params: { entity } })),
    });
  }

  const actions: EventStep[] = [
    ...draft.gates.map((entity) => ({ type: 'hide_entity', params: { entity } })),
    { type: 'set_flag', params: { flag } },
  ];
  const message = draft.message.trim();
  if (message) {
    actions.push({ type: 'show_message', params: { text: message } });
  }
  events.push({ trigger: solvedTrigger(draft), actions });

  const entityChanges: PuzzlePlan['entityChanges'] = draft.gates.map((id) => ({
    id,
    // undefined y no false: "visible" es el default del schema y no ensucia el JSON.
    changes: { hidden: draft.lockOnEnter ? true : undefined },
  }));
  if (draft.kind === 'boss') {
    entityChanges.push({ id: draft.boss, changes: { boss: true } });
  }

  return { events, entityChanges, flag };
}
