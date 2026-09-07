import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Hash routing porque bajo Electron la app se sirve desde file://, donde
    // las rutas por path no resuelven contra un servidor. Hoy no hay rutas,
    // pero en cuanto se agregue una el editor dejaria de cargar sin esto.
    provideRouter(routes, withHashLocation()),
  ],
};
