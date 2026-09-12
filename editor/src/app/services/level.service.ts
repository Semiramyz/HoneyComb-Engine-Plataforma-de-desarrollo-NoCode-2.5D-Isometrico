import { Injectable, computed, signal } from '@angular/core';

import { EventDefinition, GridConfig, Level, LevelEntity, MapTile } from '../models/level.model';
import { ProjectService } from './project.service';

// 64x32 es la proporcion 2:1 estandar del pixel art isometrico, y el mismo
// default que usa LevelLoader.cpp cuando el JSON no declara medidas de tile.
const DEFAULT_GRID: GridConfig = { width: 10, height: 10, tileWidth: 64, tileHeight: 32 };

// Se copia la grilla con spread: si se compartiera la constante, editar el
// tamano de un nivel cambiaria el default de todos los que se creen despues.
function emptyLevel(name: string): Level {
  return { name, grid: { ...DEFAULT_GRID }, entities: [], events: [] };
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
  /** Se guarda el id y no la entidad: la entidad se reemplaza en cada edicion (estado inmutable). */
  readonly selectedEntityId = signal<string | null>(null);

  /** La entidad seleccionada, resuelta desde el id. undefined si se borro o no hay ninguna. */
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
    this.selectedEntityId.set(null);
  }

  async load(fileName: string): Promise<void> {
    const level = await this.project.readLevel(fileName);
    this.level.set(level);
    this.fileName.set(fileName);
    this.selectedEntityId.set(null);
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
    this.level.update((level) => ({
      ...level,
      entities: level.entities.filter((entity) => entity.id !== id),
    }));
    // Sin esto quedaria una seleccion apuntando a algo que ya no existe, y el
    // inspector mostraria un panel vacio sin explicacion.
    if (this.selectedEntityId() === id) {
      this.selectedEntityId.set(null);
    }
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
      return { ...level, tiles };
    });
  }

  selectEntity(id: string | null): void {
    this.selectedEntityId.set(id);
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
