#pragma once

#include "raylib.h"

#include "loader/LevelLoader.hpp"

// Movimiento del jugador: caminar, esquivar (dash) y defender.
//
// Antes el caminar vivia en el bucle de main.cpp. Con el esquive y la defensa
// deja de ser "leer flechas y sumar": el esquive toma el control del movimiento
// unos instantes y la defensa frena, y las tres cosas tienen que decidirse en
// el mismo lugar para no pisarse.
//
// Los parametros salen de la entidad (LevelEntity::dash y ::defense, el bloque
// "mobility" del JSON). Sin ese bloque el jugador camina como siempre.
namespace Mobility {

struct State {
    float dashRemaining = 0.0f;  // segundos que le quedan al esquive en curso
    float dashCooldown = 0.0f;   // segundos hasta poder esquivar de nuevo
    float iframes = 0.0f;        // segundos de invulnerabilidad que quedan
    Vector2 dashDirection{0, 0};
    bool defending = false;
    Vector2 facing{1, 0};        // ultima direccion en que camino, en celdas
};

struct Intent {
    // Direccion EN PANTALLA (arriba = arriba visual), de -1 a 1 por eje.
    Vector2 screenDirection{0, 0};
    bool dashPressed = false;
    bool defendHeld = false;
    // Hacia donde apunta el mouse, en celdas: esquivar quieto va hacia ahi.
    Vector2 aimDirection{0, 0};
};

void UpdatePlayer(const LoadedLevel& level, LevelEntity& player, State& state, const Intent& intent,
                  float deltaTime);

inline bool IsDashing(const State& state) { return state.dashRemaining > 0.0f; }
inline bool IsInvulnerable(const State& state) { return state.iframes > 0.0f; }

}  // namespace Mobility
