import { Injectable, inject, signal } from '@angular/core';

import { ItemDef } from '../models/item.model';
import { ProjectService } from './project.service';

/**
 * La biblioteca de objetos del proyecto: armas, curaciones y monedas. Vive en
 * memoria como signal (la paleta Objetos, la ventana de objetos y los
 * desplegables del inspector la leen de aca) y en disco en items.json.
 *
 * Mismo trato que CharacterPresetService: save() escribe primero el archivo y
 * recien despues actualiza la memoria, para que un fallo de disco no deje la
 * paleta mostrando objetos que no se guardaron. Y un nivel nunca depende de
 * esta lista: al usar un objeto se copia a "items" del nivel (ver core/items.ts).
 */
@Injectable({ providedIn: 'root' })
export class ItemLibraryService {
  private readonly project = inject(ProjectService);

  readonly items = signal<ItemDef[]>([]);

  async load(): Promise<void> {
    this.items.set(await this.project.readItemLibrary());
  }

  async save(items: ItemDef[]): Promise<void> {
    await this.project.writeItemLibrary(items);
    this.items.set(items);
  }

  find(id: string): ItemDef | undefined {
    return this.items().find((item) => item.id === id);
  }
}
