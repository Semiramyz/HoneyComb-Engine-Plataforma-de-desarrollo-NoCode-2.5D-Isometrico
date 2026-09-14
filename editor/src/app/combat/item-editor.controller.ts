import { computed, inject, signal } from '@angular/core';

import {
  ATTACK_FIELDS,
  ATTACK_PATTERNS,
  AttackField,
  ITEM_KINDS,
  defaultAbility,
  defaultWeapon,
  itemIdFromName,
  newItemDraft,
  normalizeItem,
  patternDef,
  rangeLabel,
  withPattern,
} from '../core/items';
import {
  AbilityDef,
  AttackDef,
  AttackPattern,
  ItemDef,
  ItemKind,
  WeaponCategory,
} from '../models/item.model';
import { ItemLibraryService } from '../services/item-library.service';
import { LevelService } from '../services/level.service';
import { ProjectService } from '../services/project.service';

/** Con que abrir la ventana: un objeto guardado, o uno nuevo de ese tipo. */
export interface ItemEditorRequest {
  editId?: string;
  kind?: ItemKind;
  category?: WeaponCategory;
}

/** Que ataque del borrador edita un bloque del formulario. */
export type AttackSlot = 'weapon' | 'ability';

export interface ItemGroup {
  id: string;
  label: string;
  kind: ItemKind;
  category?: WeaponCategory;
  items: ItemDef[];
}

/**
 * La ventana "Objetos y armas": crear y editar la biblioteca del proyecto
 * (items.json). Es el mismo trato que "Configurar personajes": a la izquierda
 * lo guardado por tipo, a la derecha el borrador.
 *
 * Es un controlador y no un componente: el markup vive en app.html para usar
 * los estilos de App (ver el comentario de cabecera de app.ts). Se crea como
 * campo de App, dentro de su contexto de inyeccion.
 */
export class ItemEditorController {
  private readonly library = inject(ItemLibraryService);
  private readonly project = inject(ProjectService);
  private readonly levels = inject(LevelService);

  readonly state = signal<{ draft: ItemDef; savedId: string | null } | null>(null);

  readonly kinds = ITEM_KINDS;
  readonly patterns = ATTACK_PATTERNS;
  readonly meleePatterns = ATTACK_PATTERNS.filter((pattern) => pattern.category === 'melee');
  readonly rangedPatterns = ATTACK_PATTERNS.filter((pattern) => pattern.category === 'ranged');

  readonly groups = computed<ItemGroup[]>(() => {
    const items = this.library.items();
    const weapons = items.filter((item) => item.kind === 'weapon');
    return [
      {
        id: 'melee',
        label: 'Armas cuerpo a cuerpo',
        kind: 'weapon',
        category: 'melee',
        items: weapons.filter((item) => item.weapon?.category !== 'ranged'),
      },
      {
        id: 'ranged',
        label: 'Armas a distancia',
        kind: 'weapon',
        category: 'ranged',
        items: weapons.filter((item) => item.weapon?.category === 'ranged'),
      },
      { id: 'healing', label: 'Curación', kind: 'healing', items: items.filter((item) => item.kind === 'healing') },
      { id: 'coin', label: 'Monedas', kind: 'coin', items: items.filter((item) => item.kind === 'coin') },
    ];
  });

  /** Los bloques de ataque del borrador: el del arma y, si tiene, el de su habilidad. */
  readonly attackSlots = computed(() => {
    const weapon = this.state()?.draft.weapon;
    if (!weapon) {
      return [];
    }
    const slots: { slot: AttackSlot; label: string; attack: AttackDef }[] = [
      { slot: 'weapon', label: 'Ataque', attack: weapon.attack },
    ];
    if (weapon.ability) {
      slots.push({ slot: 'ability', label: 'Ataque de la habilidad', attack: weapon.ability.attack });
    }
    return slots;
  });

  /** El nivel abierto tiene una copia de este objeto, que se puede poner al dia. */
  readonly definedInLevel = computed(() => {
    const savedId = this.state()?.savedId;
    return !!savedId && (this.levels.level().items ?? []).some((item) => item.id === savedId);
  });

  constructor(
    private readonly note: (message: string) => void,
    private readonly markDirty: () => void,
  ) {}

  open(request: ItemEditorRequest = {}): void {
    if (request.editId) {
      this.edit(request.editId);
    } else if (request.kind) {
      this.create(request.kind, request.category ?? 'melee');
    } else {
      const first = this.library.items()[0];
      if (first) {
        this.edit(first.id);
      } else {
        this.create('weapon', 'melee');
      }
    }
  }

