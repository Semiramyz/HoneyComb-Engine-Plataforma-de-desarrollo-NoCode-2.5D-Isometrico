// Implementacion de Mobility. Las reglas estan documentadas en el .hpp.

#include "Mobility.hpp"

#include <algorithm>
#include <cmath>

#include "game/Movement.hpp"

namespace Mobility {

namespace {

float Length(Vector2 vector) {
    return std::sqrt(vector.x * vector.x + vector.y * vector.y);
}

Vector2 Normalized(Vector2 vector) {
    const float length = Length(vector);
    return length > 0.0001f ? Vector2{vector.x / length, vector.y / length} : Vector2{0, 0};
}

}  // namespace

void UpdatePlayer(const LoadedLevel& level, LevelEntity& player, State& state, const Intent& intent,
                  float deltaTime) {
    state.dashCooldown = std::max(0.0f, state.dashCooldown - deltaTime);
    state.iframes = std::max(0.0f, state.iframes - deltaTime);

    // Pantalla -> grilla: la inversa de la proyeccion isometrica. Sin esta
    // conversion, apretar "arriba" moveria en diagonal dentro del mundo, que
    // es el error clasico de los juegos isometricos. Normalizada, para que en
    // diagonal (dos teclas) no se vaya ~1.41x mas rapido.
    const Vector2 walk = Normalized(Vector2{
        intent.screenDirection.x + intent.screenDirection.y,
        intent.screenDirection.y - intent.screenDirection.x});
    if (Length(walk) > 0.0f) {
        state.facing = walk;
    }

    // Esquive: hacia donde se camina; quieto, hacia el mouse. Se puede
    // esquivar desde la defensa, que es justamente para lo que sirve.
    if (intent.dashPressed && player.dash.enabled && state.dashCooldown <= 0.0f && !IsDashing(state)) {
        Vector2 direction = Length(walk) > 0.0f ? walk : Normalized(intent.aimDirection);
        if (Length(direction) == 0.0f) {
            direction = state.facing;
        }
        state.dashDirection = direction;
        state.dashRemaining = player.dash.duration;
        // La pausa corre desde que TERMINA el esquive, no desde que empieza.
        state.dashCooldown = player.dash.cooldown + player.dash.duration;
        state.iframes = player.dash.iframes;
    }

    if (IsDashing(state)) {
        state.defending = false;
        const float step = std::min(deltaTime, state.dashRemaining);
        const float speed = player.dash.distance / player.dash.duration;
        // Contra una pared el esquive se desliza o se frena ahi: nunca la
        // atraviesa, porque cada paso pasa por la misma regla que caminar.
        Movement::TryMove(level, player,
                          Vector2{state.dashDirection.x * speed * step, state.dashDirection.y * speed * step});
        state.dashRemaining -= deltaTime;
        return;
    }

    state.defending = intent.defendHeld && player.defense.enabled;
    if (Length(walk) == 0.0f) {
        return;
    }
    // Celdas por segundo: la velocidad configurada ("stats.speed"), mas lenta
    // si esta defendiendo.
    const float speed = player.speed * (state.defending ? player.defense.speedMultiplier : 1.0f);
    Movement::TryMove(level, player, Vector2{walk.x * speed * deltaTime, walk.y * speed * deltaTime});
}

}  // namespace Mobility
