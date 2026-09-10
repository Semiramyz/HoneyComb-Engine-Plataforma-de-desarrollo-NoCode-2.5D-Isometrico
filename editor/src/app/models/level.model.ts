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
  // FALTA: el schema y LevelLoader.cpp tienen tambien "solid" (bool, default
  // false): true bloquea el movimiento, false lo deja pasar como sensor. Al no
  // estar declarado aca, el editor no lo muestra ni lo conserva -- si se abre
  // y se vuelve a guardar un nivel que lo usa (como levels/test_level.json),
  // el campo se pierde y los obstaculos dejan de frenar al jugador.
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
  /** Ausente si la entidad no colisiona. */
  collider?: ColliderConfig;
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
  // FALTA: el bloque "visuals" (texturas de piso y pared) que declaran el
  // schema y LevelLoader.cpp. Mismo problema que ColliderConfig.solid: el
  // editor lo descarta al guardar, y un nivel abierto y guardado desde aca se
  // queda sin piso ni paredes en el runtime.
}
