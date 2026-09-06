// Declara la API que preload.js expone via contextBridge, para que el
// codigo Angular la use con tipos en vez de "window as any".

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
}

declare global {
  interface Window {
    honeycombProject: HoneycombProjectApi;
  }
}
