#pragma once

#include <string>
#include <vector>

#include "raylib.h"

#include "game/Inventory.hpp"
#include "loader/LevelLoader.hpp"

// Combate entre el jugador y los enemigos (type "enemy").
//
// QUE HACE, frame a frame:
//   - El jugador ataca con el arma activa de su inventario hacia donde apunta
//     el mouse. Sin armas pega con las manos: un golpe alrededor con su
//     "stats.damage", que es el combate de siempre.
//   - Cada arma tiene un ataque (AttackDef) con una de seis formas: linea,
//     area alrededor, sector de reloj, proyectil, area remota y proyectil
//     explosivo. Las medidas van en celdas.
//   - Cada ataque que acierta suma uno al contador de la habilidad del arma.
//     Llena, la habilidad sale sola en el ataque siguiente o con la tecla Q.
//   - Un enemigo persigue al jugador si lo tiene a la vista (kEnemyAggroRange).
//     Con arma ("weapon") le ataca con ella al tenerlo a su alcance; sin arma
//     le pega por contacto, con una pausa entre golpes.
//   - Defender reduce el dano recibido; los i-frames del esquive lo anulan.
//   - Un enemigo sin vida queda destruido (y dispara "Al eliminar una
//     entidad"); un jugador sin vida marca el nivel como perdido.
//
// Vida, dano y velocidad salen de "stats"; armas, habilidades y defensa, de
// "items" y de los bloques de cada entidad (ver loader/ItemDefs.hpp).
namespace Combat {

constexpr float kEnemyAggroRange = 6.0f;      // celdas: mas lejos, el enemigo no persigue
constexpr float kEnemyContactRange = 0.9f;    // celdas: a esta distancia el enemigo pega sin arma
constexpr float kEnemyAttackCooldown = 1.0f;  // segundos entre golpes por contacto
constexpr float kHurtFlash = 0.25f;           // segundos en rojo al recibir un golpe
constexpr float kSwingDuration = 0.15f;       // segundos que se ve un golpe cuerpo a cuerpo

bool IsEnemy(const LevelEntity& entity);
// Sigue en el nivel y no esta oculta: puede pelear, bloquear y ser golpeada.
bool IsActive(const LevelEntity& entity);

// El golpe sin arma: alrededor, con el dano propio de la entidad.
AttackDef UnarmedAttack(const LevelEntity& attacker);

enum class Faction { Player, Enemy };

struct Projectile {
    AttackDef attack;
    Faction faction = Faction::Player;
    LevelEntity* owner = nullptr;
    std::string weaponId;  // arma que lo lanzo, para sumar a su contador
    bool ability = false;  // una habilidad no carga el contador
    Vector2 position{0, 0};
    Vector2 direction{1, 0};
    float traveled = 0.0f;
    bool credited = false;
    std::vector<const LevelEntity*> alreadyHit;  // con pierce, no golpear dos veces al mismo
};

// Un area remota lanzada que todavia no cayo.
struct PendingArea {
    AttackDef attack;
    Faction faction = Faction::Player;
    LevelEntity* owner = nullptr;
    std::string weaponId;
    bool ability = false;
    Vector2 center{0, 0};
    float remaining = 0.0f;
};

// Algo para dibujar un instante: el golpe, la marca de un area que va a caer,
// una explosion. Solo lo usa CombatView; la logica ya se resolvio.
enum class EffectShape { Line, Circle, Cone };

struct Effect {
    EffectShape shape = EffectShape::Circle;
    Faction faction = Faction::Player;
    bool ability = false;
    bool telegraph = false;  // aviso de un area que todavia no cayo
    Vector2 origin{0, 0};    // Circle: su centro
    Vector2 direction{1, 0};
    float length = 1.0f;     // Line/Cone: largo. Circle: radio
    float width = 0.8f;
    float angle = 90.0f;
    float remaining = 0.0f;
    float duration = 0.0f;
};

// Lo que el combate lleva de un frame al siguiente. Se vacia al cargar un nivel:
// los punteros a entidades de adentro son del nivel anterior.
struct State {
    std::vector<Projectile> projectiles;
    std::vector<PendingArea> pendingAreas;
    std::vector<Effect> effects;
    Vector2 playerFacing{1, 0};

    void Clear();
};

// Lo que el jugador quiere hacer este frame, ya traducido del teclado y mouse.
struct PlayerIntent {
    Vector2 aim{0, 0};           // punto apuntado, en celdas
    bool attack = false;         // apreto atacar
    bool ability = false;        // apreto la tecla de habilidad
    bool defending = false;
    bool invulnerable = false;   // i-frames del esquive
    float defenseReduction = 0.0f;
};

struct FrameResult {
    std::vector<LevelEntity*> defeated;       // enemigos que cayeron en este frame
    std::vector<std::string> abilitiesUsed;   // armas cuyo jugador lanzo la habilidad
    bool playerDefeated = false;
};

// Avanza un frame: pausas y destellos, ataque del jugador, proyectiles y areas
// en curso, persecucion y ataques de los enemigos.
FrameResult Update(LoadedLevel& level, State& state, LevelEntity* player, Inventory& inventory,
                   const PlayerIntent& intent, float deltaTime);

}  // namespace Combat
