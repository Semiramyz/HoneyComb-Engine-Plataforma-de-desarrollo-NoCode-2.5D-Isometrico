// Configuracion de arranque de Angular: los servicios globales que van a estar
// disponibles en toda la aplicacion. Se la consume una sola vez, desde main.ts.
//
// Los servicios propios del editor (ProjectService, LevelService,
// CatalogService) NO se listan aca: usan { providedIn: 'root' }, que los
// registra solos.

import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // Engancha los errores no capturados de la UI para que lleguen a la consola
    // en vez de perderse en silencio.
    provideBrowserGlobalErrorListeners(),
    // Hash routing porque bajo Electron la app se sirve desde file://, donde
    // las rutas por path no resuelven contra un servidor. Hoy no hay rutas,
    // pero en cuanto se agregue una el editor dejaria de cargar sin esto.
    provideRouter(routes, withHashLocation()),
  ],
};
