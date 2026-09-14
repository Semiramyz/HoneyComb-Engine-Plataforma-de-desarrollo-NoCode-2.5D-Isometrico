import { Injectable, computed, signal } from '@angular/core';

import {
  buildLayout,
  cellState,
  implicitRoom,
  legacyEdits,
  nextFreeId,
  sanitizeRoom,
  shiftLevel,
} from '../core/dungeon-layout';
import {
  EventDefinition,
  GridConfig,
  Level,
  LevelEntity,
  MapRoom,
  MapTile,
  MapTunnel,
  RoomSide,
  Zone,
} from '../models/level.model';
import { withItemDefs } from '../core/items';
import { ItemDef } from '../models/item.model';
import { ProjectService } from './project.service';

// 64x32 es la proporcion 2:1 estandar del pixel art isometrico, y el mismo
// default que usa LevelLoader.cpp cuando el JSON no declara medidas de tile.
const DEFAULT_GRID: GridConfig = { width: 10, height: 10, tileWidth: 64, tileHeight: 32 };

/**
 * Piso y pared por defecto de un nivel, con las mismas texturas y recortes que
 * traen los niveles escritos a mano (levels/test_level.json).
 *
 * No es decoracion, es lo que hace que las herramientas de piso y pared
 * SIRVAN: main.cpp recorre wallTiles solo si el nivel declara una textura de
 * pared, asi que en un nivel sin "visuals" una pared dibujada en el editor no
 * se ve ni frena a nadie al ejecutar. Los niveles que creaba el editor no
 * traian el bloque, y por eso esas dos herramientas no tenian ningun efecto.
 *
 * Es una funcion y no una constante para que cada nivel reciba su propio
 * objeto: compartiendolo, editar el recorte de uno cambiaria el de todos.
 */
function defaultVisuals(): NonNullable<Level['visuals']> {
  return {
    floor: { texture: 'textures/floor.png', sourceRect: { x: 0, y: 0, width: 64, height: 64 } },
    wall: { texture: 'textures/wall.png', sourceRect: { x: 0, y: 0, width: 32, height: 32 } },
  };
}

/**
 * Recalcula las celdas de un nivel con salas: "tiles" y el tamano de la grilla
 * salen de las salas, los tuneles y los retoques. Un nivel sin salas se
 * devuelve tal cual, asi que todo nivel viejo sigue igual.
 *
 * Tambien asegura "visuals": sin textura de pared, el motor no dibuja ni frena
 * las paredes, y un mapa sin paredes no sirve de nada.
 */
function withLayout(level: Level): Level {
  if (!level.rooms?.length) {
    return level;
  }
  const layout = buildLayout(level.grid, level.rooms, level.tunnels ?? [], level.tileEdits ?? []);
  return {
    ...level,
    grid: { ...level.grid, width: layout.width, height: layout.height },
    tiles: layout.tiles,
    visuals: level.visuals ?? defaultVisuals(),
  };
}

/**
 * Pasa un nivel de una sola grilla a mapa: el area que ya tenia se vuelve
 * "sala_1", y lo retocado a mano con Piso/Pared se guarda como retoques para no
 * perderse (ver legacyEdits).
 */
function convertToRooms(level: Level): Level {
  const room = implicitRoom(level.grid);
  return {
    ...level,
    rooms: [room],
    tunnels: [],
    tileEdits: legacyEdits(level.grid, level.tiles, room),
  };
}

// Se copia la grilla con spread: si se compartiera la constante, editar el
// tamano de un nivel cambiaria el default de todos los que se creen despues.
function emptyLevel(name: string): Level {
  return { name, grid: { ...DEFAULT_GRID }, entities: [], events: [], visuals: defaultVisuals() };
}

