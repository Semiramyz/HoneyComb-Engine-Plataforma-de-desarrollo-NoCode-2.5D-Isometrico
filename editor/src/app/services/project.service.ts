import { Injectable, signal } from '@angular/core';

import { EventCatalog } from '../models/event-catalog.model';
import { Level } from '../models/level.model';

// Unico punto de contacto entre Angular y la API de proyecto que expone
// preload.js. Ningun componente debe llamar window.honeycombProject
// directamente -- todo pasa por aca, para que el resto del editor trabaje
// con tipos (Level, EventCatalog) en vez de strings/JSON crudo.
@Injectable({ providedIn: 'root' })
export class ProjectService {
  readonly projectRoot = signal<string | null>(null);

  async openProjectFolder(): Promise<boolean> {
    const folder = await window.honeycombProject.openFolder();
    if (!folder) {
      return false;
    }
    this.projectRoot.set(folder);
    return true;
  }

  async listLevels(): Promise<string[]> {
    const names = await window.honeycombProject.listDir('levels');
    return names.filter((name) => name.endsWith('.json'));
  }

  async readLevel(fileName: string): Promise<Level> {
    const contents = await window.honeycombProject.readFile(`levels/${fileName}`);
    return JSON.parse(contents) as Level;
  }

  async saveLevel(fileName: string, level: Level): Promise<void> {
    await window.honeycombProject.writeFile(`levels/${fileName}`, JSON.stringify(level, null, 2));
  }

  async readEventCatalog(): Promise<EventCatalog> {
    const contents = await window.honeycombProject.readFile('schema/event_catalog.json');
    return JSON.parse(contents) as EventCatalog;
  }

  async listTextures(): Promise<string[]> {
    const names = await window.honeycombProject.listDir('assets/textures');
    return names.filter((name) => /\.(png|jpg|jpeg|gif)$/i.test(name));
  }
}
