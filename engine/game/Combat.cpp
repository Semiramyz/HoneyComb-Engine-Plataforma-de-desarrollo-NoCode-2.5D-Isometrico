// Implementacion de Combat. Las reglas estan documentadas en el .hpp.

#include "Combat.hpp"

#include <algorithm>
#include <cmath>

#include "game/Movement.hpp"

namespace Combat {

namespace {

float Distance(Vector2 a, Vector2 b) {
    return std::hypot(a.x - b.x, a.y - b.y);
}

void Tick(float& timer, float deltaTime) {
    timer = std::max(0.0f, timer - deltaTime);
}

// Un paso del enemigo hacia el jugador. Prueba primero el movimiento completo
// y despues cada eje por separado: contra una pared en diagonal, avanzar solo
// en el eje libre hace que se deslice por ella en vez de quedarse clavado.
void Chase(const LoadedLevel& level, LevelEntity& enemy, const LevelEntity& player,
           float deltaTime) {
    const Vector2 from = enemy.precisePosition;
    const Vector2 to = player.precisePosition;
    const float distance = Distance(from, to);
    // Se frena un poco antes del alcance de contacto: pegado del todo, el
    // bloqueo contra el jugador lo dejaria temblando contra el.
    if (enemy.speed <= 0.0f || distance > kEnemyAggroRange || distance < kEnemyContactRange * 0.8f) {
        return;
    }

    const float step = enemy.speed * deltaTime;
    const Vector2 direction{(to.x - from.x) / distance, (to.y - from.y) / distance};
    const Vector2 options[] = {
        Movement::ClampToGrid(level, {from.x + direction.x * step, from.y + direction.y * step}),
        Movement::ClampToGrid(level, {from.x + direction.x * step, from.y}),
        Movement::ClampToGrid(level, {from.x, from.y + direction.y * step}),
    };
    for (const Vector2& candidate : options) {
        if (Movement::CanOccupy(level, enemy, candidate, &player)) {
            enemy.precisePosition = candidate;
            enemy.position = GridCoord{static_cast<int>(std::round(candidate.x)),
                                       static_cast<int>(std::round(candidate.y))};
            return;
        }
    }
}

}  // namespace

bool IsEnemy(const LevelEntity& entity) {
    return entity.type == "enemy";
}

FrameResult Update(LoadedLevel& level, LevelEntity* player, bool attackPressed, float deltaTime) {
    FrameResult result;
    for (auto& entity : level.entities) {
        Tick(entity.attackTimer, deltaTime);
        Tick(entity.hurtTimer, deltaTime);
    }
    if (!player || player->destroyed) {
        return result;
    }

    // 1) Golpe del jugador: a todos los enemigos a su alcance a la vez.
    if (attackPressed && player->attackTimer <= 0.0f) {
        player->attackTimer = kPlayerAttackCooldown;
        result.playerSwung = true;
        for (auto& entity : level.entities) {
            if (!IsEnemy(entity) || entity.destroyed ||
                Distance(Movement::BoxCenter(entity), player->precisePosition) > kPlayerAttackRange) {
                continue;
            }
            entity.health -= player->damage;
            entity.hurtTimer = kHurtFlash;
            if (entity.health <= 0.0f) {
                entity.health = 0.0f;
                // Borrado suave, igual que destroy_entity: el vector no se toca
                // para no invalidar los punteros de entityById.
                entity.destroyed = true;
                result.defeated.push_back(entity.id);
            }
        }
    }

    // 2) Enemigos: persiguen y pegan por contacto.
    for (auto& entity : level.entities) {
        if (!IsEnemy(entity) || entity.destroyed) {
            continue;
        }
        Chase(level, entity, *player, deltaTime);
        const bool touching =
            Distance(Movement::BoxCenter(entity), player->precisePosition) <= kEnemyContactRange;
        if (touching && entity.damage > 0.0f && entity.attackTimer <= 0.0f) {
            entity.attackTimer = kEnemyAttackCooldown;
            player->health -= entity.damage;
            player->hurtTimer = kHurtFlash;
        }
    }

    if (player->health <= 0.0f) {
        player->health = 0.0f;
        result.playerDefeated = true;
    }
    return result;
}

}  // namespace Combat
