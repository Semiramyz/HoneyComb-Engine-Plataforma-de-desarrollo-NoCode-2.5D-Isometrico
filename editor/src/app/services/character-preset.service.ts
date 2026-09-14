import { Injectable, inject, signal } from '@angular/core';

import { CharacterPreset } from '../models/character-preset.model';
import { ProjectService } from './project.service';

/**
 * Los personajes configurados del proyecto abierto. Viven en memoria como
 * signal (la paleta y la ventana de configuracion los leen de aca) y en disco
 * en characters.json; save() escribe primero el archivo y recien despues
 * actualiza la memoria, para que un fallo de disco no deje la paleta
 * mostrando personajes que en realidad no se guardaron.
 */
@Injectable({ providedIn: 'root' })
export class CharacterPresetService {
  private readonly project = inject(ProjectService);

  readonly presets = signal<CharacterPreset[]>([]);

  async load(): Promise<void> {
    this.presets.set(await this.project.readCharacterPresets());
  }

  async save(presets: CharacterPreset[]): Promise<void> {
    await this.project.writeCharacterPresets(presets);
    this.presets.set(presets);
  }
}
