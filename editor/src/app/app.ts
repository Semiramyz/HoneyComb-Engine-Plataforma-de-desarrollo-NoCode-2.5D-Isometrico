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
import { CatalogEntry, CatalogParamDef } from './models/event-catalog.model';
import { EventStep, GridConfig, LevelEntity } from './models/level.model';
import { CatalogService } from './services/catalog.service';
import { LevelService } from './services/level.service';
import { ProjectService } from './services/project.service';

type Tool = 'select' | 'place';
type CatalogKind = 'triggers' | 'conditions' | 'actions';

// Zoom entero unicamente. En pixel art un zoom fraccionario (1.5x) reparte mal
// los pixeles del sprite -- unos quedan de 1px y otros de 2px -- y arruina la
// lectura de la imagen. Godot y Aseprite hacen lo mismo.
const ZOOM_STEPS = [1, 2, 3, 4, 6, 8];

// Umbral de la matriz de riesgos ("Degradacion de Rendimiento por Usuario"):
// el editor avisa antes de que la escena comprometa los FPS del runtime.
const ENTITY_WARN_THRESHOLD = 150;

interface ParamRow {
  key: string;
  def: CatalogParamDef;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly project = inject(ProjectService);
  readonly levels = inject(LevelService);
  readonly catalog = inject(CatalogService);
  private readonly destroyRef = inject(DestroyRef);

  /** preload.js solo existe bajo Electron; con "ng serve" la UI corre sin acceso a disco. */
  readonly hasFileSystem = typeof window !== 'undefined' && 'honeycombProject' in window;

  readonly levelFiles = signal<string[]>([]);
  readonly textures = signal<string[]>([]);
  readonly status = signal('Listo. Abri una carpeta de proyecto para empezar.');
  readonly dirty = signal(false);

  readonly tool = signal<Tool>('select');
  readonly activeTexture = signal<string | null>(null);
  readonly zoom = signal(3);
  readonly showGrid = signal(true);
  readonly showColliders = signal(true);
  readonly pan = signal({ x: 0, y: 0 });
  readonly hovered = signal<GridCoord | null>(null);
  readonly bottomPanel = signal<'eventos' | 'salida'>('eventos');
  readonly log = signal<string[]>([]);

  readonly zoomSteps = ZOOM_STEPS;

  private readonly viewport = viewChild<ElementRef<HTMLCanvasElement>>('viewport');
  private readonly canvasSize = signal({ w: 0, h: 0 });
  private observer?: ResizeObserver;
  private dragging = false;
  private dragOrigin = { x: 0, y: 0, panX: 0, panY: 0 };

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
    effect(() => {
      const ref = this.viewport();
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
    effect(() => this.draw());

    this.destroyRef.onDestroy(() => this.observer?.disconnect());
  }

  // --- Proyecto -------------------------------------------------------------

  async openProject(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abri el editor con "npm run electron".');
      return;
    }
    const opened = await this.project.openProjectFolder();
    if (!opened) {
      return;
    }
    await this.refreshProject();
  }

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

  async loadLevel(fileName: string): Promise<void> {
    try {
      await this.levels.load(fileName);
      this.dirty.set(false);
      this.pan.set({ x: 0, y: 0 });
      this.note('Nivel "' + fileName + '" cargado (' + this.entities().length + ' entidades).');
    } catch (error) {
      this.note('Error al cargar ' + fileName + ': ' + this.describe(error));
    }
  }

  newLevel(): void {
    this.levels.createNew('nuevo_nivel');
    this.dirty.set(true);
    this.pan.set({ x: 0, y: 0 });
    this.note('Nivel nuevo en memoria. Renombralo en el Inspector y guardalo.');
  }