// Mantiene el nivel actualmente abierto en memoria y expone operaciones para
// modificarlo. Ningun componente visual debe mutar el objeto Level
// directamente -- todo pasa por aca, para que el estado sea consistente y
// reactivo (signals) sin importar que panel lo haya cambiado.
@Injectable({ providedIn: 'root' })
export class LevelService {
  readonly level = signal<Level>(emptyLevel('nuevo_nivel'));
  /** Archivo de origen dentro de levels/. Null si el nivel todavia no se guardo nunca. */
  readonly fileName = signal<string | null>(null);
  /**
   * Entidades seleccionadas, por id. Se guardan ids y no entidades porque la
   * entidad se reemplaza entera en cada edicion (estado inmutable).
   *
   * El ORDEN importa: el ultimo de la lista es el objeto activo, el mismo
   * reparto que hace Blender. La seleccion puede tener muchos elementos y
   * sobre todos ellos actuan las operaciones de grupo (borrar, duplicar,
   * mover); el activo es el unico que muestra el inspector, porque los campos
   * de un formulario solo pueden mostrar un valor a la vez.
   */
  readonly selectedEntityIds = signal<string[]>([]);

  /** El objeto activo: el ultimo que se agrego a la seleccion. */
  readonly selectedEntityId = computed<string | null>(() => this.selectedEntityIds().at(-1) ?? null);

  /** La entidad activa, resuelta desde el id. undefined si se borro o no hay ninguna. */
  readonly selectedEntity = computed<LevelEntity | undefined>(() => {
    const id = this.selectedEntityId();
    return id ? this.level().entities.find((entity) => entity.id === id) : undefined;
  });

  constructor(private readonly project: ProjectService) {}

  // Todos los metodos de abajo reemplazan el nivel entero en vez de mutarlo
  // (spread y map/filter, nunca push ni asignacion directa). Un signal solo
  // avisa si la referencia cambia: mutando el objeto, el canvas no se
  // redibujaria y el inspector se quedaria mostrando datos viejos.

  /** Descarta el nivel actual y empieza uno vacio en memoria (no toca el disco). */
  createNew(name: string, grid: GridConfig = DEFAULT_GRID): void {
    this.level.set({ ...emptyLevel(name), grid: { ...grid } });
    this.fileName.set(null);
    this.selectedEntityIds.set([]);
  }

  async load(fileName: string): Promise<void> {
    this.adopt(await this.project.readLevel(fileName), fileName);
  }

  /**
   * Toma un nivel YA leido y lo pone como el nivel abierto. Lo usa el "Abrir
   * nivel" del dialogo del sistema, donde el archivo puede estar en cualquier
   * parte y no necesariamente dentro de levels/ del proyecto.
   *
   * fileName en null significa "este nivel no vive en el proyecto abierto":
   * el desplegable de niveles no lo muestra y guardar va a preguntar donde.
   */
  adopt(level: Level, fileName: string | null): void {
    this.level.set(level);
    this.fileName.set(fileName);
    this.selectedEntityIds.set([]);
  }

  /**
   * Guarda en levels/. Un nivel nunca guardado toma su nombre como archivo, y
   * a partir de ahi queda asociado a el (los guardados siguientes lo pisan).
   */
  async save(): Promise<void> {
    const fileName = this.fileName() ?? `${this.level().name}.json`;
    await this.project.saveLevel(fileName, this.level());
    this.fileName.set(fileName);
  }

  updateGrid(changes: Partial<GridConfig>): void {
    // Con salas, achicar la grilla por debajo de ellas la vuelve a agrandar: si
    // no, quedarian celdas fuera de la grilla y el motor rechaza el nivel.
    this.level.update((level) => withLayout({ ...level, grid: { ...level.grid, ...changes } }));
  }

  addEntity(entity: LevelEntity): void {
    this.level.update((level) => ({ ...level, entities: [...level.entities, entity] }));
  }

  updateEntity(id: string, changes: Partial<LevelEntity>): void {
    this.level.update((level) => ({
      ...level,
      entities: level.entities.map((entity) => (entity.id === id ? { ...entity, ...changes } : entity)),
    }));
  }

