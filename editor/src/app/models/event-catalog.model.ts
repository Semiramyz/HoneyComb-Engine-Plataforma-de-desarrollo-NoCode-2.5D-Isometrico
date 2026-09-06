// Espejo en TypeScript de schema/event_catalog.json.
//
// El panel de eventos del editor genera sus formularios DINAMICAMENTE a
// partir de esto -- no hay un formulario hardcodeado por cada trigger/accion.
// Agregar un bloque nuevo al catalogo (nuevo objeto en event_catalog.json)
// hace que aparezca disponible en el editor sin tocar codigo Angular, igual
// que EventSystem en C++ no necesita recompilarse para usar un type nuevo
// (siempre que alguien lo registre con RegisterTrigger/RegisterAction).

// Tipos de parametro que el editor sabe renderizar como control de
// formulario especifico. Un type no listado aca no rompe nada: el
// renderizador dinamico cae a un campo de texto simple.
export type CatalogParamType = 'entity_ref' | 'string' | 'number' | 'boolean';

export interface CatalogParamDef {
  type: CatalogParamType | string;
  description?: string;
}

export interface CatalogEntry {
  /** Coincide con el 'type' que EventSystem espera en C++ (RegisterTrigger/RegisterCondition/RegisterAction). */
  type: string;
  label: string;
  description?: string;
  params: Record<string, CatalogParamDef>;
}

export interface EventCatalog {
  triggers: CatalogEntry[];
  conditions: CatalogEntry[];
  actions: CatalogEntry[];
}
