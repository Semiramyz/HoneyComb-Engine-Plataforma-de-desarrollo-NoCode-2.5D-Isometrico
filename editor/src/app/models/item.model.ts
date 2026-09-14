// Espejo en TypeScript de las definiciones de combate y objetos de
// schema/level.schema.json ("items" y los bloques "inventory", "mobility",
// "drops" y "shop" de una entidad). Del lado del motor los lee
// engine/loader/ItemLoader.cpp; un campo nuevo va en los tres lugares.
//
// Todas las distancias van en CELDAS de grilla, desde el centro de quien ataca.

/** Lo que pasa al juntar el objeto: un arma va al inventario, una curacion cura, una moneda suma. */
export type ItemKind = 'weapon' | 'healing' | 'coin';

/** Cuerpo a cuerpo o a distancia. Ordena el editor y cambia como se mueve un enemigo que la lleva. */
export type WeaponCategory = 'melee' | 'ranged';

/**
 * Forma del ataque:
 *   line         golpe lineal hacia donde se apunta
 *   area         todo alrededor de quien ataca
 *   cone         sector de reloj de "angle" grados hacia donde se apunta
 *   projectile   proyectil en linea recta; golpea al primero que toca
 *   remote_area  efecto en el punto apuntado (hasta "range") tras "delay" segundos
 *   explosive    proyectil que explota con radio "radius"
 */
export type AttackPattern = 'line' | 'area' | 'cone' | 'projectile' | 'remote_area' | 'explosive';

export interface AttackDef {
  pattern: AttackPattern;
  damage: number;
  /** Segundos entre dos ataques. */
  cooldown: number;
  /** line/cone: largo. area: radio. projectile/explosive: distancia maxima. remote_area: alcance maximo. */
  range: number;
  /** line: ancho del golpe. projectile/explosive: ancho del proyectil. */
  width?: number;
  /** cone: apertura en grados. */
  angle?: number;
  /** remote_area/explosive: radio del efecto. */
  radius?: number;
  /** projectile/explosive: celdas por segundo. */
  speed?: number;
  /** remote_area: segundos hasta que cae. */
  delay?: number;
  /** projectile: atraviesa a los que golpea. */
  pierce?: boolean;
  /** Vida para quien ataca si queda dentro del efecto (area, remote_area, explosive). */
  heal?: number;
}

/** Habilidad que se carga acertando golpes con el arma. */
export interface AbilityDef {
  name?: string;
  hitsRequired: number;
  /** auto = sale sola en el ataque siguiente. manual = con la tecla Q. */
  activation?: 'auto' | 'manual';
  /** Segundos sin acertar que vacian el contador. 0 o ausente = nunca. */
  resetAfter?: number;
  attack: AttackDef;
}

export interface WeaponDef {
  category: WeaponCategory;
  attack: AttackDef;
  ability?: AbilityDef;
}

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  /** Ruta relativa a assets/: el sprite en el piso y en el inventario. */
  texture: string;
  sourceRect: { x: number; y: number; width: number; height: number };
  scale?: number;
  /** Solo kind weapon. */
  weapon?: WeaponDef;
  /** Solo kind healing: vida que devuelve. */
  heal?: number;
  /** Solo kind coin: monedas que suma. */
  value?: number;
}

/** Que pasa al tocar un arma con el inventario lleno. */
export type OnFullInventory = 'auto_replace' | 'manual_replace' | 'block';

/** Jugador: el inventario de armas (teclas 1 a 9 en el juego). */
export interface InventoryConfig {
  /** Limite de armas, de 1 a 9. */
  slots?: number;
  /** El limite queda fijo: los eventos no lo cambian. */
  locked?: boolean;
  onFull?: OnFullInventory;
  /** Armas con las que arranca, por id. */
  items?: string[];
  coins?: number;
}

export interface DashConfig {
  distance?: number;
  duration?: number;
  cooldown?: number;
  /** Segundos de invulnerabilidad desde que empieza. */
  iframes?: number;
}

export interface DefenseConfig {
  /** Parte del dano que se evita, de 0 a 1. */
  reduction?: number;
  /** Velocidad mientras defiende, de 0 a 1. */
  speedMultiplier?: number;
}

/** Jugador: esquive y defensa. Sin cada parte, esa accion no esta disponible. */
export interface MobilityConfig {
  dash?: DashConfig;
  defense?: DefenseConfig;
}

/** Enemigo: algo que puede soltar al caer, con probabilidad de 0 a 1. */
export interface DropEntry {
  item: string;
  chance: number;
}

/** NPC: un objeto de su tienda y cuantas monedas cuesta. */
export interface ShopEntry {
  item: string;
  price: number;
}

export interface ShopConfig {
  items: ShopEntry[];
}
