#pragma once

#include <string>
#include <vector>

#include "loader/LevelLoader.hpp"

// Combate basico entre el jugador y los enemigos (type "enemy").
//
// QUE HACE, frame a frame:
//   - El jugador pega con la tecla de ataque a todos los enemigos que tenga
//     cerca, y le saca a cada uno su "stats.damage" de vida.
//   - Un enemigo con velocidad persigue al jugador si lo tiene a la vista
//     (dentro de kEnemyAggroRange), chocando contra las mismas paredes que el.
//   - Un enemigo pegado al jugador le saca su propio dano, con una pausa entre
//     golpes para que el contacto no mate en un instante.
//   - Un enemigo sin vida queda destruido (y dispara "Al eliminar una
//     entidad"); un jugador sin vida marca el nivel como perdido.
//
// Vida, dano y velocidad salen del nivel ("stats"). Los alcances y las pausas
// de abajo todavia son fijos: cuando haga falta variarlos por personaje, pasan
// a "stats" como los otros tres.
namespace Combat {

constexpr float kPlayerAttackRange = 1.5f;     // celdas, desde el jugador
constexpr float kPlayerAttackCooldown = 0.4f;  // segundos entre golpes del jugador
constexpr float kEnemyAggroRange = 6.0f;       // celdas: mas lejos, el enemigo no persigue
constexpr float kEnemyContactRange = 0.9f;     // celdas: a esta distancia el enemigo pega
constexpr float kEnemyAttackCooldown = 1.0f;   // segundos entre golpes de un mismo enemigo
constexpr float kHurtFlash = 0.25f;            // segundos en rojo al recibir un golpe
constexpr float kSwingDuration = 0.15f;        // segundos que se ve el golpe del jugador

bool IsEnemy(const LevelEntity& entity);

struct FrameResult {
    bool playerSwung = false;           // el jugador ataco (para dibujar el golpe)
    std::vector<std::string> defeated;  // enemigos que cayeron en este frame
    bool playerDefeated = false;        // el jugador se quedo sin vida
};

// Avanza un frame: pausas y destellos, golpe del jugador, persecucion y dano
// por contacto. Sin jugador en el nivel no hay combate.
FrameResult Update(LoadedLevel& level, LevelEntity* player, bool attackPressed, float deltaTime);

}  // namespace Combat
