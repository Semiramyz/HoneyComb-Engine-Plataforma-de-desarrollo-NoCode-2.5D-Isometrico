#pragma once

#include <string>
#include <unordered_map>
#include <vector>

#include "raylib.h"

// Datos del sistema de combate, objetos e inventario tal como vienen del nivel
// (ver "items", "inventory", "mobility", "drops" y "shop" en
// schema/level.schema.json). Son estructuras planas, sin logica: las reglas
// que las usan viven en la Capa 4 (game/Combat, game/Inventory, game/Loot,
// game/Mobility). Estan en loader/ y no en game/ por la misma razon que
// LevelEntity: el loader las arma, y el loader no puede depender del juego.
//
// Todas las medidas de distancia van en CELDAS de grilla, igual que
// LevelEntity::precisePosition.

// La forma de un ataque. Las tres primeras son de cuerpo a cuerpo, las otras
// tres a distancia, pero cualquier arma puede usar cualquiera: la categoria
// del arma solo cambia como se mueve un enemigo que la lleva.
enum class AttackPattern {
    Line,        // golpe lineal hacia donde se apunta
    Area,        // todo alrededor de quien ataca
    Cone,        // sector de reloj de "angle" grados hacia donde se apunta
    Projectile,  // proyectil en linea recta; golpea al primero que toca
    RemoteArea,  // efecto en el punto apuntado, tras "delay" segundos
    Explosive,   // proyectil que explota con radio "radius"
};

struct AttackDef {
    AttackPattern pattern = AttackPattern::Area;
    float damage = 10.0f;
    float cooldown = 0.4f;
    float range = 1.5f;
    float width = 0.8f;
    float angle = 90.0f;   // grados
    float radius = 1.5f;
    float speed = 8.0f;    // celdas por segundo
    float delay = 0.4f;    // segundos
    bool pierce = false;
    float heal = 0.0f;     // vida para quien ataca si queda dentro del area
};

// Habilidad que se carga acertando golpes con el arma.
struct AbilityDef {
    std::string name;
    int hitsRequired = 3;
    bool manual = false;       // false = sale sola en el ataque siguiente
    float resetAfter = 0.0f;   // segundos sin acertar que vacian el contador; 0 = nunca
    AttackDef attack;
};

enum class WeaponCategory { Melee, Ranged };

struct WeaponDef {
    WeaponCategory category = WeaponCategory::Melee;
    AttackDef attack;
    bool hasAbility = false;
    AbilityDef ability;
};

enum class ItemKind { Weapon, Healing, Coin };

struct ItemDef {
    std::string id;
    std::string name;
    ItemKind kind = ItemKind::Coin;
    // Apunta a la cache del ResourceManager, que vive toda la ejecucion: por
    // eso un arma puede pasar de un nivel a otro dentro del inventario sin que
    // el puntero quede colgando.
    const Texture2D* texture = nullptr;
    Rectangle sourceRect{0, 0, 16, 16};
    float scale = 1.0f;
    WeaponDef weapon;   // solo kind Weapon
    float heal = 0.0f;  // solo kind Healing
    int value = 1;      // solo kind Coin
};

using ItemCatalog = std::unordered_map<std::string, ItemDef>;

// Estado EN EJECUCION del contador de una habilidad. No viene del JSON: lo
// lleva cada casillero del inventario del jugador, y cada enemigo armado.
struct ComboState {
    int hits = 0;         // golpes acertados desde la ultima habilidad
    float idle = 0.0f;    // segundos desde el ultimo golpe acertado
};

enum class OnFullInventory { AutoReplace, ManualReplace, Block };

struct InventoryConfig {
    bool present = false;  // el nivel declara el bloque "inventory"
    int slots = 3;
    bool locked = false;
    OnFullInventory onFull = OnFullInventory::ManualReplace;
    std::vector<std::string> items;
    int coins = 0;
};

struct DashConfig {
    bool enabled = false;
    float distance = 3.0f;
    float duration = 0.18f;
    float cooldown = 0.8f;
    float iframes = 0.25f;
};

struct DefenseConfig {
    bool enabled = false;
    float reduction = 0.5f;
    float speedMultiplier = 0.5f;
};

struct DropEntry {
    std::string item;
    float chance = 0.0f;
};

struct ShopEntry {
    std::string item;
    int price = 0;
};

// Rectangulo de celdas con nombre. Salen de "zones" y tambien de "rooms".
struct Zone {
    std::string id;
    int col = 0;
    int row = 0;
    int width = 1;
    int height = 1;
};
