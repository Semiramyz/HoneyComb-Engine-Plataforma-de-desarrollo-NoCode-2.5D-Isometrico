import { Injectable, signal } from '@angular/core';

import { EventCatalog } from '../models/event-catalog.model';
import { Level } from '../models/level.model';

// Unico punto de contacto entre Angular y la API de proyecto que expone
// preload.js. Ningun componente debe llamar window.honeycombProject
// directamente -- todo pasa por aca, para que el resto del editor trabaje
// con tipos (Level, EventCatalog) en vez de strings/JSON crudo.
@Injectable({ providedIn: 'root' })
export class ProjectService {
  /** Carpeta raiz del proyecto abierto. Null mientras no se abrio ninguno. */
  readonly projectRoot = signal<string | null>(null);

  /** Abre el dialogo de carpeta. Devuelve false si el usuario cancelo. */

  async openProjectFolder(): Promise<boolean> {
    const folder = await window.honeycombProject.openFolder();
    if (!folder) {
      return false;
    }
    this.projectRoot.set(folder);
    return true;
  }

  // Las rutas de abajo ("levels/", "schema/", "assets/textures/") son la
  // convencion de carpetas de un proyecto HoneyComb, y estan escritas relativas
  // a la raiz que eligio el usuario: main.js las resuelve contra ella y rechaza
  // cualquiera que se salga de esa carpeta.

  /** Nombres de archivo de los niveles del proyecto (solo .json). */
  async listLevels(): Promise<string[]> {
    const names = await window.honeycombProject.listDir('levels');
    return names.filter((name) => name.endsWith('.json'));
  }

  async readLevel(fileName: string): Promise<Level> {
    const contents = await window.honeycombProject.readFile(`levels/${fileName}`);
    return JSON.parse(contents) as Level;
  }

  // Indentado a 2 espacios y no minificado: el JSON del nivel se versiona en
  // git, y asi un cambio se lee como un diff entendible en vez de una sola
  // linea gigante.
  async saveLevel(fileName: string, level: Level): Promise<void> {
    await window.honeycombProject.writeFile(`levels/${fileName}`, JSON.stringify(level, null, 2));
  }

  async readEventCatalog(): Promise<EventCatalog> {
    const contents = await window.honeycombProject.readFile('schema/event_catalog.json');
    return JSON.parse(contents) as EventCatalog;
  }

  /** Imagenes de assets/textures/, que son las que aparecen en el panel Recursos. */
  async listTextures(): Promise<string[]> {
    const names = await window.honeycombProject.listDir('assets/textures');
    return names.filter((name) => /\.(png|jpg|jpeg|gif)$/i.test(name));
  }
}
