import { computed, inject, signal } from '@angular/core';

import { PUZZLE_KINDS, PuzzleDraft, PuzzleKind, buildPuzzle, validatePuzzle } from '../core/puzzles';
import { ItemLibraryService } from '../services/item-library.service';
import { LevelService } from '../services/level.service';

const CHARACTER_TYPES = new Set(['player', 'enemy', 'npc', 'item']);

/**
 * El dialogo "Puzzle de sala": elegir que hay que resolver, en que sala, y que
 * entidades bloquean el paso hasta entonces. Arma los eventos con
 * core/puzzles.ts y los deja en el panel Eventos, donde se pueden ajustar.
 *
 * Controlador y no componente por la misma razon que ItemEditorController.
 */
export class PuzzleController {
  private readonly levels = inject(LevelService);
  private readonly library = inject(ItemLibraryService);

  readonly draft = signal<PuzzleDraft | null>(null);
  readonly kinds = PUZZLE_KINDS;

  /** Salas del mapa y zonas sueltas: el motor usa las dos como zonas. */
  readonly zoneIds = computed(() => [
    ...(this.levels.level().rooms ?? []).map((room) => room.id),
    ...(this.levels.level().zones ?? []).map((zone) => zone.id),
  ]);

  readonly enemies = computed(() => this.levels.level().entities.filter((entity) => entity.type === 'enemy'));

  /** Lo que puede hacer de puerta: cualquier cosa que no sea un personaje ni un objeto. */
  readonly gateCandidates = computed(() =>
    this.levels.level().entities.filter((entity) => !CHARACTER_TYPES.has(entity.type)),
  );

  readonly error = computed(() => {
    const draft = this.draft();
    return draft ? validatePuzzle(draft) : null;
  });

  readonly kindHint = computed(() => {
    const kind = this.draft()?.kind;
    return PUZZLE_KINDS.find((def) => def.id === kind)?.hint ?? '';
  });

  constructor(
    private readonly note: (message: string) => void,
    private readonly markDirty: () => void,
    private readonly showEvents: () => void,
  ) {}

  /** Propone lo mas probable: limpiar la primera sala, con las puertas cerrandose al entrar. */
  open(): void {
    const zone = this.zoneIds()[0] ?? '';
    const enemies = this.enemies();
    this.draft.set({
      kind: enemies.length > 0 ? 'clear_zone' : 'collect',
      zone,
      boss: enemies.find((enemy) => enemy.boss)?.id ?? enemies[0]?.id ?? '',
      item: '',
      count: 0,
      gates: [],
      lockOnEnter: zone !== '',
      message: '¡El paso está libre!',
    });
  }

  cancel(): void {
    this.draft.set(null);
  }

  patch(changes: Partial<PuzzleDraft>): void {
    this.draft.update((draft) => (draft ? { ...draft, ...changes } : draft));
  }

  setKind(value: string): void {
    const kind = PUZZLE_KINDS.find((def) => def.id === value)?.id as PuzzleKind | undefined;
    if (kind) {
      this.patch({ kind });
    }
  }

  toggleGate(id: string, checked: boolean): void {
    this.draft.update((draft) => {
      if (!draft) {
        return draft;
      }
      const gates = checked ? [...new Set([...draft.gates, id])] : draft.gates.filter((gate) => gate !== id);
      return { ...draft, gates };
    });
  }

  confirm(): void {
    const draft = this.draft();
    if (!draft) {
      return;
    }
    const error = validatePuzzle(draft);
    if (error) {
      this.note(error);
      return;
    }
    const plan = buildPuzzle(draft);
    if (draft.kind === 'collect' && draft.item) {
      const def = this.library.find(draft.item);
      if (def) {
        this.levels.upsertItems([def]);
      }
    }
    this.levels.applyEntityChanges(plan.entityChanges);
    this.levels.addEvents(plan.events);
    this.draft.set(null);
    this.markDirty();
    this.showEvents();
    this.note(
      'Puzzle creado: ' + plan.events.length + (plan.events.length === 1 ? ' evento' : ' eventos') +
        ' y ' + draft.gates.length + (draft.gates.length === 1 ? ' puerta.' : ' puertas.'),
    );
  }
}
