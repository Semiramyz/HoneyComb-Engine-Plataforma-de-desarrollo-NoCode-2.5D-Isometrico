// =============================================================================
// HoneyComb Engine - Editor (componente raiz)
// =============================================================================
//
// Todo el editor vive en un solo componente. Es una decision deliberada para el
// prototipo: la ventana es una unica pantalla con areas fijas (outliner,
// recursos, viewport, propiedades, eventos) que comparten el mismo nivel
// abierto, y partirla en componentes solo agregaria capas de @Input/@Output
// para pasar el mismo estado de un lado a otro.
//
// La interfaz esta modelada sobre la de Blender: areas con cabecera propia
// separadas por un surco, pestanas de workspace que cambian que editores estan
// abiertos, propiedades en paneles plegables, y navegacion del viewport con
// rueda (zoom al cursor), boton medio (desplazar) e Inicio (encuadrar). El tema
// visual vive entero en app.scss.
//
// El estado NO vive aca: vive en los servicios (LevelService el nivel abierto,
// ProjectService el disco, CatalogService el catalogo de eventos). Este archivo
// es la capa de interaccion: traduce clicks y teclas a llamadas a esos
// servicios, y dibuja el canvas isometrico.
//
// El canvas se dibuja a mano con la API 2D, sin libreria: la proyeccion tiene
// que ser identica a la del runtime (ver core/iso-projection.ts, espejo de
// IsoGridSystem en C++), asi que conviene controlar cada pixel.
// =============================================================================

