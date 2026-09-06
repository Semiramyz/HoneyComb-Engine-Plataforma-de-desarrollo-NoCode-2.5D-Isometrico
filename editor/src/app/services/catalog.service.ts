import { Injectable, signal } from '@angular/core';

import { CatalogEntry, EventCatalog } from '../models/event-catalog.model';
import { ProjectService } from './project.service';

// Carga schema/event_catalog.json una vez y lo deja disponible para
// consulta: que triggers/condiciones/acciones existen y que parametros
// necesita cada uno. El panel de eventos arma sus formularios a partir de
// esto, nunca de una lista hardcodeada en el componente.
@Injectable({ providedIn: 'root' })
export class CatalogService {
  readonly catalog = signal<EventCatalog | null>(null);

  constructor(private readonly project: ProjectService) {}

  async load(): Promise<void> {
    const catalog = await this.project.readEventCatalog();
    this.catalog.set(catalog);
  }

  findTrigger(type: string): CatalogEntry | undefined {
    return this.catalog()?.triggers.find((entry) => entry.type === type);
  }

  findCondition(type: string): CatalogEntry | undefined {
    return this.catalog()?.conditions.find((entry) => entry.type === type);
  }

  findAction(type: string): CatalogEntry | undefined {
    return this.catalog()?.actions.find((entry) => entry.type === type);
  }
}
