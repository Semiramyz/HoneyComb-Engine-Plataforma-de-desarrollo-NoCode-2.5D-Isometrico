// Punto de entrada de la interfaz. Es lo primero que corre dentro de la ventana
// de Electron (o del navegador con "ng serve") y lo unico que hace es arrancar
// Angular: monta el componente raiz App sobre el <app-root> de index.html, con
// la configuracion de app.config.ts.
//
// Toda la logica del editor vive en app.ts; aca no va nada mas.

import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapApplication(App, appConfig)
  // Si el arranque falla, sin este catch la ventana queda en blanco y sin
  // ningun mensaje. main.js reenvia los errores del renderer a la terminal.
  .catch((err) => console.error(err));
