// Personajes configurados del PROYECTO (no de un nivel): se guardan en
// characters.json, junto a levels/ y assets/, y se reutilizan en cualquier
// nivel desde el panel Personajes.
//
// No son parte del contrato con el motor. Al colocar uno, el editor copia sus
// valores a una entidad normal del nivel (ver entityFromPreset en
// core/characters.ts), asi que un nivel sigue siendo un JSON autosuficiente:
// cambiar un personaje configurado despues no altera lo que ya se coloco.

import { ColliderConfig, EntityStats, SourceRect } from './level.model';

/** Los cuatro tipos de personaje. Tambien es el "type" de la entidad que se crea. */
export type CharacterKind = 'player' | 'enemy' | 'npc' | 'item';

export interface CharacterPreset {
  /** Id estable, sacado del nombre al guardar por primera vez. Las entidades lo guardan en "preset". */
  id: string;
  name: string;
  kind: CharacterKind;
  /** Ruta relativa a assets/, como en las entidades. */
  texture: string;
  /** Recorte del primer cuadro. Los demas van a su derecha, del mismo ancho. */
  sourceRect: SourceRect;
  /** Cuadros de animacion; 1 = quieto. */
  frames: number;
  /** Segundos por cuadro. */
  frameDuration: number;
  /** Tamano de dibujo: 2 = el doble del recorte. */
  scale: number;
  collider: ColliderConfig;
  stats: EntityStats;
}