  close(): void {
    this.state.set(null);
  }

  create(kind: ItemKind, category: WeaponCategory = 'melee'): void {
    this.state.set({ draft: newItemDraft(kind, category), savedId: null });
  }

  edit(id: string): void {
    const item = this.library.find(id);
    if (item) {
      // Copia profunda: el borrador no toca la biblioteca hasta Guardar.
      this.state.set({ draft: structuredClone(item), savedId: id });
    }
  }

  private update(change: (draft: ItemDef) => ItemDef): void {
    this.state.update((state) => (state ? { ...state, draft: change(state.draft) } : state));
  }

  setName(name: string): void {
    this.update((draft) => ({ ...draft, name }));
  }

  /** Cambiar de tipo conserva nombre y sprite, y arranca lo propio del tipo nuevo. */
  setKind(value: string): void {
    const kind = ITEM_KINDS.find((def) => def.id === value)?.id;
    if (!kind) {
      return;
    }
    this.update((draft) => {
      const fresh = newItemDraft(kind, draft.weapon?.category ?? 'melee');
      return { ...fresh, id: draft.id, name: draft.name, texture: draft.texture, sourceRect: draft.sourceRect, scale: draft.scale };
    });
  }

  /** Cambiar la categoria propone el ataque tipico de la nueva, si el actual no le corresponde. */
  setCategory(value: string): void {
    if (value !== 'melee' && value !== 'ranged') {
      return;
    }
    this.update((draft) => {
      const weapon = draft.weapon ?? defaultWeapon(value);
      const fits = patternDef(weapon.attack.pattern).category === value;
      return {
        ...draft,
        weapon: { ...weapon, category: value, attack: fits ? weapon.attack : defaultWeapon(value).attack },
      };
    });
  }

  /** Nueva textura: el recorte arranca con la imagen entera, que es lo comun en un objeto. */
  setTexture(name: string, asset?: { width: number; height: number }): void {
    this.update((draft) => ({
      ...draft,
      texture: 'textures/' + name,
      sourceRect:
        asset && asset.width > 0
          ? { x: 0, y: 0, width: asset.width, height: asset.height }
          : draft.sourceRect,
    }));
  }

  patchRect(field: 'x' | 'y' | 'width' | 'height', value: number): void {
    const min = field === 'width' || field === 'height' ? 1 : 0;
    this.update((draft) => ({ ...draft, sourceRect: { ...draft.sourceRect, [field]: Math.max(min, value || 0) } }));
  }

  setScale(value: number): void {
    this.update((draft) => ({ ...draft, scale: value > 0 ? value : 1 }));
  }

  setHeal(value: number): void {
    this.update((draft) => ({ ...draft, heal: Math.max(0, value || 0) }));
  }

  setCoinValue(value: number): void {
    this.update((draft) => ({ ...draft, value: Math.max(1, Math.round(value) || 1) }));
  }

  // --- Ataques ---------------------------------------------------------------

  private setAttack(slot: AttackSlot, change: (attack: AttackDef) => AttackDef): void {
    this.update((draft) => {
      if (!draft.weapon) {
        return draft;
      }
      if (slot === 'weapon') {
        return { ...draft, weapon: { ...draft.weapon, attack: change(draft.weapon.attack) } };
      }
      const ability = draft.weapon.ability;
      return ability
        ? { ...draft, weapon: { ...draft.weapon, ability: { ...ability, attack: change(ability.attack) } } }
        : draft;
    });
  }

  setPattern(slot: AttackSlot, pattern: AttackPattern): void {
    this.setAttack(slot, (attack) => (attack.pattern === pattern ? attack : withPattern(attack, pattern)));
  }

  setDamage(slot: AttackSlot, value: number): void {
    this.setAttack(slot, (attack) => ({ ...attack, damage: Math.max(0, value || 0) }));
  }

  setCooldown(slot: AttackSlot, value: number): void {
    this.setAttack(slot, (attack) => ({ ...attack, cooldown: Math.max(0, value || 0) }));
  }

  setField(slot: AttackSlot, field: Exclude<AttackField, 'pierce'>, value: number): void {
    const limits = ATTACK_FIELDS[field];
    const clamped = Math.min(limits.max ?? Infinity, Math.max(limits.min, Number.isFinite(value) ? value : limits.min));
    this.setAttack(slot, (attack) => ({ ...attack, [field]: clamped }));
  }

  setPierce(slot: AttackSlot, pierce: boolean): void {
    this.setAttack(slot, (attack) => ({ ...attack, pierce: pierce || undefined }));
  }

