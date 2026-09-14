// Implementacion de Combat. Las reglas estan documentadas en el .hpp.
//
// Toda la geometria se resuelve en CELDAS, no en pixeles: un sector de 90
// grados en la grilla se ve achatado en la pantalla isometrica, igual que un
// circulo se ve como elipse, pero es la misma forma para todos los que estan
// en el mapa. CombatView la proyecta despues con la misma cuenta que el resto.

#include "Combat.hpp"

#include <algorithm>
#include <cmath>
#include <cstddef>

#include "game/Movement.hpp"

namespace Combat {

namespace {

float Distance(Vector2 a, Vector2 b) {
    return std::hypot(a.x - b.x, a.y - b.y);
}

Vector2 Normalized(Vector2 vector, Vector2 fallback) {
    const float length = std::hypot(vector.x, vector.y);
    return length > 0.0001f ? Vector2{vector.x / length, vector.y / length} : fallback;
}

void Tick(float& timer, float deltaTime) {
    timer = std::max(0.0f, timer - deltaTime);
}

// Radio del cuerpo de una entidad, en celdas: un golpe que la roza la toca.
float BodyRadius(const LoadedLevel& level, const LevelEntity& entity) {
    const Vector2 half = Movement::HalfExtentsInCells(level, entity);
    const float radius = std::max(half.x, half.y);
    return radius > 0.0f ? radius : 0.3f;
}

float SegmentDistance(Vector2 point, Vector2 from, Vector2 to) {
    const Vector2 segment{to.x - from.x, to.y - from.y};
    const float lengthSquared = segment.x * segment.x + segment.y * segment.y;
    float t = 0.0f;
    if (lengthSquared > 0.0f) {
        t = std::clamp(((point.x - from.x) * segment.x + (point.y - from.y) * segment.y) / lengthSquared,
                       0.0f, 1.0f);
    }
    return Distance(point, Vector2{from.x + segment.x * t, from.y + segment.y * t});
}

bool HitsLine(Vector2 origin, Vector2 direction, float length, float width, Vector2 point, float radius) {
    const Vector2 end{origin.x + direction.x * length, origin.y + direction.y * length};
    return SegmentDistance(point, origin, end) <= width / 2.0f + radius;
}

bool HitsCircle(Vector2 center, float circleRadius, Vector2 point, float radius) {
    return Distance(center, point) <= circleRadius + radius;
}

// Sector de reloj: dentro del radio y a no mas de medio "angle" de la
// direccion. El cuerpo del objetivo agranda un poco el angulo (asin(r/d)): un
// enemigo con medio cuerpo dentro del sector tambien recibe el golpe.
bool HitsCone(Vector2 origin, Vector2 direction, float length, float angle, Vector2 point, float radius) {
    const float distance = Distance(origin, point);
    if (distance > length + radius) {
        return false;
    }
    if (distance <= radius || angle >= 360.0f) {
        return true;
    }
    const Vector2 toPoint{(point.x - origin.x) / distance, (point.y - origin.y) / distance};
    const float cosine = std::clamp(direction.x * toPoint.x + direction.y * toPoint.y, -1.0f, 1.0f);
    const float degrees = std::acos(cosine) * RAD2DEG;
    const float margin = std::asin(std::min(1.0f, radius / distance)) * RAD2DEG;
    return degrees <= angle / 2.0f + margin;
}

// Todo lo que necesitan las funciones de abajo, para no pasarlo suelto.
struct Context {
    LoadedLevel& level;
    State& state;
    LevelEntity* player;
    Inventory& inventory;
    const PlayerIntent& intent;
    FrameResult& result;
};

// Llama a "visit" con cada entidad que un ataque de ese bando puede golpear.
template <typename Visit>
void ForEachTarget(Context& ctx, Faction faction, Visit visit) {
    if (faction == Faction::Player) {
        for (auto& entity : ctx.level.entities) {
            if (IsEnemy(entity) && IsActive(entity)) {
                visit(entity);
            }
        }
    } else if (ctx.player && IsActive(*ctx.player)) {
        visit(*ctx.player);
    }
}

void Damage(Context& ctx, LevelEntity& target, float amount) {
    if (&target == ctx.player) {
        if (ctx.intent.invulnerable) {
            return;
        }
        if (ctx.intent.defending) {
            amount *= 1.0f - ctx.intent.defenseReduction;
        }
    }
    if (amount <= 0.0f) {
        return;
    }
    target.health -= amount;
    target.hurtTimer = kHurtFlash;
    if (&target != ctx.player && target.health <= 0.0f && !target.destroyed) {
        target.health = 0.0f;
        // Borrado suave, igual que destroy_entity: el vector no se toca para
        // no invalidar los punteros de entityById.
        target.destroyed = true;
        ctx.result.defeated.push_back(&target);
    }
}

void Heal(LevelEntity& entity, float amount) {
    entity.health = std::min(entity.maxHealth, entity.health + amount);
}

// Un ataque que acerto suma uno al contador de la habilidad de su arma. El del
// jugador vive en su casillero del inventario; el de un enemigo, en la entidad.
// Se busca el arma por id y no por puntero: un proyectil puede llegar despues
// de que el jugador cambio de arma, y le sigue sumando a la que lo tiro.
void CreditHit(Context& ctx, Faction faction, LevelEntity* owner, const std::string& weaponId) {
    ComboState* combo = nullptr;
    int required = 0;
    if (faction == Faction::Player) {
        InventorySlot* slot = ctx.inventory.SlotFor(weaponId);
        if (slot && slot->item.weapon.hasAbility) {
            combo = &slot->combo;
            required = slot->item.weapon.ability.hitsRequired;
        }
    } else if (owner) {
        auto it = ctx.level.items.find(owner->weaponId);
        if (it != ctx.level.items.end() && it->second.weapon.hasAbility) {
            combo = &owner->combo;
            required = it->second.weapon.ability.hitsRequired;
        }
    }
    if (combo) {
        combo->hits = std::min(required, combo->hits + 1);
        combo->idle = 0.0f;
    }
}

void AddEffect(Context& ctx, Effect effect, float duration) {
    effect.duration = std::max(0.05f, duration);
    effect.remaining = effect.duration;
    ctx.state.effects.push_back(effect);
}

// Dano en un circulo. Devuelve a cuantos golpeo (solo cuenta si hace dano: una
// zona de curacion no carga habilidades). "heal" es para quien lo lanzo.
int ApplyCircle(Context& ctx, Faction faction, LevelEntity* owner, const AttackDef& attack, Vector2 center,
                float radius) {
    int hits = 0;
    ForEachTarget(ctx, faction, [&](LevelEntity& target) {
        if (HitsCircle(center, radius, Movement::BoxCenter(target), BodyRadius(ctx.level, target))) {
            Damage(ctx, target, attack.damage);
            hits += attack.damage > 0.0f ? 1 : 0;
        }
    });
    if (attack.heal > 0.0f && owner && IsActive(*owner) &&
        HitsCircle(center, radius, Movement::BoxCenter(*owner), BodyRadius(ctx.level, *owner))) {
        Heal(*owner, attack.heal);
    }
    return hits;
}

// Lanza un ataque de "attacker" hacia "aim". Los golpes cuerpo a cuerpo se
// resuelven en el acto; proyectiles y areas remotas quedan en el State.
void Launch(Context& ctx, Faction faction, LevelEntity& attacker, const AttackDef& attack, Vector2 aim,
            const std::string& weaponId, bool ability, Vector2 fallbackDirection) {
    const Vector2 origin = Movement::BoxCenter(attacker);
    const Vector2 direction = Normalized(Vector2{aim.x - origin.x, aim.y - origin.y}, fallbackDirection);

    Effect effect;
    effect.faction = faction;
    effect.ability = ability;
    effect.origin = origin;
    effect.direction = direction;

    int hits = 0;
    switch (attack.pattern) {
    case AttackPattern::Line:
        ForEachTarget(ctx, faction, [&](LevelEntity& target) {
            if (HitsLine(origin, direction, attack.range, attack.width, Movement::BoxCenter(target),
                         BodyRadius(ctx.level, target))) {
                Damage(ctx, target, attack.damage);
                hits += attack.damage > 0.0f ? 1 : 0;
            }
        });
        effect.shape = EffectShape::Line;
        effect.length = attack.range;
        effect.width = attack.width;
        AddEffect(ctx, effect, kSwingDuration);
        break;

    case AttackPattern::Area:
        hits = ApplyCircle(ctx, faction, &attacker, attack, origin, attack.range);
        effect.shape = EffectShape::Circle;
        effect.length = attack.range;
        AddEffect(ctx, effect, kSwingDuration);
        break;

    case AttackPattern::Cone:
        ForEachTarget(ctx, faction, [&](LevelEntity& target) {
            if (HitsCone(origin, direction, attack.range, attack.angle, Movement::BoxCenter(target),
                         BodyRadius(ctx.level, target))) {
                Damage(ctx, target, attack.damage);
                hits += attack.damage > 0.0f ? 1 : 0;
            }
        });
        effect.shape = EffectShape::Cone;
        effect.length = attack.range;
        effect.angle = attack.angle;
        AddEffect(ctx, effect, kSwingDuration);
        break;

    case AttackPattern::Projectile:
    case AttackPattern::Explosive: {
        Projectile projectile;
        projectile.attack = attack;
        projectile.faction = faction;
        projectile.owner = &attacker;
        projectile.weaponId = weaponId;
        projectile.ability = ability;
        projectile.position = origin;
        projectile.direction = direction;
        ctx.state.projectiles.push_back(std::move(projectile));
        break;
    }

    case AttackPattern::RemoteArea: {
        // Se apunta a un LUGAR, pero no mas lejos que el alcance: mas alla, el
        // efecto cae en el borde del alcance en esa misma direccion.
        Vector2 offset{aim.x - origin.x, aim.y - origin.y};
        const float distance = std::hypot(offset.x, offset.y);
        if (distance > attack.range) {
            offset = Vector2{offset.x / distance * attack.range, offset.y / distance * attack.range};
        }
        PendingArea area;
        area.attack = attack;
        area.faction = faction;
        area.owner = &attacker;
        area.weaponId = weaponId;
        area.ability = ability;
        area.center = Vector2{origin.x + offset.x, origin.y + offset.y};
        area.remaining = attack.delay;
        ctx.state.pendingAreas.push_back(area);

        effect.shape = EffectShape::Circle;
        effect.origin = area.center;
        effect.length = attack.radius;
        effect.telegraph = true;
        AddEffect(ctx, effect, attack.delay);
        break;
    }
    }

    if (hits > 0 && !ability) {
        CreditHit(ctx, faction, &attacker, weaponId);
    }
}

void Explode(Context& ctx, const Projectile& projectile) {
    const int hits = ApplyCircle(ctx, projectile.faction, projectile.owner, projectile.attack,
                                 projectile.position, projectile.attack.radius);
    Effect effect;
    effect.shape = EffectShape::Circle;
    effect.faction = projectile.faction;
    effect.ability = projectile.ability;
    effect.origin = projectile.position;
    effect.length = projectile.attack.radius;
    AddEffect(ctx, effect, 0.3f);
    if (hits > 0 && !projectile.ability) {
        CreditHit(ctx, projectile.faction, projectile.owner, projectile.weaponId);
    }
}

// Avanza los proyectiles en pasos de a lo sumo un cuarto de celda: uno rapido
// avanzaria de una vez mas que el ancho de un enemigo y lo atravesaria sin
// tocarlo.
void UpdateProjectiles(Context& ctx, float deltaTime) {
    constexpr float kMaxStep = 0.25f;
    auto& projectiles = ctx.state.projectiles;
    for (std::size_t index = 0; index < projectiles.size();) {
        Projectile& projectile = projectiles[index];
        const bool explosive = projectile.attack.pattern == AttackPattern::Explosive;
        const float distance = projectile.attack.speed * deltaTime;
        const int steps = std::max(1, static_cast<int>(std::ceil(distance / kMaxStep)));
        const float stepLength = distance / steps;
        bool finished = false;

        for (int step = 0; step < steps && !finished; ++step) {
            projectile.position.x += projectile.direction.x * stepLength;
            projectile.position.y += projectile.direction.y * stepLength;
            projectile.traveled += stepLength;

            ForEachTarget(ctx, projectile.faction, [&](LevelEntity& target) {
                if (finished ||
                    std::find(projectile.alreadyHit.begin(), projectile.alreadyHit.end(), &target) !=
                        projectile.alreadyHit.end() ||
                    !HitsCircle(projectile.position, projectile.attack.width / 2.0f,
                                Movement::BoxCenter(target), BodyRadius(ctx.level, target))) {
                    return;
                }
                if (explosive) {
                    finished = true;  // el dano lo hace la explosion
                    return;
                }
                Damage(ctx, target, projectile.attack.damage);
                if (projectile.attack.damage > 0.0f && !projectile.ability && !projectile.credited) {
                    projectile.credited = true;
                    CreditHit(ctx, projectile.faction, projectile.owner, projectile.weaponId);
                }
                if (projectile.attack.pierce) {
                    projectile.alreadyHit.push_back(&target);
                } else {
                    finished = true;
                }
            });

            if (!finished && (projectile.traveled >= projectile.attack.range ||
                              Movement::BlocksProjectile(ctx.level, projectile.position, projectile.owner))) {
                finished = true;
            }
        }

        if (finished) {
            if (explosive) {
                Explode(ctx, projectile);
            }
            projectiles.erase(projectiles.begin() + static_cast<std::ptrdiff_t>(index));
        } else {
            ++index;
        }
    }
}

void UpdatePendingAreas(Context& ctx, float deltaTime) {
    auto& areas = ctx.state.pendingAreas;
    for (std::size_t index = 0; index < areas.size();) {
        areas[index].remaining -= deltaTime;
        if (areas[index].remaining > 0.0f) {
            ++index;
            continue;
        }
        // Copia: ApplyCircle no toca la lista, pero el erase de abajo si.
        const PendingArea area = areas[index];
        areas.erase(areas.begin() + static_cast<std::ptrdiff_t>(index));
        const int hits = ApplyCircle(ctx, area.faction, area.owner, area.attack, area.center, area.attack.radius);
        Effect effect;
        effect.shape = EffectShape::Circle;
        effect.faction = area.faction;
        effect.ability = area.ability;
        effect.origin = area.center;
        effect.length = area.attack.radius;
        AddEffect(ctx, effect, 0.25f);
        if (hits > 0 && !area.ability) {
            CreditHit(ctx, area.faction, area.owner, area.weaponId);
        }
    }
}

// Un paso del enemigo hacia el jugador. Se frena en "stopAt": pegado del todo,
// el bloqueo contra el jugador lo dejaria temblando contra el, y uno con arma a
// distancia no tiene por que acercarse hasta tocarlo.
void Chase(const LoadedLevel& level, LevelEntity& enemy, const LevelEntity& player, float deltaTime,
           float stopAt) {
    const Vector2 from = enemy.precisePosition;
    const Vector2 to = player.precisePosition;
    const float distance = Distance(from, to);
    if (enemy.speed <= 0.0f || distance > kEnemyAggroRange || distance < stopAt) {
        return;
    }
    const float step = enemy.speed * deltaTime;
    Movement::TryMove(level, enemy,
                      Vector2{(to.x - from.x) / distance * step, (to.y - from.y) / distance * step}, &player);
}

// Hasta donde llega un ataque, para decidir cuando un enemigo lo usa.
float Reach(const AttackDef& attack) {
    switch (attack.pattern) {
    case AttackPattern::Projectile:
    case AttackPattern::Explosive:
        return std::min(attack.range, kEnemyAggroRange);
    default:
        return attack.range;
    }
}

void UpdatePlayerAttack(Context& ctx, float deltaTime) {
    LevelEntity& player = *ctx.player;
    const PlayerIntent& intent = ctx.intent;
    const Vector2 origin = Movement::BoxCenter(player);
    ctx.state.playerFacing = Normalized(Vector2{intent.aim.x - origin.x, intent.aim.y - origin.y},
                                        ctx.state.playerFacing);

    InventorySlot* slot = ctx.inventory.ActiveSlot();
    const AttackDef normal = slot ? slot->item.weapon.attack : UnarmedAttack(player);
    const std::string weaponId = slot ? slot->item.id : std::string();
    const AbilityDef* ability = slot && slot->item.weapon.hasAbility ? &slot->item.weapon.ability : nullptr;

    if (ability) {
        ComboState& combo = slot->combo;
        combo.idle += deltaTime;
        // Una habilidad ya lista no se pierde por esperar: se gano.
        if (ability->resetAfter > 0.0f && combo.hits < ability->hitsRequired && combo.idle > ability->resetAfter) {
            combo.hits = 0;
        }
    }

    // Defendiendo no se ataca: es la contra de reducir el dano.
    if (player.attackTimer > 0.0f || intent.defending) {
        return;
    }
    const bool ready = ability && slot->combo.hits >= ability->hitsRequired;
    const bool fireAbility = ready && (ability->manual ? intent.ability : intent.attack);
    if (fireAbility) {
        // Copia antes de lanzar: Launch no cambia el inventario, pero asi el
        // ataque no depende de un puntero a un casillero.
        const AttackDef attack = ability->attack;
        slot->combo.hits = 0;
        player.attackTimer = attack.cooldown;
        Launch(ctx, Faction::Player, player, attack, intent.aim, weaponId, true, ctx.state.playerFacing);
        ctx.result.abilitiesUsed.push_back(weaponId);
    } else if (intent.attack) {
        player.attackTimer = normal.cooldown;
        Launch(ctx, Faction::Player, player, normal, intent.aim, weaponId, false, ctx.state.playerFacing);
    }
}

void UpdateEnemies(Context& ctx, float deltaTime) {
    LevelEntity* player = ctx.player;
    if (!player || !IsActive(*player)) {
        return;
    }
    for (auto& enemy : ctx.level.entities) {
        if (!IsEnemy(enemy) || !IsActive(enemy)) {
            continue;
        }
        auto weaponIt = ctx.level.items.find(enemy.weaponId);
        const bool armed = !enemy.weaponId.empty() && weaponIt != ctx.level.items.end() &&
                           weaponIt->second.kind == ItemKind::Weapon;
        const float distance = Distance(Movement::BoxCenter(enemy), player->precisePosition);

        if (!armed) {
            Chase(ctx.level, enemy, *player, deltaTime, kEnemyContactRange * 0.8f);
            const bool touching =
                Distance(Movement::BoxCenter(enemy), player->precisePosition) <= kEnemyContactRange;
            if (touching && enemy.damage > 0.0f && enemy.attackTimer <= 0.0f) {
                enemy.attackTimer = kEnemyAttackCooldown;
                Damage(ctx, *player, enemy.damage);
            }
            continue;
        }

        const WeaponDef& weapon = weaponIt->second.weapon;
        const float reach = Reach(weapon.attack);
        const float stopAt = weapon.category == WeaponCategory::Ranged
                                 ? reach * 0.8f
                                 : std::max(kEnemyContactRange * 0.8f, reach * 0.6f);
        Chase(ctx.level, enemy, *player, deltaTime, stopAt);

        if (distance > reach || distance > kEnemyAggroRange || enemy.attackTimer > 0.0f) {
            continue;
        }
        // Un enemigo lanza su habilidad apenas la tiene: no hay tecla que apretar.
        const bool ready = weapon.hasAbility && enemy.combo.hits >= weapon.ability.hitsRequired;
        const AttackDef attack = ready ? weapon.ability.attack : weapon.attack;
        if (ready) {
            enemy.combo.hits = 0;
        }
        // Nunca mas rapido que cada 0.2 s: un arma con cooldown 0 en manos de la
        // IA dispararia todos los frames.
        enemy.attackTimer = std::max(attack.cooldown, 0.2f);
        Launch(ctx, Faction::Enemy, enemy, attack, Movement::BoxCenter(*player), enemy.weaponId, ready,
               Vector2{1, 0});
    }
}

}  // namespace

bool IsEnemy(const LevelEntity& entity) {
    return entity.type == "enemy";
}

bool IsActive(const LevelEntity& entity) {
    return !entity.destroyed && !entity.hidden;
}

AttackDef UnarmedAttack(const LevelEntity& attacker) {
    AttackDef attack;
    attack.pattern = AttackPattern::Area;
    attack.damage = attacker.damage;
    attack.cooldown = 0.4f;
    attack.range = 1.5f;
    return attack;
}

void State::Clear() {
    projectiles.clear();
    pendingAreas.clear();
    effects.clear();
    playerFacing = Vector2{1, 0};
}

FrameResult Update(LoadedLevel& level, State& state, LevelEntity* player, Inventory& inventory,
                   const PlayerIntent& intent, float deltaTime) {
    FrameResult result;
    for (auto& entity : level.entities) {
        Tick(entity.attackTimer, deltaTime);
        Tick(entity.hurtTimer, deltaTime);
    }
    for (std::size_t index = 0; index < state.effects.size();) {
        state.effects[index].remaining -= deltaTime;
        if (state.effects[index].remaining <= 0.0f) {
            state.effects.erase(state.effects.begin() + static_cast<std::ptrdiff_t>(index));
        } else {
            ++index;
        }
    }

    Context ctx{level, state, player && !player->destroyed ? player : nullptr, inventory, intent, result};
    if (ctx.player && IsActive(*ctx.player)) {
        UpdatePlayerAttack(ctx, deltaTime);
    }
    UpdateProjectiles(ctx, deltaTime);
    UpdatePendingAreas(ctx, deltaTime);
    UpdateEnemies(ctx, deltaTime);

    if (ctx.player && ctx.player->health <= 0.0f) {
        ctx.player->health = 0.0f;
        result.playerDefeated = true;
    }
    return result;
}

}  // namespace Combat
