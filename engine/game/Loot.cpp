// Implementacion de Loot. Las reglas estan documentadas en el .hpp.

#include "Loot.hpp"

#include <algorithm>
#include <cmath>

#include "game/Combat.hpp"
#include "game/Movement.hpp"

namespace Loot {

namespace {

float Distance(Vector2 a, Vector2 b) {
    return std::hypot(a.x - b.x, a.y - b.y);
}

std::string Number(float value) {
    return std::to_string(static_cast<int>(std::round(value)));
}

}  // namespace

void State::ClearLevel() {
    ground.clear();
    collected.clear();
    collectedTotal = 0;
}

GiveResult Give(const ItemDef& item, LevelEntity& player, Inventory& inventory, std::vector<GroundItem>& drops,
                bool confirmReplace, std::string& message) {
    switch (item.kind) {
    case ItemKind::Weapon: {
        const OnFullInventory rule = inventory.OnFull();
        const bool replace = rule != OnFullInventory::Block &&
                             (confirmReplace || rule == OnFullInventory::AutoReplace);
        ItemDef dropped;
        switch (inventory.AddWeapon(item, replace, dropped)) {
        case Inventory::AddResult::Added:
            message = "Nueva arma: " + item.name;
            return GiveResult::Taken;
        case Inventory::AddResult::Replaced:
            drops.push_back(GroundItem{dropped, player.precisePosition, true, 0.0f});
            message = "Cambiaste " + dropped.name + " por " + item.name;
            return GiveResult::Taken;
        case Inventory::AddResult::AlreadyOwned:
            message = "Ya tenes " + item.name;
            return GiveResult::Rejected;
        case Inventory::AddResult::Full:
            if (rule == OnFullInventory::ManualReplace && inventory.ActiveSlot()) {
                message = "Inventario lleno - E: cambiar " + inventory.ActiveSlot()->item.name + " por " + item.name;
                return GiveResult::NeedsConfirm;
            }
            message = "Inventario lleno";
            return GiveResult::Rejected;
        }
        return GiveResult::Rejected;
    }
    case ItemKind::Healing:
        // Con la vida llena la curacion se queda donde esta, para despues.
        if (player.health >= player.maxHealth) {
            message = "Vida llena";
            return GiveResult::Rejected;
        }
        player.health = std::min(player.maxHealth, player.health + item.heal);
        message = item.name + ": +" + Number(item.heal) + " vida";
        return GiveResult::Taken;
    case ItemKind::Coin:
        inventory.coins += item.value;
        message = "+" + std::to_string(item.value) + (item.value == 1 ? " moneda" : " monedas");
        return GiveResult::Taken;
    }
    return GiveResult::Rejected;
}

PickupFrame UpdatePickups(LoadedLevel& level, LevelEntity& player, Inventory& inventory, State& state,
                          bool interactPressed, float deltaTime) {
    PickupFrame frame;
    // Las armas que se sueltan al cambiar se juntan aparte y se agregan al
    // final: agregarlas a "ground" mientras se lo recorre invalidaria el recorrido.
    std::vector<GroundItem> drops;
    bool interactUsed = false;
    const Vector2 center = Movement::BoxCenter(player);

    const auto take = [&](const ItemDef& item) {
        const bool confirm = interactPressed && !interactUsed;
        std::string message;
        const GiveResult result = Give(item, player, inventory, drops, confirm, message);
        if (result == GiveResult::Taken) {
            // Una E cambia UN arma: parado sobre dos, la segunda espera otra E.
            interactUsed = interactUsed || (confirm && item.kind == ItemKind::Weapon && inventory.IsFull());
            frame.message = message;
            state.collected[item.id] += 1;
            state.collectedTotal += 1;
        } else if (frame.prompt.empty()) {
            frame.prompt = message;
        }
        return result == GiveResult::Taken;
    };

    for (auto& entity : level.entities) {
        if (entity.itemId.empty() || !Combat::IsActive(entity)) {
            continue;
        }
        auto it = level.items.find(entity.itemId);
        if (it == level.items.end() || Distance(Movement::BoxCenter(entity), center) > kPickupRadius) {
            continue;
        }
        if (take(it->second)) {
            entity.destroyed = true;
            frame.collectedEntities.push_back(entity.id);
        }
    }

    for (std::size_t index = 0; index < state.ground.size();) {
        GroundItem& ground = state.ground[index];
        ground.age += deltaTime;
        const bool near = Distance(ground.position, center) <= kPickupRadius;
        if (ground.waitForExit) {
            ground.waitForExit = near;
            ++index;
            continue;
        }
        if (near && take(ground.item)) {
            state.ground.erase(state.ground.begin() + static_cast<std::ptrdiff_t>(index));
        } else {
            ++index;
        }
    }

    state.ground.insert(state.ground.end(), drops.begin(), drops.end());
    return frame;
}

void RollDrops(const LoadedLevel& level, const LevelEntity& enemy, State& state) {
    std::uniform_real_distribution<float> roll(0.0f, 1.0f);
    // Un poco desparramado: dos cosas soltadas juntas no quedan una encima de la otra.
    std::uniform_real_distribution<float> spread(-0.3f, 0.3f);
    const Vector2 at = Movement::BoxCenter(enemy);
    for (const auto& drop : enemy.drops) {
        auto it = level.items.find(drop.item);
        if (it == level.items.end() || roll(state.rng) >= drop.chance) {
            continue;
        }
        state.ground.push_back(
            GroundItem{it->second, Vector2{at.x + spread(state.rng), at.y + spread(state.rng)}, false, 0.0f});
    }
}

void DropItems(State& state, const std::vector<ItemDef>& items, Vector2 position) {
    for (const auto& item : items) {
        state.ground.push_back(GroundItem{item, position, true, 0.0f});
    }
}

LevelEntity* NearbyShop(LoadedLevel& level, const LevelEntity& player) {
    LevelEntity* nearest = nullptr;
    float best = kShopRange;
    for (auto& entity : level.entities) {
        if (entity.shop.empty() || !Combat::IsActive(entity)) {
            continue;
        }
        const float distance = Distance(Movement::BoxCenter(entity), Movement::BoxCenter(player));
        if (distance <= best) {
            best = distance;
            nearest = &entity;
        }
    }
    return nearest;
}

std::string Buy(const LoadedLevel& level, const LevelEntity& npc, int index, LevelEntity& player,
                Inventory& inventory, State& state) {
    if (index < 0 || index >= static_cast<int>(npc.shop.size())) {
        return "";
    }
    const ShopEntry& entry = npc.shop[index];
    auto it = level.items.find(entry.item);
    if (it == level.items.end()) {
        return "Ese objeto no esta definido en el nivel";
    }
    if (inventory.coins < entry.price) {
        return "Te faltan " + std::to_string(entry.price - inventory.coins) + " monedas";
    }
    std::string message;
    // Comprar ya es la confirmacion: con el inventario lleno se cambia el arma
    // activa (salvo que el inventario no deje cambiar).
    if (Give(it->second, player, inventory, state.ground, true, message) != GiveResult::Taken) {
        return message;
    }
    inventory.coins -= entry.price;
    return "Compraste " + it->second.name;
}

}  // namespace Loot
