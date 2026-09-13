// Barra de menus del editor: Archivo, Editar, Ver... con desplegables y
// submenus, como la de VS Code o la de Word.
//
// Es el unico pedazo de la interfaz con componente propio, y no es un cambio de
// criterio respecto de app.ts: esto no toca el nivel para nada. Tiene su propio
// estado (que menu y que submenu estan abiertos) y su propio manejo de clics
// afuera, y meterlo en app.ts solo engordaria un archivo que ya es largo.
//
// Recibe los menus como DATO y cada opcion trae la funcion que ejecuta, asi que
// no necesita ningun @Output: agregar una opcion es agregar una entrada en el
// computed "menus" de app.ts, sin tocar este componente.

import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, inject, input, signal } from '@angular/core';

/** Una opcion que hace algo. */
export interface MenuAction {
  kind: 'action';
  label: string;
  /** Solo se muestra. El atajo lo atiende app.ts, que escucha el teclado. */
  shortcut?: string;
  /** Marca de las opciones que prenden o apagan algo (barra lateral, grilla...). */
  checked?: boolean;
  disabled?: boolean;
  run: () => void;
}

/**
 * Algo planeado que todavia no existe. Se ve, dice que va a hacer, y no se
 * puede elegir: una opcion que parece funcionar y no hace nada es peor que no
 * tenerla.
 */
export interface MenuSoon {
  kind: 'soon';
  label: string;
  hint: string;
}

export interface MenuSeparator {
  kind: 'separator';
}

/**
 * Lo que puede ir dentro de un submenu. No hay submenus dentro de submenus: un
 * nivel alcanza para ordenar, y dos ya cuestan de recorrer con el mouse.
 */
export type MenuLeaf = MenuAction | MenuSoon | MenuSeparator;

export interface MenuSubmenu {
  kind: 'submenu';
  label: string;
  items: MenuLeaf[];
  /** Que decir cuando la lista esta vacia (por ejemplo, un proyecto sin niveles). */
  emptyLabel: string;
}

export type MenuEntry = MenuLeaf | MenuSubmenu;

export interface MenuDef {
  id: string;
  label: string;
  items: MenuEntry[];
}

@Component({
  selector: 'app-menu-bar',
  imports: [NgTemplateOutlet],
  templateUrl: './menu-bar.html',
  styleUrl: './menu-bar.scss',
  host: {
    role: 'menubar',
    // En document y no en el host: lo que cierra un menu es justamente un clic
    // FUERA de la barra, que el host nunca ve.
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown.escape)': 'close()',
  },
})
export class MenuBar {
  readonly menus = input.required<MenuDef[]>();

  /** Id del menu desplegado, o null. */
  readonly openMenu = signal<string | null>(null);
  /** Etiqueta del submenu desplegado dentro del menu abierto, o null. */
  readonly openSubmenu = signal<string | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  toggle(id: string): void {
    this.openMenu.update((current) => (current === id ? null : id));
    this.openSubmenu.set(null);
  }

  /**
   * Con un menu ya abierto, pasar el mouse por otro titulo lo abre. Es lo que
   * hace cualquier barra de escritorio, y permite recorrerlos todos sin tener
   * que cerrar y volver a clickear cada uno.
   */
  hoverTitle(id: string): void {
    const current = this.openMenu();
    if (current !== null && current !== id) {
      this.openMenu.set(id);
      this.openSubmenu.set(null);
    }
  }

  /** Cierra antes de ejecutar: la opcion puede abrir un dialogo, y el menu no debe quedar encima. */
  choose(action: MenuAction): void {
    if (action.disabled) {
      return;
    }
    this.close();
    action.run();
  }

  close(): void {
    this.openMenu.set(null);
    this.openSubmenu.set(null);
  }

  onDocumentPointerDown(event: PointerEvent): void {
    if (this.openMenu() !== null && !this.host.nativeElement.contains(event.target as Node)) {
      this.close();
    }
  }

  // Las plantillas no angostan bien una union por su "kind", asi que cada caso
  // se pide con su propio metodo: devuelve la entrada con su tipo, o null.

  asAction(entry: MenuEntry): MenuAction | null {
    return entry.kind === 'action' ? entry : null;
  }

  asSoon(entry: MenuEntry): MenuSoon | null {
    return entry.kind === 'soon' ? entry : null;
  }

  asSubmenu(entry: MenuEntry): MenuSubmenu | null {
    return entry.kind === 'submenu' ? entry : null;
  }
}