  removeEntity(id: string): void {
    this.removeEntities([id]);
  }

  /** Borra varias de una vez: es lo que necesita una seleccion multiple. */
  removeEntities(ids: readonly string[]): void {
    const doomed = new Set(ids);
    this.level.update((level) => ({
      ...level,
      entities: level.entities.filter((entity) => !doomed.has(entity.id)),
    }));
    // Sin esto quedaria una seleccion apuntando a algo que ya no existe, y el
    // inspector mostraria un panel vacio sin explicacion.
    this.selectedEntityIds.update((selected) => selected.filter((id) => !doomed.has(id)));
  }

  /** Materializa la grilla legacy y alterna piso o pared en una celda. */
  toggleTile(col: number, row: number, kind: 'floor' | 'wall'): void {
    if (this.level().rooms?.length) {
      this.toggleTileEdit(col, row, kind);
      return;
    }
    this.level.update((level) => {
      const tiles = level.tiles
        ? level.tiles.map((tile) => ({ ...tile }))
        : Array.from({ length: level.grid.height }, (_, tileRow) =>
            Array.from({ length: level.grid.width }, (_, tileCol): MapTile => ({
              col: tileCol,
              row: tileRow,
              floor: true,
              wall: tileCol === 0 || tileRow === 0 ||
                tileCol === level.grid.width - 1 || tileRow === level.grid.height - 1,
            })),
          ).flat();
      const index = tiles.findIndex((tile) => tile.col === col && tile.row === row);
      const current = index >= 0 ? tiles[index] : { col, row, floor: false, wall: false };
      const updated = { ...current, [kind]: !(current[kind] ?? false) };
      if (index >= 0) {
        tiles[index] = updated;
      } else {
        tiles.push(updated);
      }
      // Un nivel abierto de disco puede no traer "visuals" (los que creaba el
      // editor antes no lo traian). Se completa aca y no al abrirlo para no
      // ensuciar con un bloque que nadie pidio los niveles que solo se miran:
      // este es el momento en que las celdas empiezan a importar.
      return { ...level, tiles, visuals: level.visuals ?? defaultVisuals() };
    });
  }

  /**
   * Piso o pared en un nivel CON salas. No se toca "tiles" directo -- se
   * recalcula cada vez que se mueve una sala --, sino que se guarda un retoque.
   * Y solo lo que difiere de lo que ya generan las salas: si el retoque vuelve
   * la celda a su estado generado, desaparece, en vez de acumularse.
   */
  private toggleTileEdit(col: number, row: number, kind: 'floor' | 'wall'): void {
    this.level.update((level) => {
      const current = cellState(level.tiles ?? [], col, row);
      const generated = cellState(
        buildLayout(level.grid, level.rooms ?? [], level.tunnels ?? [], []).tiles,
        col,
        row,
      );
      const previous = (level.tileEdits ?? []).find((edit) => edit.col === col && edit.row === row);
      const wanted = { floor: previous?.floor, wall: previous?.wall, [kind]: !current[kind] };

      const edit: MapTile = { col, row };
      if (wanted.floor !== undefined && wanted.floor !== generated.floor) {
        edit.floor = wanted.floor;
      }
      if (wanted.wall !== undefined && wanted.wall !== generated.wall) {
        edit.wall = wanted.wall;
      }

      const others = (level.tileEdits ?? []).filter((other) => other.col !== col || other.row !== row);
      const hasOverride = edit.floor !== undefined || edit.wall !== undefined;
      return withLayout({ ...level, tileEdits: hasOverride ? [...others, edit] : others });
    });
  }

  // --- Mapa: salas y tuneles ------------------------------------------------
  //
  // Toda operacion termina en withLayout(): las celdas que lee el motor se
  // recalculan cada vez, asi que nunca pueden quedar desfasadas de las salas.

