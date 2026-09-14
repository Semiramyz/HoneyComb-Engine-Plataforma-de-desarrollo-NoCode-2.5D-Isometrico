import { PuzzleDraft, buildPuzzle, puzzleFlag, validatePuzzle } from './puzzles';

const base: PuzzleDraft = {
  kind: 'clear_zone',
  zone: 'sala_2',
  boss: '',
  item: '',
  count: 0,
  gates: ['puerta_1', 'puerta_2'],
  lockOnEnter: true,
  message: '¡Sala despejada!',
};

describe('buildPuzzle', () => {
  it('limpiar la zona cerrando al entrar: dos eventos y puertas ocultas de entrada', () => {
    const plan = buildPuzzle(base);
    const flag = 'puzzle_sala_2_resuelto';
    expect(plan.flag).toBe(flag);
    expect(plan.events).toEqual([
      {
        trigger: { type: 'on_player_enter_zone', params: { zone: 'sala_2' } },
        conditions: [{ type: 'flag_is_not_set', params: { flag } }],
        actions: [
          { type: 'show_entity', params: { entity: 'puerta_1' } },
          { type: 'show_entity', params: { entity: 'puerta_2' } },
        ],
      },
      {
        trigger: { type: 'on_zone_cleared', params: { zone: 'sala_2' } },
        actions: [
          { type: 'hide_entity', params: { entity: 'puerta_1' } },
          { type: 'hide_entity', params: { entity: 'puerta_2' } },
          { type: 'set_flag', params: { flag } },
          { type: 'show_message', params: { text: '¡Sala despejada!' } },
        ],
      },
    ]);
    expect(plan.entityChanges).toEqual([
      { id: 'puerta_1', changes: { hidden: true } },
      { id: 'puerta_2', changes: { hidden: true } },
    ]);
  });

  it('jefe sin cerrar al entrar: las puertas bloquean desde el principio y el enemigo queda como jefe', () => {
    const plan = buildPuzzle({ ...base, kind: 'boss', boss: 'enemy_3', lockOnEnter: false, message: '  ' });
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0].trigger).toEqual({ type: 'on_entity_destroyed', params: { entity: 'enemy_3' } });
    expect(plan.events[0].actions.some((action) => action.type === 'show_message')).toBe(false);
    expect(plan.entityChanges).toContainEqual({ id: 'puerta_1', changes: { hidden: undefined } });
    expect(plan.entityChanges).toContainEqual({ id: 'enemy_3', changes: { boss: true } });
  });

  it('recoleccion: objeto y cantidad entera en el trigger', () => {
    const plan = buildPuzzle({ ...base, kind: 'collect', item: 'gema', count: 2.6, lockOnEnter: false });
    expect(plan.events[0].trigger).toEqual({ type: 'on_items_collected', params: { item: 'gema', count: 3 } });
  });
});

describe('validatePuzzle', () => {
  it('pide lo que falta', () => {
    expect(validatePuzzle({ ...base, zone: '' })).toContain('sala o zona');
    expect(validatePuzzle({ ...base, kind: 'boss', boss: '' })).toContain('jefe');
    expect(validatePuzzle({ ...base, kind: 'collect', zone: '', lockOnEnter: true })).toContain('cerrar las puertas');
    expect(validatePuzzle({ ...base, gates: [] })).toContain('bloquee el paso');
    expect(validatePuzzle(base)).toBeNull();
  });
});

describe('puzzleFlag', () => {
  it('sin zona usa lo que se resuelve', () => {
    expect(puzzleFlag({ ...base, zone: '', kind: 'boss', boss: 'rey-goblin' })).toBe('puzzle_rey_goblin_resuelto');
  });
});
