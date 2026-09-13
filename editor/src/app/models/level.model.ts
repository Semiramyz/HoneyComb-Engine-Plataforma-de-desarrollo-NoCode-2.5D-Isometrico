// Espejo en TypeScript de schema/level.schema.json. Cualquier campo que se
// agregue aca tiene que agregarse tambien al schema y a LevelLoader.cpp (y
// viceversa) -- este es el contrato compartido entre editor y runtime.

export interface GridConfig {
  width: number;
  height: number;
  /** Ancho del tile isometrico en pixeles. 64 sigue la proporcion 2:1 estandar de pixel art isometrico. */
  tileWidth: number;
  /** Alto del tile isometrico en pixeles. Ver tileWidth. */
  tileHeight: number;
}

export interface GridPosition {
  col: number;
  row: number;
}

export interface SourceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ColliderConfig {
  width: number;
  height: number;
  /**
   * true = la entidad BLOQUEA el movimiento (una pared). false o ausente = la
   * atraviesan, pero sigue detectando el contacto y disparando on_collision
   * (un sensor). Es el mismo campo que ya leia LevelLoader.cpp.
   */
  solid?: boolean;
}

export interface LevelEntity {
  /** Identificador unico dentro del nivel; los eventos lo referencian via params de tipo entity_ref. */
  id: string;
  /** Tipo/categoria libre (ej. "player", "obstaculo", "item"), uso del editor. */
  type: string;
  position: GridPosition;
  /** Ruta relativa a assets/ (ver AssetResolver del motor). */
  texture: string;
  sourceRect: SourceRect;
  /** Nombre de clip registrado en AnimationSystem. Ausente si la entidad no se anima. */
  animation?: string;
  /**
   * Pixeles que el sprite baja al dibujarse. Ausente o 0 = el motor apoya el
   * borde inferior del sprite en el punto de la celda (los "pies" de un
   * personaje). Un solido que llena la casilla lo usa para apoyar ahi el
   * centro del rombo de su base, medio tile mas abajo, que es donde el motor
   * centra el tile de piso.
   */
  groundOffset?: number;
  /**
   * Celdas por lado que ocupa, a partir de position hacia +col y +row. Ausente
   * = 1. El motor agranda el sprite span veces y lo centra en el bloque; el
   * collider ya viene del tamano del bloque entero.
   */
  span?: number;
  /** Ausente si la entidad no colisiona. */
  collider?: ColliderConfig;
}

export interface MapTile {
  col: number;
  row: number;
  floor?: boolean;
  wall?: boolean;
}

/**
 * Una grilla (sala) del mapa del nivel. Solo la usa el editor: se traduce a
 * "tiles", que es lo que lee el motor (ver core/dungeon-layout.ts).
 */
export interface MapRoom {
  /** Nombre unico; los tuneles se enganchan por el. */
  id: string;
  col: number;
  row: number;
  width: number;
  height: number;
}

/**
 * Lado de una sala, en los ejes de la GRILLA: left/right son -columna/+columna,
 * top/bottom son -fila/+fila. En la pantalla isometrica eso se ve en diagonal
 * (+columna va abajo a la derecha), y por eso el editor los muestra con flechas.
 */
export type RoomSide = 'top' | 'bottom' | 'left' | 'right';

/** Pasillo entre dos salas. Solo del editor, igual que MapRoom. */
export interface MapTunnel {
  id: string;
  from: string;
  to: string;
  /** Ancho en celdas caminables; las paredes van por fuera. */
  width: number;
  /** Lado por el que sale de "from". Ausente = desde el centro de la sala. */
  fromSide?: RoomSide;
  /** Lado por el que entra a "to". Ausente = hasta el centro de la sala. */
  toSide?: RoomSide;
  /** Puntos de paso trazados a mano, en orden. Ausente = en L automatica. */
  path?: GridPosition[];
}

/** Un paso individual (trigger, condicion o accion). 'type' referencia un ID de event_catalog.json. */
export interface EventStep {
  type: string;
  params: Record<string, unknown>;
}

export interface EventDefinition {
  trigger: EventStep;
  conditions?: EventStep[];
  actions: EventStep[];
}

export interface Level {
  name: string;
  grid: GridConfig;
  entities: LevelEntity[];
  events: EventDefinition[];
  visuals?: {
    floor?: { texture: string; sourceRect: SourceRect };
    wall?: { texture: string; sourceRect: SourceRect };
  };
  tiles?: MapTile[];
  /** Grillas del mapa. Ausente = el nivel es una sola grilla, como siempre. */
  rooms?: MapRoom[];
  tunnels?: MapTunnel[];
  /**
   * Celdas retocadas a mano con Piso/Pared en un nivel con salas. Se aplican
   * encima de lo que generan las salas, para no perderse al moverlas.
   */
  tileEdits?: MapTile[];
}