  /**
   * Agrega una sala y, si se pide, un tunel que la une con otra. En un nivel
   * que todavia era una sola grilla, primero convierte esa grilla en "sala_1".
   */
  addRoom(
    room: MapRoom,
    connection: { to: string; width: number; fromSide?: RoomSide; toSide?: RoomSide } | null,
  ): void {
    this.level.update((level) => {
      const converted = level.rooms?.length ? level : convertToRooms(level);
      // Ubicada a la izquierda o arriba del mapa, la sala caeria en celdas
      // negativas: se corre todo lo demas lo justo para que entre con su pared.
      const deltaCol = Math.max(0, 1 - Math.round(room.col));
      const deltaRow = Math.max(0, 1 - Math.round(room.row));
      const base = deltaCol || deltaRow ? shiftLevel(converted, deltaCol, deltaRow) : converted;

      const tunnels = [...(base.tunnels ?? [])];
      if (connection) {
        tunnels.push({
          id: nextFreeId('tunel', tunnels.map((tunnel) => tunnel.id)),
          from: connection.to,
          to: room.id,
          width: connection.width,
          fromSide: connection.fromSide,
          toSide: connection.toSide,
        });
      }
      const placed = sanitizeRoom({ ...room, col: room.col + deltaCol, row: room.row + deltaRow });
      return withLayout({ ...base, rooms: [...(base.rooms ?? []), placed], tunnels });
    });
  }

  /** Mueve o redimensiona una sala. Llevarla mas alla del borde de arriba o de la izquierda corre el mapa. */
  updateRoom(id: string, changes: Partial<Omit<MapRoom, 'id'>>): void {
    this.level.update((level) => {
      const current = level.rooms?.find((room) => room.id === id);
      if (!current) {
        return level;
      }
      const target = { ...current, ...changes };
      const deltaCol = Math.max(0, 1 - Math.round(target.col));
      const deltaRow = Math.max(0, 1 - Math.round(target.row));
      const base = deltaCol || deltaRow ? shiftLevel(level, deltaCol, deltaRow) : level;
      return withLayout({
        ...base,
        rooms: (base.rooms ?? []).map((room) =>
          room.id === id
            ? sanitizeRoom({ ...target, col: target.col + deltaCol, row: target.row + deltaRow })
            : room,
        ),
      });
    });
  }

  /**
   * Quita una sala y los tuneles que llegaban a ella. Sin ninguna sala, el
   * nivel vuelve a ser una sola grilla rectangular, como antes de tener mapa.
   */
  removeRoom(id: string): void {
    this.level.update((level) => {
      const rooms = (level.rooms ?? []).filter((room) => room.id !== id);
      if (rooms.length === 0) {
        return { ...level, rooms: undefined, tunnels: undefined, tileEdits: undefined, tiles: undefined };
      }
      return withLayout({
        ...level,
        rooms,
        tunnels: (level.tunnels ?? []).filter((tunnel) => tunnel.from !== id && tunnel.to !== id),
      });
    });
  }

  addTunnel(tunnel: Omit<MapTunnel, 'id'>): void {
    this.level.update((level) => {
      const tunnels = level.tunnels ?? [];
      return withLayout({
        ...level,
        tunnels: [
          ...tunnels,
          {
            ...tunnel,
            id: nextFreeId('tunel', tunnels.map((existing) => existing.id)),
            width: Math.max(1, Math.round(tunnel.width) || 1),
          },
        ],
      });
    });
  }

  /**
   * Cambia un tunel. Una clave que llega en undefined SE BORRA (asi "volver a
   * automatico" quita el trazado a mano); una que no llega, queda como estaba.
   */
  updateTunnel(id: string, changes: Partial<Omit<MapTunnel, 'id'>>): void {
    this.level.update((level) =>
      withLayout({
        ...level,
        tunnels: (level.tunnels ?? []).map((tunnel) => {
          if (tunnel.id !== id) {
            return tunnel;
          }
          const next = { ...tunnel, ...changes, id };
          return { ...next, width: Math.max(1, Math.round(next.width) || 1) };
        }),
      }),
    );
  }

