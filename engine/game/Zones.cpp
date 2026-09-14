// Implementacion de Zones. El contrato esta documentado en el .hpp.

#include "Zones.hpp"

#include "game/Combat.hpp"

namespace Zones {

const Zone* Find(const LoadedLevel& level, const std::string& id) {
    for (const auto& zone : level.zones) {
        if (zone.id == id) {
            return &zone;
        }
    }
    return nullptr;
}

bool Contains(const Zone& zone, Vector2 point) {
    return point.x >= zone.col - 0.5f && point.x < zone.col + zone.width - 0.5f &&
           point.y >= zone.row - 0.5f && point.y < zone.row + zone.height - 0.5f;
}

bool IsCleared(const LoadedLevel& level, const Zone& zone) {
    bool anyEnemy = false;
    for (const auto& entity : level.entities) {
        const float spanOffset = (entity.span - 1) / 2.0f;
        const Vector2 start{entity.startPosition.x + spanOffset, entity.startPosition.y + spanOffset};
        if (!Combat::IsEnemy(entity) || !Contains(zone, start)) {
            continue;
        }
        if (!entity.destroyed) {
            return false;
        }
        anyEnemy = true;
    }
    return anyEnemy;
}

}  // namespace Zones
