// Declara la API que preload.js expone via contextBridge, para que el
// codigo Angular la use con tipos en vez de "window as any".

/** Un archivo o una carpeta del proyecto, tal como los devuelve listEntries(). */
export interface ProjectNode {
  name: string;
  /** Ruta relativa a la raiz del proyecto, siempre con "/" (tambien en Windows). */
  path: string;
  kind: 'dir' | 'file';
}

/**
 * Un archivo leido para mirarlo en el visor. El proceso principal decide por
 * extension cual de las tres formas devuelve: "binary" es lo que el editor no
 * sabe mostrar (o lo que pesa demasiado) y solo trae el tamano.
 */
export type ProjectFileData =
  | { kind: 'text'; size: number; text: string; truncated: boolean }
  | { kind: 'image'; size: number; dataUrl: string }
  | { kind: 'binary'; size: number; reason: 'too-large' | 'unsupported' };

/**
 * Una imagen del plan de importacion. "status" dice que hay en el destino:
 * nada ("new"), una copia cruda de esta misma imagen que se puede reemplazar
 * por la ajustada ("stale"), u otra imagen con ese nombre que no se pisa
 * ("exists"). Ver project:beginImport en main.js.
 */
export interface ImportItem {
  source: string;
  target: string;
  status: 'new' | 'stale' | 'exists';
}

/** Resultado de empezar a importar. Trae la raiz aunque se cancele: pudo deducirse recien. */
export type ImportSession =
  | { projectRoot: string; canceled: true }
  | { projectRoot: string; canceled: false; folder: string; items: ImportItem[] };

export interface HoneycombProjectApi {
  save(defaultPath: string, contents: string): Promise<{ canceled: boolean; filePath?: string }>;
  open(): Promise<{ canceled: boolean; filePath?: string; contents?: string }>;

  /** Abre un dialogo de carpeta y la fija como raiz del proyecto actual. Null si se cancelo. */
  openFolder(): Promise<string | null>;
  /** Ruta relativa a la raiz del proyecto abierto. */
  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, contents: string): Promise<void>;
  /** Lista los nombres de archivo (no subcarpetas) dentro de una carpeta relativa a la raiz del proyecto. */
  listDir(relativeDir: string): Promise<string[]>;
  /** Contenido de UNA carpeta del proyecto (carpetas primero). Vacio si no hay proyecto abierto. */
  listEntries(relativeDir: string): Promise<ProjectNode[]>;
  /** Lee un archivo del proyecto para mostrarlo en el visor. */
  readFileData(relativePath: string): Promise<ProjectFileData>;
  /**
   * Empieza a importar: deduce o pregunta la carpeta del proyecto, pregunta la
   * de imagenes y arma el plan. Null si se cancelo la eleccion del proyecto.
   */
  beginImport(): Promise<ImportSession | null>;
  /** El original de una imagen del plan, como data URL. */
  readImportImage(index: number): Promise<string>;
  /** Escribe la textura de una imagen del plan. null = copiar el original (solo PNG). */
  writeImportedTexture(index: number, pngBase64: string | null): Promise<{ written: boolean }>;

  /**
   * Lanza el runtime con el nivel de esa ruta absoluta. El ejecutable lo
   * localiza el proceso principal a partir de ella.
   */
  run(levelPath: string): Promise<{ ok: boolean; executable?: string; error?: string }>;
}

/** Control de la ventana, para lo que antes daba el menu nativo de Electron. */
export interface HoneycombWindowApi {
  toggleDevTools(): Promise<void>;
}

declare global {
  interface Window {
    honeycombProject: HoneycombProjectApi;
    honeycombWindow: HoneycombWindowApi;
  }
}