import {
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Hsv, clampChannel, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from './core/color';

import {
  CHARACTERS,
  CharacterId,
  ENGINE_PLAYER_ID,
  basePresetId,
  characterDef,
  characterOf,
  defaultStatsFor,
  entityFromPreset,
  isCharacterKind,
  normalizePreset,
  presetFromArchetype,
  presetIdFromName,
} from './core/characters';
import { CharacterPreset } from './models/character-preset.model';
import { CharacterPresetService } from './services/character-preset.service';
import { GridCoord, IsoProjection } from './core/iso-projection';
import {
  decodeImage,
  fitTextureSize,
  renderPng,
  renderPngBase64,
  usesNearestNeighbor,
} from './core/texture-fit';
import type { ImportSession, ProjectFileData, ProjectNode } from './electron-api';
import { MenuBar, MenuDef, MenuLeaf } from './menu-bar/menu-bar';
import {
  implicitRoom,
  nextFreeId,
  oppositeSide,
  placeBeside,
  rectBetween,
  roomAt,
  roomCenter,
  sideFacing,
  tunnelAt,
} from './core/dungeon-layout';
import {
  SHAPES,
  SHAPE_SHEET_DATA_URL,
  SHAPE_SHEET_HEIGHT,
  SHAPE_SHEET_WIDTH,
  SHAPE_TEXTURE,
  ShapeDef,
  ShapeId,
  shapeCollider,
  shapeDef,
  shapeOf,
} from './core/iso-shapes';
import { CatalogEntry, CatalogParamDef } from './models/event-catalog.model';
import {
  EntityStats,
  EventStep,
  GridConfig,
  GridPosition,
  LevelEntity,
  MapRoom,
  RgbColor,
  RoomSide,
} from './models/level.model';
import {
  blockCenter,
  blocksOverlap,
  clampBlockPosition,
  entitySpan,
} from './core/entity-blocks';
import { CatalogService } from './services/catalog.service';
import { LevelService } from './services/level.service';
import { ProjectService } from './services/project.service';

/** Herramienta activa del viewport: seleccionar entidades o colocarlas. */
type Tool = 'select' | 'place' | 'floor' | 'wall' | 'room' | 'tunnel';
/** Las tres secciones de event_catalog.json, para acceder a ellas por nombre. */
type CatalogKind = 'triggers' | 'conditions' | 'actions';
/** Plantillas del dialogo "nivel nuevo": vacio, con jugador, o escena de prueba. */
export type NewLevelTemplate = 'empty' | 'player' | 'test-scene';

/**
 * Espacio de trabajo activo, al estilo de las workspaces de Blender: la pestana
 * de arriba no cambia de pantalla, cambia QUE editores estan abiertos. En
 * "layout" el viewport se queda con todo el alto; las otras dos abren el editor
 * de abajo con eventos o con la consola.
 */
type Workspace = 'layout' | 'eventos' | 'salida' | 'archivo';

/**
 * Pestana del editor de propiedades (la columna de iconos a su izquierda, como
 * en Blender). "objeto" muestra la entidad seleccionada; "escena", el nivel y
 * su grilla. Antes las propiedades del nivel solo se veian deseleccionando
 * todo, que es justo lo que esta separacion evita.
 */
type InspectorTab = 'objeto' | 'escena';

/**
 * Que editor ocupa el area de arriba a la izquierda. Es el mismo mecanismo que
 * el selector de tipo de editor de Blender: el area no cambia de lugar ni de
 * tamano, cambia lo que muestra. "escena" es el outliner de entidades;
 * "proyecto", el organizador de archivos de la carpeta abierta.
 */
type LeftEditor = 'escena' | 'proyecto';

/**
 * Una fila del explorador de archivos ya aplanada: el nodo y a que profundidad
 * va sangrado. Ver projectRows().
 */
interface TreeRow {
  node: ProjectNode;
  depth: number;
}

/** El archivo que se esta mirando en el visor, con su ruta. */
interface OpenFile {
  path: string;
  data: ProjectFileData;
}

/**
 * Algo que quedo esperando respuesta porque cayo sobre celdas ocupadas, y que
 * se puede resolver en los tres sentidos (reemplazar, superponer, cancelar)
 * sin rehacer el trabajo. Llega de dos lados:
 *   place  una entidad nueva, YA ARMADA, que todavia no se agrego
 *   move   entidades arrastradas con Ctrl que ya se movieron; "originals"
 *          guarda de donde salieron, para que Cancelar las devuelva ahi
 */
type PendingPlacement =
  | { kind: 'place'; entity: LevelEntity; occupants: LevelEntity[] }
  | {
      kind: 'move';
      movedIds: string[];
      originals: Map<string, GridPosition>;
      occupants: LevelEntity[];
    };

// Presets de zoom de la barra: enteros, porque en pixel art un zoom fraccionario
// reparte mal los pixeles del sprite (unos de 1px y otros de 2px) y arruina la
// lectura de la imagen.
const ZOOM_STEPS = [1, 2, 3, 4, 6, 8];

// La rueda, en cambio, hace zoom continuo como el de Blender: encuadrar es una
// accion de navegacion, no de encuadre final, y saltar de 3x a 4x de golpe hace
// perder el punto que se estaba mirando. Los presets de arriba siguen ahi para
// volver a un entero exacto cuando importa ver los pixeles.
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 16;
/** Factor por muesca de rueda. ~1.15 da la misma sensacion de "arrastre" que Blender. */
const ZOOM_WHEEL_FACTOR = 1.15;

/**
 * Pixeles que puede moverse el cursor entre apretar y soltar sin dejar de
 * contar como un click. Separa "click derecho" (abre el menu) de "arrastre con
 * el derecho" (mueve la camara); con 0 el menu no abriria nunca, porque un
 * mouse siempre se corre uno o dos pixeles al hacer click.
 */
const CLICK_SLOP = 4;

// Limites del ancho de los dos paneles laterales al arrastrar su borde. El
// minimo es lo que necesita una fila para no cortar todos los nombres; el
// maximo, dejarle al viewport la mitad de una pantalla chica.
const SIDEBAR_MIN_WIDTH = 170;
const SIDEBAR_MAX_WIDTH = 560;
const SIDEBAR_DEFAULT_WIDTH = 230;
const INSPECTOR_DEFAULT_WIDTH = 290;

/** Cuanto mueve cada flecha del teclado, en celdas de la grilla. */
const ARROW_NUDGES: Record<string, { col: number; row: number }> = {
  ArrowRight: { col: 1, row: 0 },
  ArrowLeft: { col: -1, row: 0 },
  ArrowDown: { col: 0, row: 1 },
  ArrowUp: { col: 0, row: -1 },
};

/** Margen superior del encuadre por defecto, en pixeles de canvas. */
const VIEW_TOP_MARGIN = 60;
/** Proporcion del viewport que ocupa la grilla al encuadrarla con Inicio. */
const FRAME_FILL = 0.82;

// Umbral de la matriz de riesgos ("Degradacion de Rendimiento por Usuario"):
// el editor avisa antes de que la escena comprometa los FPS del runtime.
const ENTITY_WARN_THRESHOLD = 150;
/** Textura de respaldo si el proyecto abierto todavia no tiene ninguna. */
const DEFAULT_STARTER_TEXTURE = 'player.png';

/**
 * Cuantas texturas se procesan para el panel Recursos. Las miniaturas se
 * guardan reducidas, asi que el tope ya no es por memoria sino por tiempo de
 * carga; las que lo pasan se siguen listando por nombre y se usan igual.
 */
const TEXTURE_THUMBNAIL_LIMIT = 400;
/** Lado de la miniatura guardada: el doble de lo que se ve, para pantallas de alta densidad. */
const THUMBNAIL_SIDE = 64;

/** Recorte de respaldo cuando no se pudo averiguar el tamano real de la imagen. */
const FALLBACK_SOURCE_RECT = { x: 0, y: 0, width: 16, height: 16 };

/** Nombre de archivo de una textura a partir de su ruta en el nivel ("textures/x.png" -> "x.png"). */
const textureName = (path: string) => path.replace(/^textures\//, '');

/**
 * Estilo CSS que muestra SOLO el recorte de un sprite, escalado para caber en
 * un cuadrado de "box" pixeles. Funciona con la imagen completa y tambien con
 * su miniatura reducida: el tamano del fondo se calcula con las medidas REALES
 * de la imagen, y el navegador estira la miniatura hasta que el recorte cae
 * donde tiene que caer.
 */
function spriteCropStyle(
  dataUrl: string,
  imageWidth: number,
  imageHeight: number,
  rect: { x: number; y: number; width: number; height: number },
  box: number,
): Record<string, string> {
  const zoom = box / Math.max(rect.width, rect.height, 1);
  return {
    'background-image': `url(${dataUrl})`,
    'background-size': `${imageWidth * zoom}px ${imageHeight * zoom}px`,
    'background-position': `${-rect.x * zoom}px ${-rect.y * zoom}px`,
    width: `${rect.width * zoom}px`,
    height: `${rect.height * zoom}px`,
  };
}

/**
 * Que hace cada herramienta, para decirlo en la barra de estado al elegirla.
 * Varias no cambian nada en pantalla hasta el primer click en la grilla, y sin
 * este mensaje el boton se siente muerto aunque haya respondido.
 */
/** Borrador del dialogo de grilla, tanto para agregar una como para cambiarla. */
interface RoomDraft {
  /** La grilla que se esta cambiando, o null si es una nueva. */
  editId: string | null;
  id: string;
  col: number;
  row: number;
  width: number;
  height: number;
  /** Grilla junto a la que se ubica. Vacio = posicion libre (columna y fila a mano). */
  anchor: string;
  side: RoomSide;
  /** Grilla con la que se une por un tunel. Vacio = sin tunel. */
  connectTo: string;
  tunnelWidth: number;
}

/**
 * Borrador del dialogo "Pasar a otro nivel". Es un atajo para armar el evento
 * mas comun de un juego por niveles sin tener que componerlo a mano en el
 * panel Eventos: un trigger mas la accion load_level.
 */
interface TransitionDraft {
  /** Que dispara el paso: eliminar una entidad, vencer a todos, o tocar una entidad. */
  when: 'entity_destroyed' | 'all_enemies' | 'touch';
  entity: string;
  level: string;
  message: string;
}

/** Borrador del dialogo de tunel. Un lado vacio = automatico (desde el centro). */
interface TunnelDraft {
  /** El tunel que se esta cambiando, o null si es uno nuevo. */
  editId: string | null;
  from: string;
  to: string;
  width: number;
  fromSide: RoomSide | '';
  toSide: RoomSide | '';
  path: GridPosition[];
}

/**
 * Los cuatro lados, como se ven en PANTALLA. Los ejes de la grilla van en
 * diagonal en la vista isometrica (+columna es abajo a la derecha), asi que
 * "derecha" a secas no le diria a nadie donde va a aparecer la grilla.
 */
const ROOM_SIDES: readonly { value: RoomSide; label: string; hint: string }[] = [
  { value: 'right', label: '↘ Abajo der.', hint: 'Hacia +columna: en pantalla, abajo a la derecha' },
  { value: 'bottom', label: '↙ Abajo izq.', hint: 'Hacia +fila: en pantalla, abajo a la izquierda' },
  { value: 'top', label: '↗ Arriba der.', hint: 'Hacia −fila: en pantalla, arriba a la derecha' },
  { value: 'left', label: '↖ Arriba izq.', hint: 'Hacia −columna: en pantalla, arriba a la izquierda' },
];

/** Tamano inicial de una grilla nueva. */
const NEW_ROOM_SIZE = 6;
/**
 * Celdas libres entre una grilla nueva y la anterior: una de pared de cada
 * lado y una de pasillo en el medio, lo minimo para que un tunel se vea.
 */
const NEW_ROOM_GAP = 4;
/** Ancho de tunel que propone el dialogo: el 3×3 del ejemplo del diseño. */
const DEFAULT_TUNNEL_WIDTH = 3;

/** Nombre de cada herramienta en el menu Editar > Herramienta. */
const TOOL_LABELS: Record<Tool, string> = {
  select: 'Seleccionar',
  place: 'Colocar entidad',
  floor: 'Alternar piso',
  wall: 'Alternar pared',
  room: 'Dibujar grilla',
  tunnel: 'Trazar túnel',
};

/** Nombre de cada espacio de trabajo en el menu Ver > Espacio de trabajo. */
const WORKSPACE_LABELS: Record<Workspace, string> = {
  layout: 'Layout',
  eventos: 'Eventos',
  salida: 'Salida',
  archivo: 'Archivo',
};

const TOOL_HINTS: Record<Tool, string> = {
  select: 'Seleccionar: clic sobre una entidad para activarla.',
  place: 'Colocar: elige una textura en Recursos o una figura, y clic en la grilla.',
  floor: 'Piso: clic en una celda para quitarle o devolverle el suelo.',
  wall: 'Pared: clic en una celda para levantar o quitar la pared.',
  room: 'Grilla: arrastrá sobre el vacío para dibujar una nueva, o dentro de una para moverla. Clic derecho la configura.',
  tunnel:
    'Túnel: clic en una grilla, clics para marcar el camino y clic en otra grilla para terminar. Retroceso borra el último punto; Escape cancela.',
};

/** Una fila del formulario dinamico de parametros (ver paramRows()). */
interface ParamRow {
  key: string;
  def: CatalogParamDef;
}

@Component({
  selector: 'app-root',
  imports: [MenuBar],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  // Los atajos se escuchan en window y no en el canvas: en Blender funcionan
  // con el puntero sobre cualquier editor, no solo sobre el viewport, y ademas
  // el canvas no tiene foco propio (habria que darle tabindex y pedirlo a mano).
  host: { '(window:keydown)': 'onKeyDown($event)' },
})
export class App {
  readonly project = inject(ProjectService);
  readonly levels = inject(LevelService);
  readonly catalog = inject(CatalogService);
  readonly presetsService = inject(CharacterPresetService);
  private readonly destroyRef = inject(DestroyRef);

  /** preload.js solo existe bajo Electron; con "ng serve" la UI corre sin acceso a disco. */
  readonly hasFileSystem = typeof window !== 'undefined' && 'honeycombProject' in window;

  // --- Estado del proyecto abierto ------------------------------------------
  readonly levelFiles = signal<string[]>([]);
  readonly textures = signal<string[]>([]);
  /**
   * Imagen y medidas de cada textura de assets/textures/, por nombre de
   * archivo. Sirve para dos cosas: mostrar la miniatura de verdad en el panel
   * Recursos (antes era un cuadrado vacio, y elegir textura era adivinar), y
   * saber el tamano real al soltarla sobre una entidad, para recortarla entera
   * en vez de dejar el recorte viejo.
   */
  readonly textureAssets = signal<Record<string, { dataUrl: string; width: number; height: number }>>({});
  /** Hay una importacion en curso; el boton se apaga para no lanzar dos juntas. */
  readonly importing = signal(false);
  /** Numero de la pasada de miniaturas vigente. Ver loadTextureThumbnails(). */
  private thumbnailRun = 0;
  readonly status = signal('Listo. Abre una carpeta de proyecto, o crea un nivel y usa Guardar como.');
  /** Ultima ruta usada al guardar por dialogo; se propone en el siguiente. */
  readonly lastSavedPath = signal<string | null>(null);
  /** Hay cambios sin guardar. Lo enciende cualquier edicion; solo save() lo apaga. */
  readonly dirty = signal(false);

  /** Colocacion esperando respuesta porque la celda ya tenia algo. */
  readonly pendingPlacement = signal<PendingPlacement | null>(null);

  // --- Dialogo "nivel nuevo" ------------------------------------------------
  readonly showNewLevelDialog = signal(false);
  readonly newLevelName = signal('nuevo_nivel');
  readonly newLevelWidth = signal(10);
  readonly newLevelHeight = signal(10);
  readonly newLevelTileWidth = signal(64);
  readonly newLevelTileHeight = signal(32);
  readonly newLevelTemplate = signal<NewLevelTemplate>('empty');

  // --- Estado del viewport --------------------------------------------------
  readonly tool = signal<Tool>('select');
  /** Textura elegida en el panel Recursos; es la que se coloca con la herramienta "place". */
  readonly activeTexture = signal<string | null>(null);
  /**
   * Primitiva elegida en el panel Figuras. Es EXCLUYENTE con activeTexture:
   * elegir una apaga la otra, porque la herramienta "place" tiene que saber sin
   * ambiguedad que esta a punto de colocar.
   */
  readonly activeShape = signal<ShapeId | null>(null);
  /** Panel Figuras: arrastrar con una figura elegida la coloca en cada casilla que pisa. */
  readonly paintShapes = signal(false);
  /** Trazo en curso de figuras pintadas arrastrando (ver startShapeStroke). */
  private shapeStroke: { shape: ShapeId; start: GridCoord; last: GridCoord; placed: number } | null = null;
  /**
   * Id del personaje elegido en el panel Personajes: un tipo base
   * ("base-enemy") o uno configurado. Excluyente con los otros dos por el
   * mismo motivo: la herramienta "place" tiene que saber sin ambiguedad que
   * esta a punto de colocar.
   */
  readonly activeCharacter = signal<string | null>(null);
  readonly zoom = signal(3);
  readonly showGrid = signal(true);
  readonly showColliders = signal(true);
  /** Lineas de la grilla por encima de las entidades (como F1 en el runtime) o debajo. */
  readonly gridOnTop = signal(false);
  /** Desplazamiento de camara en pixeles de pantalla (boton medio o shift-arrastre). */
  readonly pan = signal({ x: 0, y: 0 });
  /** Celda bajo el cursor, para resaltarla. Null cuando el mouse sale del canvas. */
  readonly hovered = signal<GridCoord | null>(null);
  readonly workspace = signal<Workspace>('layout');
  readonly inspectorTab = signal<InspectorTab>('objeto');
  readonly log = signal<string[]>([]);

  // --- Explorador de archivos del proyecto ----------------------------------
  readonly leftEditor = signal<LeftEditor>('escena');
  /**
   * Hijos ya leidos de cada carpeta, indexados por su ruta ("" es la raiz del
   * proyecto). El arbol se llena de a una carpeta por vez, al desplegarla.
   */
  private readonly treeChildren = signal<Record<string, ProjectNode[]>>({});
  /**
   * Carpetas desplegadas. Aca se guardan las ABIERTAS -- al reves que los
   * paneles del inspector -- porque con carga perezosa abrir es la accion que
   * cuesta: lo que nadie desplego no se leyo del disco, y arrancar con todo
   * abierto significaria leer el proyecto entero.
   */
  private readonly expandedDirs = signal<Record<string, boolean>>({});
  /** El archivo que se esta mirando en el visor (workspace "archivo"). */
  readonly openFile = signal<OpenFile | null>(null);

  // --- Paneles laterales: ancho y visibilidad -------------------------------
  // Los dos se comportan igual: se arrastra su borde interior para cambiar el
  // ancho y se esconden con su boton del topbar.
  readonly sidebarWidth = signal(SIDEBAR_DEFAULT_WIDTH);
  readonly sidebarVisible = signal(true);
  readonly inspectorWidth = signal(INSPECTOR_DEFAULT_WIDTH);
  readonly inspectorVisible = signal(true);
  /** Que borde se esta arrastrando, si alguno. La plantilla lo usa para resaltarlo. */
  private readonly resizing = signal<'sidebar' | 'inspector' | null>(null);

  /**
   * Paneles del inspector plegados, por id. Se guarda el conjunto de PLEGADOS y
   * no el de abiertos para que un panel nuevo aparezca desplegado sin tener que
   * inicializarlo en ningun lado.
   */
  private readonly collapsedPanels = signal<Record<string, boolean>>({});

  readonly zoomSteps = ZOOM_STEPS;
  readonly shapes = SHAPES;
  readonly characters = CHARACTERS;
  /** Zoom en porcentaje para la barra de estado, como el de Blender. */
  readonly zoomLabel = computed(() => Math.round(this.zoom() * 100) + '%');

  /**
   * Estilo de una miniatura de la paleta: recorta la celda de la figura del
   * sheet embebido y la escala a la mitad.
   *
   * Es un recorte del sheet real y no un icono aparte, para que la paleta no
   * pueda mostrar una cosa y el viewport otra. La escala 0.5 es exacta (mitad
   * justa de cada pixel), asi que con image-rendering: pixelated se ve nitida.
   */
  thumbStyle(shape: ShapeDef): Record<string, string> {
    const scale = 0.5;
    return {
      'background-image': `url(${SHAPE_SHEET_DATA_URL})`,
      'background-size': `${SHAPE_SHEET_WIDTH * scale}px ${SHAPE_SHEET_HEIGHT * scale}px`,
      'background-position': `${-shape.sourceRect.x * scale}px ${-shape.sourceRect.y * scale}px`,
      width: `${shape.sourceRect.width * scale}px`,
      height: `${shape.sourceRect.height * scale}px`,
    };
  }

  /**
   * El sheet ya decodificado, listo para dibujar en el canvas. Es null hasta
   * que la imagen termina de cargar (unos milisegundos: son datos embebidos,
   * no una descarga), y por eso es un signal -- al resolverse dispara el
   * effect() que redibuja, sin necesidad de un bucle de render.
   */
  private readonly shapeSheet = signal<HTMLImageElement | null>(null);

  private readonly viewport = viewChild<ElementRef<HTMLCanvasElement>>('viewport');
  /** Tamano real del canvas en pixeles. Lo mantiene al dia el ResizeObserver. */
  private readonly canvasSize = signal({ w: 0, h: 0 });
  private observer?: ResizeObserver;
  /**
   * Hay un arrastre de camara en curso. Es un signal y no un campo suelto
   * porque la plantilla lo lee para cambiar el cursor a "mano cerrada"; se
   * escribe dos veces por gesto (al apretar y al soltar), no en cada
   * movimiento, asi que no cuesta nada.
   */
  readonly panning = signal(false);
  /** Punto donde empezo el arrastre + pan que habia entonces, para calcular el delta. */
  private dragOrigin = { x: 0, y: 0, panX: 0, panY: 0 };
  /** Boton que inicio el gesto en curso, para saber al soltar que hacer con el. */
  private pressedButton: number | null = null;
  /**
   * Arrastre con Ctrl+clic en curso: la celda donde empezo, la posicion
   * original de cada entidad que se lleva, y el desplazamiento ya aplicado.
   */
  private moveDrag: {
    startCell: GridCoord;
    originals: Map<string, GridPosition>;
    delta: GridPosition;
  } | null = null;
  /** Hay entidades agarradas con Ctrl; la plantilla cambia el cursor a "mano cerrada". */
  readonly moving = signal(false);

  /**
   * Id de la entidad cuyo menu del clic derecho esta abierto. Null cuando no
   * hay ninguno. El menu va centrado en la ventana, asi que no guarda posicion.
   */
  readonly contextMenu = signal<string | null>(null);
  /** La entidad del menu abierto, resuelta; undefined si se borro mientras tanto. */
  readonly contextMenuEntity = computed(() => {
    const id = this.contextMenu();
    return id ? this.entities().find((entity) => entity.id === id) : undefined;
  });

  // --- Vistas derivadas del nivel abierto -----------------------------------
  // computed() y no getters: asi Angular sabe exactamente de que dependen y
  // solo recalcula (y redibuja el canvas) cuando eso cambia de verdad.
  readonly entities = computed(() => this.levels.level().entities);
  readonly events = computed(() => this.levels.level().events);
  readonly rooms = computed(() => this.levels.level().rooms ?? []);
  readonly tunnels = computed(() => this.levels.level().tunnels ?? []);
  readonly tileEditCount = computed(() => this.levels.level().tileEdits?.length ?? 0);
  readonly grid = computed(() => this.levels.level().grid);
  /** El objeto ACTIVO: el ultimo seleccionado, el unico que muestra el inspector. */
  readonly selected = this.levels.selectedEntity;
  /** Todos los seleccionados. Sobre estos actuan las operaciones de grupo. */
  readonly selectedIds = this.levels.selectedEntityIds;
  readonly selectionCount = computed(() => this.selectedIds().length);
  /** Consulta rapida para el outliner y el canvas, que preguntan una vez por entidad. */
  private readonly selectedSet = computed(() => new Set(this.selectedIds()));
  readonly entityIds = computed(() => this.entities().map((entity) => entity.id));
  readonly overBudget = computed(() => this.entities().length > ENTITY_WARN_THRESHOLD);

  readonly triggers = computed(() => this.catalog.catalog()?.triggers ?? []);
  readonly conditions = computed(() => this.catalog.catalog()?.conditions ?? []);
  readonly actions = computed(() => this.catalog.catalog()?.actions ?? []);

  /** preload.js expone el control de la ventana solo bajo Electron. */
  readonly hasWindowApi = typeof window !== 'undefined' && 'honeycombWindow' in window;

  // --- Barra de menus -------------------------------------------------------
  //
  // Toda la barra se describe aca como dato; el componente MenuBar solo la
  // dibuja. Es un computed y no un arreglo fijo porque tiene partes vivas: las
  // marcas ✓ (barra lateral, grilla, herramienta), las opciones que se apagan
  // sin seleccion, y la lista de niveles del proyecto.
  //
  // Archivo, Editar, Ver y Ejecutar llaman a lo que ya existe. Mapa, Niveles y
  // Generar son las tres partes del sistema de mazmorras que viene -- grillas
  // unidas por tuneles, pase entre niveles y generacion procedural con semilla
  // -- y por ahora se muestran como "Proximamente": se ve lo que va a haber y
  // donde, sin opciones que parezcan andar y no hagan nada.

  readonly menus = computed<MenuDef[]>(() => {
    const separator: MenuLeaf = { kind: 'separator' };
    const nothingSelected = this.selectionCount() === 0;

    return [
      {
        id: 'archivo',
        label: 'Archivo',
        items: [
          { kind: 'action', label: 'Nuevo nivel…', shortcut: 'Ctrl+N', run: () => this.newLevel() },
          { kind: 'action', label: 'Abrir nivel…', shortcut: 'Ctrl+O', run: () => void this.openLevelFile() },
          {
            kind: 'submenu',
            label: 'Abrir nivel del proyecto',
            emptyLabel: 'Sin proyecto abierto, o sin niveles en levels/',
            items: this.levelFiles().map((file) => ({
              kind: 'action' as const,
              label: file,
              checked: this.levels.fileName() === file,
              run: () => void this.loadLevel(file),
            })),
          },
          { kind: 'action', label: 'Abrir carpeta de proyecto…', run: () => void this.openProject() },
          separator,
          {
            kind: 'action',
            // El punto es el aviso de cambios sin guardar, que antes iba en el
            // boton "Guardar *" del topbar.
            label: this.dirty() ? 'Guardar  ●' : 'Guardar',
            shortcut: 'Ctrl+S',
            run: () => void this.save(),
          },
          { kind: 'action', label: 'Guardar como…', shortcut: 'Ctrl+Shift+S', run: () => void this.saveAs() },
          separator,
          {
            kind: 'action',
            label: 'Importar texturas…',
            disabled: this.importing(),
            run: () => void this.importTextures(),
          },
          separator,
          { kind: 'action', label: 'Salir', run: () => window.close() },
        ],
      },
      {
        id: 'editar',
        label: 'Editar',
        items: [
          { kind: 'action', label: 'Duplicar', shortcut: 'Shift+D', disabled: nothingSelected, run: () => this.duplicateSelected() },
          { kind: 'action', label: 'Eliminar', shortcut: 'X', disabled: nothingSelected, run: () => this.deleteSelected() },
          separator,
          {
            kind: 'action',
            label: 'Seleccionar todo',
            shortcut: 'Ctrl+A',
            disabled: this.entities().length === 0,
            run: () => this.selectAllEntities(),
          },
          { kind: 'action', label: 'Deseleccionar', disabled: nothingSelected, run: () => this.selectEntity(null) },
          separator,
          {
            kind: 'submenu',
            label: 'Herramienta',
            emptyLabel: '',
            items: (['select', 'place', 'floor', 'wall', 'room', 'tunnel'] as const).map((tool) => ({
              kind: 'action' as const,
              label: TOOL_LABELS[tool],
              checked: this.tool() === tool,
              run: () => this.setTool(tool),
            })),
          },
        ],
      },
      {
        id: 'ver',
        label: 'Ver',
        items: [
          { kind: 'action', label: 'Barra lateral', shortcut: 'Ctrl+B', checked: this.sidebarVisible(), run: () => this.toggleSidebar() },
          { kind: 'action', label: 'Panel de propiedades', checked: this.inspectorVisible(), run: () => this.toggleInspector() },
          {
            kind: 'submenu',
            label: 'Espacio de trabajo',
            emptyLabel: '',
            items: (['layout', 'eventos', 'salida', 'archivo'] as const).map((workspace) => ({
              kind: 'action' as const,
              label: WORKSPACE_LABELS[workspace],
              checked: this.workspace() === workspace,
              run: () => this.workspace.set(workspace),
            })),
          },
          separator,
          { kind: 'action', label: 'Grilla', checked: this.showGrid(), run: () => this.toggleGrid() },
          { kind: 'action', label: 'Colisiones', checked: this.showColliders(), run: () => this.toggleColliders() },
          { kind: 'action', label: 'Encuadrar todo', shortcut: 'Inicio', run: () => this.frameAll() },
          separator,
          { kind: 'action', label: 'Recargar ventana', shortcut: 'Ctrl+R', run: () => this.reloadWindow() },
          {
            kind: 'action',
            label: 'Herramientas de desarrollo',
            shortcut: 'Ctrl+Shift+I',
            disabled: !this.hasWindowApi,
            run: () => this.toggleDevTools(),
          },
        ],
      },
      {
        id: 'personajes',
        label: 'Personajes',
        items: [
          { kind: 'action', label: 'Configurar personajes…', run: () => this.openCharacterEditor() },
          separator,
          ...CHARACTERS.map((def) => ({
            kind: 'action' as const,
            label: 'Nuevo ' + def.label.toLowerCase() + '…',
            run: () => this.openCharacterEditor(def.id),
          })),
          separator,
          {
            kind: 'submenu',
            label: 'Editar un personaje guardado',
            emptyLabel: 'Todavía no hay personajes guardados',
            items: this.presetsService.presets().map((preset) => ({
              kind: 'action' as const,
              label: preset.name + '  ·  ' + this.kindLabel(preset.kind),
              run: () => this.editCharacterPreset(preset.id),
            })),
          },
        ],
      },
      {
        id: 'mapa',
        label: 'Mapa',
        items: [
          { kind: 'action', label: 'Agregar grilla al mapa…', run: () => this.openRoomDialog() },
          {
            kind: 'action',
            label: 'Dibujar grilla en el viewport',
            checked: this.tool() === 'room',
            run: () => this.setTool('room'),
          },
          separator,
          {
            kind: 'action',
            label: 'Conectar grillas con un túnel…',
            disabled: this.rooms().length < 2,
            run: () => this.openTunnelDialog(),
          },
          {
            kind: 'action',
            label: 'Trazar túnel a mano',
            checked: this.tool() === 'tunnel',
            disabled: this.rooms().length < 2,
            run: () => this.setTool('tunnel'),
          },
          {
            kind: 'action',
            label: 'Tamaño de las conexiones…',
            disabled: this.tunnels().length === 0,
            run: () => this.showMapPanel(),
          },
          separator,
          { kind: 'action', label: 'Grillas y túneles del nivel', run: () => this.showMapPanel() },
          { kind: 'action', label: 'Propiedades de la grilla', run: () => this.showGridProperties() },
        ],
      },
      {
        id: 'niveles',
        label: 'Niveles',
        items: [
          { kind: 'action', label: 'Pasar a otro nivel…', run: () => this.openTransitionDialog() },
          { kind: 'action', label: 'Ver eventos del nivel', run: () => this.workspace.set('eventos') },
        ],
      },
      {
        id: 'generar',
        label: 'Generar',
        items: [
          {
            kind: 'soon',
            label: 'Generar nivel aleatorio…',
            hint: 'Colocar paredes y grillas de forma procedural sobre el mapa.',
          },
          {
            kind: 'soon',
            label: 'Semilla de generación…',
            hint: 'El número que hace que la misma generación salga igual cada vez.',
          },
        ],
      },
      {
        id: 'ejecutar',
        label: 'Ejecutar',
        items: [{ kind: 'action', label: 'Ejecutar nivel', shortcut: 'F5', run: () => void this.run() }],
      },
    ];
  });

  /** Recarga la interfaz. Si hay cambios sin guardar pregunta antes, porque recargar los pierde. */
  reloadWindow(): void {
    if (this.dirty() && !window.confirm('Hay cambios sin guardar en el nivel. ¿Recargar igual y perderlos?')) {
      return;
    }
    window.location.reload();
  }

  toggleDevTools(): void {
    if (this.hasWindowApi) {
      void window.honeycombWindow.toggleDevTools();
    }
  }

  /** Abre el panel de propiedades en la pestaña de escena, donde estan las medidas de la grilla. */
  showGridProperties(): void {
    this.inspectorVisible.set(true);
    this.inspectorTab.set('escena');
  }

  // --- Pasar a otro nivel ---------------------------------------------------
  //
  // Arma el evento "cuando pase X, mostrar la pantalla de nivel superado y
  // cargar otro nivel". Queda como un evento mas en el panel Eventos, asi que
  // despues se lo puede cambiar o completar (sumar un sonido, una condicion).

  readonly transitionDraft = signal<TransitionDraft | null>(null);

  /**
   * Propone lo mas probable: si hay enemigos, pasar al eliminar el primero;
   * si no, al tocar la primera entidad. El nivel de destino, el primero de
   * levels/ que no sea el que esta abierto.
   */
  openTransitionDialog(): void {
    const enemies = this.entities().filter((entity) => entity.type === 'enemy');
    const current = this.levels.fileName();
    this.transitionDraft.set({
      when: enemies.length > 0 ? 'entity_destroyed' : 'touch',
      entity: enemies[0]?.id ?? this.entityIds().find((id) => id !== ENGINE_PLAYER_ID) ?? '',
      level: this.levelFiles().find((file) => file !== current) ?? '',
      message: '¡Nivel superado!',
    });
  }

  patchTransitionDraft(changes: Partial<TransitionDraft>): void {
    this.transitionDraft.update((draft) => (draft ? { ...draft, ...changes } : draft));
  }

  /** El <select> devuelve texto: se valida antes de aceptarlo. */
  setTransitionWhen(value: string): void {
    if (value === 'entity_destroyed' || value === 'all_enemies' || value === 'touch') {
      this.patchTransitionDraft({ when: value });
    }
  }

  cancelTransitionDialog(): void {
    this.transitionDraft.set(null);
  }

  confirmTransitionDialog(): void {
    const draft = this.transitionDraft();
    if (!draft) {
      return;
    }
    const level = draft.level.trim();
    if (!level) {
      this.note('Elegí el nivel al que se pasa.');
      return;
    }
    if (draft.when !== 'all_enemies' && !draft.entity) {
      this.note('Elegí la entidad que dispara el paso de nivel.');
      return;
    }

    const trigger =
      draft.when === 'entity_destroyed'
        ? { type: 'on_entity_destroyed', params: { entity: draft.entity } }
        : draft.when === 'all_enemies'
          ? { type: 'on_all_enemies_defeated', params: {} }
          : // "Tocar" es siempre el jugador con esa entidad: es quien se mueve.
            { type: 'on_collision', params: { entityA: ENGINE_PLAYER_ID, entityB: draft.entity } };

    this.levels.addEvent({
      trigger,
      actions: [{ type: 'load_level', params: { level, message: draft.message.trim() } }],
    });
    this.transitionDraft.set(null);
    this.dirty.set(true);
    // Se muestra el evento recien creado, que es donde se lo puede ajustar.
    this.workspace.set('eventos');
    this.note('Evento creado: al cumplirse, el juego pasa a ' + level + '.');
  }

  // --- Personajes configurados ----------------------------------------------
  //
  // Personajes con su asset, tamano y caracteristicas, guardados en el
  // proyecto (characters.json) para reutilizarlos en cualquier nivel. La paleta
  // los muestra agrupados por tipo y la ventana "Configurar personajes" los
  // crea y los edita. Colocar uno COPIA sus valores a la entidad, asi que un
  // nivel no depende de characters.json para abrirse ni para jugarse.

  readonly basePresetId = basePresetId;
  readonly characterKinds = CHARACTERS;

  /** Tipo desplegado en la paleta, o null si estan todos plegados. */
  readonly expandedKind = signal<CharacterId | null>(null);

  /** Los tipos base mas los guardados: todo lo que se puede colocar. */
  readonly allPresets = computed<CharacterPreset[]>(() => [
    ...CHARACTERS.map(presetFromArchetype),
    ...this.presetsService.presets(),
  ]);

  /** Ventana de configuracion abierta: el borrador y, si ya esta guardado, su id. */
  readonly characterEditor = signal<{ draft: CharacterPreset; savedId: string | null } | null>(null);

  /**
   * La imagen COMPLETA de la textura del borrador. Las miniaturas de Recursos
   * vienen reducidas: sirven para reconocer un personaje en la paleta, pero no
   * para ajustar un recorte al pixel.
   */
  readonly editorTexture = signal<{ name: string; dataUrl: string; width: number; height: number } | null>(null);

  /** Primer cuadro del borrador, para la vista previa de la ventana. */
  readonly draftPreviewStyle = computed(() => {
    const editor = this.characterEditor();
    const image = this.editorTexture();
    if (!editor || !image || textureName(editor.draft.texture) !== image.name) {
      return null;
    }
    return spriteCropStyle(image.dataUrl, image.width, image.height, editor.draft.sourceRect, 96);
  });

  toggleKind(kind: CharacterId): void {
    this.expandedKind.update((current) => (current === kind ? null : kind));
  }

  /** Lo que se despliega bajo un tipo en la paleta: el base primero, despues los guardados. */
  presetsOfKind(kind: CharacterId): CharacterPreset[] {
    return this.allPresets().filter((preset) => preset.kind === kind);
  }

  savedPresetsOfKind(kind: CharacterId): CharacterPreset[] {
    return this.presetsService.presets().filter((preset) => preset.kind === kind);
  }

  kindLabel(kind: CharacterId): string {
    return characterDef(kind)?.label ?? kind;
  }

  kindColor(kind: CharacterId): string {
    return characterDef(kind)?.color ?? '#4772b3';
  }

  kindHint(kind: CharacterId): string {
    return characterDef(kind)?.hint ?? '';
  }

  /** Miniatura de un personaje en la paleta: su primer cuadro, sacado de la miniatura de Recursos. */
  presetSpriteStyle(preset: CharacterPreset): Record<string, string> | null {
    const asset = this.textureAssets()[textureName(preset.texture)];
    return asset && asset.width > 0
      ? spriteCropStyle(asset.dataUrl, asset.width, asset.height, preset.sourceRect, 22)
      : null;
  }

  /** Sin tipo, abre el primer personaje guardado; con tipo, uno nuevo de ese tipo. */
  openCharacterEditor(kind?: CharacterId): void {
    if (kind) {
      this.newCharacterDraft(kind);
      return;
    }
    const first = this.presetsService.presets()[0];
    if (first) {
      this.editCharacterPreset(first.id);
    } else {
      this.newCharacterDraft('enemy');
    }
  }

  /** Borrador nuevo, arrancando de los valores del tipo base. */
  newCharacterDraft(kind: CharacterId): void {
    const def = characterDef(kind);
    if (!def) {
      return;
    }
    const draft = { ...presetFromArchetype(def), id: '', name: 'Nuevo ' + def.label.toLowerCase() };
    this.characterEditor.set({ draft, savedId: null });
    void this.loadEditorTexture(textureName(draft.texture));
  }

  editCharacterPreset(id: string): void {
    const preset = this.presetsService.presets().find((candidate) => candidate.id === id);
    if (!preset) {
      return;
    }
    // Copia profunda: editar el borrador no tiene que tocar la lista guardada
    // hasta que se aprete Guardar.
    this.characterEditor.set({ draft: structuredClone(preset), savedId: id });
    void this.loadEditorTexture(textureName(preset.texture));
  }

  closeCharacterEditor(): void {
    this.characterEditor.set(null);
  }

  private updateDraft(change: (draft: CharacterPreset) => CharacterPreset): void {
    this.characterEditor.update((editor) => (editor ? { ...editor, draft: change(editor.draft) } : editor));
  }

  patchCharacterDraft(changes: Partial<CharacterPreset>): void {
    this.updateDraft((draft) => ({ ...draft, ...changes }));
  }

  /** El <select> de tipo devuelve texto: se valida antes de aceptarlo. */
  setCharacterKind(value: string): void {
    if (isCharacterKind(value)) {
      this.patchCharacterDraft({ kind: value });
    }
  }

  patchDraftRect(field: 'x' | 'y' | 'width' | 'height', value: number): void {
    const min = field === 'width' || field === 'height' ? 1 : 0;
    this.updateDraft((draft) => ({ ...draft, sourceRect: { ...draft.sourceRect, [field]: Math.max(min, value) } }));
  }

  setDraftFrames(value: number): void {
    this.patchCharacterDraft({ frames: Math.max(1, Math.round(value) || 1) });
  }

  setDraftFrameDuration(value: number): void {
    this.patchCharacterDraft({ frameDuration: value > 0 ? value : 0.15 });
  }

  setDraftScale(value: number): void {
    this.patchCharacterDraft({ scale: value > 0 ? value : 1 });
  }

  patchDraftCollider(field: 'width' | 'height', value: number): void {
    this.updateDraft((draft) => ({ ...draft, collider: { ...draft.collider, [field]: Math.max(1, value) } }));
  }

  setDraftSolid(solid: boolean): void {
    // undefined y no false: es el default del schema, y asi no ensucia el JSON.
    this.updateDraft((draft) => ({ ...draft, collider: { ...draft.collider, solid: solid || undefined } }));
  }

  patchDraftStats(field: keyof EntityStats, value: number): void {
    this.updateDraft((draft) => ({ ...draft, stats: { ...draft.stats, [field]: Math.max(0, value) } }));
  }

  /** Colision del tamano con que se va a dibujar: el recorte por la escala. */
  fitDraftCollider(): void {
    this.updateDraft((draft) => ({
      ...draft,
      collider: {
        ...draft.collider,
        width: Math.max(1, Math.round(draft.sourceRect.width * draft.scale)),
        height: Math.max(1, Math.round(draft.sourceRect.height * draft.scale)),
      },
    }));
  }

  /**
   * Cambia el asset del borrador. El recorte arranca con la imagen entera
   * partida en tantos cuadros como tenga el personaje, uno al lado del otro,
   * que es como el motor los lee: una tira de 4 cuadros de 128 px de ancho da
   * cuadros de 32.
   */
  async setDraftTexture(name: string): Promise<void> {
    this.patchCharacterDraft({ texture: 'textures/' + name });
    const image = await this.loadEditorTexture(name);
    const draft = this.characterEditor()?.draft;
    if (!image || !draft) {
      return;
    }
    const frames = Math.max(1, draft.frames);
    this.patchCharacterDraft({
      sourceRect: { x: 0, y: 0, width: Math.max(1, Math.floor(image.width / frames)), height: image.height },
    });
  }

  private async loadEditorTexture(name: string) {
    const current = this.editorTexture();
    if (current?.name === name) {
      return current;
    }
    try {
      const data = await this.project.readFileData('assets/textures/' + name);
      if (data.kind !== 'image') {
        return null;
      }
      const image = await decodeImage(data.dataUrl);
      const loaded = { name, dataUrl: data.dataUrl, width: image.naturalWidth, height: image.naturalHeight };
      this.editorTexture.set(loaded);
      return loaded;
    } catch {
      // Sin proyecto abierto o sin esa textura en disco: la ventana sigue
      // andando, solo que sin vista previa.
      return null;
    }
  }

  /** La carpeta del proyecto, deduciendola o preguntandola si nadie abrio una. */
  private async ensureProject(): Promise<boolean> {
    if (this.project.projectRoot()) {
      return true;
    }
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return false;
    }
    if (!(await this.project.ensureRoot())) {
      return false;
    }
    await this.refreshProject();
    return true;
  }

  /**
   * Guarda el borrador en characters.json. El id se fija la primera vez, a
   * partir del nombre, y ya no cambia aunque despues se lo renombre: es la
   * referencia que guardan las entidades colocadas ("preset").
   */
  async saveCharacterDraft(): Promise<void> {
    const editor = this.characterEditor();
    if (!editor) {
      return;
    }
    const name = editor.draft.name.trim();
    if (!name) {
      this.note('El personaje necesita un nombre.');
      return;
    }
    if (!(await this.ensureProject())) {
      return;
    }

    const current = this.presetsService.presets();
    const id = editor.savedId ?? presetIdFromName(name, current.map((preset) => preset.id));
    const saved = normalizePreset({ ...editor.draft, id, name });
    const list = editor.savedId
      ? current.map((preset) => (preset.id === id ? saved : preset))
      : [...current, saved];

    try {
      await this.presetsService.save(list);
      this.characterEditor.set({ draft: structuredClone(saved), savedId: id });
      this.note('Personaje "' + name + '" guardado. Ya aparece en el panel Personajes para arrastrarlo.');
    } catch (error) {
      this.note('No se pudo guardar el personaje: ' + this.describe(error));
    }
  }

  async deleteCharacterPreset(): Promise<void> {
    const editor = this.characterEditor();
    if (!editor?.savedId) {
      return;
    }
    const confirmed = window.confirm(
      '¿Eliminar el personaje "' + editor.draft.name + '"? Lo que ya está colocado en los niveles no cambia.',
    );
    if (!confirmed) {
      return;
    }
    const list = this.presetsService.presets().filter((preset) => preset.id !== editor.savedId);
    try {
      await this.presetsService.save(list);
    } catch (error) {
      this.note('No se pudo eliminar el personaje: ' + this.describe(error));
      return;
    }
    const next = list.find((preset) => preset.kind === editor.draft.kind) ?? list[0];
    if (next) {
      this.editCharacterPreset(next.id);
    } else {
      this.newCharacterDraft(editor.draft.kind);
    }
    this.note('Personaje "' + editor.draft.name + '" eliminado.');
  }

  /** Copia sin guardar: al guardarla recibe su propio id. */
  duplicateCharacterPreset(): void {
    const editor = this.characterEditor();
    if (!editor) {
      return;
    }
    this.characterEditor.set({
      draft: { ...structuredClone(editor.draft), id: '', name: editor.draft.name + ' (copia)' },
      savedId: null,
    });
  }

  // --- Inspector: animacion, tamano y caracteristicas de una entidad ---------

  /** Las caracteristicas se muestran para personajes, y para todo lo que ya tenga "stats". */
  isCharacter(entity: LevelEntity): boolean {
    return characterOf(entity) !== undefined || entity.stats !== undefined;
  }

  statsOf(entity: LevelEntity): EntityStats {
    return entity.stats ?? defaultStatsFor(entity.type);
  }

  /** Cuadros que anima el motor, contando el "player_idle" de los niveles viejos. */
  effectiveFrames(entity: LevelEntity): number {
    return entity.frames ?? (entity.animation === 'player_idle' ? 2 : 1);
  }

  effectiveFrameDuration(entity: LevelEntity): number {
    return entity.frameDuration ?? (entity.animation === 'player_idle' ? 0.4 : 0.15);
  }

  patchEntityStats(field: keyof EntityStats, value: number): void {
    const entity = this.selected();
    if (!entity) {
      return;
    }
    this.patchEntity({ stats: { ...this.statsOf(entity), [field]: Math.max(0, value) } });
  }

  /**
   * Cuadros de animacion de la entidad. Se quita "animation" en el mismo paso:
   * el nombre de clip viejo solo cuenta mientras no haya "frames", y dejarlo
   * suelto confundiria a quien lea el JSON.
   */
  patchEntityFrames(value: number): void {
    const entity = this.selected();
    if (!entity) {
      return;
    }
    const frames = Math.max(1, Math.round(value) || 1);
    this.patchEntity({
      frames: frames > 1 ? frames : undefined,
      frameDuration: frames > 1 ? this.effectiveFrameDuration(entity) : undefined,
      animation: undefined,
    });
  }

  patchEntityFrameDuration(value: number): void {
    const entity = this.selected();
    if (!entity) {
      return;
    }
    const frames = this.effectiveFrames(entity);
    this.patchEntity({
      frames: frames > 1 ? frames : undefined,
      frameDuration: value > 0 ? value : 0.15,
      animation: undefined,
    });
  }

  patchEntityScale(value: number): void {
    const scale = value > 0 ? value : 1;
    this.patchEntity({ scale: scale === 1 ? undefined : scale });
  }

  // --- Mapa: grillas y tuneles (parte 1) ------------------------------------
  //
  // Un nivel puede ser un MAPA de varias grillas (salas) unidas por tuneles.
  // Salas y tuneles se guardan en el JSON para seguir editandolos, y el editor
  // los traduce a las celdas de piso y pared que el motor ya sabe leer (ver
  // core/dungeon-layout.ts). Aca solo estan los dialogos y el panel; las
  // cuentas viven en LevelService y en ese modulo.

  readonly roomDraft = signal<RoomDraft | null>(null);
  readonly tunnelDraft = signal<TunnelDraft | null>(null);
  readonly roomSides = ROOM_SIDES;

  /**
   * Arrastre en curso de la herramienta Grilla: dibujar el rectangulo de una
   * nueva, o mover una existente. Es un signal porque el canvas dibuja la
   * vista previa mientras dura.
   */
  readonly roomDrag = signal<
    | { kind: 'create'; start: GridCoord; end: GridCoord }
    | { kind: 'move'; id: string; grab: GridCoord; origin: GridCoord; delta: GridCoord }
    | null
  >(null);

  /**
   * Tunel a medio trazar con la herramienta Tunel: de que grilla sale, los
   * puntos marcados hasta ahora, el ancho que va a tener, y que tunel se esta
   * redibujando (null si es uno nuevo).
   */
  readonly tunnelTrace = signal<{
    from: string;
    points: GridCoord[];
    width: number;
    editId: string | null;
  } | null>(null);

  /** Abre Propiedades en la pestaña de escena con el panel Mapa desplegado. */
  showMapPanel(): void {
    this.showGridProperties();
    this.collapsedPanels.update((state) => ({ ...state, map: false }));
  }

  /**
   * Las salas con las que se puede conectar una grilla nueva. En un nivel que
   * todavia es una sola grilla, es la sala en la que se va a convertir: asi el
   * dialogo ya ofrece unir la nueva con el area de siempre.
   */
  connectableRooms() {
    return this.rooms().length > 0 ? this.rooms() : [implicitRoom(this.grid())];
  }

  /**
   * Abre el dialogo de grilla nueva. Sin argumentos propone pegarla a la
   * ultima grilla, del lado de siempre (↘, +columna) y unida por un tunel
   * recto; con un rectangulo -- el que se dibujo con la herramienta Grilla --
   * la deja justo ahi, sin tunel, para trazarlo despues a mano si se quiere.
   */
  openRoomDialog(area?: { col: number; row: number; width: number; height: number }): void {
    const existing = this.connectableRooms();
    const last = existing[existing.length - 1];
    const id = nextFreeId('sala', existing.map((room) => room.id));

    if (area) {
      this.roomDraft.set({
        editId: null,
        id,
        ...area,
        anchor: '',
        side: 'right',
        connectTo: '',
        tunnelWidth: DEFAULT_TUNNEL_WIDTH,
      });
      return;
    }
    this.roomDraft.set(
      this.placedDraft({
        editId: null,
        id,
        col: 0,
        row: 0,
        width: NEW_ROOM_SIZE,
        height: NEW_ROOM_SIZE,
        anchor: last.id,
        side: 'right',
        connectTo: last.id,
        tunnelWidth: DEFAULT_TUNNEL_WIDTH,
      }),
    );
  }

  /** El mismo dialogo, para cambiar una grilla que ya existe. */
  editRoom(id: string): void {
    const room = this.rooms().find((candidate) => candidate.id === id);
    if (!room) {
      return;
    }
    this.roomDraft.set({
      editId: id,
      ...room,
      anchor: '',
      side: 'right',
      connectTo: '',
      tunnelWidth: DEFAULT_TUNNEL_WIDTH,
    });
  }

  /** Grillas junto a las que se puede ubicar la del dialogo: todas menos ella misma. */
  anchorRooms(): MapRoom[] {
    const editing = this.roomDraft()?.editId;
    return this.connectableRooms().filter((room) => room.id !== editing);
  }

  /** Si el borrador esta pegado a otra grilla, recalcula su columna y fila. */
  private placedDraft(draft: RoomDraft): RoomDraft {
    const anchor = this.connectableRooms().find((room) => room.id === draft.anchor);
    return anchor ? { ...draft, ...placeBeside(anchor, draft.side, draft, NEW_ROOM_GAP) } : draft;
  }

  patchRoomDraft(changes: Partial<RoomDraft>): void {
    this.roomDraft.update((draft) => (draft ? { ...draft, ...changes } : draft));
  }

  /**
   * Columna o fila escritas a mano: la grilla deja de estar pegada a otra. Si
   * no, el numero que se escribio se pisaria al instante con la posicion de
   * al lado.
   */
  patchRoomPosition(changes: { col?: number; row?: number }): void {
    this.roomDraft.update((draft) => (draft ? { ...draft, ...changes, anchor: '' } : draft));
  }

  /**
   * El tamano mueve la posicion cuando la grilla esta pegada a la izquierda o
   * arriba de otra: tiene que seguir terminando justo antes del hueco.
   */
  patchRoomSize(changes: { width?: number; height?: number }): void {
    this.roomDraft.update((draft) => (draft ? this.placedDraft({ ...draft, ...changes }) : draft));
  }

  setRoomAnchor(id: string): void {
    this.roomDraft.update((draft) =>
      draft
        ? this.placedDraft({
            ...draft,
            anchor: id,
            // Pegarla a otra propone unirse con esa misma, que es lo que casi
            // siempre se quiere. Al editar una existente no hay tunel que tocar.
            connectTo: draft.editId ? draft.connectTo : id || draft.connectTo,
          })
        : draft,
    );
  }

  setRoomSide(side: RoomSide): void {
    this.roomDraft.update((draft) => (draft ? this.placedDraft({ ...draft, side }) : draft));
  }

  cancelRoomDialog(): void {
    this.roomDraft.set(null);
  }

  confirmRoomDialog(): void {
    const draft = this.roomDraft();
    if (!draft) {
      return;
    }
    const area = { col: draft.col, row: draft.row, width: draft.width, height: draft.height };

    if (draft.editId) {
      this.levels.updateRoom(draft.editId, area);
      this.roomDraft.set(null);
      this.dirty.set(true);
      this.frameAll();
      this.note('Grilla "' + draft.editId + '" actualizada.');
      return;
    }

    const id = draft.id.trim();
    if (!id || this.connectableRooms().some((room) => room.id === id)) {
      this.note(id ? 'Ya hay una grilla llamada "' + id + '".' : 'La grilla necesita un nombre.');
      return;
    }

    // Unida a la grilla junto a la que se ubico, el tunel sale por ese lado y
    // entra por el opuesto: queda un pasillo recto entre las dos, en vez de
    // una L que arranca en el medio de la sala.
    const facing = draft.anchor !== '' && draft.connectTo === draft.anchor;
    const connection = draft.connectTo
      ? {
          to: draft.connectTo,
          width: Math.max(1, Math.round(draft.tunnelWidth) || 1),
          fromSide: facing ? draft.side : undefined,
          toSide: facing ? oppositeSide(draft.side) : undefined,
        }
      : null;

    this.levels.addRoom({ id, ...area }, connection);
    this.roomDraft.set(null);
    this.dirty.set(true);
    // La grilla del nivel pudo haber crecido, o el mapa correrse: se encuadra.
    this.frameAll();
    this.note(
      'Grilla "' + id + '" agregada' +
        (connection
          ? ', unida a "' + connection.to + '" por un túnel de ' + connection.width + ' celdas.'
          : '.'),
    );
  }

  /** Propone unir las dos ultimas grillas, que suele ser la que se acaba de agregar. */
  openTunnelDialog(): void {
    const rooms = this.rooms();
    if (rooms.length < 2) {
      this.note('Hacen falta al menos dos grillas para conectarlas. Agregá una desde Mapa.');
      return;
    }
    this.tunnelDraft.set({
      editId: null,
      from: rooms[rooms.length - 2].id,
      to: rooms[rooms.length - 1].id,
      width: DEFAULT_TUNNEL_WIDTH,
      fromSide: '',
      toSide: '',
      path: [],
    });
  }

  /** El menu de un tunel que ya existe: lados, trazado y ancho. */
  editTunnel(id: string): void {
    const tunnel = this.tunnels().find((candidate) => candidate.id === id);
    if (!tunnel) {
      return;
    }
    this.tunnelDraft.set({
      editId: id,
      from: tunnel.from,
      to: tunnel.to,
      width: tunnel.width,
      fromSide: tunnel.fromSide ?? '',
      toSide: tunnel.toSide ?? '',
      path: [...(tunnel.path ?? [])],
    });
  }

  patchTunnelDraft(changes: Partial<TunnelDraft>): void {
    this.tunnelDraft.update((draft) => (draft ? { ...draft, ...changes } : draft));
  }

  cancelTunnelDialog(): void {
    this.tunnelDraft.set(null);
  }

  /** El <select> de lados devuelve texto: se valida antes de aceptarlo. */
  sideValue(event: Event): RoomSide | '' {
    const value = this.str(event);
    return value === 'top' || value === 'bottom' || value === 'left' || value === 'right' ? value : '';
  }

  confirmTunnelDialog(): void {
    const draft = this.tunnelDraft();
    if (!draft) {
      return;
    }
    if (draft.from === draft.to) {
      this.note('Un túnel tiene que unir dos grillas distintas.');
      return;
    }
    // Vacio pasa a undefined, no a '' ni a []: asi la clave desaparece del
    // JSON, y al editar un tunel "volver a automatico" borra el trazado viejo.
    const tunnel = {
      from: draft.from,
      to: draft.to,
      width: Math.max(1, Math.round(draft.width) || 1),
      fromSide: draft.fromSide || undefined,
      toSide: draft.toSide || undefined,
      path: draft.path.length > 0 ? draft.path : undefined,
    };
    if (draft.editId) {
      this.levels.updateTunnel(draft.editId, tunnel);
    } else {
      this.levels.addTunnel(tunnel);
    }
    this.tunnelDraft.set(null);
    this.dirty.set(true);
    this.note(
      draft.editId
        ? 'Túnel "' + draft.editId + '" actualizado.'
        : 'Túnel de ' + tunnel.width + ' celdas entre "' + draft.from + '" y "' + draft.to + '".',
    );
  }

  /**
   * Cierra el menu del tunel y deja trazandolo a mano desde su grilla de
   * origen. Al terminar en otra grilla, el menu se vuelve a abrir con el
   * trazado nuevo; si era un tunel que ya existia, lo reemplaza al guardar.
   */
  retraceTunnel(): void {
    const draft = this.tunnelDraft();
    if (!draft) {
      return;
    }
    this.tunnelDraft.set(null);
    this.tool.set('tunnel');
    this.tunnelTrace.set({ from: draft.from, points: [], width: draft.width, editId: draft.editId });
    this.note('Trazando desde "' + draft.from + '": clics para marcar el camino, y clic en la grilla de destino.');
  }

  // --- Herramientas de mapa del viewport ------------------------------------

  private roomToolDown(event: PointerEvent): void {
    const cell = this.coordAt(event);
    const room = roomAt(this.rooms(), cell);
    this.roomDrag.set(
      room
        ? { kind: 'move', id: room.id, grab: cell, origin: { col: room.col, row: room.row }, delta: { col: 0, row: 0 } }
        : { kind: 'create', start: cell, end: cell },
    );
    // Con captura, el arrastre sigue aunque el cursor salga del canvas.
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  private roomToolMove(event: PointerEvent): void {
    const drag = this.roomDrag();
    if (!drag) {
      return;
    }
    const cell = this.coordAt(event);
    this.hovered.set(cell);
    if (drag.kind === 'create') {
      this.roomDrag.set({ ...drag, end: cell });
      return;
    }
    const delta = { col: cell.col - drag.grab.col, row: cell.row - drag.grab.row };
    if (delta.col !== drag.delta.col || delta.row !== drag.delta.row) {
      this.roomDrag.set({ ...drag, delta });
    }
  }

  /**
   * Al soltar: una grilla movida se guarda en su lugar nuevo (el mapa se
   * recalcula una sola vez, no con cada celda del arrastre), y un rectangulo
   * dibujado abre el dialogo con ese lugar. Un clic sin arrastrar propone una
   * grilla del tamano de siempre en esa celda.
   */
  private roomToolUp(event: PointerEvent): void {
    const drag = this.roomDrag();
    if (!drag) {
      return;
    }
    this.roomDrag.set(null);
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);

    if (drag.kind === 'move') {
      if (drag.delta.col === 0 && drag.delta.row === 0) {
        return;
      }
      this.levels.updateRoom(drag.id, {
        col: drag.origin.col + drag.delta.col,
        row: drag.origin.row + drag.delta.row,
      });
      this.dirty.set(true);
      this.note('Grilla "' + drag.id + '" movida.');
      return;
    }

    const area = rectBetween(drag.start, drag.end);
    const clickOnly = area.width === 1 && area.height === 1;
    this.openRoomDialog(
      clickOnly ? { col: area.col, row: area.row, width: NEW_ROOM_SIZE, height: NEW_ROOM_SIZE } : area,
    );
  }

  private tunnelToolClick(event: PointerEvent): void {
    if (this.rooms().length < 2) {
      this.note('Hacen falta al menos dos grillas para trazar un túnel. Agregá una desde Mapa.');
      return;
    }
    const cell = this.coordAt(event);
    const room = roomAt(this.rooms(), cell);
    const trace = this.tunnelTrace();

    if (!trace) {
      if (!room) {
        this.note('Empezá el túnel con un clic dentro de una grilla.');
        return;
      }
      this.tunnelTrace.set({ from: room.id, points: [], width: DEFAULT_TUNNEL_WIDTH, editId: null });
      this.note('Túnel desde "' + room.id + '": clics para marcar el camino, y clic en otra grilla para terminar.');
      return;
    }

    if (room && room.id !== trace.from) {
      this.finishTunnelTrace(room.id);
      return;
    }
    if (room) {
      this.note('Esa es la grilla de origen: terminá el túnel en otra.');
      return;
    }
    this.tunnelTrace.set({ ...trace, points: [...trace.points, cell] });
  }

  /**
   * Termina el trazado y abre el menu del tunel con todo ya deducido. Los
   * lados salen de hacia donde se trazo: sale por el lado de "from" que mira
   * al primer punto marcado, y entra por el lado de "to" que mira al ultimo.
   * Sin puntos, cada una por el lado que da a la otra.
   */
  private finishTunnelTrace(toId: string): void {
    const trace = this.tunnelTrace();
    const from = this.rooms().find((room) => room.id === trace?.from);
    const to = this.rooms().find((room) => room.id === toId);
    if (!trace || !from || !to) {
      return;
    }
    const path = trace.points;
    this.tunnelTrace.set(null);
    this.tunnelDraft.set({
      editId: trace.editId,
      from: from.id,
      to: to.id,
      width: trace.width,
      fromSide: sideFacing(from, path[0] ?? roomCenter(to)),
      toSide: sideFacing(to, path[path.length - 1] ?? roomCenter(from)),
      path,
    });
  }

  updateRoom(id: string, changes: { col?: number; row?: number; width?: number; height?: number }): void {
    this.levels.updateRoom(id, changes);
    this.dirty.set(true);
  }

  removeRoom(id: string): void {
    this.levels.removeRoom(id);
    this.dirty.set(true);
    this.note(
      this.rooms().length === 0
        ? 'Se quitó la última grilla: el nivel vuelve a ser una sola grilla rectangular.'
        : 'Grilla "' + id + '" quitada, con sus túneles.',
    );
  }

  updateTunnel(id: string, width: number): void {
    this.levels.updateTunnel(id, { width });
    this.dirty.set(true);
  }

  removeTunnel(id: string): void {
    this.levels.removeTunnel(id);
    this.dirty.set(true);
    this.note('Túnel "' + id + '" quitado.');
  }

  clearTileEdits(): void {
    this.levels.clearTileEdits();
    this.dirty.set(true);
    this.note('Retoques descartados: el mapa queda como lo generan las grillas y los túneles.');
  }

  constructor() {
    // El canvas no tiene tamano propio: lo estira el layout de CSS. Para
    // dibujar hay que saber cuantos pixeles ocupa realmente, y eso solo se
    // sabe midiendo. Se observa el contenedor y no el canvas mismo para no
    // entrar en un bucle (dibujar cambia el tamano del canvas -> reobservar).
    effect(() => {
      const ref = this.viewport();
      // El effect se reevalua varias veces; el observer se instala una sola.
      if (!ref || this.observer) {
        return;
      }
      const host = ref.nativeElement.parentElement;
      if (!host) {
        return;
      }
      this.observer = new ResizeObserver((entries) => {
        const rect = entries[0].contentRect;
        this.canvasSize.set({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
      });
      this.observer.observe(host);
    });

    // Redibuja cuando cambia algo que se ve: nivel, zoom, pan, seleccion.
    // No hace falta enumerar de que depende: draw() lee los signals y Angular
    // registra solo esas dependencias. Tampoco hay bucle de render corriendo
    // al pedo -- se dibuja cuando algo cambio, y nada mas.
    effect(() => this.draw());

    // Decodifica el sheet de primitivas una sola vez. Al resolverse, el signal
    // dispara el effect() de arriba y el viewport se redibuja ya con los
    // sprites. La guarda de "typeof Image" es para los tests, que corren en
    // jsdom sin decodificador de imagenes.
    if (typeof Image !== 'undefined') {
      const sheet = new Image();
      sheet.onload = () => this.shapeSheet.set(sheet);
      sheet.src = SHAPE_SHEET_DATA_URL;
    }

    // El ResizeObserver sobrevive al componente si no se lo desconecta.
    this.destroyRef.onDestroy(() => this.observer?.disconnect());
  }

  // --- Proyecto -------------------------------------------------------------

  async openProject(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }
    const opened = await this.project.openProjectFolder();
    if (!opened) {
      return;
    }
    await this.refreshProject();
  }

  /**
   * Relee del disco todo lo que depende del proyecto abierto: niveles,
   * texturas y catalogo de eventos. Los dos try van separados a proposito:
   * un proyecto sin event_catalog.json sigue siendo editable (solo queda sin
   * panel de eventos), asi que ese fallo no debe tapar el listado de niveles.
   */
  private async refreshProject(): Promise<void> {
    try {
      this.levelFiles.set(await this.project.listLevels());
      this.textures.set(await this.project.listTextures());
      // Sin await: las miniaturas van apareciendo solas, y abrir el proyecto no
      // tiene por que esperar a que se procese una carpeta de 150 imagenes.
      void this.loadTextureThumbnails();
      // El explorador arranca con la raiz y nada desplegado, como VS Code.
      this.treeChildren.set({ '': await this.project.listEntries('') });
      this.expandedDirs.set({});
      this.note('Proyecto abierto: ' + this.project.projectRoot());
    } catch (error) {
      this.note('No se pudo leer el proyecto: ' + this.describe(error));
    }

    try {
      await this.catalog.load();
      const total = this.triggers().length + this.conditions().length + this.actions().length;
      this.note('Catalogo de eventos cargado (' + total + ' bloques).');
    } catch {
      this.note('No se encontro schema/event_catalog.json: el panel de eventos queda vacio.');
    }

    // Tercer try aparte por lo mismo: un characters.json roto deja la paleta
    // solo con los tipos base, pero no impide editar el nivel.
    try {
      await this.presetsService.load();
    } catch (error) {
      this.note('No se pudieron leer los personajes configurados: ' + this.describe(error));
    }
  }

  /**
   * Abre un nivel eligiendo el archivo con el dialogo del sistema.
   *
   * A diferencia del desplegable de niveles, esto no exige tener un proyecto
   * abierto ni que el archivo viva en levels/: se puede abrir un .json de
   * donde sea y verlo dibujado.
   */
  async openLevelFile(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }
    try {
      const opened = await this.project.openLevelFile();
      if (!opened) {
        return; // el usuario cancelo el dialogo
      }

      // Si resulta estar dentro de levels/ del proyecto abierto, se adopta con
      // su nombre: aparece en el desplegable y guardar no vuelve a preguntar.
      const inLevels = this.levelsFolderFile(opened.path);
      this.levels.adopt(opened.level, inLevels);
      this.lastSavedPath.set(opened.path);
      this.dirty.set(false);
      this.frameAll();
      this.note('Abierto ' + opened.path + ' (' + this.entities().length + ' entidades).');
    } catch (error) {
      this.note('No se pudo abrir: ' + this.describe(error));
    }
  }

  /** Abre un nivel del proyecto y recentra la camara sobre el. */
  async loadLevel(fileName: string): Promise<void> {
    try {
      await this.levels.load(fileName);
      this.dirty.set(false);
      // Sin recentrar, un nivel chico abierto despues de uno grande podria
      // quedar fuera de la vista o entrar con un zoom que no le corresponde.
      this.frameAll();
      this.note('Nivel "' + fileName + '" cargado (' + this.entities().length + ' entidades).');
    } catch (error) {
      this.note('Error al cargar ' + fileName + ': ' + this.describe(error));
    }
  }

  /** Abre el dialogo de nivel nuevo, con los valores siempre en su default. */
  newLevel(): void {
    this.newLevelName.set('nuevo_nivel');
    this.newLevelWidth.set(10);
    this.newLevelHeight.set(10);
    this.newLevelTileWidth.set(64);
    this.newLevelTileHeight.set(32);
    this.newLevelTemplate.set('empty');
    this.showNewLevelDialog.set(true);
  }

  cancelNewLevel(): void {
    this.showNewLevelDialog.set(false);
  }

  /** El <select> del dialogo devuelve string; se valida antes de aceptarlo. */
  setNewLevelTemplate(value: string): void {
    if (value === 'empty' || value === 'player' || value === 'test-scene') {
      this.newLevelTemplate.set(value);
    }
  }

  /**
   * Crea el nivel EN MEMORIA (no toca el disco hasta que se guarde) y le
   * aplica la plantilla elegida.
   */
  confirmNewLevel(): void {
    const name = this.newLevelName().trim() || 'nuevo_nivel';
    // Todo entero y >= 1: el schema exige enteros positivos, y el usuario
    // puede haber dejado el campo vacio o con decimales.
    const grid: GridConfig = {
      width: Math.max(1, Math.round(this.newLevelWidth())),
      height: Math.max(1, Math.round(this.newLevelHeight())),
      tileWidth: Math.max(1, Math.round(this.newLevelTileWidth())),
      tileHeight: Math.max(1, Math.round(this.newLevelTileHeight())),
    };

    this.levels.createNew(name, grid);
    this.addStarterEntities(this.newLevelTemplate(), grid);
    this.showNewLevelDialog.set(false);
    this.dirty.set(true);
    this.frameAll();
    this.note('Nivel nuevo en memoria. Revisa la escena y usa Guardar.');
  }

  /**
   * Puebla un nivel recien creado segun la plantilla:
   *   empty      - nada
   *   player     - solo el jugador ("player_1", el id que busca main.cpp)
   *   test-scene - jugador + un obstaculo, para probar colision al toque
   *
   * Las posiciones pasan por Math.min contra el tamano de la grilla: en un
   * nivel de 1x1 todo tiene que caber igual.
   */
  private addStarterEntities(template: NewLevelTemplate, grid: GridConfig): void {
    if (template === 'empty') {
      return;
    }

    const texture = this.textures()[0] ?? DEFAULT_STARTER_TEXTURE;

    const sourceRect = { x: 0, y: 0, width: 16, height: 16 };
    this.levels.addEntity({
      id: 'player_1',
      type: 'player',
      position: {
        col: Math.min(1, grid.width - 1),
        row: Math.min(2, grid.height - 1),
      },
      texture: 'textures/' + texture,
      sourceRect,
      collider: { width: 16, height: 16 },
    });

    if (template === 'test-scene') {
      this.levels.addEntity({
        id: 'target_1',
        type: 'obstacle',
        position: {
          col: Math.min(3, grid.width - 1),
          row: Math.min(2, grid.height - 1),
        },
        texture: 'textures/' + texture,
        sourceRect: { ...sourceRect },
        collider: { width: 16, height: 16 },
      });
    }
  }

  /** Guarda el nivel en levels/ y refresca el listado (puede ser uno nuevo). */
  /**
   * Guarda el nivel. Se comporta como el Guardar de cualquier programa: si ya
   * se sabe donde va el archivo, lo escribe sin preguntar; si todavia no, abre
   * el dialogo de Guardar como.
   *
   * Antes exigia tener una carpeta de proyecto abierta y, si no la habia, no
   * hacia nada mas que avisar: no habia forma de guardar un nivel recien
   * creado sin montar antes un proyecto entero.
   */
  async save(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }

    // Sin proyecto abierto, o con un nivel que nunca se guardo, no hay ruta
    // conocida: hay que preguntarla.
    if (!this.project.projectRoot() || !this.levels.fileName()) {
      await this.saveAs();
      return;
    }

    try {
      await this.levels.save();
      this.dirty.set(false);
      this.levelFiles.set(await this.project.listLevels());
      await this.reloadDir('levels');
      this.note('Guardado en levels/' + this.levels.fileName());
    } catch (error) {
      this.note('Error al guardar: ' + this.describe(error));
    }
  }

  /**
   * Guardar como: abre el dialogo del sistema para elegir carpeta y nombre.
   *
   * Se puede usar sin proyecto abierto, que es el punto: un nivel suelto se
   * guarda donde uno quiera, igual que un documento.
   */
  async saveAs(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }

    // Se propone la ultima ruta usada; si no hay, el nombre del nivel.
    const suggested = this.lastSavedPath() ?? this.levels.level().name + '.json';

    try {
      const path = await this.project.saveLevelAs(suggested, this.levels.level());
      if (!path) {
        return; // el usuario cancelo el dialogo
      }
      await this.afterSavedTo(path);
    } catch (error) {
      this.note('Error al guardar: ' + this.describe(error));
    }
  }

  /**
   * Deja el editor al dia despues de guardar por dialogo.
   *
   * Si el archivo cayo dentro de levels/ del proyecto abierto, se adopta como
   * el nivel actual: aparece en el desplegable y los guardados siguientes ya no
   * vuelven a preguntar. Si cayo fuera, se recuerda la ruta para proponerla la
   * proxima vez, pero se sigue preguntando -- escribir fuera del proyecto sin
   * dialogo requeriria abrirle al editor todo el disco, y no vale la pena.
   */
  private async afterSavedTo(path: string): Promise<void> {
    this.dirty.set(false);
    this.lastSavedPath.set(path);

    const inLevels = this.levelsFolderFile(path);
    if (inLevels) {
      this.levels.fileName.set(inLevels);
      this.levelFiles.set(await this.project.listLevels());
      await this.reloadDir('levels');
    }
    this.note('Guardado en ' + path);
  }

  /**
   * Nombre del archivo si "path" esta justo dentro de levels/ del proyecto
   * abierto; null en cualquier otro caso.
   *
   * Se compara en minusculas y con barras normales porque en Windows la misma
   * carpeta llega escrita de varias formas (mayusculas distintas, / o \).
   */
  private levelsFolderFile(path: string): string | null {
    const root = this.project.projectRoot();
    if (!root) {
      return null;
    }
    const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase();
    const prefix = normalize(root).replace(/\/$/, '') + '/levels/';
    const target = normalize(path);
    if (!target.startsWith(prefix)) {
      return null;
    }
    const rest = target.slice(prefix.length);
    // Solo el nivel de arriba de levels/: una subcarpeta no la lista el editor.
    return rest.includes('/') ? null : path.slice(path.length - rest.length);
  }

  // --- Explorador de archivos -----------------------------------------------
  //
  // Muestra la carpeta del proyecto entera, como el explorador de VS Code, y
  // deja ABRIR lo que encuentra: un nivel se carga en el viewport, una textura
  // queda elegida para colocar, y cualquier otro archivo se muestra en el
  // visor de abajo. Eso es lo que lo separa de una lista decorativa.
  //
  // Las carpetas se leen de a una, al desplegarlas (ver el handler en main.js).

  /**
   * El arbol aplanado a filas con su profundidad, salteando lo que cuelga de
   * una carpeta cerrada.
   *
   * Se aplana aca en vez de dibujarlo recursivamente porque las plantillas de
   * Angular no tienen recursion: habria que montar un ng-template con
   * ngTemplateOutlet que se invoca a si mismo, mucha mas maquinaria que este
   * recorrido. De paso, la plantilla queda con un solo @for plano.
   */
  readonly projectRows = computed<TreeRow[]>(() => {
    const children = this.treeChildren();
    const expanded = this.expandedDirs();
    const rows: TreeRow[] = [];

    const walk = (parentPath: string, depth: number): void => {
      for (const node of children[parentPath] ?? []) {
        rows.push({ node, depth });
        if (node.kind === 'dir' && expanded[node.path]) {
          walk(node.path, depth + 1);
        }
      }
    };

    walk('', 0);
    return rows;
  });

  /**
   * Relee el proyecto desde la raiz y olvida lo que tenia cacheado, para que
   * aparezca lo que se creo o borro fuera del editor. Las carpetas que estaban
   * abiertas se vuelven a leer; las cerradas siguen sin costar nada.
   */
  async refreshTree(): Promise<void> {
    if (!this.project.projectRoot()) {
      this.note('No hay un proyecto abierto. Elige la carpeta raiz con "Carpeta...".');
      return;
    }
    try {
      const open = Object.keys(this.expandedDirs()).filter((path) => this.expandedDirs()[path]);
      const children: Record<string, ProjectNode[]> = { '': await this.project.listEntries('') };
      for (const path of open) {
        children[path] = await this.project.listEntries(path);
      }
      this.treeChildren.set(children);
      this.note('Proyecto releido: ' + this.project.projectRoot());
    } catch (error) {
      // La carpeta pudo haberse movido o borrado desde que se abrio.
      this.note('No se pudo leer el proyecto: ' + this.describe(error));
    }
  }

  /**
   * Relee UNA carpeta si el explorador ya la tenia cargada. Se usa despues de
   * guardar, para que el nivel nuevo aparezca en la lista; si esa carpeta
   * nunca se desplego no hay nada que actualizar y no se toca el disco.
   */
  private async reloadDir(path: string): Promise<void> {
    if (!this.treeChildren()[path]) {
      return;
    }
    const children = await this.project.listEntries(path);
    this.treeChildren.update((state) => ({ ...state, [path]: children }));
  }

  isDirExpanded(path: string): boolean {
    return this.expandedDirs()[path] === true;
  }

  /** true si esa fila es el nivel que esta abierto ahora, para marcarlo en la lista. */
  isOpenLevel(node: ProjectNode): boolean {
    const fileName = this.levels.fileName();
    return !!fileName && node.path.toLowerCase() === ('levels/' + fileName).toLowerCase();
  }

  /** true si es el archivo que se esta mirando en el visor. */
  isOpenFile(node: ProjectNode): boolean {
    return this.openFile()?.path === node.path;
  }

  /**
   * Glifo de la fila: la flecha de plegado si es carpeta, o un icono segun la
   * extension si es archivo. Los niveles y las imagenes llevan uno propio
   * porque son los dos tipos que el editor hace algo mas que mostrar.
   */
  treeGlyph(node: ProjectNode): string {
    if (node.kind === 'dir') {
      return this.isDirExpanded(node.path) ? '▾' : '▸';
    }
    if (/\.json$/i.test(node.name)) {
      return '◈';
    }
    if (/\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(node.name)) {
      return '▦';
    }
    return '·';
  }

  /**
   * Click sobre una fila. Una carpeta se abre o se cierra (leyendo su contenido
   * la primera vez); un archivo se abre con lo que corresponda a su tipo, y lo
   * que el editor no sabe editar se muestra igual en el visor -- que es el
   * punto de tener un explorador y no una lista de niveles.
   */
  async openTreeEntry(node: ProjectNode): Promise<void> {
    if (node.kind === 'dir') {
      await this.toggleDir(node);
      return;
    }

    if (/^levels\/.+\.json$/i.test(node.path)) {
      await this.openProjectLevel(node);
      return;
    }

    // Solo las texturas de arriba de assets/textures/: lo que guarda
    // activeTexture es el nombre suelto, y en una subcarpeta perderia el camino.
    //
    // Ademas de elegirla se MUESTRA en el visor. Antes solo se elegia, y por
    // eso la pestana Archivo mostraba una imagen de cualquier otra carpeta pero
    // nunca las de texturas, que son justo las que uno quiere mirar.
    if (/^assets\/textures\/[^/]+\.(png|jpg|jpeg|gif)$/i.test(node.path)) {
      this.selectTexture(node.name);
      await this.viewFile(node);
      this.note('Textura activa: ' + node.name + '. Clic en la grilla para colocarla.');
      return;
    }

    await this.viewFile(node);
  }

  /** Abre o cierra una carpeta, leyendo su contenido la primera vez. */
  private async toggleDir(node: ProjectNode): Promise<void> {
    const open = this.isDirExpanded(node.path);
    this.expandedDirs.update((state) => ({ ...state, [node.path]: !open }));
    if (open || this.treeChildren()[node.path]) {
      return; // se cerro, o ya se habia leido antes
    }
    try {
      const children = await this.project.listEntries(node.path);
      this.treeChildren.update((state) => ({ ...state, [node.path]: children }));
    } catch (error) {
      this.note('No se pudo leer ' + node.path + ': ' + this.describe(error));
    }
  }

  /**
   * Muestra un archivo en el visor de abajo y trae esa workspace al frente.
   * El proceso principal decide si llega como texto, como imagen o si no se
   * puede mostrar (ver project:readFileData en main.js).
   */
  private async viewFile(node: ProjectNode): Promise<void> {
    try {
      const data = await this.project.readFileData(node.path);
      this.openFile.set({ path: node.path, data });
      this.workspace.set('archivo');
      this.note(
        data.kind === 'binary'
          ? node.path + ': ' + this.fileSize(data.size) + ', no se puede mostrar aca.'
          : 'Mirando ' + node.path + ' (' + this.fileSize(data.size) + ').',
      );
    } catch (error) {
      this.note('No se pudo leer ' + node.path + ': ' + this.describe(error));
    }
  }

  closeOpenFile(): void {
    this.openFile.set(null);
  }

  /** Tamano legible para la cabecera del visor. */
  fileSize(bytes: number): string {
    if (bytes < 1024) {
      return bytes + ' B';
    }
    if (bytes < 1024 * 1024) {
      return Math.round(bytes / 1024) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // --- Paneles laterales: ocultar y redimensionar ---------------------------
  //
  // Como en VS Code: se arrastra el borde interior de cada panel para cambiar
  // su ancho, y cada uno se esconde con su boton del topbar. Los anchos viven
  // en signals y la plantilla los inyecta en el grid-template-columns del
  // cuerpo, asi que no hace falta tocar el DOM a mano en ningun momento.

  toggleSidebar(): void {
    this.sidebarVisible.update((visible) => !visible);
  }

  toggleInspector(): void {
    this.inspectorVisible.update((visible) => !visible);
  }

  /** Las columnas del cuerpo. Un panel escondido no ocupa columna: desaparece. */
  bodyColumns(): string {
    const columns: string[] = [];
    if (this.sidebarVisible()) {
      columns.push(this.sidebarWidth() + 'px');
    }
    columns.push('1fr');
    if (this.inspectorVisible()) {
      columns.push(this.inspectorWidth() + 'px');
    }
    return columns.join(' ');
  }

  isResizing(panel: 'sidebar' | 'inspector'): boolean {
    return this.resizing() === panel;
  }

  onResizeStart(panel: 'sidebar' | 'inspector', event: PointerEvent): void {
    event.preventDefault();
    this.resizing.set(panel);
    // Con captura el arrastre sigue aunque el cursor se vaya sobre el canvas,
    // que es justo lo que pasa al ensanchar un panel.
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  onResizeMove(event: PointerEvent): void {
    const panel = this.resizing();
    if (!panel) {
      return;
    }
    // No hace falta guardar donde arranco el gesto: cada panel esta pegado a un
    // borde de la ventana, asi que su ancho es la distancia del cursor a ese
    // borde. El izquierdo mide desde 0; el derecho, desde el ancho total.
    const width =
      panel === 'sidebar' ? event.clientX : window.innerWidth - event.clientX;
    const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
    if (panel === 'sidebar') {
      this.sidebarWidth.set(clamped);
    } else {
      this.inspectorWidth.set(clamped);
    }
  }

  onResizeEnd(event: PointerEvent): void {
    if (!this.resizing()) {
      return;
    }
    this.resizing.set(null);
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  }

  /**
   * Abre un nivel elegido en el organizador. Es lo mismo que hace el
   * desplegable de la topbar, pero para un archivo que puede estar en una
   * subcarpeta de levels/.
   */
  private async openProjectLevel(node: ProjectNode): Promise<void> {
    try {
      const level = await this.project.readLevelAt(node.path);
      // Solo un nivel que este JUSTO en levels/ se adopta con su nombre de
      // archivo: es lo unico que le permite a Guardar volver a escribirlo sin
      // preguntar (ver levels.save()).
      const direct = /^levels\/[^/]+$/i.test(node.path) ? node.name : null;
      this.levels.adopt(level, direct);

      const root = this.project.projectRoot();
      // Ruta absoluta para Ejecutar: el motor lee el nivel del disco.
      this.lastSavedPath.set(root ? root.replace(/[\\/]$/, '') + '/' + node.path : null);
      this.dirty.set(false);
      this.frameAll();
      this.note('Nivel "' + node.path + '" abierto (' + this.entities().length + ' entidades).');
    } catch (error) {
      this.note('No se pudo abrir ' + node.path + ': ' + this.describe(error));
    }
  }

  // --- Interfaz: workspaces y paneles plegables -----------------------------

  /** Un panel del inspector esta plegado solo si figura en el mapa como true. */
  isCollapsed(id: string): boolean {
    return this.collapsedPanels()[id] === true;
  }

  togglePanel(id: string): void {
    this.collapsedPanels.update((state) => ({ ...state, [id]: !state[id] }));
  }

  // Las secciones de la barra izquierda se pliegan con el mismo mapa que los
  // paneles del inspector, con ids "side-*". Plegada, una seccion queda en su
  // cabecera sola, como las vistas del explorador de VS Code.

  /** Cambia el editor del area de arriba a la izquierda, y la despliega si estaba plegada. */
  setLeftEditor(editor: LeftEditor): void {
    this.leftEditor.set(editor);
    this.collapsedPanels.update((state) => ({ ...state, 'side-main': false }));
  }

  /**
   * Filas de la barra izquierda. Una seccion plegada mide lo que su cabecera,
   * y el alto que sobra va a la primera seccion abierta que lo aprovecha: la
   * escena o el explorador, o Recursos si esa esta plegada. Es el mismo reparto
   * que hace VS Code con sus vistas.
   */
  sidebarRows(): string {
    const mainOpen = !this.isCollapsed('side-main');
    const assetsOpen = !this.isCollapsed('side-assets');
    return [
      mainOpen ? 'minmax(0, 1fr)' : 'auto',
      !mainOpen && assetsOpen ? 'minmax(0, 1fr)' : 'auto',
      'auto',
      'auto',
    ].join(' ');
  }

  /** true si el archivo del visor es una imagen que no se muestra solo por su peso. */
  isTooLargeToPreview(file: OpenFile): boolean {
    return file.data.kind === 'binary' && file.data.reason === 'too-large';
  }

  // --- Ejecutar en el runtime -----------------------------------------------

  /**
   * Ruta absoluta del archivo del nivel abierto, o null si todavia no se
   * guardo en ningun lado.
   *
   * Hay dos formas de saberla: si el nivel vive en el proyecto, se arma con la
   * raiz mas levels/<archivo>; si se abrio o guardo con el dialogo del
   * sistema, es la ruta que quedo de ahi.
   */
  private currentLevelPath(): string | null {
    const root = this.project.projectRoot();
    const fileName = this.levels.fileName();
    if (root && fileName) {
      return root.replace(/[\\/]$/, '') + '/levels/' + fileName;
    }
    return this.lastSavedPath();
  }

  /**
   * Lanza el motor con el nivel abierto: el equivalente a correr a mano
   * engine\build\engine.exe con la ruta del nivel.
   *
   * Guarda antes de lanzar. No es una comodidad: el motor lee el nivel del
   * DISCO, asi que sin guardar correria la version anterior y uno estaria
   * probando algo distinto de lo que tiene en pantalla.
   */
  async run(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }

    if (this.dirty() || !this.currentLevelPath()) {
      await this.save(); // puede abrir el dialogo si el nivel es nuevo
    }

    const levelPath = this.currentLevelPath();
    // Si sigue sin ruta o con cambios, el guardado se cancelo.
    if (!levelPath || this.dirty()) {
      this.note('Guarda el nivel antes de ejecutarlo.');
      return;
    }

    const result = await this.project.runLevel(levelPath);
    this.note(
      result.ok
        ? 'Ejecutando ' + levelPath
        : result.error ?? 'No se pudo ejecutar el motor.',
    );
  }

  // --- Viewport -------------------------------------------------------------

  /**
   * Cambia la herramienta activa y dice en la barra de estado que hace.
   *
   * El mensaje es la parte importante: elegir "piso" o "pared" no cambia nada
   * en pantalla hasta el primer click sobre la grilla, asi que sin el aviso el
   * boton parece no responder aunque este encendido.
   */
  setTool(tool: Tool): void {
    // Cambiar de herramienta abandona un tunel a medio trazar: si no, el
    // camino quedaria dibujado en verde sin ninguna forma de terminarlo.
    if (tool !== 'tunnel') {
      this.tunnelTrace.set(null);
    }
    this.tool.set(tool);
    this.note(TOOL_HINTS[tool]);
  }

  setZoom(step: number): void {
    this.zoom.set(this.clampZoom(step));
  }

  private clampZoom(value: number): number {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
  }

  /**
   * Zoom con la rueda, anclado al cursor: el punto de la escena que esta bajo
   * el mouse se queda EXACTAMENTE donde esta, y todo lo demas se acerca o se
   * aleja alrededor de el. Es lo que hace Blender con "Zoom to Mouse Position"
   * y es la diferencia entre encuadrar de una o pelearse con el paneo despues
   * de cada muesca.
   *
   * La cuenta: si un punto del mundo esta en worldX = (mouseX - originX) / zoom,
   * para que no se mueva al pasar de "old" a "next" el origen tiene que
   * correrse worldX * (old - next). Como origin() es pan mas una constante,
   * ese mismo delta se le aplica al pan.
   */
  onWheel(event: WheelEvent): void {
    // Sin esto Electron desplaza el contenedor y el zoom se pierde.
    event.preventDefault();

    const ref = this.viewport();
    if (!ref) {
      return;
    }

    const old = this.zoom();
    const next = this.clampZoom(
      event.deltaY < 0 ? old * ZOOM_WHEEL_FACTOR : old / ZOOM_WHEEL_FACTOR,
    );
    // Ya estamos en un extremo del rango: no hay nada que recalcular.
    if (next === old) {
      return;
    }

    const rect = ref.nativeElement.getBoundingClientRect();
    const origin = this.origin();
    const worldX = (event.clientX - rect.left - origin.x) / old;
    const worldY = (event.clientY - rect.top - origin.y) / old;

    const pan = this.pan();
    this.pan.set({
      x: pan.x + worldX * (old - next),
      y: pan.y + worldY * (old - next),
    });
    this.zoom.set(next);
  }

  /**
   * Encuadra la grilla entera en el viewport, como el Inicio de Blender. Se
   * calcula el rectangulo que ocupa la grilla ya proyectada (incluyendo el alto
   * del rombo de la ultima fila) y se elige el zoom que lo hace entrar con
   * margen, dejandolo centrado.
   */
  frameAll(): void {
    const size = this.canvasSize();
    const grid = this.grid();
    if (size.w === 0 || size.h === 0) {
      return;
    }

    const halfW = grid.tileWidth / 2;
    const halfH = grid.tileHeight / 2;
    // Extremos de la proyeccion isometrica: la columna crece hacia la derecha y
    // la fila hacia la izquierda, asi que el ancho lo dan las dos esquinas
    // laterales y el alto va de la punta de (0,0) a la base de la ultima celda.
    const minX = -grid.height * halfW;
    const maxX = grid.width * halfW;
    const minY = 0;
    const maxY = (grid.width - 1 + grid.height - 1) * halfH + grid.tileHeight;

    const zoom = this.clampZoom(
      Math.min((size.w * FRAME_FILL) / (maxX - minX), (size.h * FRAME_FILL) / (maxY - minY)),
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // origin() = (w/2 + panX, VIEW_TOP_MARGIN + panY); se despeja el pan que
    // deja el centro de la grilla en el centro del canvas.
    this.zoom.set(zoom);
    this.pan.set({
      x: -centerX * zoom,
      y: size.h / 2 - VIEW_TOP_MARGIN - centerY * zoom,
    });
  }

  /**
   * Atajos de teclado, con el mismo reparto que Blender:
   *   Inicio    encuadrar todo         Supr / X   borrar el objeto activo
   *   Shift+D   duplicar               Ctrl+S     guardar
   *
   * El primer if es la parte importante: si el foco esta en un campo de texto
   * el atajo no corre. Sin eso, escribir una "x" en el id de una entidad la
   * borraria.
   */
  onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable) {
      return;
    }
    // Un dialogo abierto se lleva todos los atajos: solo responde a Escape.
    if (this.showNewLevelDialog()) {
      if (event.key === 'Escape') {
        this.cancelNewLevel();
      }
      return;
    }
    if (this.pendingPlacement()) {
      if (event.key === 'Escape') {
        this.cancelPending();
      }
      return;
    }
    if (this.roomDraft() || this.tunnelDraft() || this.characterEditor() || this.transitionDraft()) {
      if (event.key === 'Escape') {
        this.cancelRoomDialog();
        this.cancelTunnelDialog();
        this.closeCharacterEditor();
        this.cancelTransitionDialog();
      }
      return;
    }
    // Un tunel a medio trazar se lleva Escape (abandonarlo) y Retroceso
    // (deshacer el ultimo punto). El resto de las teclas sigue funcionando: se
    // puede hacer zoom o encuadrar sin perder el trazado.
    if (this.tunnelTrace()) {
      if (event.key === 'Escape') {
        this.tunnelTrace.set(null);
        this.note('Trazado de túnel cancelado.');
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        this.tunnelTrace.update((trace) => (trace ? { ...trace, points: trace.points.slice(0, -1) } : trace));
        return;
      }
    }

    // El menu del clic derecho es un dialogo mas: mientras esta abierto, las
    // teclas no le llegan a la escena (una X borraria la entidad que se esta
    // editando), y Escape lo cierra.
    if (this.contextMenu()) {
      if (event.key === 'Escape') {
        this.closeContextMenu();
      }
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      // Ctrl+Shift+S fuerza el dialogo aunque ya se sepa donde va el archivo.
      void (event.shiftKey ? this.saveAs() : this.save());
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      void this.openLevelFile();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.newLevel();
      return;
    }
    // Estos dos los daba el menu nativo de Electron, que se quito para que no
    // hubiera dos barras de menus. Siguen funcionando igual desde aca.
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      this.toggleDevTools();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      this.reloadWindow();
      return;
    }
    // Ctrl+B esconde la barra lateral, el mismo atajo que en VS Code.
    if (event.ctrlKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      this.toggleSidebar();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.selectAllEntities();
      return;
    }
    // F5: probar el nivel, como en cualquier entorno de desarrollo.
    if (event.key === 'F5') {
      event.preventDefault();
      void this.run();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      this.frameAll();
      return;
    }
    // Las flechas mueven la seleccion entera una celda. Es la unica forma de
    // mover varias entidades juntas (ver nudgeSelection).
    //
    // Sin nada seleccionado NO se las toca: asi siguen sirviendo para
    // desplazarse por el visor de archivos o por la consola de abajo.
    const nudge = ARROW_NUDGES[event.key];
    if (nudge && this.selectionCount() > 0) {
      event.preventDefault();
      this.nudgeSelection(nudge.col, nudge.row);
      return;
    }
    if (event.key === 'Delete' || event.key.toLowerCase() === 'x') {
      this.deleteSelected();
      return;
    }
    if (event.shiftKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.duplicateSelected();
    }
  }

  toggleGrid(): void {
    this.showGrid.update((value) => !value);
  }

  /** Elegir donde van las lineas es querer verlas: con la grilla oculta, se muestra. */
  setGridOnTop(onTop: boolean): void {
    this.gridOnTop.set(onTop);
    this.showGrid.set(true);
  }

  toggleColliders(): void {
    this.showColliders.update((value) => !value);
  }

  onPointerDown(event: PointerEvent): void {
    // Dos formas de desplazar la vista: boton medio (el de Blender) y boton
    // derecho (la mas comoda con mouse de dos botones o trackpad).
    //
    // Antes tambien paneaba el shift-arrastre. Se quito porque Shift pasa a ser
    // el modificador de seleccion multiple, que es lo que espera cualquiera que
    // venga de un editor grafico; los otros dos gestos siguen cubriendo el
    // paneo de sobra.
    if (event.button === 1 || event.button === 2) {
      this.panning.set(true);
      // Un click derecho puede terminar en dos cosas distintas segun si el
      // cursor se movio o no: arrastrar la camara, o abrir el menu de la
      // entidad. Se guarda el boton para decidirlo recien al soltar.
      this.pressedButton = event.button;
      this.contextMenu.set(null);
      const pan = this.pan();
      this.dragOrigin = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      // Con captura, el arrastre sigue funcionando aunque el cursor se vaya
      // fuera del canvas; sin ella, el paneo se corta al pasar sobre un panel.
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    // Solo el boton izquierdo edita.
    if (event.button !== 0) {
      return;
    }
    // Cualquier click izquierdo cierra el menu abierto, como en cualquier
    // programa: el menu no debe sobrevivir a la siguiente accion.
    this.contextMenu.set(null);

    // Ctrl+clic sobre una entidad la agarra para moverla, sea cual sea la
    // herramienta activa: con "colocar" encendida, un clic normal crearia otra
    // entidad, y justo lo que se quiere es reacomodar la que ya esta. Sobre el
    // vacio no hace nada, para no colocar ni deseleccionar por accidente.
    if (event.ctrlKey) {
      const grabbed = this.entityAt(event);
      if (grabbed) {
        this.startMove(grabbed, event);
      }
      return;
    }

    const activeTool = this.tool();
    if (activeTool === 'room') {
      this.roomToolDown(event);
      return;
    }
    if (activeTool === 'tunnel') {
      this.tunnelToolClick(event);
      return;
    }
    if (activeTool === 'place') {
      const character = this.activeCharacter();
      const shape = this.activeShape();
      if (shape && (this.paintShapes() || event.shiftKey)) {
        this.startShapeStroke(event, shape);
      } else if (character) {
        this.placeCharacter(this.coordAt(event), character);
      } else {
        this.placeEntity(this.coordAt(event));
      }
    } else if (activeTool === 'floor' || activeTool === 'wall') {
      const cell = this.coordAt(event);
      const grid = this.grid();
      if (!new IsoProjection(grid.tileWidth, grid.tileHeight).isValidCoord(cell, grid.width, grid.height)) {
        return;
      }
      this.levels.toggleTile(cell.col, cell.row, activeTool);
      this.dirty.set(true);
    } else {
      // Shift suma a la seleccion en vez de reemplazarla; sin modificador,
      // clickear elige una sola y el vacio deselecciona todo. (Ctrl ya no suma
      // en el viewport: es el gesto de mover, ver arriba.)
      this.selectEntity(this.entityAt(event), event.shiftKey);
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (this.moveDrag) {
      this.updateMove(event);
      return;
    }
    if (this.shapeStroke) {
      this.continueShapeStroke(event);
      return;
    }
    if (this.roomDrag()) {
      this.roomToolMove(event);
      return;
    }
    if (this.panning()) {
      this.pan.set({
        x: this.dragOrigin.panX + (event.clientX - this.dragOrigin.x),
        y: this.dragOrigin.panY + (event.clientY - this.dragOrigin.y),
      });
      return;
    }
    this.hovered.set(this.coordAt(event));
  }

  onPointerUp(event: PointerEvent): void {
    if (this.moveDrag) {
      this.finishMove(event);
      return;
    }
    if (this.shapeStroke) {
      this.finishShapeStroke(event);
      return;
    }
    if (this.roomDrag()) {
      this.roomToolUp(event);
      return;
    }
    if (this.panning()) {
      this.panning.set(false);
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);

      // Boton derecho SIN arrastre = click derecho: abre el menu de la entidad
      // que este debajo. El umbral es lo que separa las dos acciones; sin el,
      // el menu aparecería al final de cada paneo, que es exactamente lo que
      // arruina el gesto de arrastrar con el derecho.
      const moved =
        Math.abs(event.clientX - this.dragOrigin.x) +
        Math.abs(event.clientY - this.dragOrigin.y);
      if (this.pressedButton === 2 && moved <= CLICK_SLOP) {
        this.openContextMenu(event);
      }
    }
    this.pressedButton = null;
  }

  /**
   * Abre el menu contextual sobre la entidad que este bajo el cursor. Sobre
   * espacio vacio no abre nada: un menu sin destino solo estorba.
   */
  private openContextMenu(event: PointerEvent): void {
    const id = this.entityAt(event);
    if (!id) {
      this.contextMenu.set(null);
      // Sin entidad debajo, el clic derecho configura la parte del mapa que
      // haya ahi: la grilla si cae adentro de una, o el tunel que pasa por esa
      // celda. Es el "menu del tunel" que se abre donde se lo ve.
      const cell = this.coordAt(event);
      const room = roomAt(this.rooms(), cell);
      if (room) {
        this.editRoom(room.id);
        return;
      }
      const tunnel = tunnelAt(this.rooms(), this.tunnels(), cell);
      if (tunnel) {
        this.editTunnel(tunnel.id);
      }
      return;
    }
    this.selectEntity(id);
    this.contextMenu.set(id);
  }

  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  // --- Tamano de las figuras ------------------------------------------------
  //
  // Una figura puede ocupar un bloque de NxN celdas ("span" en el contrato),
  // y se cambia desde el menu del clic derecho. Solo las figuras: son volumenes
  // pensados para llenar casillas, mientras que agrandar cuatro veces un
  // personaje de 16 px solo lo dejaria pixelado.

  /** Tamanos que el menu ofrece de un clic; uno mas grande se escribe a mano. */
  readonly spanChoices = [1, 2, 3, 4];

  isShape(entity: LevelEntity): boolean {
    return shapeOf(entity) !== undefined;
  }

  spanOf(entity: LevelEntity): number {
    return entitySpan(entity);
  }

  /** El bloque mas grande que entra en la grilla del nivel. */
  maxSpan(): number {
    const grid = this.grid();
    return Math.max(1, Math.min(grid.width, grid.height));
  }

  /** Ids de las entidades que comparten alguna celda con el bloque de esta. */
  overlapIds(entity: LevelEntity): string[] {
    return this.entities()
      .filter((other) => other.id !== entity.id && blocksOverlap(other, entity))
      .map((other) => other.id);
  }

  /**
   * Cambia cuantas celdas por lado ocupa una figura.
   *
   * El collider crece con ella, porque el motor agranda el sprite entero y una
   * figura grande con la huella de una chica se dejaria atravesar casi toda. Si
   * el bloque no entra desde su celda, la figura se corre hacia adentro lo
   * justo, en vez de quedar con celdas fuera del mapa.
   */
  setSpan(id: string, requested: number): void {
    const entity = this.entities().find((candidate) => candidate.id === id);
    const shape = entity ? shapeOf(entity) : undefined;
    if (!entity || !shape) {
      return;
    }

    const grid = this.grid();
    const span = Math.min(this.maxSpan(), Math.max(1, Math.round(requested) || 1));
    const position = clampBlockPosition(entity.position, span, grid);
    const shifted = position.col !== entity.position.col || position.row !== entity.position.row;

    this.levels.updateEntity(id, {
      // 1 se omite: es el default del schema, y asi el JSON de lo que no se
      // agrando queda exactamente igual que antes de que existiera el campo.
      span: span === 1 ? undefined : span,
      position,
      // Se conserva si era pared o sensor; una figura vieja que no tenia
      // collider recibe el de su forma, solido.
      collider: {
        ...shapeCollider(shape, grid, span),
        solid: entity.collider ? entity.collider.solid : true,
      },
    });
    this.dirty.set(true);
    this.note(
      '"' + id + '" ocupa ' + span + '×' + span + ' celdas' +
        (shifted ? ', corrida a ' + position.col + ',' + position.row + ' para entrar en la grilla.' : '.'),
    );
  }

  // --- Mover con Ctrl+arrastrar ---------------------------------------------
  //
  // Ctrl+clic sobre una entidad la agarra y arrastrando se la lleva de celda
  // en celda. Si la agarrada ya estaba seleccionada junto con otras, se mueve
  // la seleccion entera, que es la operacion de grupo que uno espera. Al
  // soltar sobre celdas ocupadas se pregunta, igual que al colocar.

  private startMove(id: string, event: PointerEvent): void {
    if (!this.isEntitySelected(id)) {
      this.levels.selectEntity(id);
    }
    this.inspectorTab.set('objeto');

    const originals = new Map<string, GridPosition>();
    for (const entity of this.entities()) {
      if (this.isEntitySelected(entity.id)) {
        originals.set(entity.id, { ...entity.position });
      }
    }

    this.moveDrag = { startCell: this.coordAt(event), originals, delta: { col: 0, row: 0 } };
    this.moving.set(true);
    // Con captura, el arrastre sigue aunque el cursor pase sobre un panel.
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  private updateMove(event: PointerEvent): void {
    const drag = this.moveDrag;
    if (!drag) {
      return;
    }
    const cell = this.coordAt(event);
    this.hovered.set(cell);

    // El desplazamiento se limita para que NINGUN bloque del grupo se salga de
    // la grilla. Aplastar contra el borde solo a los que se salen deformaria el
    // grupo: dejaria de tener la forma con la que se lo agarro.
    const grid = this.grid();
    let col = cell.col - drag.startCell.col;
    let row = cell.row - drag.startCell.row;
    for (const [id, origin] of drag.originals) {
      const span = entitySpan(this.entities().find((entity) => entity.id === id) ?? {});
      col = Math.min(Math.max(col, -origin.col), grid.width - span - origin.col);
      row = Math.min(Math.max(row, -origin.row), grid.height - span - origin.row);
    }

    if (col === drag.delta.col && row === drag.delta.row) {
      return; // sigue en la misma celda: no hay nada que redibujar
    }
    drag.delta = { col, row };
    for (const [id, origin] of drag.originals) {
      this.levels.updateEntity(id, { position: { col: origin.col + col, row: origin.row + row } });
    }
  }

  private finishMove(event: PointerEvent): void {
    const drag = this.moveDrag;
    if (!drag) {
      return;
    }
    this.moveDrag = null;
    this.moving.set(false);
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);

    // Se solto donde se agarro: no hubo movimiento, y no hay nada que guardar.
    if (drag.delta.col === 0 && drag.delta.row === 0) {
      return;
    }

    const moved = new Set(drag.originals.keys());
    const movedEntities = this.entities().filter((entity) => moved.has(entity.id));
    const occupants = this.entities().filter(
      (other) => !moved.has(other.id) && movedEntities.some((entity) => blocksOverlap(entity, other)),
    );
    if (occupants.length > 0) {
      this.pendingPlacement.set({
        kind: 'move',
        movedIds: [...moved],
        originals: drag.originals,
        occupants,
      });
      return;
    }

    this.dirty.set(true);
    if (movedEntities.length === 1) {
      const { col, row } = movedEntities[0].position;
      this.note('"' + movedEntities[0].id + '" movida a ' + col + ',' + row + '.');
    } else {
      this.note(movedEntities.length + ' entidades movidas.');
    }
  }

  // --- Entidad o pared ------------------------------------------------------
  //
  // Las dos opciones del menu son las dos caras del MISMO campo del contrato:
  // collider.solid (ver schema/level.schema.json). No hizo falta inventar nada
  // nuevo -- el schema ya lo declaraba y el motor ya bloqueaba con el; lo unico
  // que faltaba era que el editor lo dejara tocar.
  //
  //   Pared   -> collider.solid = true   el motor frena al jugador contra ella
  //   Entidad -> collider.solid = false  se la atraviesa; el contacto se sigue
  //                                      detectando y dispara on_collision

  /** true si la entidad bloquea el paso. */
  isWall(entity: LevelEntity): boolean {
    return entity.collider?.solid === true;
  }

  /**
   * Convierte una entidad en pared o en entidad atravesable.
   *
   * Al hacerla pared se le crea el collider si no tenia: sin caja no hay con
   * que chocar. Una figura lo recibe con la huella de su forma (ver
   * shapeCollider); el resto, al tamano de su sprite.
   *
   * Al volverla entidad se conserva el collider y solo se apaga "solid": asi
   * los eventos de contacto que ya estuvieran configurados siguen andando.
   */
  setWall(id: string, wall: boolean): void {
    const entity = this.entities().find((candidate) => candidate.id === id);
    if (!entity) {
      return;
    }

    const shape = shapeOf(entity);
    const collider =
      entity.collider ??
      (shape
        ? shapeCollider(shape, this.grid(), entitySpan(entity))
        : { width: entity.sourceRect.width, height: entity.sourceRect.height });

    this.levels.updateEntity(id, {
      // solid se omite cuando es false: es el default del schema, y asi no
      // ensucia el JSON de todo lo que no es pared.
      collider: { ...collider, solid: wall ? true : undefined },
    });
    this.dirty.set(true);
    this.note('"' + id + '" ahora es ' + (wall ? 'pared: bloquea el paso.' : 'entidad: se atraviesa.'));
  }

  /**
   * Lo mismo, pero sobre TODA la seleccion: es la casilla del inspector, que
   * con varias entidades elegidas tiene que aplicarles el cambio a todas.
   */
  setWallOnSelection(wall: boolean): void {
    const ids = this.selectedIds();
    for (const id of ids) {
      this.setWall(id, wall);
    }
    if (ids.length > 1) {
      this.note(ids.length + ' entidades: ' + (wall ? 'ahora bloquean el paso.' : 'ahora se atraviesan.'));
    }
  }

  /**
   * El menu contextual del navegador se cancela SIEMPRE sobre el canvas: el
   * boton derecho ahi es desplazar la vista, y si el menu apareciera al soltar
   * cortaria el gesto justo al terminarlo.
   */
  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  onPointerLeave(): void {
    this.hovered.set(null);
  }

  // --- Entidades ------------------------------------------------------------

  // Las tres paletas -- Recursos, Figuras y Personajes -- alimentan la MISMA
  // herramienta de colocar, y por eso elegir en una apaga las otras dos: si no,
  // "place" no sabria cual de las tres cosas esta a punto de crear.

  /**
   * Importa una carpeta de imagenes como texturas: las copia a assets/textures/
   * del proyecto AJUSTADAS a lo que el motor puede dibujar dentro de una celda
   * (ver core/texture-fit.ts) y las deja listas en Recursos.
   *
   * Se copian y no se referencian donde estaban porque el nivel guarda rutas
   * relativas a assets/: una textura de afuera saldria en negro al ejecutar.
   *
   * Ya no exige abrir un proyecto antes. Si falta, el proceso principal lo
   * deduce -- o lo pregunta en el mismo gesto -- y aca solo hay que ponerse al
   * dia con la raiz que devuelve.
   */
  async importTextures(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }
    if (this.importing()) {
      return;
    }

    let session: ImportSession | null = null;
    try {
      session = await this.project.beginImport();
    } catch (error) {
      this.note('No se pudo empezar a importar: ' + this.describe(error));
      return;
    }
    if (!session) {
      return; // se cancelo la eleccion de la carpeta del proyecto
    }
    if (session.projectRoot !== this.project.projectRoot()) {
      this.project.projectRoot.set(session.projectRoot);
      await this.refreshProject();
    }
    if (session.canceled) {
      return;
    }

    // El limite es el ancho de tile del nivel abierto: es la casilla dentro de
    // la cual tiene que verse el sprite.
    const maxSide = this.grid().tileWidth;
    const report = { copied: 0, converted: 0, kept: 0, failed: [] as string[] };
    this.importing.set(true);

    try {
      for (const [index, item] of session.items.entries()) {
        this.note('Importando ' + (index + 1) + '/' + session.items.length + ': ' + item.source);
        // El sheet de figuras no se toca nunca, aunque venga en la carpeta: es
        // un spritesheet de 262 px a proposito, y "ajustarlo" a un tile
        // romperia el recorte de cada figura en el juego.
        if (item.status === 'exists' || 'textures/' + item.target === SHAPE_TEXTURE) {
          report.kept += 1;
          continue;
        }
        try {
          const image = await decodeImage(await this.project.readImportImage(index));
          const fitted = fitTextureSize(image.naturalWidth, image.naturalHeight, maxSide);
          const needsConversion = fitted.scaled || !/\.png$/i.test(item.source);

          // Una copia vieja que ya cumplia los requisitos no gana nada
          // reescribiendose: queda como esta.
          if (item.status === 'stale' && !needsConversion) {
            report.kept += 1;
            continue;
          }

          const pngBase64 = needsConversion
            ? renderPngBase64(image, fitted, usesNearestNeighbor(image.naturalWidth, fitted))
            : null;
          const { written } = await this.project.writeImportedTexture(index, pngBase64);
          if (!written) {
            report.kept += 1;
          } else if (needsConversion) {
            report.converted += 1;
          } else {
            report.copied += 1;
          }
        } catch {
          // Una imagen rota no corta la importacion del resto; queda en el
          // informe final con su nombre.
          report.failed.push(item.source);
        }
      }
    } finally {
      this.importing.set(false);
    }

    try {
      this.textures.set(await this.project.listTextures());
      void this.loadTextureThumbnails();
      await this.reloadDir('assets/textures');
      // Si Recursos estaba plegado, se despliega: es donde esta el resultado.
      this.collapsedPanels.update((state) => ({ ...state, 'side-assets': false }));
      this.note(this.describeImport(report, session.items.length, maxSide));
    } catch (error) {
      this.note('Se importo, pero no se pudo releer assets/textures: ' + this.describe(error));
    }
  }

  /** Resumen de una importacion para la barra de estado. */
  private describeImport(
    report: { copied: number; converted: number; kept: number; failed: string[] },
    total: number,
    maxSide: number,
  ): string {
    if (total === 0) {
      return 'Esa carpeta no tiene imagenes.';
    }
    const parts: string[] = [];
    if (report.converted > 0) {
      parts.push(report.converted + ' ajustadas a ' + maxSide + ' px y guardadas como PNG');
    }
    if (report.copied > 0) {
      parts.push(report.copied + ' copiadas tal cual (ya cumplian)');
    }
    if (report.kept > 0) {
      parts.push(report.kept + ' ya estaban y no se tocaron');
    }
    if (report.failed.length > 0) {
      const names = report.failed.slice(0, 3).join(', ') + (report.failed.length > 3 ? '…' : '');
      parts.push(report.failed.length + ' no se pudieron leer (' + names + ')');
    }
    return 'Importacion: ' + parts.join('; ') + '.';
  }

  /**
   * Arma las miniaturas del panel Recursos y guarda el tamano real de cada
   * textura, que es el que se usa al soltarla sobre una entidad.
   *
   * Tres cosas hacian que el panel se quedara en cuadros vacios con una
   * carpeta de capturas, y las tres cambiaron:
   *   - como "miniatura" se guardaba el data URL COMPLETO de cada imagen;
   *     ahora se guarda una version reducida de verdad;
   *   - el panel se actualizaba recien al terminar TODAS; ahora cada miniatura
   *     aparece apenas esta lista;
   *   - solo se procesaban las primeras 80.
   *
   * "run" corta una pasada vieja si arranca otra (por ejemplo, al terminar una
   * importacion mientras todavia cargaban las del proyecto): sin eso, las dos
   * escribirian el mismo signal intercaladas.
   */
  private async loadTextureThumbnails(): Promise<void> {
    const run = ++this.thumbnailRun;

    for (const name of this.textures().slice(0, TEXTURE_THUMBNAIL_LIMIT)) {
      try {
        const data = await this.project.readFileData('assets/textures/' + name);
        if (run !== this.thumbnailRun) {
          return;
        }
        if (data.kind !== 'image') {
          continue;
        }
        const image = await decodeImage(data.dataUrl);
        const thumb = fitTextureSize(image.naturalWidth, image.naturalHeight, THUMBNAIL_SIDE);
        const entry = {
          dataUrl: thumb.scaled
            ? renderPng(image, thumb, usesNearestNeighbor(image.naturalWidth, thumb))
            : data.dataUrl,
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
        if (run !== this.thumbnailRun) {
          return;
        }
        this.textureAssets.update((state) => ({ ...state, [name]: entry }));
      } catch {
        // Una imagen rota o bloqueada se queda sin miniatura y nada mas: el
        // panel tiene que listar igual el resto de la carpeta.
      }
    }

    // Se olvidan las de texturas que ya no estan en la carpeta.
    const present = new Set(this.textures());
    this.textureAssets.update((state) =>
      Object.fromEntries(Object.entries(state).filter(([name]) => present.has(name))),
    );
  }

  onTextureDragStart(event: DragEvent, name: string): void {
    event.dataTransfer?.setData('text/honeycomb-texture', name);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  /**
   * Suelta una textura en el viewport. Sobre una entidad le cambia el arte;
   * sobre una celda vacia crea una entidad nueva con esa textura, igual que
   * arrastrar una figura.
   *
   * El recorte se rehace con el tamano real de la imagen: conservar el anterior
   * (16x16 por defecto) mostraria apenas la esquina de un sprite mas grande.
   */
  private dropTexture(event: DragEvent, name: string): void {
    const asset = this.textureAssets()[name];
    const sourceRect =
      asset && asset.width > 0
        ? { x: 0, y: 0, width: asset.width, height: asset.height }
        : { ...FALLBACK_SOURCE_RECT };

    const targetId = this.entityAt(event);
    if (targetId) {
      this.levels.updateEntity(targetId, { texture: 'textures/' + name, sourceRect });
      this.selectEntity(targetId);
      this.dirty.set(true);
      this.note('"' + targetId + '" ahora usa ' + name + '.');
      return;
    }

    const coord = this.coordAt(event);
    const grid = this.grid();
    if (!new IsoProjection(grid.tileWidth, grid.tileHeight).isValidCoord(coord, grid.width, grid.height)) {
      return;
    }
    this.commitPlacement({
      id: this.nextEntityId('entidad'),
      type: 'prop',
      position: { col: coord.col, row: coord.row },
      // Prefijo "textures/": las rutas del nivel son relativas a assets/.
      texture: 'textures/' + name,
      sourceRect,
    });
  }

  /** Elegir una textura pasa sola a la herramienta de colocar: es lo que se va a hacer. */
  selectTexture(name: string): void {
    this.activeTexture.set(name);
    this.activeShape.set(null);
    this.activeCharacter.set(null);
    this.tool.set('place');
  }

  /** Idem con una primitiva del panel Figuras. */
  selectShape(id: ShapeId): void {
    this.activeShape.set(id);
    this.activeTexture.set(null);
    this.activeCharacter.set(null);
    this.tool.set('place');
  }

  /** Idem con un personaje del panel Personajes: un tipo base o uno configurado. */
  selectCharacter(presetId: string): void {
    const preset = this.allPresets().find((candidate) => candidate.id === presetId);
    if (!preset) {
      return;
    }
    this.activeCharacter.set(presetId);
    this.activeShape.set(null);
    this.activeTexture.set(null);
    this.tool.set('place');
    this.note(preset.name + ': clic en la grilla para colocarlo. ' + this.kindHint(preset.kind));
  }

  /** Nombre del personaje elegido, para el chip del viewport. */
  activeCharacterLabel(): string | null {
    const id = this.activeCharacter();
    return id ? this.allPresets().find((preset) => preset.id === id)?.name ?? id : null;
  }

  /**
   * Coloca un personaje en la celda indicada. Todos los valores salen del
   * personaje -- asset, recorte, cuadros, escala, colision, caracteristicas --
   * y se COPIAN a la entidad (ver entityFromPreset).
   *
   * El jugador es el unico caso especial, y no por capricho del editor: el
   * motor mueve con las flechas a la entidad con id "player_1" y a ninguna
   * otra, asi que el primer jugador que se coloque se queda con ese id.
   */
  private placeCharacter(coord: GridCoord, presetId: string): void {
    const preset = this.allPresets().find((candidate) => candidate.id === presetId);
    const grid = this.grid();
    if (!preset || !new IsoProjection(grid.tileWidth, grid.tileHeight).isValidCoord(coord, grid.width, grid.height)) {
      return;
    }

    const entity = entityFromPreset(preset, coord, new Set(this.entityIds()));
    const placed = this.commitPlacement(entity);

    // El aviso del jugador se da igual aunque la colocacion quede esperando:
    // habla del id, no de la celda, y es lo que hay que saber antes de decidir.
    if (preset.kind === 'player' && entity.id !== ENGINE_PLAYER_ID) {
      this.note(
        'Ya hay un "' + ENGINE_PLAYER_ID + '": el motor solo mueve a ese. "' +
          entity.id + '" queda como decorado hasta que le cambies el id.',
      );
    } else if (placed) {
      this.note(preset.name + ' "' + entity.id + '" colocado.');
    }
  }

  /**
   * Crea una entidad nueva en la celda indicada. Si "shape" viene, la entidad
   * es una primitiva de bloqueo; si no, se usa la textura activa.
   *
   * Las dos ramas producen una entidad IGUAL DE VALIDA para el motor: la figura
   * viaja en el "type" (texto libre, uso del editor) y la textura sigue siendo
   * obligatoria en las dos, porque el schema la exige. La diferencia es solo
   * como la dibuja el canvas del editor.
   */
  private placeEntity(coord: GridCoord, shape: ShapeId | null = this.activeShape()): void {
    const grid = this.grid();
    const iso = new IsoProjection(grid.tileWidth, grid.tileHeight);
    if (!iso.isValidCoord(coord, grid.width, grid.height)) {
      this.note('Esa celda queda fuera de la grilla.');
      return;
    }

    const texture = this.activeTexture();
    if (!shape && !texture) {
      this.note('Elige una textura en Recursos o una primitiva en Figuras antes de colocar.');
      return;
    }

    // Una primitiva NO es un caso especial del nivel: es una entidad como
    // cualquier otra, apuntando a un recorte del spritesheet de figuras. Por
    // eso el runtime la dibuja sin saber nada de "figuras", y por eso el JSON
    // que sale de aca no tiene ni un campo inventado.
    const def = shape ? shapeDef(shape) : undefined;

    const entity: LevelEntity = def
      ? this.shapeEntity(coord, def)
      : {
          id: this.nextEntityId('entidad'),
          type: 'prop',
          position: { col: coord.col, row: coord.row },
          // Prefijo "textures/": las rutas del nivel son relativas a assets/,
          // que es donde AssetResolver las busca del lado del motor.
          texture: 'textures/' + (texture ?? DEFAULT_STARTER_TEXTURE),
          sourceRect: { x: 0, y: 0, width: 16, height: 16 },
        };

    this.commitPlacement(entity);
  }

  private shapeEntity(coord: GridCoord, def: ShapeDef): LevelEntity {
    return {
      id: this.nextEntityId(def.id),
      type: def.id,
      position: { col: coord.col, row: coord.row },
      texture: SHAPE_TEXTURE,
      sourceRect: { ...def.sourceRect },
      // Sin esto el solido flota medio tile sobre su casilla: el motor
      // apoya el borde inferior del sprite en el punto de la celda, y un
      // solido tiene que apoyar ahi el centro del rombo de su base.
      groundOffset: def.groundOffset,
      // La colision de SU forma, no una generica. Antes las figuras salian
      // sin collider: se veian, pero el jugador las atravesaba.
      collider: shapeCollider(def, this.grid()),
    };
  }

  // --- Pintar figuras arrastrando --------------------------------------------
  //
  // Con "Pintar figuras arrastrando" (panel Figuras) o con Shift, mantener el
  // clic y pasar por las casillas deja la figura elegida en cada una. Las
  // casillas ocupadas se SALTAN sin preguntar: el dialogo de celda ocupada en
  // medio de un trazo lo cortaria en cada casilla.

  private startShapeStroke(event: PointerEvent, shape: ShapeId): void {
    const cell = this.coordAt(event);
    this.shapeStroke = { shape, start: cell, last: cell, placed: 0 };
    // Con captura el trazo sigue aunque el cursor pase sobre un panel.
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
    this.paintShapeAt(cell);
  }

  private continueShapeStroke(event: PointerEvent): void {
    const stroke = this.shapeStroke;
    const cell = this.coordAt(event);
    this.hovered.set(cell);
    if (!stroke || (cell.col === stroke.last.col && cell.row === stroke.last.row)) {
      return;
    }
    // Un movimiento rapido salta casillas entre dos eventos: se recorre la
    // linea entera desde la ultima para no dejar huecos en el trazo.
    const from = stroke.last;
    const steps = Math.max(Math.abs(cell.col - from.col), Math.abs(cell.row - from.row));
    for (let step = 1; step <= steps; step++) {
      this.paintShapeAt({
        col: Math.round(from.col + ((cell.col - from.col) * step) / steps),
        row: Math.round(from.row + ((cell.row - from.row) * step) / steps),
      });
    }
    stroke.last = cell;
  }

  private finishShapeStroke(event: PointerEvent): void {
    const stroke = this.shapeStroke;
    this.shapeStroke = null;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    if (!stroke) {
      return;
    }
    const stayed = stroke.last.col === stroke.start.col && stroke.last.row === stroke.start.row;
    if (stayed && stroke.placed === 0) {
      // Un clic suelto sobre una casilla ocupada (o fuera de la grilla) no es
      // un trazo: se resuelve como siempre, con el dialogo o el aviso.
      this.placeEntity(stroke.start, stroke.shape);
    } else if (stroke.placed > 1) {
      this.note(stroke.placed + ' figuras colocadas.');
    }
  }

  /** Coloca la figura del trazo si la casilla esta en la grilla y libre. */
  private paintShapeAt(cell: GridCoord): void {
    const def = this.shapeStroke ? shapeDef(this.shapeStroke.shape) : undefined;
    const grid = this.grid();
    if (!this.shapeStroke || !def || !new IsoProjection(grid.tileWidth, grid.tileHeight).isValidCoord(cell, grid.width, grid.height)) {
      return;
    }
    const entity = this.shapeEntity(cell, def);
    if (this.entities().some((other) => blocksOverlap(other, entity))) {
      return;
    }
    this.addPlaced(entity);
    this.shapeStroke.placed++;
  }

  // --- Celda ocupada --------------------------------------------------------
  //
  // Colocar algo donde ya hay otra cosa no se resuelve solo: antes se apilaba
  // sin avisar y las dos entidades quedaban en la misma casilla tapandose entre
  // si -- se veia una sola, y la de abajo aparecia unicamente en el outliner,
  // asi que lo normal era no enterarse hasta ejecutar el nivel. Ahora se
  // pregunta, y la respuesta esperable (reemplazar) es la que esta primera.

  /**
   * Agrega la entidad, salvo que su celda ya este ocupada: en ese caso no toca
   * nada todavia y deja la colocacion esperando respuesta.
   *
   * Devuelve true si quedo colocada en el acto.
   */
  private commitPlacement(entity: LevelEntity): boolean {
    // Por bloque y no por celda exacta: una figura de 3x3 ocupa nueve casillas,
    // y colocar algo en cualquiera de ellas es ponerlo encima.
    const occupants = this.entities().filter((other) => blocksOverlap(other, entity));
    if (occupants.length > 0) {
      this.pendingPlacement.set({ kind: 'place', entity, occupants });
      return false;
    }
    this.addPlaced(entity);
    return true;
  }

  private addPlaced(entity: LevelEntity): void {
    this.levels.addEntity(entity);
    // Queda seleccionada para poder ajustarla en el inspector sin buscarla.
    this.selectEntity(entity.id);
    this.dirty.set(true);
  }

  /** Saca lo que habia en esas celdas y deja lo nuevo, o lo que se movio. */
  replacePending(): void {
    const pending = this.pendingPlacement();
    if (!pending) {
      return;
    }
    this.pendingPlacement.set(null);
    this.levels.removeEntities(pending.occupants.map((entity) => entity.id));
    const replaced =
      pending.occupants.length === 1
        ? '"' + pending.occupants[0].id + '" reemplazada'
        : pending.occupants.length + ' entidades reemplazadas';

    if (pending.kind === 'place') {
      this.addPlaced(pending.entity);
      this.note(replaced + ' por "' + pending.entity.id + '".');
    } else {
      this.dirty.set(true);
      this.note(replaced + ' por lo que moviste.');
    }
  }

  /** Deja todo en las mismas celdas, una cosa encima de la otra. */
  stackPending(): void {
    const pending = this.pendingPlacement();
    if (!pending) {
      return;
    }
    this.pendingPlacement.set(null);
    if (pending.kind === 'place') {
      this.addPlaced(pending.entity);
      this.note('"' + pending.entity.id + '" queda encima de lo que ya habia en esa celda.');
    } else {
      this.dirty.set(true);
      this.note('Queda encima de lo que ya habia en esas celdas.');
    }
  }

  /** Descarta: una colocacion no se hace, y un movimiento vuelve a donde estaba. */
  cancelPending(): void {
    const pending = this.pendingPlacement();
    this.pendingPlacement.set(null);
    if (pending?.kind === 'move') {
      for (const [id, position] of pending.originals) {
        this.levels.updateEntity(id, { position });
      }
    }
  }

  /** Texto del dialogo de celdas ocupadas, segun de donde venga la espera. */
  pendingSummary(): string {
    const pending = this.pendingPlacement();
    if (!pending) {
      return '';
    }
    const there =
      pending.occupants.length === 1
        ? 'ya esta "' + pending.occupants[0].id + '"'
        : 'ya hay ' + pending.occupants.length + ' entidades';

    if (pending.kind === 'place') {
      const { col, row } = pending.entity.position;
      return (
        'En la celda ' + col + ',' + row + ' ' + there +
        '. Vas a colocar "' + pending.entity.id + '".'
      );
    }
    const what =
      pending.movedIds.length === 1
        ? '"' + pending.movedIds[0] + '"'
        : pending.movedIds.length + ' entidades';
    return 'Donde soltaste ' + what + ' ' + there + '. Cancelar lo devuelve a donde estaba.';
  }

  // --- Arrastrar una primitiva al viewport ----------------------------------
  //
  // Se usa el drag & drop nativo del navegador y no un arrastre a mano con
  // pointer events: el nativo ya trae el fantasma del elemento pegado al
  // cursor, el cursor de "copiar" y la cancelacion con Escape, que es
  // exactamente lo que se espera de este gesto.

  onShapeDragStart(event: DragEvent, id: ShapeId): void {
    event.dataTransfer?.setData('text/honeycomb-shape', id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  /** Idem para los personajes (el id de un tipo base o de uno configurado), con su propio tipo de dato. */
  onCharacterDragStart(event: DragEvent, id: string): void {
    event.dataTransfer?.setData('text/honeycomb-character', id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  /**
   * Sin preventDefault() el canvas NO es un destino valido y el drop nunca
   * llega. De paso se resalta la celda de destino, para poder apuntar.
   */
  onCanvasDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.hovered.set(this.coordAt(event));
  }

  onCanvasDrop(event: DragEvent): void {
    event.preventDefault();

    const textureName = event.dataTransfer?.getData('text/honeycomb-texture');
    if (textureName) {
      this.dropTexture(event, textureName);
      return;
    }

    const characterId = event.dataTransfer?.getData('text/honeycomb-character');
    if (characterId && this.allPresets().some((preset) => preset.id === characterId)) {
      this.placeCharacter(this.coordAt(event), characterId);
      return;
    }

    const id = event.dataTransfer?.getData('text/honeycomb-shape');
    // Puede caer aca cualquier cosa arrastrada desde fuera del editor.
    if (!id || !shapeDef(id)) {
      return;
    }
    this.placeEntity(this.coordAt(event), id as ShapeId);
  }

  onCanvasDragLeave(): void {
    this.hovered.set(null);
  }

  // --- Seleccion ------------------------------------------------------------
  //
  // La seleccion es una LISTA, no una sola entidad, con el mismo reparto que
  // hace Blender: todas las seleccionadas reciben las operaciones de grupo
  // (borrar, duplicar, mover, marcar como pared), pero solo la ultima -- el
  // "objeto activo" -- es la que muestra el inspector, porque un formulario no
  // puede mostrar dos valores distintos en el mismo campo.

  /**
   * Selecciona una entidad y trae al frente la pestana de propiedades del
   * objeto: seleccionar algo y que el inspector siga mostrando la escena seria
   * un click perdido.
   *
   * Con "additive" (Shift o Ctrl) la suma o la quita de la seleccion en vez de
   * reemplazarla.
   */
  selectEntity(id: string | null, additive = false): void {
    if (!id) {
      // Clickear el vacio con Shift no deberia tirar abajo lo que ya estaba
      // seleccionado: el gesto es "agregar", y ahi no hay nada que agregar.
      if (!additive) {
        this.levels.selectEntity(null);
      }
      return;
    }
    if (additive) {
      this.levels.toggleEntitySelection(id);
    } else {
      this.levels.selectEntity(id);
    }
    this.inspectorTab.set('objeto');
  }

  isEntitySelected(id: string): boolean {
    return this.selectedSet().has(id);
  }

  /**
   * Clic en una fila del outliner. Se comporta como cualquier lista de
   * escritorio: Ctrl suma o quita una, Shift selecciona el rango desde la
   * activa hasta la clickeada.
   */
  onOutlinerClick(id: string, event: MouseEvent): void {
    if (event.shiftKey) {
      this.selectRangeTo(id);
      return;
    }
    this.selectEntity(id, event.ctrlKey);
  }

  /** Selecciona de la entidad activa a la clickeada, en el orden del outliner. */
  private selectRangeTo(id: string): void {
    const ids = this.entityIds();
    const anchor = this.levels.selectedEntityId();
    const from = anchor ? ids.indexOf(anchor) : -1;
    const to = ids.indexOf(id);
    if (to < 0) {
      return;
    }
    // Sin ancla previa no hay rango que trazar: vale como un clic normal.
    if (from < 0) {
      this.selectEntity(id);
      return;
    }
    const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
    // La clickeada queda al final para que sea la activa, sin importar hacia
    // que lado se trazo el rango.
    this.levels.selectEntities([...range.filter((other) => other !== id), id]);
    this.inspectorTab.set('objeto');
  }

  selectAllEntities(): void {
    this.levels.selectEntities(this.entityIds());
    this.inspectorTab.set('objeto');
  }

  /** Borra TODA la seleccion, no solo la entidad activa. */
  deleteSelected(): void {
    const ids = this.selectedIds();
    if (ids.length === 0) {
      return;
    }
    this.levels.removeEntities(ids);
    this.dirty.set(true);
    this.note(
      ids.length === 1 ? 'Entidad "' + ids[0] + '" eliminada.' : ids.length + ' entidades eliminadas.',
    );
  }

  /**
   * Duplica toda la seleccion una celda a la derecha y deja seleccionadas las
   * copias, que es lo que uno quiere seguir moviendo.
   *
   * Los objetos anidados se copian a mano: el spread es superficial, y sin esto
   * la copia compartiria sourceRect y collider con el original (editar uno
   * moveria los dos).
   */
  duplicateSelected(): void {
    const sources = this.entities().filter((entity) => this.isEntitySelected(entity.id));
    if (sources.length === 0) {
      return;
    }

    const copies: string[] = [];
    for (const source of sources) {
      const copy: LevelEntity = {
        ...source,
        id: this.nextEntityId(source.type || 'entidad'),
        position: { col: source.position.col + 1, row: source.position.row },
        sourceRect: { ...source.sourceRect },
        collider: source.collider ? { ...source.collider } : undefined,
      };
      this.levels.addEntity(copy);
      copies.push(copy.id);
    }

    this.levels.selectEntities(copies);
    this.dirty.set(true);
    this.note(copies.length === 1 ? 'Copia creada.' : copies.length + ' copias creadas.');
  }

  /**
   * Mueve la seleccion entera por celdas (las flechas del teclado). Es la
   * unica forma de mover VARIAS a la vez: los campos de columna y fila del
   * inspector escriben un valor absoluto, y aplicarlo a todas las amontonaria
   * en la misma casilla.
   */
  nudgeSelection(deltaCol: number, deltaRow: number): void {
    const ids = this.selectedIds();
    if (ids.length === 0) {
      return;
    }
    const grid = this.grid();
    for (const entity of this.entities()) {
      if (!this.isEntitySelected(entity.id)) {
        continue;
      }
      this.levels.updateEntity(entity.id, {
        position: {
          col: Math.min(grid.width - 1, Math.max(0, entity.position.col + deltaCol)),
          row: Math.min(grid.height - 1, Math.max(0, entity.position.row + deltaRow)),
        },
      });
    }
    this.dirty.set(true);
  }

  /**
   * Aplica un cambio parcial a la entidad seleccionada. Es el paso obligado de
   * todo el inspector: un solo lugar que marca "dirty" y que reengancha la
   * seleccion si lo que cambio fue el propio id (si no, se perderia).
   */
  patchEntity(changes: Partial<LevelEntity>): void {
    const id = this.levels.selectedEntityId();
    if (!id) {
      return;
    }
    this.levels.updateEntity(id, changes);
    this.dirty.set(true);
    if (changes.id && changes.id !== id) {
      this.levels.selectEntity(changes.id);
    }
  }

  // Los patch* de abajo existen porque estos campos son objetos anidados: hay
  // que reconstruir el objeto entero, no se puede tocar una sola clave.

  patchPosition(axis: 'col' | 'row', value: number): void {
    const entity = this.selected();
    if (!entity) {
      return;
    }
    this.patchEntity({ position: { ...entity.position, [axis]: value } });
  }

  patchSourceRect(field: 'x' | 'y' | 'width' | 'height', value: number): void {
    const entity = this.selected();
    if (!entity) {
      return;
    }
    this.patchEntity({ sourceRect: { ...entity.sourceRect, [field]: value } });
  }

  /**
   * Activa o desactiva el collider. Al activarlo, una figura recupera la
   * colision de su forma -- es tambien la manera de arreglar una figura vieja
   * que quedo sin collider: apagar y prender la casilla -- y el resto arranca
   * del tamano del sprite. Al desactivarlo se pone en undefined para que la
   * clave no aparezca en el JSON (el schema la trata como ausente = la entidad
   * no colisiona).
   */
  toggleCollider(enabled: boolean): void {
    const entity = this.selected();
    if (!entity) {
      return;
    }
    const shape = shapeOf(entity);
    if (enabled && shape) {
      this.patchEntity({ collider: shapeCollider(shape, this.grid(), entitySpan(entity)) });
      return;
    }
    this.patchEntity({
      collider: enabled
        ? {
            width: entity.sourceRect.width,
            height: entity.sourceRect.height,
            // Se conserva si la entidad ya era pared: antes esta rama
            // reconstruia el objeto de cero y apagaba "solid" en silencio, asi
            // que apagar y volver a encender el collider convertia una pared
            // en algo atravesable sin que nada lo dijera.
            solid: entity.collider?.solid,
          }
        : undefined,
    });
  }

  patchCollider(field: 'width' | 'height', value: number): void {
    const entity = this.selected();
    if (!entity || !entity.collider) {
      return;
    }
    this.patchEntity({ collider: { ...entity.collider, [field]: value } });
  }

  patchGrid(changes: Partial<GridConfig>): void {
    this.levels.updateGrid(changes);
    this.dirty.set(true);
  }

  renameLevel(name: string): void {
    this.levels.level.update((level) => ({ ...level, name }));
    this.dirty.set(true);
  }

  /** Fondo del runtime. Sin "backgroundColor" el motor usa RAYWHITE, asi que se muestra ese. */
  backgroundColor(): RgbColor {
    return this.levels.level().backgroundColor ?? { r: 245, g: 245, b: 245 };
  }

  backgroundHex(): string {
    return rgbToHex(this.backgroundColor());
  }

  /**
   * Ultimo HSV elegido en el selector. El RGB no alcanza para reconstruirlo:
   * un gris no tiene tono y el negro tampoco saturacion, y sin guardarlo el
   * cursor saltaria a una esquina al arrastrar por ahi.
   */
  private readonly backgroundPick = signal<Hsv | null>(null);

  /**
   * El color como lo dibuja el selector. Si el RGB cambio por otro lado (los
   * campos, el hex, otro nivel), el HSV guardado ya no corresponde y se
   * recalcula, conservando solo su tono para los grises.
   */
  backgroundHsv(): Hsv {
    const rgb = this.backgroundColor();
    const kept = this.backgroundPick();
    if (kept && rgbToHex(hsvToRgb(kept)) === rgbToHex(rgb)) {
      return kept;
    }
    return rgbToHsv(rgb, kept?.h ?? 0);
  }

  /** Color puro del tono actual: el fondo del cuadro de saturacion/brillo. */
  backgroundHueCss(): string {
    return `hsl(${this.backgroundHsv().h}, 100%, 50%)`;
  }

  /** Cuadro grande: X es la saturacion y Y el brillo (arriba = claro). */
  onBackgroundSquare(event: PointerEvent): void {
    const point = this.pickerPoint(event);
    if (point) {
      this.pickBackground({ ...this.backgroundHsv(), s: point.x, v: 1 - point.y });
    }
  }

  /** Barra de tono: arriba 0°, abajo 360°. */
  onBackgroundHue(event: PointerEvent): void {
    const point = this.pickerPoint(event);
    if (point) {
      this.pickBackground({ ...this.backgroundHsv(), h: point.y * 360 });
    }
  }

  setBackgroundHex(text: string): void {
    const rgb = hexToRgb(text);
    if (rgb) {
      this.storeBackground(rgb);
    }
  }

  patchBackground(changes: Partial<RgbColor>): void {
    // El schema exige enteros de 0 a 255; el campo numerico deja escribir cualquier cosa.
    const merged = { ...this.backgroundColor(), ...changes };
    this.storeBackground({ r: clampChannel(merged.r), g: clampChannel(merged.g), b: clampChannel(merged.b) });
  }

  private pickBackground(hsv: Hsv): void {
    this.backgroundPick.set(hsv);
    this.storeBackground(hsvToRgb(hsv));
  }

  private storeBackground(backgroundColor: RgbColor): void {
    this.levels.level.update((level) => ({ ...level, backgroundColor }));
    this.dirty.set(true);
  }

  /**
   * Posicion del puntero dentro del control, de 0 a 1 por eje; null si se
   * mueve sin el boton apretado. Al apretar captura el puntero, asi el
   * arrastre sigue aunque el mouse se salga del cuadro.
   */
  private pickerPoint(event: PointerEvent): { x: number; y: number } | null {
    const target = event.currentTarget as HTMLElement;
    if (event.type === 'pointerdown') {
      target.setPointerCapture(event.pointerId);
      event.preventDefault();
    } else if ((event.buttons & 1) === 0) {
      return null;
    }
    const box = target.getBoundingClientRect();
    const unit = (value: number) => Math.min(1, Math.max(0, value));
    return {
      x: unit((event.clientX - box.left) / box.width),
      y: unit((event.clientY - box.top) / box.height),
    };
  }

  /**
   * Primer id libre de la forma "base_N". Los ids tienen que ser unicos porque
   * los eventos referencian entidades por id (params de tipo entity_ref), y un
   * duplicado haria que el motor resuelva siempre la misma de las dos.
   */
  private nextEntityId(base: string): string {
    const taken = new Set(this.entityIds());
    let index = 1;
    while (taken.has(base + '_' + index)) {
      index += 1;
    }
    return base + '_' + index;
  }

  // --- Eventos --------------------------------------------------------------
  //
  // Todo este bloque trabaja contra el CATALOGO, nunca contra una lista fija de
  // triggers y acciones. Un bloque nuevo en schema/event_catalog.json aparece
  // solo en la UI, con su formulario generado a partir de sus params. Es el
  // mismo trato que del lado de C++, donde EventSystem despacha por "type".
  //
  // Los eventos se identifican por su indice en el array del nivel; por eso
  // casi todos los metodos reciben "index" (y "actionIndex" para las acciones).

  /** Agrega un evento con el primer trigger del catalogo y sin acciones todavia. */
  addEvent(): void {
    const trigger = this.triggers()[0];
    if (!trigger) {
      this.note('Carga el catalogo de eventos antes de crear un evento.');
      return;
    }
    this.levels.addEvent({
      trigger: { type: trigger.type, params: this.defaultParams(trigger) },
      actions: [],
    });
    this.dirty.set(true);
  }

  removeEvent(index: number): void {
    this.levels.removeEvent(index);
    this.dirty.set(true);
  }

  /**
   * Cambia el trigger de un evento. Los params se reinician a los del bloque
   * nuevo: cada trigger declara los suyos, y conservar los del anterior
   * dejaria claves que el motor no espera.
   */
  changeTrigger(index: number, type: string): void {
    const entry = this.entryFor('triggers', type);
    this.levels.updateEvent(index, {
      trigger: { type, params: entry ? this.defaultParams(entry) : {} },
    });
    this.dirty.set(true);
  }

  updateTriggerParam(index: number, key: string, value: unknown): void {
    const event = this.events()[index];
    this.levels.updateEvent(index, {
      trigger: { ...event.trigger, params: { ...event.trigger.params, [key]: value } },
    });
    this.dirty.set(true);
  }

  addAction(index: number): void {
    const entry = this.actions()[0];
    if (!entry) {
      this.note('El catalogo no declara ninguna accion.');
      return;
    }
    const event = this.events()[index];
    this.levels.updateEvent(index, {
      actions: [...event.actions, { type: entry.type, params: this.defaultParams(entry) }],
    });
    this.dirty.set(true);
  }

  removeAction(index: number, actionIndex: number): void {
    const event = this.events()[index];
    this.levels.updateEvent(index, {
      actions: event.actions.filter((_, i) => i !== actionIndex),
    });
    this.dirty.set(true);
  }

  changeAction(index: number, actionIndex: number, type: string): void {
    const entry = this.entryFor('actions', type);
    const event = this.events()[index];
    this.levels.updateEvent(index, {
      actions: event.actions.map((action, i) =>
        i === actionIndex ? { type, params: entry ? this.defaultParams(entry) : {} } : action,
      ),
    });
    this.dirty.set(true);
  }

  updateActionParam(index: number, actionIndex: number, key: string, value: unknown): void {
    const event = this.events()[index];
    this.levels.updateEvent(index, {
      actions: event.actions.map((action, i) =>
        i === actionIndex ? { ...action, params: { ...action.params, [key]: value } } : action,
      ),
    });
    this.dirty.set(true);
  }

  /** Filas de parametros de un bloque del catalogo, para el formulario dinamico. */
  paramRows(kind: CatalogKind, type: string): ParamRow[] {
    const entry = this.entryFor(kind, type);
    if (!entry) {
      return [];
    }
    return Object.keys(entry.params).map((key) => ({ key, def: entry.params[key] }));
  }

  entryFor(kind: CatalogKind, type: string): CatalogEntry | undefined {
    const catalog = this.catalog.catalog();
    return catalog ? catalog[kind].find((entry) => entry.type === type) : undefined;
  }

  labelFor(kind: CatalogKind, type: string): string {
    const entry = this.entryFor(kind, type);
    return entry ? entry.label : type;
  }

  paramValue(step: EventStep, key: string): string {
    const value = step.params[key];
    return value === undefined || value === null ? '' : String(value);
  }

  /**
   * Valor inicial de cada parametro de un bloque, segun su tipo declarado.
   * Se rellenan todos aunque esten vacios para que el JSON guardado tenga
   * siempre la forma completa que el motor espera, y para que el formulario
   * dinamico tenga algo a que enlazarse desde el primer render.
   * entity_ref y string comparten default (''): un id vacio es "sin elegir".
   */
  private defaultParams(entry: CatalogEntry): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    for (const key of Object.keys(entry.params)) {
      const type = entry.params[key].type;
      params[key] = type === 'number' ? 0 : type === 'boolean' ? false : '';
    }
    return params;
  }

  // --- Canvas ---------------------------------------------------------------
  //
  // Tres transformaciones entre el mundo y la pantalla, y siempre en este orden:
  //
  //   celda (col,row)  --IsoProjection.gridToScreen-->  pixeles isometricos
  //                    --* zoom-->                      pixeles escalados
  //                    --+ origin()-->                  pixeles del canvas
  //
  // coordAt() y entityAt() hacen exactamente el camino inverso. Si se toca una
  // de las tres, hay que tocar las tres.

  /** Punto del canvas donde cae la celda (0,0): centro horizontal, margen arriba, mas el pan. */
  private origin(): { x: number; y: number } {
    const size = this.canvasSize();
    const pan = this.pan();
    // Mismo encuadre que main.cpp: centro horizontal y un margen superior.
    return { x: size.w / 2 + pan.x, y: VIEW_TOP_MARGIN + pan.y };
  }

  /** Celda de la grilla bajo el cursor. Puede quedar fuera de rango: quien llama valida. */
  private coordAt(event: MouseEvent): GridCoord {
    const ref = this.viewport();
    const grid = this.grid();
    if (!ref) {
      return { col: 0, row: 0 };
    }
    // clientX/Y son relativos a la ventana: hay que restar la posicion del
    // canvas y el origen, y dividir por el zoom, en ese orden.
    const rect = ref.nativeElement.getBoundingClientRect();
    const origin = this.origin();
    const zoom = this.zoom();
    const iso = new IsoProjection(grid.tileWidth, grid.tileHeight);
    return iso.screenToGrid({
      x: (event.clientX - rect.left - origin.x) / zoom,
      // El medio tile extra invierte el centrado del rombo: screenToGrid trata
      // el punto de la celda como su esquina de arriba, y las celdas se dibujan
      // centradas en el (ver diamond()). Sin esto, apuntar al medio de una
      // casilla devolveria la de atras.
      y: (event.clientY - rect.top - origin.y) / zoom + grid.tileHeight / 2,
    });
  }

  /**
   * Hit-test sobre el rectangulo real del sprite, no sobre la celda: un sprite
   * alto sobresale de su rombo, y hay que poder clickear la parte que se ve.
   * Devuelve el id de la entidad clickeada, o null si no hay ninguna.
   */
  private entityAt(event: MouseEvent): string | null {
    const ref = this.viewport();
    if (!ref) {
      return null;
    }
    const rect = ref.nativeElement.getBoundingClientRect();
    const origin = this.origin();
    const zoom = this.zoom();
    const grid = this.grid();
    const iso = new IsoProjection(grid.tileWidth, grid.tileHeight);
    const x = (event.clientX - rect.left - origin.x) / zoom;
    const y = (event.clientY - rect.top - origin.y) / zoom;

    // De adelante hacia atras (orden inverso al de draw()), para que en un
    // solapamiento gane el sprite que se ve encima: es el que el usuario
    // creyo estar clickeando.
    const ordered = [...this.entities()].sort(
      (a, b) => iso.gridToScreen(blockCenter(b)).y - iso.gridToScreen(blockCenter(a)).y,
    );
    for (const entity of ordered) {
      // La misma caja que usa draw(), a zoom 1 (x e y ya vienen sin zoom). Si
      // el hit-test calculara la suya por separado, clickear una entidad
      // seleccionaria otra cosa en cuanto una de las dos formulas cambiara.
      const box = this.spriteBox(entity, iso.gridToScreen(blockCenter(entity)), 1);

      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
        return entity.id;
      }
    }
    return null;
  }

  /**
   * Donde cae el sprite de una entidad en pantalla. Es la traduccion EXACTA de
   * lo que hace engine/main.cpp al encolar una entidad:
   *
   *     drawPosition = { ancla.x - ancho/2,  ancla.y - alto + groundOffset }
   *
   * Vive en un solo metodo, y no repetida en el dibujo y en el hit-test, para
   * que no puedan divergir entre si -- ni de la formula del motor, que es la
   * unica que manda: si el editor la calcula distinto, el nivel se ve de una
   * forma al disenarlo y de otra al jugarlo.
   *
   * "anchor" ya viene en pixeles de canvas (proyectado y con zoom aplicado);
   * el tamano y el offset se escalan aca.
   */
  private spriteBox(
    entity: LevelEntity,
    anchor: { x: number; y: number },
    zoom: number,
  ): { x: number; y: number; w: number; h: number } {
    // Con span, el motor agranda el sprite y su groundOffset span veces, y
    // "anchor" ya tiene que ser el centro del bloque (ver blockCenter).
    // Y lo mismo con la escala del personaje, igual que main.cpp.
    const scale = entitySpan(entity) * (entity.scale ?? 1) * zoom;
    const w = entity.sourceRect.width * scale;
    const h = entity.sourceRect.height * scale;
    return {
      x: anchor.x - w / 2,
      y: anchor.y - h + (entity.groundOffset ?? 0) * scale,
      w,
      h,
    };
  }

  /**
   * Redibuja el viewport entero. Lo dispara el effect() del constructor cada
   * vez que cambia algo que se ve; no hay bucle de animacion.
   *
   * Orden de dibujado (de atras hacia adelante):
   *   fondo -> grilla -> ejes -> tiles -> celda bajo el cursor
   *         -> entidades por profundidad -> gizmo y textos de overlay
   *
   * El aspecto sigue al viewport 3D de Blender a proposito: gris neutro sin
   * tinte, lineas de grilla apenas mas claras que el fondo, y los dos ejes del
   * mundo en rojo y verde. Ese codigo de color es el mismo que usa Blender
   * (X rojo, Y verde) y aca sirve igual: dice de un vistazo hacia donde crecen
   * la columna y la fila, que en isometrico no es obvio.
   *
   * Las entidades se dibujan como rectangulos de color y no con su textura
   * real: el editor no carga las imagenes del proyecto todavia. El color por
   * tipo alcanza para componer la escena, y el ancla marca donde va a apoyarse
   * de verdad en el runtime.
   */
  private draw(): void {
    const ref = this.viewport();
    const size = this.canvasSize();
    // Antes del primer ResizeObserver el canvas mide 0: no hay nada que dibujar.
    if (!ref || size.w === 0 || size.h === 0) {
      return;
    }

    const canvas = ref.nativeElement;
    // Asignar width/height (aunque no cambien) resetea el canvas: es la forma
    // mas barata de limpiarlo, y ademas sincroniza el buffer con el tamano CSS.
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    // Sin interpolacion: es la mitad de lo que hace ver pixel art como pixel art.
    ctx.imageSmoothingEnabled = false;

    const level = this.levels.level();
    const grid = level.grid;
    const zoom = this.zoom();
    const origin = this.origin();
    const iso = new IsoProjection(grid.tileWidth, grid.tileHeight);
    const selectedId = this.levels.selectedEntityId();
    const hovered = this.hovered();

    // Fondo del viewport: el gris de Blender en modo solido, sin nada de azul.
    ctx.fillStyle = '#393939';
    ctx.fillRect(0, 0, size.w, size.h);

    const halfW = (grid.tileWidth / 2) * zoom;
    const halfH = (grid.tileHeight / 2) * zoom;
    const fullH = grid.tileHeight * zoom;

    /** Pasa una celda a pixeles del canvas (su punto de apoyo, el del motor). */
    const project = (coord: GridCoord) => {
      const point = iso.gridToScreen(coord);
      return { x: origin.x + point.x * zoom, y: origin.y + point.y * zoom };
    };

    /**
     * Una ESQUINA de la grilla, para el contorno y las lineas de division.
     *
     * Como las celdas van centradas en su punto (ver diamond()), sus esquinas
     * caen en col-0.5 / row-0.5, y proyectar eso da exactamente el mismo punto
     * medio tile mas arriba. De ahi el "- halfH".
     */
    const gridPoint = (coord: GridCoord) => {
      const point = project(coord);
      return { x: point.x, y: point.y - halfH };
    };

    // Traza el rombo de una celda (sin pintarlo): quien llama decide si lo
    // rellena, lo bordea o las dos cosas. Los cuatro puntos van desde la punta
    // superior, en sentido horario.
    // El rombo va CENTRADO en el punto de la celda, no colgando de el. Es lo
    // que hace el motor con el tile de piso (lo centra: ver el Submit del piso
    // en main.cpp), y es lo que hace que una figura -- que apoya el centro de
    // su base en ese punto -- se vea parada sobre su casilla y no medio tile
    // por encima. Antes el editor lo dibujaba medio tile mas abajo que el
    // juego.
    const diamond = (coord: GridCoord) => {
      const { x, y } = project(coord);
      ctx.beginPath();
      ctx.moveTo(x, y - halfH);
      ctx.lineTo(x + halfW, y);
      ctx.lineTo(x, y + halfH);
      ctx.lineTo(x - halfW, y);
      ctx.closePath();
    };

    // Lineas de division. Se dibujan como dos familias de rectas completas y no
    // rombo a rombo -- una linea por borde en vez de una por celda, sin trazos
    // repetidos que se ven mas gruesos al superponerse.
    const gridLines = (color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let col = 0; col <= grid.width; col += 1) {
        const from = gridPoint({ col, row: 0 });
        const to = gridPoint({ col, row: grid.height });
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
      }
      for (let row = 0; row <= grid.height; row += 1) {
        const from = gridPoint({ col: 0, row });
        const to = gridPoint({ col: grid.width, row });
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
      }
      ctx.stroke();
    };

    if (this.showGrid()) {
      // El suelo de la grilla es una sola forma plana, no un damero: Blender no
      // alterna el color de sus cuadros, y el damero competia con el arte.
      ctx.beginPath();
      const corners: GridCoord[] = [
        { col: 0, row: 0 },
        { col: grid.width, row: 0 },
        { col: grid.width, row: grid.height },
        { col: 0, row: grid.height },
      ];
      corners.forEach((corner, index) => {
        const { x, y } = gridPoint(corner);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      // Con un mapa de celdas ("tiles"), lo que no es piso es VACIO: el motor
      // no deja pisarlo ni lo dibuja. Se pinta mas oscuro, y encima solo las
      // celdas de piso con el gris de siempre, para que la forma de las salas
      // y de los tuneles se lea de un vistazo.
      ctx.fillStyle = level.tiles ? '#262626' : '#333333';
      ctx.fill();
      if (level.tiles) {
        ctx.fillStyle = '#333333';
        for (const tile of level.tiles) {
          if (tile.floor !== false) {
            diamond(tile);
            ctx.fill();
          }
        }
      }

      // Debajo: un pelo mas claras que el suelo, como las de Blender. Encima se
      // dibujan despues de las entidades (ver el final de draw()).
      if (!this.gridOnTop()) {
        gridLines('#4a4a4a');
      }

      // Los dos ejes que salen de la celda (0,0), con el color de Blender:
      // rojo el que hace crecer la columna, verde el que hace crecer la fila.
      // Van despues de la grilla para quedar por encima de ella.
      const zero = gridPoint({ col: 0, row: 0 });
      ctx.lineWidth = 1.5;

      ctx.strokeStyle = 'rgba(197, 79, 79, 0.85)';
      ctx.beginPath();
      ctx.moveTo(zero.x, zero.y);
      const colEnd = gridPoint({ col: grid.width, row: 0 });
      ctx.lineTo(colEnd.x, colEnd.y);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(112, 158, 60, 0.85)';
      ctx.beginPath();
      ctx.moveTo(zero.x, zero.y);
      const rowEnd = gridPoint({ col: 0, row: grid.height });
      ctx.lineTo(rowEnd.x, rowEnd.y);
      ctx.stroke();
    }

    // Paredes: la celda entera rellena. Antes era una franja chica en el medio,
    // que servia para ver una pared suelta pero no para leer el contorno de una
    // sala o de un tunel, que es lo que importa al armar un mapa.
    if (level.tiles) {
      ctx.lineWidth = 1;
      for (const tile of level.tiles) {
        if (tile.wall) {
          diamond(tile);
          ctx.fillStyle = 'rgba(176, 106, 70, 0.55)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
          ctx.stroke();
        }
      }
    }

    // Contorno y nombre de cada grilla del mapa, en punteado azul: son una
    // ayuda del editor, no algo que se vea en el juego. El nombre va en la
    // esquina de arriba porque es el que se usa al conectar tuneles.
    for (const room of level.rooms ?? []) {
      const corners = [
        gridPoint({ col: room.col, row: room.row }),
        gridPoint({ col: room.col + room.width, row: room.row }),
        gridPoint({ col: room.col + room.width, row: room.row + room.height }),
        gridPoint({ col: room.col, row: room.row + room.height }),
      ];
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (const corner of corners.slice(1)) {
        ctx.lineTo(corner.x, corner.y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(92, 138, 208, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '600 11px Inter, "Segoe UI", sans-serif';
      ctx.fillStyle = '#a9c4ec';
      ctx.textAlign = 'center';
      ctx.fillText(room.id, corners[0].x, corners[0].y + 18);
      ctx.textAlign = 'left';
    }

    // --- Vistas previas de las herramientas de mapa ------------------------
    // En verde y punteado: todavia no son parte del nivel. Muestran donde va a
    // quedar una grilla antes de confirmarla, y por donde va un tunel mientras
    // se lo traza.
    const ghostRect = (col: number, row: number, width: number, height: number) => {
      const corners = [
        gridPoint({ col, row }),
        gridPoint({ col: col + width, row }),
        gridPoint({ col: col + width, row: row + height }),
        gridPoint({ col, row: row + height }),
      ];
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (const corner of corners.slice(1)) {
        ctx.lineTo(corner.x, corner.y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(127, 201, 127, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(127, 201, 127, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const roomDraft = this.roomDraft();
    if (roomDraft) {
      ghostRect(roomDraft.col, roomDraft.row, roomDraft.width, roomDraft.height);
    }

    const roomDrag = this.roomDrag();
    if (roomDrag?.kind === 'create') {
      const area = rectBetween(roomDrag.start, roomDrag.end);
      ghostRect(area.col, area.row, area.width, area.height);
    } else if (roomDrag?.kind === 'move') {
      const moving = level.rooms?.find((room) => room.id === roomDrag.id);
      if (moving) {
        ghostRect(
          roomDrag.origin.col + roomDrag.delta.col,
          roomDrag.origin.row + roomDrag.delta.row,
          moving.width,
          moving.height,
        );
      }
    }

    const trace = this.tunnelTrace();
    const traceStart = trace ? level.rooms?.find((room) => room.id === trace.from) : undefined;
    if (trace && traceStart) {
      // Con codos en L, como lo va a armar el mapa, y siguiendo al cursor hasta
      // la celda que se esta apuntando.
      const points = [roomCenter(traceStart), ...trace.points, ...(hovered ? [hovered] : [])];
      const first = project(points[0]);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let index = 1; index < points.length; index += 1) {
        const bend = project({ col: points[index].col, row: points[index - 1].row });
        const next = project(points[index]);
        ctx.lineTo(bend.x, bend.y);
        ctx.lineTo(next.x, next.y);
      }
      ctx.strokeStyle = 'rgba(127, 201, 127, 0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#7fc97f';
      for (const point of trace.points) {
        const { x, y } = project(point);
        ctx.fillRect(x - 3, y - 3, 6, 6);
      }
    }

    // Celda bajo el cursor. Se valida el rango: fuera de la grilla no se
    // resalta nada, que es la pista visual de que ahi no se puede colocar.
    if (hovered && iso.isValidCoord(hovered, grid.width, grid.height)) {
      diamond(hovered);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Mismo criterio de profundidad que ZSortSystem::Flush(): menor Y primero.
    const ordered = [...level.entities].sort(
      // Por el centro del bloque, que es el sortPosition del motor.
      (a, b) => iso.gridToScreen(blockCenter(a)).y - iso.gridToScreen(blockCenter(b)).y,
    );

    const selectedIds = this.selectedSet();

    for (const entity of ordered) {
      const { x, y } = project(blockCenter(entity));
      // Dos estados distintos, como en Blender: "seleccionada" (contorno mas
      // apagado) y "activa" (la ultima que se toco, en naranja pleno). Con una
      // seleccion de varias, sin esa diferencia no se sabria cual es la que
      // esta mostrando el inspector.
      const isSelected = selectedIds.has(entity.id);
      const isActive = entity.id === selectedId;

      // Una primitiva de bloqueo se dibuja como solido isometrico; el resto,
      // Caja del sprite en pantalla, con la MISMA regla que main.cpp:
      // centrado en X sobre el punto de la celda, borde inferior en ese punto,
      // y groundOffset bajandolo. Antes el editor lo dibujaba con la esquina
      // superior izquierda en el punto, que no es lo que hace el motor: una
      // entidad se veia en un lugar en el editor y en otro en el juego.
      const box = this.spriteBox(entity, { x, y }, zoom);

      // Si es una primitiva del sheet se dibuja el sprite REAL; asi el editor
      // muestra exactamente los pixeles que va a mostrar el juego. Lo demas
      // sigue siendo un rectangulo de color, porque el editor todavia no carga
      // las texturas del proyecto desde el disco.
      const sheet = this.shapeSheet();
      const def = shapeOf(entity);

      if (def && sheet) {
        const src = def.sourceRect;
        ctx.drawImage(sheet, src.x, src.y, src.width, src.height, box.x, box.y, box.w, box.h);
      } else {
        ctx.fillStyle = this.entityColor(entity.type);
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
      }

      // Collider: se ve que es una caja logica y no arte. Va en el punto de la
      // celda y no en la caja del sprite, porque es ahi donde lo encola el
      // motor (ver el Submit a CollisionSystem en main.cpp).
      //
      // Una PARED (solid) va en linea llena y roja; un sensor, punteado y
      // verde. Son dos comportamientos opuestos -- uno frena al jugador y el
      // otro no -- y sin distinguirlos hay que abrir el inspector de cada
      // entidad para saber cual es cual.
      if (this.showColliders() && entity.collider) {
        const solid = entity.collider.solid === true;
        ctx.strokeStyle = solid ? '#c05050' : '#6b9e3f';
        ctx.lineWidth = solid ? 1.5 : 1;

        if (solid) {
          // Lo que BLOQUEA es una caja en celdas: main.cpp divide el collider
          // por el tamano del tile y compara contra la casilla. En pantalla esa
          // caja es un rombo sobre el piso, y es el que se dibuja. Antes era un
          // rectangulo colgando del punto de la celda, que no coincidia con lo
          // que frena al jugador: un cubo y un pilar se veian con la misma
          // colision aunque bloquean superficies muy distintas.
          const halfCols = entity.collider.width / grid.tileWidth / 2;
          const halfRows = entity.collider.height / grid.tileHeight / 2;
          const { col, row } = blockCenter(entity);
          const corners = [
            project({ col: col - halfCols, row: row - halfRows }),
            project({ col: col + halfCols, row: row - halfRows }),
            project({ col: col + halfCols, row: row + halfRows }),
            project({ col: col - halfCols, row: row + halfRows }),
          ];
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          for (const corner of corners.slice(1)) {
            ctx.lineTo(corner.x, corner.y);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(192, 80, 80, 0.18)';
          ctx.fill();
          ctx.stroke();
        } else {
          // Un sensor no bloquea: solo dispara on_collision, y el motor lo
          // detecta con OTRA caja, en pixeles y colgando del punto de la celda
          // (el Submit a CollisionSystem en main.cpp). Esa es la que se dibuja.
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(x, y, entity.collider.width * zoom, entity.collider.height * zoom);
          ctx.setLineDash([]);
        }
      }

      // Contorno naranja, igual que el de Blender: un halo oscuro por fuera
      // para que se lea sobre cualquier color de relleno, y el naranja pegado
      // al sprite. El objeto activo lo lleva pleno; el resto de la seleccion,
      // en un tono mas apagado.
      if (isSelected) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.strokeRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = isActive ? '#ff8b1f' : '#b06a26';
        ctx.strokeRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
      }

      // Ancla real del runtime: la punta superior del rombo (origin {0,0}).
      ctx.fillStyle = isActive ? '#ff8b1f' : 'rgba(255, 255, 255, 0.55)';
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);

      // El id solo desde 2x: mas chico, las etiquetas se pisan entre si y
      // ensucian mas de lo que ayudan.
      if (zoom >= 2) {
        ctx.font = '10px Inter, "Segoe UI", sans-serif';
        ctx.fillStyle = isSelected ? '#ffd0a0' : 'rgba(230, 230, 230, 0.6)';
        ctx.fillText(entity.id, box.x, box.y - 6);
      }
    }

    // Encima: despues de las entidades y en el mismo rosa que la grilla de F1
    // del runtime (main.cpp), que tambien va encima de todo.
    if (this.showGrid() && this.gridOnTop()) {
      gridLines('rgba(255, 105, 180, 0.86)');
    }

    this.drawAxisGizmo(ctx, size, iso, grid);
  }

  /**
   * Gizmo de navegacion de la esquina superior derecha, el mismo que Blender
   * pone en su viewport 3D: dos brazos con una bolita en la punta, en la
   * direccion REAL de cada eje segun la proyeccion isometrica del nivel.
   *
   * No es decoracion: como la proyeccion depende de tileWidth/tileHeight, la
   * inclinacion de los ejes cambia con la grilla, y el gizmo lo muestra.
   */
  private drawAxisGizmo(
    ctx: CanvasRenderingContext2D,
    size: { w: number; h: number },
    iso: IsoProjection,
    grid: GridConfig,
  ): void {
    const radius = 30;
    const cx = size.w - radius - 18;
    const cy = radius + 18;

    // Direccion unitaria de cada eje en pantalla: se proyecta un paso de una
    // celda y se normaliza, asi el gizmo tiene siempre el mismo tamano aunque
    // el tile mida 64x32 o 32x32.
    const unit = (coord: GridCoord) => {
      const point = iso.gridToScreen(coord);
      const length = Math.hypot(point.x, point.y) || 1;
      return { x: point.x / length, y: point.y / length };
    };
    const colDir = unit({ col: 1, row: 0 });
    const rowDir = unit({ col: 0, row: 1 });

    const arm = (dir: { x: number; y: number }, color: string, label: string) => {
      const tipX = cx + dir.x * radius;
      const tipY = cy + dir.y * radius;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#101010';
      ctx.font = '600 9px Inter, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, tipX, tipY + 0.5);
      // Se restauran los defaults: el resto de draw() dibuja texto alineado a
      // la izquierda y da por hecho ese estado.
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    };

    arm(colDir, '#c54f4f', 'C');
    arm(rowDir, '#709e3c', 'F');

    // Medidas del nivel bajo el gizmo, como el texto de estadisticas del
    // viewport de Blender.
    ctx.font = '10px Inter, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(230, 230, 230, 0.45)';
    ctx.textAlign = 'right';
    ctx.fillText(
      grid.width + ' x ' + grid.height + '  ·  ' + grid.tileWidth + 'x' + grid.tileHeight + ' px',
      size.w - 18,
      cy + radius + 22,
    );
    ctx.textAlign = 'left';
  }

  /**
   * Color de relleno por tipo de entidad. Los arquetipos de la paleta traen el
   * suyo, asi que el color del viewport y el del icono del panel Personajes no
   * pueden separarse. Los tipos son texto libre en el schema: lo que no
   * reconoce nadie cae al azul por defecto, sin romper nada.
   */
  private entityColor(type: string): string {
    const character = characterOf({ type });
    if (character) {
      return character.color;
    }
    return type === 'obstacle' ? '#c05050' : '#4772b3';
  }

  // --- Utilidades de plantilla ---------------------------------------------
  //
  // Las plantillas de Angular no pueden hacer casts, asi que sacar el valor de
  // un evento de input necesita un helper por tipo. Nombres cortos porque
  // aparecen en cada binding del HTML.

  str(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  int(event: Event): number {
    // Todo en enteros: un sprite en x=10.5 sale borroso o con tearing.
    return Math.round(Number((event.target as HTMLInputElement).value)) || 0;
  }

  /** Con decimales: escala, segundos por cuadro, velocidad. */
  num(event: Event): number {
    return Number((event.target as HTMLInputElement).value) || 0;
  }

  checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  /**
   * Deja un mensaje en la barra de estado y en la consola del panel inferior.
   * El log se corta en 40 lineas: es para ver que acaba de pasar, no un
   * historial, y sin tope crece sin limite durante una sesion larga.
   */
  private note(message: string): void {
    this.status.set(message);
    this.log.update((entries) => [...entries.slice(-40), message]);
  }

  /** Texto legible de cualquier cosa que llegue por un catch (no siempre es un Error). */
  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
