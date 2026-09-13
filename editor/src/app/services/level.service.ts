import { Injectable, computed, signal } from '@angular/core';

import { EventDefinition, GridConfig, Level, LevelEntity, MapTile } from '../models/level.model';
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
    this.level.update((level) => ({ ...level, grid: { ...level.grid, ...changes } }));
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
}
