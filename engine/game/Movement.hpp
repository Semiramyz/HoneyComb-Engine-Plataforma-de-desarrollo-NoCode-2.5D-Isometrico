#pragma once

#include "raylib.h"

#include "loader/LevelLoader.hpp"

// Reglas de movimiento compartidas por todo lo que se mueve en el nivel: el
// jugador con las flechas y los enemigos que lo persiguen.
//
// Antes vivian escritas adentro del bucle de main.cpp, solo para el jugador.
// Los enemigos tienen que chocar contra las mismas paredes y el mismo borde
// del mapa, y dos copias de estas cuentas terminarian diciendo cosas
// distintas; por eso estan aca, una sola vez.
//
// Todas las posiciones van en CELDAS (col, row), continuas: es lo que lleva
// LevelEntity::precisePosition.
namespace Movement {

// Mitad del collider en celdas. Los colliders se declaran en pixeles (es lo
// que muestra el editor), asi que hay que dividir por el tamano del tile.
Vector2 HalfExtentsInCells(const LoadedLevel& level, const LevelEntity& entity);

// Centro de la caja de una entidad. Una de span N ocupa NxN celdas desde su
// celda, asi que su centro esta (N-1)/2 celdas mas adelante en cada eje.
Vector2 BoxCenter(const LevelEntity& entity);

// Lleva una posicion al interior de la grilla: el limite duro del mapa, aparte
// de las paredes.
Vector2 ClampToGrid(const LoadedLevel& level, Vector2 position);

// true si "mover" puede estar en "candidate": hay piso debajo, no pisa una
// pared y no se solapa con ninguna entidad solida. "blocker" es una entidad
// extra que cuenta como solida aunque no lo sea: un enemigo no atraviesa al
// jugador que persigue. "mover" nunca choca consigo mismo.
bool CanOccupy(const LoadedLevel& level, const LevelEntity& mover, Vector2 candidate,
               const LevelEntity* blocker = nullptr);

// Mueve "delta" celdas si se puede. Prueba primero el movimiento completo y
// despues cada eje por separado: contra una pared en diagonal, avanzar solo en
// el eje libre hace que se deslice por ella en vez de quedarse clavado.
// Devuelve false si no se pudo mover nada.
bool TryMove(const LoadedLevel& level, LevelEntity& mover, Vector2 delta,
             const LevelEntity* blocker = nullptr);

// true si un proyectil en "point" choca contra el mapa: fuera del piso, en una
// pared o dentro de una entidad solida (que no sea "ignore", quien lo tiro).
bool BlocksProjectile(const LoadedLevel& level, Vector2 point, const LevelEntity* ignore);

}  // namespace Movement
