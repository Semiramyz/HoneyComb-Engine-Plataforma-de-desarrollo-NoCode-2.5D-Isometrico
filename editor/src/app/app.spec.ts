// Pruebas del componente raiz.
//
// OJO: el segundo test viene del andamiaje que genero Angular CLI y quedo
// desactualizado -- busca un <h1> con "Hello, editor", texto que la plantilla
// real del editor ya no tiene. Falla si se corre. Hay que reescribirlo contra
// la UI de verdad (por ejemplo, que la barra superior muestre "HoneyComb") o
// borrarlo.

import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    })
      .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('Hello, editor');
  });
});
