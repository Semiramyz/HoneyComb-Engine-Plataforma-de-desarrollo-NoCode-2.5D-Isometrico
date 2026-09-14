import { CharacterPreset } from '../models/character-preset.model';
import {
  CHARACTERS,
  entityFromPreset,
  normalizePreset,
  presetFromArchetype,
  presetIdFromName,
} from './characters';

const goblin: CharacterPreset = {
  id: 'goblin',
  name: 'Goblin',
  kind: 'enemy',
  texture: 'textures/goblin.png',
  sourceRect: { x: 0, y: 0, width: 32, height: 32 },
  frames: 4,
  frameDuration: 0.1,
  scale: 2,
  collider: { width: 40, height: 40 },
  stats: { health: 50, damage: 7, speed: 2 },
};

describe('entityFromPreset', () => {
  it('copia los valores del personaje a una entidad del nivel', () => {
    const entity = entityFromPreset(goblin, { col: 3, row: 4 }, new Set());
    expect(entity).toEqual({
      id: 'goblin_1',
      type: 'enemy',
      preset: 'goblin',
      position: { col: 3, row: 4 },
      texture: 'textures/goblin.png',
      sourceRect: { x: 0, y: 0, width: 32, height: 32 },
      collider: { width: 40, height: 40 },
      stats: { health: 50, damage: 7, speed: 2 },
      frames: 4,
      frameDuration: 0.1,
      scale: 2,
    });
  });

  it('no escribe lo que ya es el default: un cuadro y escala 1', () => {
    const still = { ...goblin, frames: 1, scale: 1 };
    const entity = entityFromPreset(still, { col: 0, row: 0 }, new Set());
    expect('frames' in entity).toBe(false);
    expect('scale' in entity).toBe(false);
  });

  it('el primer jugador se queda con el id que mueve el motor', () => {
    const player = presetFromArchetype(CHARACTERS[0]);
    expect(entityFromPreset(player, { col: 0, row: 0 }, new Set()).id).toBe('player_1');
    expect(entityFromPreset(player, { col: 0, row: 0 }, new Set(['player_1'])).id).toBe('player_2');
  });

  it('un tipo base no deja referencia a ningun personaje guardado', () => {
    const base = presetFromArchetype(CHARACTERS[1]);
    expect('preset' in entityFromPreset(base, { col: 0, row: 0 }, new Set())).toBe(false);
  });

  it('no repite ids ya usados en el nivel', () => {
    expect(entityFromPreset(goblin, { col: 0, row: 0 }, new Set(['goblin_1'])).id).toBe('goblin_2');
  });
});

describe('presetIdFromName', () => {
  it('queda legible, sin tildes ni espacios', () => {
    expect(presetIdFromName('Esqueleto Rápido', [])).toBe('esqueleto_rapido');
  });

  it('agrega un numero si el nombre ya se uso', () => {
    expect(presetIdFromName('Goblin', ['goblin', 'goblin_2'])).toBe('goblin_3');
  });

  it('un nombre sin letras ni numeros no deja un id vacio', () => {
    expect(presetIdFromName('¡¡!!', [])).toBe('personaje');
  });
});

describe('normalizePreset', () => {
  it('completa lo que falta con los valores de su tipo', () => {
    const preset = normalizePreset({ id: 'x', name: 'X', kind: 'enemy' });
    expect(preset.stats).toEqual({ health: 30, damage: 10, speed: 1.5 });
    expect(preset.frames).toBe(1);
    expect(preset.scale).toBe(1);
  });

  it('lleva los numeros a rangos validos', () => {
    const preset = normalizePreset({
      id: 'x',
      name: 'X',
      kind: 'player',
      frames: 0,
      scale: -3,
      sourceRect: { x: -5, y: 0, width: 0, height: 20 },
      stats: { health: -1, damage: 3, speed: 2 },
    });
    expect(preset.frames).toBe(1);
    expect(preset.scale).toBe(0.1);
    expect(preset.sourceRect).toEqual({ x: 0, y: 0, width: 1, height: 20 });
    expect(preset.stats.health).toBe(0);
  });

  it('un tipo desconocido cae en enemigo en vez de romper', () => {
    expect(normalizePreset({ id: 'x', name: 'X', kind: 'dragon' }).kind).toBe('enemy');
  });
});
