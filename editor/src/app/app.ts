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

import { GridCoord, IsoProjection } from './core/iso-projection';
import {
  SHAPES,
  SHAPE_SHEET_DATA_URL,
  SHAPE_SHEET_HEIGHT,
  SHAPE_SHEET_WIDTH,
  SHAPE_TEXTURE,
  ShapeDef,
  ShapeId,
  shapeDef,
  shapeOf,
} from './core/iso-shapes';
import { CatalogEntry, CatalogParamDef } from './models/event-catalog.model';
import { EventStep, GridConfig, LevelEntity } from './models/level.model';
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
type Workspace = 'layout' | 'eventos' | 'salida';

/**
 * Pestana del editor de propiedades (la columna de iconos a su izquierda, como
 * en Blender). "objeto" muestra la entidad seleccionada; "escena", el nivel y
 * su grilla. Antes las propiedades del nivel solo se veian deseleccionando
 * todo, que es justo lo que esta separacion evita.
 */
type InspectorTab = 'objeto' | 'escena';

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

/** Margen superior del encuadre por defecto, en pixeles de canvas. */
const VIEW_TOP_MARGIN = 60;
/** Proporcion del viewport que ocupa la grilla al encuadrarla con Inicio. */
const FRAME_FILL = 0.82;

// Umbral de la matriz de riesgos ("Degradacion de Rendimiento por Usuario"):
// el editor avisa antes de que la escena comprometa los FPS del runtime.
const ENTITY_WARN_THRESHOLD = 150;
/** Textura de respaldo si el proyecto abierto todavia no tiene ninguna. */
const DEFAULT_STARTER_TEXTURE = 'player.png';

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
  readonly status = signal('Listo. Abre una carpeta de proyecto, o crea un nivel y usa Guardar como.');
  /** Ultima ruta usada al guardar por dialogo; se propone en el siguiente. */
  readonly lastSavedPath = signal<string | null>(null);
  /** Hay cambios sin guardar. Lo enciende cualquier edicion; solo save() lo apaga. */
  readonly dirty = signal(false);

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

  /**
   * Paneles del inspector plegados, por id. Se guarda el conjunto de PLEGADOS y
   * no el de abiertos para que un panel nuevo aparezca desplegado sin tener que
   * inicializarlo en ningun lado.
   */
  private readonly collapsedPanels = signal<Record<string, boolean>>({});

  readonly zoomSteps = ZOOM_STEPS;
  readonly shapes = SHAPES;
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

  // --- Vistas derivadas del nivel abierto -----------------------------------
  // computed() y no getters: asi Angular sabe exactamente de que dependen y
  // solo recalcula (y redibuja el canvas) cuando eso cambia de verdad.
  readonly entities = computed(() => this.levels.level().entities);
  readonly events = computed(() => this.levels.level().events);
  readonly grid = computed(() => this.levels.level().grid);
  readonly selected = this.levels.selectedEntity;
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

  // --- Interfaz: workspaces y paneles plegables -----------------------------

  /** Un panel del inspector esta plegado solo si figura en el mapa como true. */
  isCollapsed(id: string): boolean {
    return this.collapsedPanels()[id] === true;
  }

  togglePanel(id: string): void {
    this.collapsedPanels.update((state) => ({ ...state, [id]: !state[id] }));
  }

  // --- Viewport -------------------------------------------------------------

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

    if (event.ctrlKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      // Ctrl+Shift+S fuerza el dialogo aunque ya se sepa donde va el archivo.
      void (event.shiftKey ? this.saveAs() : this.save());
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      this.frameAll();
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
    // Tres formas de desplazar la vista: boton medio (el de Blender), boton
    // derecho (la mas comoda con mouse de dos botones o trackpad) y
    // shift-arrastre (para cuando el derecho ya esta ocupado).
    if (event.button === 1 || event.button === 2 || event.shiftKey) {
      this.panning.set(true);
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

    const activeTool = this.tool();
    if (activeTool === 'place') {
      this.placeEntity(this.coordAt(event));
    } else if (activeTool === 'floor' || activeTool === 'wall') {
      const cell = this.coordAt(event);
      const grid = this.grid();
      if (!new IsoProjection(grid.tileWidth, grid.tileHeight).isValidCoord(cell, grid.width, grid.height)) {
        return;
      }
      this.levels.toggleTile(cell.col, cell.row, activeTool);
      this.dirty.set(true);
    } else {
      this.selectEntity(this.entityAt(event));
    }
  }

  onPointerMove(event: PointerEvent): void {
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
    if (this.panning()) {
      this.panning.set(false);
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
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

  /** Elegir una textura pasa sola a la herramienta de colocar: es lo que se va a hacer. */
  selectTexture(name: string): void {
    this.activeTexture.set(name);
    this.activeShape.set(null);
    this.tool.set('place');
  }

  /** Idem con una primitiva del panel Figuras. */
  selectShape(id: ShapeId): void {
    this.activeShape.set(id);
    this.activeTexture.set(null);
    this.tool.set('place');
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

    this.levels.addEntity(entity);
    // Queda seleccionada para poder ajustarla en el inspector sin buscarla.
    this.selectEntity(entity.id);
    this.dirty.set(true);
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

  /**
   * Selecciona una entidad y trae al frente la pestana de propiedades del
   * objeto: seleccionar algo y que el inspector siga mostrando la escena seria
   * un click perdido.
   */
  selectEntity(id: string | null): void {
    this.levels.selectEntity(id);
    if (id) {
      this.inspectorTab.set('objeto');
    }
  }

  deleteSelected(): void {
    const id = this.levels.selectedEntityId();
    if (!id) {
      return;
    }
    this.levels.removeEntity(id);
    this.dirty.set(true);
    this.note('Entidad "' + id + '" eliminada.');
  }

  /**
   * Duplica la entidad seleccionada una celda a la derecha. Los objetos
   * anidados se copian a mano: el spread es superficial, y sin esto la copia
   * compartiria sourceRect y collider con el original (editar uno movería los dos).
   */
  duplicateSelected(): void {
    const source = this.selected();
    if (!source) {
      return;
    }
    const copy: LevelEntity = {
      ...source,
      id: this.nextEntityId(source.type || 'entidad'),
      position: { col: source.position.col + 1, row: source.position.row },
      sourceRect: { ...source.sourceRect },
      collider: source.collider ? { ...source.collider } : undefined,
    };
    this.levels.addEntity(copy);
    this.selectEntity(copy.id);
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
   * Activa o desactiva el collider. Al activarlo arranca del tamano del
   * sprite, que es lo que se espera casi siempre; al desactivarlo se pone en
   * undefined para que la clave no aparezca en el JSON (el schema la trata
   * como ausente = la entidad no colisiona).
   */
  toggleCollider(enabled: boolean): void {
    const entity = this.selected();
    if (!entity) {
      return;
    }
    this.patchEntity({
      collider: enabled
        ? { width: entity.sourceRect.width, height: entity.sourceRect.height }
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
  private entityAt(event: PointerEvent): string | null {
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
      (a, b) => iso.gridToScreen(b.position).y - iso.gridToScreen(a.position).y,
    );
    for (const entity of ordered) {
      // La misma caja que usa draw(), a zoom 1 (x e y ya vienen sin zoom). Si
      // el hit-test calculara la suya por separado, clickear una entidad
      // seleccionaria otra cosa en cuanto una de las dos formulas cambiara.
      const box = this.spriteBox(entity, iso.gridToScreen(entity.position), 1);

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
    const w = entity.sourceRect.width * zoom;
    const h = entity.sourceRect.height * zoom;
    return {
      x: anchor.x - w / 2,
      y: anchor.y - h + (entity.groundOffset ?? 0) * zoom,
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
      (a, b) => iso.gridToScreen(a.position).y - iso.gridToScreen(b.position).y,
    );

    for (const entity of ordered) {
      const { x, y } = project(entity.position);
      const isSelected = entity.id === selectedId;

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

      // Collider en verde punteado: se ve que es una caja logica y no arte.
      // Va en el punto de la celda y no en la caja del sprite, porque es ahi
      // donde lo encola el motor (ver el Submit a CollisionSystem en main.cpp).
      if (this.showColliders() && entity.collider) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#6b9e3f';
        ctx.strokeRect(x, y, entity.collider.width * zoom, entity.collider.height * zoom);
        ctx.setLineDash([]);
      }

      // Contorno naranja del objeto activo, igual que el de Blender: un halo
      // oscuro por fuera para que se lea sobre cualquier color de relleno, y el
      // naranja pegado al sprite.
      if (isSelected) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.strokeRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ff8b1f';
        ctx.strokeRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
      }

      // Ancla real del runtime: la punta superior del rombo (origin {0,0}).
      ctx.fillStyle = isSelected ? '#ff8b1f' : 'rgba(255, 255, 255, 0.55)';
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
   * Color de relleno por tipo de entidad. Los tipos son texto libre en el
   * schema: los que no estan aca caen al azul por defecto, sin romper nada.
   */
  private entityColor(type: string): string {
    switch (type) {
      case 'player':
        return '#e08a3c';
      case 'obstacle':
        return '#c05050';
      case 'item':
        return '#5f9e4a';
      default:
        return '#4772b3';
    }
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
