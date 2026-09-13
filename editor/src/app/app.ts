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

import {
  CHARACTERS,
  CharacterId,
  ENGINE_PLAYER_ID,
  characterDef,
  characterOf,
} from './core/characters';
import { GridCoord, IsoProjection } from './core/iso-projection';
import {
  decodeImage,
  fitTextureSize,
  renderPng,
  renderPngBase64,
  usesNearestNeighbor,
} from './core/texture-fit';
import type { ImportSession, ProjectFileData, ProjectNode } from './electron-api';
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
import { EventStep, GridConfig, GridPosition, LevelEntity } from './models/level.model';
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
type Tool = 'select' | 'place' | 'floor' | 'wall';
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

/**
 * Que hace cada herramienta, para decirlo en la barra de estado al elegirla.
 * Varias no cambian nada en pantalla hasta el primer click en la grilla, y sin
 * este mensaje el boton se siente muerto aunque haya respondido.
 */
const TOOL_HINTS: Record<Tool, string> = {
  select: 'Seleccionar: clic sobre una entidad para activarla.',
  place: 'Colocar: elige una textura en Recursos o una figura, y clic en la grilla.',
  floor: 'Piso: clic en una celda para quitarle o devolverle el suelo.',
  wall: 'Pared: clic en una celda para levantar o quitar la pared.',
};

/** Una fila del formulario dinamico de parametros (ver paramRows()). */
interface ParamRow {
  key: string;
  def: CatalogParamDef;
}

@Component({
  selector: 'app-root',
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
  /**
   * Arquetipo de personaje elegido en el panel Personajes. Excluyente con los
   * otros dos por el mismo motivo: la herramienta "place" tiene que saber sin
   * ambiguedad que esta a punto de colocar.
   */
  readonly activeCharacter = signal<CharacterId | null>(null);
  readonly zoom = signal(3);
  readonly showGrid = signal(true);
  readonly showColliders = signal(true);
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
    if (activeTool === 'place') {
      const character = this.activeCharacter();
      if (character) {
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

  /** Idem con un arquetipo del panel Personajes. */
  selectCharacter(id: CharacterId): void {
    this.activeCharacter.set(id);
    this.activeShape.set(null);
    this.activeTexture.set(null);
    this.tool.set('place');
    const def = characterDef(id);
    if (def) {
      this.note(def.hint);
    }
  }

  /** Nombre del arquetipo elegido, para el chip del viewport. */
  activeCharacterLabel(): string | null {
    const id = this.activeCharacter();
    return id ? characterDef(id)?.label ?? id : null;
  }

  /**
   * Crea un personaje en la celda indicada, con todos los campos que el
   * runtime espera ya puestos (ver core/characters.ts).
   *
   * El jugador es el unico caso especial, y no por capricho del editor: el
   * motor mueve con las flechas a la entidad con id "player_1" y a ninguna
   * otra, asi que el primer jugador que se coloque tiene que quedarse con ese
   * id o no va a responder a las teclas.
   */
  private placeCharacter(coord: GridCoord, id: CharacterId): void {
    const def = characterDef(id);
    const grid = this.grid();
    if (!def || !new IsoProjection(grid.tileWidth, grid.tileHeight).isValidCoord(coord, grid.width, grid.height)) {
      return;
    }

    const taken = new Set(this.entityIds());
    const isFirstPlayer = def.id === 'player' && !taken.has(ENGINE_PLAYER_ID);

    const entity: LevelEntity = {
      id: isFirstPlayer ? ENGINE_PLAYER_ID : this.nextEntityId(def.idBase),
      type: def.type,
      position: { col: coord.col, row: coord.row },
      texture: def.texture,
      sourceRect: { ...def.sourceRect },
      collider: { ...def.collider },
      animation: def.animation,
    };

    const placed = this.commitPlacement(entity);

    // El aviso del jugador se da igual aunque la colocacion quede esperando:
    // habla del id, no de la celda, y es lo que hay que saber antes de decidir.
    if (def.id === 'player' && !isFirstPlayer) {
      this.note(
        'Ya hay un "' + ENGINE_PLAYER_ID + '": el motor solo mueve a ese. "' +
          entity.id + '" queda como decorado hasta que le cambies el id.',
      );
    } else if (placed) {
      this.note(def.label + ' "' + entity.id + '" colocado. ' + def.hint);
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
      ? {
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
          collider: shapeCollider(def, grid),
        }
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

  /** Idem para los personajes, con su propio tipo de dato para no confundirlos. */
  onCharacterDragStart(event: DragEvent, id: CharacterId): void {
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
    if (characterId && characterDef(characterId)) {
      this.placeCharacter(this.coordAt(event), characterId as CharacterId);
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
    const scale = entitySpan(entity) * zoom;
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
      ctx.fillStyle = '#333333';
      ctx.fill();

      // Lineas de division: un pelo mas claras que el suelo, como las de
      // Blender. Se dibujan como dos familias de rectas completas y no rombo a
      // rombo -- una linea por borde en vez de una por celda, sin trazos
      // repetidos que se ven mas gruesos al superponerse.
      ctx.strokeStyle = '#4a4a4a';
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

    // Las celdas fuera de la forma del mapa quedan oscuras; las paredes se
    // marcan con una franja para que su edicion sea visible aunque no haya arte.
    if (level.tiles) {
      for (const tile of level.tiles) {
        if (tile.floor === false) {
          diamond(tile);
          ctx.fillStyle = '#2a2a2a';
          ctx.fill();
        }
        if (tile.wall) {
          const { x, y } = project(tile);
          ctx.fillStyle = 'rgba(216, 122, 74, 0.35)';
          ctx.fillRect(x - 3 * zoom, y - 10 * zoom, 6 * zoom, 10 * zoom);
        }
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
