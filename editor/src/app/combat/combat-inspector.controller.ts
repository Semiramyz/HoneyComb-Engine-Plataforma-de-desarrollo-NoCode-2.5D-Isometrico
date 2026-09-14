import { computed, inject } from '@angular/core';

import { itemKindDef, missingItemIds } from '../core/items';
import {
  DashConfig,
  DefenseConfig,
  DropEntry,
  InventoryConfig,
  ItemDef,
  OnFullInventory,
  ShopEntry,
} from '../models/item.model';
import { LevelEntity } from '../models/level.model';
import { ItemLibraryService } from '../services/item-library.service';
import { LevelService } from '../services/level.service';

/** Valores que usa el motor cuando el nivel no los declara (ver loader/ItemDefs.hpp). */
export const INVENTORY_DEFAULTS: Required<InventoryConfig> = {
  slots: 3,
  locked: false,
  onFull: 'manual_replace',
  items: [],
  coins: 0,
};
export const DASH_DEFAULTS: Required<DashConfig> = { distance: 3, duration: 0.18, cooldown: 0.8, iframes: 0.25 };
export const DEFENSE_DEFAULTS: Required<DefenseConfig> = { reduction: 0.5, speedMultiplier: 0.5 };

export const ON_FULL_OPTIONS: readonly { value: OnFullInventory; label: string; hint: string }[] = [
  { value: 'manual_replace', label: 'Cambiar con E', hint: 'Avisa y cambia el arma activa al apretar E. El arma vieja queda en el piso.' },
  { value: 'auto_replace', label: 'Cambiar automático', hint: 'Al tocar el arma, la cambia sola por la activa. La vieja queda en el piso.' },
  { value: 'block', label: 'Inventario lleno', hint: 'No se puede juntar hasta tener un casillero libre.' },
];

/** Que seccion de combate le corresponde a una entidad en el inspector. */
export type CombatRole = 'player' | 'enemy' | 'npc' | 'item' | 'other';

/**
 * El panel "Combate" del inspector: inventario y movilidad del jugador, arma,
 * jefe y lo que suelta un enemigo, tienda de un NPC, y que objeto es un objeto
 * colocado.
 *
 * Todo lo que elige un objeto lo COPIA al nivel (upsertItems): elegir "Espada"
 * en el inventario del jugador deja la definicion de la espada dentro del
 * nivel, que asi se juega sin la biblioteca. Controlador y no componente por la
 * misma razon que ItemEditorController.
 */
export class CombatInspectorController {
  private readonly levels = inject(LevelService);
  private readonly library = inject(ItemLibraryService);

  readonly onFullOptions = ON_FULL_OPTIONS;

