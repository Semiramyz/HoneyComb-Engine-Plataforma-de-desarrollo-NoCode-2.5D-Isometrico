#pragma once

#include <string>

#include "raylib.h"

#include "loader/LevelLoader.hpp"

// Zonas de los puzzles: las salas del mapa y las zonas sueltas del nivel
// (LoadedLevel::zones). Las usan los eventos "Al limpiar una zona", "Al entrar
// a una zona" y "Si el jugador esta en la zona".
namespace Zones {

// nullptr si el nivel no tiene una zona con ese id.
const Zone* Find(const LoadedLevel& level, const std::string& id);

// true si el punto (en celdas) cae dentro. Cada celda va centrada en su
// coordenada, asi que la zona cubre de col - 0.5 a col + width - 0.5.
bool Contains(const Zone& zone, Vector2 point);

// Arrancaron enemigos dentro de la zona y ya cayeron todos. Cuenta donde
// ARRANCO cada uno: el que sale persiguiendo al jugador sigue siendo de su
// sala. Una zona sin enemigos no queda nunca "limpia".
bool IsCleared(const LoadedLevel& level, const Zone& zone);

}  // namespace Zones