  removeTunnel(id: string): void {
    this.level.update((level) =>
      withLayout({ ...level, tunnels: (level.tunnels ?? []).filter((tunnel) => tunnel.id !== id) }),
    );
  }

  /** Olvida los retoques de Piso/Pared y deja el mapa como lo generan las salas. */
  clearTileEdits(): void {
    this.level.update((level) => withLayout({ ...level, tileEdits: [] }));
  }

  /** Deja seleccionada solo esa entidad, o nada si llega null. */
  selectEntity(id: string | null): void {
    this.selectedEntityIds.set(id ? [id] : []);
  }

  selectEntities(ids: readonly string[]): void {
    this.selectedEntityIds.set([...ids]);
  }

  /**
   * Suma o quita una entidad de la seleccion, que es lo que hace Shift+clic.
   * Al sumarla queda al final, o sea que pasa a ser la activa: el inspector
   * muestra siempre la ultima que se toco.
   */
  toggleEntitySelection(id: string): void {
    this.selectedEntityIds.update((selected) =>
      selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id],
    );
  }

  // Los eventos no tienen id propio en el schema: se los identifica por su
  // posicion en el array, que es tambien el orden en que EventSystem los
  // evalua. Por eso updateEvent/removeEvent trabajan con indices.

  addEvent(event: EventDefinition): void {
    this.level.update((level) => ({ ...level, events: [...level.events, event] }));
  }

  updateEvent(index: number, changes: Partial<EventDefinition>): void {
    this.level.update((level) => ({
      ...level,
      events: level.events.map((event, i) => (i === index ? { ...event, ...changes } : event)),
    }));
  }

  removeEvent(index: number): void {
    this.level.update((level) => ({
      ...level,
      events: level.events.filter((_, i) => i !== index),
    }));
  }

  // --- Combate, objetos y puzzles --------------------------------------------

  addEvents(events: readonly EventDefinition[]): void {
    this.level.update((level) => ({ ...level, events: [...level.events, ...events] }));
  }

  /** Copia definiciones de objetos a "items" del nivel (reemplaza por id). Ver core/items.ts. */
  upsertItems(defs: readonly ItemDef[]): void {
    this.level.update((level) => withItemDefs(level, defs));
  }

  /** Varios cambios de entidad en una sola actualizacion: lo que arma un puzzle. */
  applyEntityChanges(changes: readonly { id: string; changes: Partial<LevelEntity> }[]): void {
    const byId = new Map(changes.map((change) => [change.id, change.changes]));
    this.level.update((level) => ({
      ...level,
      entities: level.entities.map((entity) => {
        const patch = byId.get(entity.id);
        return patch ? { ...entity, ...patch } : entity;
      }),
    }));
  }

  addZone(zone: Zone): void {
    this.level.update((level) => ({ ...level, zones: [...(level.zones ?? []), zone] }));
  }

  updateZone(id: string, changes: Partial<Omit<Zone, 'id'>>): void {
    this.level.update((level) => ({
      ...level,
      zones: (level.zones ?? []).map((zone) =>
        zone.id === id
          ? {
              ...zone,
              ...changes,
              col: Math.max(0, Math.round(changes.col ?? zone.col)),
              row: Math.max(0, Math.round(changes.row ?? zone.row)),
              width: Math.max(1, Math.round(changes.width ?? zone.width)),
              height: Math.max(1, Math.round(changes.height ?? zone.height)),
            }
          : zone,
      ),
    }));
  }

  removeZone(id: string): void {
    this.level.update((level) => {
      const zones = (level.zones ?? []).filter((zone) => zone.id !== id);
      return { ...level, zones: zones.length ? zones : undefined };
    });
  }
}
