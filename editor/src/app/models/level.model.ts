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
}