  /** Los campos numericos de la forma, con su etiqueta. "pierce" va aparte (es una casilla). */
  numericFields(attack: AttackDef): { field: Exclude<AttackField, 'pierce'>; label: string; hint: string; step: number; min: number; max?: number; value: number }[] {
    return patternDef(attack.pattern)
      .fields.filter((field): field is Exclude<AttackField, 'pierce'> => field !== 'pierce')
      .map((field) => ({
        field,
        ...ATTACK_FIELDS[field],
        label: field === 'range' ? rangeLabel(attack.pattern) : ATTACK_FIELDS[field].label,
        value: field === 'range' ? attack.range : (attack[field] ?? 0),
      }));
  }

  usesPierce(attack: AttackDef): boolean {
    return patternDef(attack.pattern).fields.includes('pierce');
  }

  patternHint(attack: AttackDef): string {
    return patternDef(attack.pattern).hint;
  }

  // --- Habilidad -------------------------------------------------------------

  setAbilityEnabled(enabled: boolean): void {
    this.update((draft) => {
      if (!draft.weapon) {
        return draft;
      }
      const { ability: _removed, ...weapon } = draft.weapon;
      return {
        ...draft,
        weapon: enabled ? { ...weapon, ability: defaultAbility(weapon.category) } : weapon,
      };
    });
  }

  patchAbility(changes: Partial<Omit<AbilityDef, 'attack'>>): void {
    this.update((draft) => {
      const ability = draft.weapon?.ability;
      return ability && draft.weapon
        ? { ...draft, weapon: { ...draft.weapon, ability: { ...ability, ...changes } } }
        : draft;
    });
  }

  setHitsRequired(value: number): void {
    this.patchAbility({ hitsRequired: Math.max(1, Math.round(value) || 1) });
  }

  setResetAfter(value: number): void {
    this.patchAbility({ resetAfter: Math.max(0, value || 0) });
  }

  setActivation(value: string): void {
    if (value === 'auto' || value === 'manual') {
      this.patchAbility({ activation: value });
    }
  }

  // --- Guardar ---------------------------------------------------------------

  /**
   * Guarda en items.json. El id sale del nombre la primera vez y ya no cambia:
   * es lo que referencian los niveles.
   */
  async save(): Promise<void> {
    const state = this.state();
    if (!state) {
      return;
    }
    const name = state.draft.name.trim();
    if (!name) {
      this.note('El objeto necesita un nombre.');
      return;
    }
    if (!this.project.projectRoot() && !(await this.project.ensureRoot())) {
      this.note('Abrí una carpeta de proyecto para guardar objetos.');
      return;
    }

    const current = this.library.items();
    const id = state.savedId ?? itemIdFromName(name, current.map((item) => item.id));
    const saved = normalizeItem({ ...state.draft, id, name });
    const list = state.savedId ? current.map((item) => (item.id === id ? saved : item)) : [...current, saved];
    try {
      await this.library.save(list);
      this.state.set({ draft: structuredClone(saved), savedId: id });
      this.note('Objeto "' + name + '" guardado en items.json.');
    } catch (error) {
      this.note('No se pudo guardar el objeto: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  async remove(): Promise<void> {
    const state = this.state();
    if (!state?.savedId) {
      return;
    }
    if (!window.confirm('¿Eliminar "' + state.draft.name + '" de la biblioteca? Los niveles que ya lo usan conservan su copia.')) {
      return;
    }
    const list = this.library.items().filter((item) => item.id !== state.savedId);
    try {
      await this.library.save(list);
    } catch (error) {
      this.note('No se pudo eliminar: ' + (error instanceof Error ? error.message : String(error)));
      return;
    }
    const next = list[0];
    if (next) {
      this.edit(next.id);
    } else {
      this.create(state.draft.kind, state.draft.weapon?.category);
    }
    this.note('Objeto "' + state.draft.name + '" eliminado de la biblioteca.');
  }

  duplicate(): void {
    const state = this.state();
    if (state) {
      this.state.set({ draft: { ...structuredClone(state.draft), id: '', name: state.draft.name + ' (copia)' }, savedId: null });
    }
  }

  /** Pone al dia la copia del nivel abierto con lo guardado en la biblioteca. */
  updateInLevel(): void {
    const savedId = this.state()?.savedId;
    const saved = savedId ? this.library.find(savedId) : undefined;
    if (!saved) {
      return;
    }
    this.levels.upsertItems([saved]);
    this.markDirty();
    this.note('"' + saved.name + '" actualizado en este nivel.');
  }
}