  async save(): Promise<void> {
    if (!this.hasFileSystem || !this.project.projectRoot()) {
      this.note('Abri primero una carpeta de proyecto para poder guardar.');
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

  // --- Viewport -------------------------------------------------------------

  setZoom(step: number): void {
    this.zoom.set(step);
  }

  resetView(): void {
    this.pan.set({ x: 0, y: 0 });
    this.zoom.set(3);
  }

  toggleGrid(): void {
    this.showGrid.update((value) => !value);
  }

  toggleColliders(): void {
    this.showColliders.update((value) => !value);
  }

  onPointerDown(event: PointerEvent): void {
    // Boton medio o shift-arrastre: paneo, como en Godot.
    if (event.button === 1 || event.shiftKey) {
      this.dragging = true;
      const pan = this.pan();
      this.dragOrigin = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    if (event.button !== 0) {
      return;
    }

    if (this.tool() === 'place') {
      this.placeEntity(this.coordAt(event));
    } else {
      this.levels.selectEntity(this.entityAt(event));
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (this.dragging) {
      this.pan.set({
        x: this.dragOrigin.panX + (event.clientX - this.dragOrigin.x),
        y: this.dragOrigin.panY + (event.clientY - this.dragOrigin.y),
      });
      return;
    }
    this.hovered.set(this.coordAt(event));
  }

  onPointerUp(event: PointerEvent): void {
    if (this.dragging) {
      this.dragging = false;
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    }
  }

  onPointerLeave(): void {
    this.hovered.set(null);
  }

  // --- Entidades ------------------------------------------------------------

  selectTexture(name: string): void {
    this.activeTexture.set(name);
    this.tool.set('place');
  }

  private placeEntity(coord: GridCoord): void {
    const grid = this.grid();
    const iso = new IsoProjection(grid.tileWidth, grid.tileHeight);
    if (!iso.isValidCoord(coord, grid.width, grid.height)) {
      this.note('Esa celda queda fuera de la grilla.');
      return;
    }

    const texture = this.activeTexture();
    if (!texture) {
      this.note('Elegi una textura en el panel Recursos antes de colocar.');
      return;
    }

    const entity: LevelEntity = {
      id: this.nextEntityId('entidad'),
      type: 'prop',
      position: { col: coord.col, row: coord.row },
      texture: 'textures/' + texture,
      sourceRect: { x: 0, y: 0, width: 16, height: 16 },
    };
    this.levels.addEntity(entity);
    this.levels.selectEntity(entity.id);
    this.dirty.set(true);
  }

  selectEntity(id: string | null): void {
    this.levels.selectEntity(id);
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
    this.levels.selectEntity(copy.id);
    this.dirty.set(true);
  }

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

  private nextEntityId(base: string): string {
    const taken = new Set(this.entityIds());
    let index = 1;
    while (taken.has(base + '_' + index)) {
      index += 1;
    }
    return base + '_' + index;
  }

  // --- Eventos --------------------------------------------------------------

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

  private defaultParams(entry: CatalogEntry): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    for (const key of Object.keys(entry.params)) {
      const type = entry.params[key].type;
      params[key] = type === 'number' ? 0 : type === 'boolean' ? false : '';
    }
    return params;
  }

  // --- Canvas ---------------------------------------------------------------

  private origin(): { x: number; y: number } {
    const size = this.canvasSize();
    const pan = this.pan();
    // Mismo encuadre que main.cpp: centro horizontal y un margen superior.
    return { x: Math.round(size.w / 2 + pan.x), y: Math.round(60 + pan.y) };
  }

  private coordAt(event: PointerEvent): GridCoord {
    const ref = this.viewport();
    const grid = this.grid();
    if (!ref) {
      return { col: 0, row: 0 };
    }
    const rect = ref.nativeElement.getBoundingClientRect();
    const origin = this.origin();
    const zoom = this.zoom();
    const iso = new IsoProjection(grid.tileWidth, grid.tileHeight);
    return iso.screenToGrid({
      x: (event.clientX - rect.left - origin.x) / zoom,
      y: (event.clientY - rect.top - origin.y) / zoom,
    });
  }

  /** Hit-test sobre el rectangulo real del sprite, no sobre la celda. */
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

    // De adelante hacia atras, para que gane el sprite dibujado encima.
    const ordered = [...this.entities()].sort(
      (a, b) => iso.gridToScreen(b.position).y - iso.gridToScreen(a.position).y,
    );
    for (const entity of ordered) {
      const point = iso.gridToScreen(entity.position);
      if (
        x >= point.x &&
        x <= point.x + entity.sourceRect.width &&
        y >= point.y &&
        y <= point.y + entity.sourceRect.height
      ) {
        return entity.id;
      }
    }
    return null;
  }

  private draw(): void {
    const ref = this.viewport();
    const size = this.canvasSize();
    if (!ref || size.w === 0 || size.h === 0) {
      return;
    }

    const canvas = ref.nativeElement;
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

    ctx.fillStyle = '#14171d';
    ctx.fillRect(0, 0, size.w, size.h);

    const halfW = (grid.tileWidth / 2) * zoom;
    const halfH = (grid.tileHeight / 2) * zoom;
    const fullH = grid.tileHeight * zoom;

    const diamond = (coord: GridCoord) => {
      const point = iso.gridToScreen(coord);
      const x = origin.x + point.x * zoom;
      const y = origin.y + point.y * zoom;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + halfW, y + halfH);
      ctx.lineTo(x, y + fullH);
      ctx.lineTo(x - halfW, y + halfH);
      ctx.closePath();
    };

    if (this.showGrid()) {
      ctx.lineWidth = 1;
      for (let row = 0; row < grid.height; row += 1) {
        for (let col = 0; col < grid.width; col += 1) {
          diamond({ col, row });
          ctx.fillStyle = (col + row) % 2 === 0 ? '#1c2029' : '#191d25';
          ctx.fill();
          ctx.strokeStyle = '#262c37';
          ctx.stroke();
        }
      }
    }

    if (hovered && iso.isValidCoord(hovered, grid.width, grid.height)) {
      diamond(hovered);
      ctx.fillStyle = 'rgba(245, 166, 35, 0.15)';
      ctx.fill();
      ctx.strokeStyle = '#f5a623';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Mismo criterio de profundidad que ZSortSystem::Flush(): menor Y primero.
    const ordered = [...level.entities].sort(
      (a, b) => iso.gridToScreen(a.position).y - iso.gridToScreen(b.position).y,
    );

    for (const entity of ordered) {
      const point = iso.gridToScreen(entity.position);
      const x = origin.x + point.x * zoom;
      const y = origin.y + point.y * zoom;
      const w = entity.sourceRect.width * zoom;
      const h = entity.sourceRect.height * zoom;

      ctx.fillStyle = this.entityColor(entity.type);
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

      if (this.showColliders() && entity.collider) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#5be0a0';
        ctx.strokeRect(x, y, entity.collider.width * zoom, entity.collider.height * zoom);
        ctx.setLineDash([]);
      }

      if (entity.id === selectedId) {
        ctx.strokeStyle = '#f5a623';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
      }

      // Ancla real del runtime: la punta superior del rombo (origin {0,0}).
      ctx.fillStyle = '#f5a623';
      ctx.fillRect(x - 1, y - 1, 3, 3);

      if (zoom >= 3) {
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillStyle = '#aeb6c2';
        ctx.fillText(entity.id, x, y - 6);
      }
    }
  }

  private entityColor(type: string): string {
    switch (type) {
      case 'player':
        return '#f5a623';
      case 'obstacle':
        return '#e05a5a';
      case 'item':
        return '#4fb286';
      default:
        return '#5b8fd6';
    }
  }

  // --- Utilidades de plantilla ---------------------------------------------

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

  private note(message: string): void {
    this.status.set(message);
    this.log.update((entries) => [...entries.slice(-40), message]);
  }

  private describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
