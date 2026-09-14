#pragma once

#include <functional>
#include <string>

#include "raylib.h"

#include "core/GraphicsDevice.hpp"
#include "game/Combat.hpp"
#include "game/Inventory.hpp"
#include "game/Loot.hpp"
#include "game/Mobility.hpp"
#include "systems/z_sort/ZSortSystem.hpp"

// Todo lo que se DIBUJA del combate y los objetos: golpes, marcas de areas,
// proyectiles, objetos en el piso, HUD de inventario y tienda. La logica ya se
// resolvio en Combat, Loot y Mobility; aca solo se mira su estado.
//
// Las formas se calculan en celdas y se proyectan punto por punto con
// "toScreen" (la misma proyeccion con camara que usa main.cpp para todo), asi
// un circulo de golpe se ve como la elipse que le corresponde en isometrico.
namespace CombatView {

using ToScreen = std::function<Vector2(Vector2)>;

// Los objetos del piso van al ZSort como cualquier sprite: se tapan con las
// paredes y los personajes segun su profundidad.
void SubmitGroundItems(ZSortSystem& zsort, const Loot::State& loot, const ToScreen& toScreen, float time);

// Golpes, areas y explosiones (despues del Flush del ZSort, encima de la escena).
void DrawEffects(const Combat::State& state, const ToScreen& toScreen);
void DrawProjectiles(const Combat::State& state, const ToScreen& toScreen);

struct Hud {
    const LevelEntity* player = nullptr;
    const Inventory* inventory = nullptr;
    const Mobility::State* mobility = nullptr;
    const LevelEntity* boss = nullptr;  // el primer jefe en pie, o nullptr
    std::string prompt;
    std::string message;
    float messageAlpha = 0.0f;  // 0 a 1
    Color text = LIGHTGRAY;     // texto suelto sobre la escena: claro u oscuro segun el fondo
};

void DrawHud(GraphicsDevice& gfx, const Font& font, const Hud& hud);

void DrawShop(GraphicsDevice& gfx, const Font& font, const LoadedLevel& level, const LevelEntity& npc,
              const Inventory& inventory, const std::string& feedback);

}  // namespace CombatView
