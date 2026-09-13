import { Injectable, signal } from '@angular/core';

import type { ImportSession, ProjectFileData, ProjectNode } from '../electron-api';
import { EventCatalog } from '../models/event-catalog.model';
import { Level } from '../models/level.model';

/**
 * Convierte el texto de un archivo en un Level utilizable, o falla con un
 * mensaje que se entienda.
 *
 * Existe porque abrir un archivo es el unico lugar donde entra al editor algo
 * que nadie valido: puede ser un JSON roto, o uno valido que no sea un nivel.
 * Sin este control, un archivo cualquiera dejaba la pantalla en blanco al
 * dibujar (draw() lee level.grid.tileWidth sin preguntar).
 *
 * Lo obligatorio es la grilla, que es de lo unico que no se puede inventar un
 * default razonable. El resto se completa: un nivel sin entidades o sin
 * eventos es perfectamente valido, solo que esta vacio.
 */
function parseLevel(contents: string, source: string): Level {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new Error(`"${source}" no es un JSON valido.`);
  }

  const data = raw as Partial<Level>;
  const grid = data?.grid;
  const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  if (
    !grid ||
    !isNumber(grid.width) ||
    !isNumber(grid.height) ||
    !isNumber(grid.tileWidth) ||
    !isNumber(grid.tileHeight)
  ) {
    throw new Error(`"${source}" no parece un nivel de HoneyComb: le falta "grid".`);
  }

  return {
    name: typeof data.name === 'string' ? data.name : 'nivel',
    grid,
    entities: Array.isArray(data.entities) ? data.entities : [],
    events: Array.isArray(data.events) ? data.events : [],
    visuals: data.visuals,
    tiles: data.tiles,
  };
}

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
    return this.readLevelAt(`levels/${fileName}`);
  }

  /**
   * Igual que readLevel(), pero con la ruta relativa completa dentro del
   * proyecto. Lo usa el organizador de archivos, que abre el .json donde sea
   * que este y no solo el nivel de arriba de levels/.
   */
  async readLevelAt(relativePath: string): Promise<Level> {
    const contents = await window.honeycombProject.readFile(relativePath);
    return parseLevel(contents, relativePath);
  }

  /**
   * Contenido de una carpeta del proyecto, para el explorador. Se piden de a
   * una, al desplegarla: ver el comentario del handler en main.js.
   */
  async listEntries(relativeDir: string): Promise<ProjectNode[]> {
    return window.honeycombProject.listEntries(relativeDir);
  }

  /** Lee un archivo cualquiera del proyecto para mirarlo en el visor. */
  async readFileData(relativePath: string): Promise<ProjectFileData> {
    return window.honeycombProject.readFileData(relativePath);
  }

  // Importar imagenes va en tres pasos porque el ajuste de tamano lo hace la UI
  // (ver el comentario de project:beginImport en main.js).

  async beginImport(): Promise<ImportSession | null> {
    return window.honeycombProject.beginImport();
  }

  async readImportImage(index: number): Promise<string> {
    return window.honeycombProject.readImportImage(index);
  }

  async writeImportedTexture(index: number, pngBase64: string | null): Promise<{ written: boolean }> {
    return window.honeycombProject.writeImportedTexture(index, pngBase64);
  }

  /**
   * Abre un nivel eligiendo el ARCHIVO con el dialogo del sistema, en vez de
   * elegirlo del desplegable del proyecto.
   *
   * Sirve para abrir un .json que este en cualquier parte, tenga o no un
   * proyecto abierto. Devuelve la ruta elegida junto al nivel, o null si se
   * cancelo.
   */
  async openLevelFile(): Promise<{ path: string; level: Level } | null> {
    const result = await window.honeycombProject.open();
    if (result.canceled || !result.filePath || result.contents === undefined) {
      return null;
    }
    return { path: result.filePath, level: parseLevel(result.contents, result.filePath) };
  }

  // Indentado a 2 espacios y no minificado: el JSON del nivel se versiona en
  // git, y asi un cambio se lee como un diff entendible en vez de una sola
  // linea gigante.
  async saveLevel(fileName: string, level: Level): Promise<void> {
    await window.honeycombProject.writeFile(`levels/${fileName}`, JSON.stringify(level, null, 2));
  }

  /**
   * Guarda abriendo el dialogo nativo del sistema, donde se elige carpeta y
   * nombre: el "Guardar como" de cualquier programa de escritorio.
   *
   * A diferencia de saveLevel(), esto NO exige tener un proyecto abierto: el
   * dialogo escribe en la ruta que elija la persona, sin pasar por la raiz del
   * proyecto. Devuelve esa ruta, o null si se cancelo.
   */
  async saveLevelAs(suggestedPath: string, level: Level): Promise<string | null> {
    const result = await window.honeycombProject.save(
      suggestedPath,
      JSON.stringify(level, null, 2),
    );
    return result.canceled || !result.filePath ? null : result.filePath;
  }

  async readEventCatalog(): Promise<EventCatalog> {
    const contents = await window.honeycombProject.readFile('schema/event_catalog.json');
    return JSON.parse(contents) as EventCatalog;
  }

  /**
   * Lanza el runtime con un nivel ya guardado en disco.
   *
   * Se le pasa la ruta del NIVEL, no la del motor: el proceso principal deduce
   * de ella donde esta engine.exe, con la misma convencion de carpetas que usa
   * el propio motor para encontrar los assets.
   */
  async runLevel(levelPath: string): Promise<{ ok: boolean; executable?: string; error?: string }> {
    return window.honeycombProject.run(levelPath);
  }

  /** Imagenes de assets/textures/, que son las que aparecen en el panel Recursos. */
  async listTextures(): Promise<string[]> {
    const names = await window.honeycombProject.listDir('assets/textures');
    return names.filter((name) => /\.(png|jpg|jpeg|gif)$/i.test(name));
  }
}
