#pragma once

#include <random>
#include <string>
#include <unordered_map>
#include <vector>

#include "raylib.h"

#include "game/Inventory.hpp"
#include "loader/LevelLoader.hpp"

// Un objeto tirado en el piso EN EJECUCION: lo que solto un enemigo o el arma
// que se cambio por otra. No es una LevelEntity porque aparece con el juego
// andando, y agregar al vector de entidades invalidaria los punteros de
// entityById (ver main.cpp).
struct GroundItem {
    ItemDef item;
    Vector2 position{0, 0};
    // El arma que el jugador acaba de soltar cae a sus pies: sin esto la
    // volveria a juntar en el mismo frame. Espera a que se aleje.
    bool waitForExit = false;
    float age = 0.0f;
};

// Objetos del juego: juntarlos (colocados en el nivel o tirados en el piso), lo
// que sueltan los enemigos al caer, y la tienda de los NPC.
namespace Loot {

constexpr float kPickupRadius = 0.7f;  // celdas entre el jugador y el objeto para juntarlo
constexpr float kShopRange = 1.6f;     // celdas entre el jugador y el NPC para abrir su tienda

struct State {
    std::vector<GroundItem> ground;
    // Cuantos se juntaron de cada objeto en este nivel: "Al juntar objetos".
    std::unordered_map<std::string, int> collected;
    int collectedTotal = 0;
    std::mt19937 rng{std::random_device{}()};

    void ClearLevel();
};

enum class GiveResult {
    Taken,         // lo tiene: arma al inventario, vida o monedas sumadas
    Rejected,      // no se puede: ya la tiene, vida llena o inventario bloqueado
    NeedsConfirm,  // inventario lleno con cambio manual: falta apretar E
};

// Le da un objeto al jugador. "confirmReplace" es la respuesta a "¿cambiar el
// arma activa?" (apreto E, o viene de una compra o de un evento). Un arma que
// sale del inventario se agrega a "drops" a los pies del jugador. "message"
// dice que paso, para mostrarlo.
GiveResult Give(const ItemDef& item, LevelEntity& player, Inventory& inventory, std::vector<GroundItem>& drops,
                bool confirmReplace, std::string& message);

struct PickupFrame {
    std::vector<std::string> collectedEntities;  // objetos colocados que se juntaron
    std::string prompt;   // aviso mientras esta parado sobre algo que no junta
    std::string message;  // lo que junto este frame
};

// Junta lo que el jugador esta tocando: objetos colocados ("item") y objetos
// del piso. Un objeto colocado juntado queda destruido.
PickupFrame UpdatePickups(LoadedLevel& level, LevelEntity& player, Inventory& inventory, State& state,
                          bool interactPressed, float deltaTime);

// Sortea lo que suelta un enemigo al caer ("drops") y lo deja en el piso.
void RollDrops(const LoadedLevel& level, const LevelEntity& enemy, State& state);

// Deja objetos en el piso en un punto (las armas que no entran al achicar el inventario).
void DropItems(State& state, const std::vector<ItemDef>& items, Vector2 position);

// El NPC con tienda mas cercano al alcance del jugador, o nullptr.
LevelEntity* NearbyShop(LoadedLevel& level, const LevelEntity& player);

// Compra el objeto "index" de la tienda del NPC. Devuelve el mensaje a mostrar.
std::string Buy(const LoadedLevel& level, const LevelEntity& npc, int index, LevelEntity& player,
                Inventory& inventory, State& state);

}  // namespace Loot
