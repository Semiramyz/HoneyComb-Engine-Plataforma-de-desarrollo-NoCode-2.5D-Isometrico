import { Injectable, computed, signal } from '@angular/core';

import { EventDefinition, GridConfig, Level, LevelEntity } from '../models/level.model';
import { ProjectService } from './project.service';

const DEFAULT_GRID: GridConfig = { width: 10, height: 10, tileWidth: 64, tileHeight: 32 };

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
  readonly fileName = signal<string | null>(null);
  readonly selectedEntityId = signal<string | null>(null);

  readonly selectedEntity = computed<LevelEntity | undefined>(() => {
    const id = this.selectedEntityId();
    return id ? this.level().entities.find((entity) => entity.id === id) : undefined;
  });

  constructor(private readonly project: ProjectService) {}

  createNew(name: string): void {
    this.level.set(emptyLevel(name));
    this.fileName.set(null);
    this.selectedEntityId.set(null);
  }

  async load(fileName: string): Promise<void> {
    const level = await this.project.readLevel(fileName);
    this.level.set(level);
    this.fileName.set(fileName);
    this.selectedEntityId.set(null);
  }

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
    if (this.selectedEntityId() === id) {
      this.selectedEntityId.set(null);
    }
  }

  selectEntity(id: string | null): void {
    this.selectedEntityId.set(id);
  }

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