  /**
   * Objetos elegibles: la biblioteca, mas los que el nivel ya define (un nivel
   * abierto sin su proyecto sigue siendo editable). A igual id gana la
   * biblioteca, que es la version que se va a copiar.
   */
  readonly options = computed<ItemDef[]>(() => {
    const byId = new Map<string, ItemDef>();
    for (const item of this.levels.level().items ?? []) {
      byId.set(item.id, item);
    }
    for (const item of this.library.items()) {
      byId.set(item.id, item);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  readonly weaponOptions = computed(() => this.options().filter((item) => item.kind === 'weapon'));

  /** Referencias a objetos que el nivel no define: el motor las ignoraria. */
  readonly missing = computed(() => missingItemIds(this.levels.level()));

  constructor(private readonly markDirty: () => void) {}

  roleOf(entity: LevelEntity): CombatRole {
    if (entity.type === 'player' || entity.type === 'enemy' || entity.type === 'npc' || entity.type === 'item') {
      return entity.type;
    }
    return 'other';
  }

  /** "⚔ Espada", o el id crudo si no esta definido en ningun lado. */
  itemLabel(id: string): string {
    const item = this.options().find((option) => option.id === id);
    return item ? itemKindDef(item.kind).glyph + ' ' + item.name : id + ' (sin definir)';
  }

  private patch(entity: LevelEntity, changes: Partial<LevelEntity>): void {
    this.levels.updateEntity(entity.id, changes);
    this.markDirty();
  }

  /** Copia al nivel la definicion de la biblioteca (si esta alli). */
  use(id: string): void {
    const def = this.library.find(id);
    if (def) {
      this.levels.upsertItems([def]);
    }
  }

  // --- Cualquier entidad -------------------------------------------------------

  setHidden(entity: LevelEntity, hidden: boolean): void {
    this.patch(entity, { hidden: hidden || undefined });
  }

  // --- Objeto colocado ----------------------------------------------------------

  /** Elegir el objeto trae tambien su sprite: la entidad se ve como lo que es. */
  setPickupItem(entity: LevelEntity, id: string): void {
    const def = this.options().find((option) => option.id === id);
    if (!def) {
      return;
    }
    this.use(id);
    this.patch(entity, {
      item: id,
      texture: def.texture,
      sourceRect: { ...def.sourceRect },
      scale: def.scale && def.scale !== 1 ? def.scale : undefined,
    });
  }

  // --- Enemigo -----------------------------------------------------------------

  setBoss(entity: LevelEntity, boss: boolean): void {
    this.patch(entity, { boss: boss || undefined });
  }

  setWeapon(entity: LevelEntity, id: string): void {
    if (id) {
      this.use(id);
    }
    this.patch(entity, { weapon: id || undefined });
  }

  addDrop(entity: LevelEntity): void {
    const first = this.options()[0];
    if (!first) {
      return;
    }
    this.use(first.id);
    this.patch(entity, { drops: [...(entity.drops ?? []), { item: first.id, chance: 0.5 }] });
  }

  setDropItem(entity: LevelEntity, index: number, id: string): void {
    this.use(id);
    this.updateDrop(entity, index, { item: id });
  }

  /** La probabilidad se edita en porcentaje, que es como se piensa ("25%"). */
  setDropPercent(entity: LevelEntity, index: number, percent: number): void {
    this.updateDrop(entity, index, { chance: Math.min(1, Math.max(0, (percent || 0) / 100)) });
  }

  private updateDrop(entity: LevelEntity, index: number, changes: Partial<DropEntry>): void {
    this.patch(entity, {
      drops: (entity.drops ?? []).map((drop, i) => (i === index ? { ...drop, ...changes } : drop)),
    });
  }

  removeDrop(entity: LevelEntity, index: number): void {
    const drops = (entity.drops ?? []).filter((_, i) => i !== index);
    this.patch(entity, { drops: drops.length ? drops : undefined });
  }

  percent(chance: number): number {
    return Math.round(chance * 100);
  }

  // --- Jugador: inventario ------------------------------------------------------

  inventoryOf(entity: LevelEntity): Required<InventoryConfig> {
    return { ...INVENTORY_DEFAULTS, ...entity.inventory, items: entity.inventory?.items ?? [] };
  }

  patchInventory(entity: LevelEntity, changes: Partial<InventoryConfig>): void {
    const next = { ...this.inventoryOf(entity), ...changes };
    next.slots = Math.min(9, Math.max(1, Math.round(next.slots) || 1));
    next.coins = Math.max(0, Math.round(next.coins) || 0);
    this.patch(entity, { inventory: next });
  }

  addStartItem(entity: LevelEntity, id: string): void {
    const inventory = this.inventoryOf(entity);
    if (!id || inventory.items.includes(id)) {
      return;
    }
    this.use(id);
    this.patchInventory(entity, { items: [...inventory.items, id] });
  }

  removeStartItem(entity: LevelEntity, index: number): void {
    const inventory = this.inventoryOf(entity);
    this.patchInventory(entity, { items: inventory.items.filter((_, i) => i !== index) });
  }

  onFullHint(value: OnFullInventory): string {
    return ON_FULL_OPTIONS.find((option) => option.value === value)?.hint ?? '';
  }

  // --- Jugador: movilidad -------------------------------------------------------

  dashOf(entity: LevelEntity): Required<DashConfig> | null {
    return entity.mobility?.dash ? { ...DASH_DEFAULTS, ...entity.mobility.dash } : null;
  }

  defenseOf(entity: LevelEntity): Required<DefenseConfig> | null {
    return entity.mobility?.defense ? { ...DEFENSE_DEFAULTS, ...entity.mobility.defense } : null;
  }

  private patchMobility(entity: LevelEntity, dash: DashConfig | undefined, defense: DefenseConfig | undefined): void {
    this.patch(entity, { mobility: dash || defense ? { dash, defense } : undefined });
  }

  setDashEnabled(entity: LevelEntity, enabled: boolean): void {
    this.patchMobility(entity, enabled ? { ...DASH_DEFAULTS } : undefined, entity.mobility?.defense);
  }

  patchDash(entity: LevelEntity, field: keyof DashConfig, value: number): void {
    const dash = this.dashOf(entity);
    if (!dash) {
      return;
    }
    const min = field === 'distance' || field === 'duration' ? 0.05 : 0;
    this.patchMobility(entity, { ...dash, [field]: Math.max(min, value || 0) }, entity.mobility?.defense);
  }

  setDefenseEnabled(entity: LevelEntity, enabled: boolean): void {
    this.patchMobility(entity, entity.mobility?.dash, enabled ? { ...DEFENSE_DEFAULTS } : undefined);
  }

  /** Los dos valores de la defensa se editan en porcentaje. */
  patchDefensePercent(entity: LevelEntity, field: keyof DefenseConfig, percent: number): void {
    const defense = this.defenseOf(entity);
    if (!defense) {
      return;
    }
    const value = Math.min(1, Math.max(0, (percent || 0) / 100));
    this.patchMobility(entity, entity.mobility?.dash, { ...defense, [field]: value });
  }

  // --- NPC: tienda ----------------------------------------------------------------

  shopOf(entity: LevelEntity): ShopEntry[] {
    return entity.shop?.items ?? [];
  }

  addShopItem(entity: LevelEntity): void {
    const first = this.options()[0];
    if (!first) {
      return;
    }
    this.use(first.id);
    this.patch(entity, { shop: { items: [...this.shopOf(entity), { item: first.id, price: 5 }] } });
  }

  setShopItem(entity: LevelEntity, index: number, changes: Partial<ShopEntry>): void {
    if (changes.item) {
      this.use(changes.item);
    }
    const items = this.shopOf(entity).map((entry, i) =>
      i === index ? { ...entry, ...changes, price: Math.max(0, Math.round(changes.price ?? entry.price) || 0) } : entry,
    );
    this.patch(entity, { shop: { items } });
  }

  removeShopItem(entity: LevelEntity, index: number): void {
    const items = this.shopOf(entity).filter((_, i) => i !== index);
    this.patch(entity, { shop: items.length ? { items } : undefined });
  }
}
