// Implementacion de ItemLoader. El contrato esta documentado en el .hpp y los
// campos, en schema/level.schema.json.

#include "ItemLoader.hpp"

#include <algorithm>
#include <string>

#include "loader/LevelLoader.hpp"

namespace {

using nlohmann::json;

AttackPattern ParsePattern(const std::string& name) {
    if (name == "line") return AttackPattern::Line;
    if (name == "cone") return AttackPattern::Cone;
    if (name == "projectile") return AttackPattern::Projectile;
    if (name == "remote_area") return AttackPattern::RemoteArea;
    if (name == "explosive") return AttackPattern::Explosive;
    // "area" y cualquier nombre desconocido: el ataque de siempre, alrededor.
    return AttackPattern::Area;
}

// Un valor que tiene que ser mayor que cero (un alcance, una velocidad). Cero o
// negativo no tiene sentido y se reemplaza por el default.
float Positive(const json& object, const char* key, float fallback) {
    const float value = object.value(key, fallback);
    return value > 0.0f ? value : fallback;
}

float NonNegative(const json& object, const char* key, float fallback) {
    return std::max(0.0f, object.value(key, fallback));
}

float Unit(const json& object, const char* key, float fallback) {
    return std::clamp(object.value(key, fallback), 0.0f, 1.0f);
}

}  // namespace

AttackDef ItemLoader::ParseAttack(const json& attackJson) {
    AttackDef attack;
    if (!attackJson.is_object()) {
        return attack;
    }
    attack.pattern = ParsePattern(attackJson.value("pattern", std::string("area")));
    attack.damage = NonNegative(attackJson, "damage", attack.damage);
    attack.cooldown = NonNegative(attackJson, "cooldown", attack.cooldown);
    attack.range = Positive(attackJson, "range", attack.range);
    attack.width = Positive(attackJson, "width", attack.width);
    attack.angle = std::clamp(Positive(attackJson, "angle", attack.angle), 1.0f, 360.0f);
    attack.radius = Positive(attackJson, "radius", attack.radius);
    attack.speed = Positive(attackJson, "speed", attack.speed);
    attack.delay = NonNegative(attackJson, "delay", attack.delay);
    attack.pierce = attackJson.value("pierce", false);
    attack.heal = NonNegative(attackJson, "heal", 0.0f);
    return attack;
}

ItemCatalog ItemLoader::ParseItems(const json& itemsArray, ResourceManager& resources,
                                   AssetResolver& assets) {
    ItemCatalog catalog;
    if (!itemsArray.is_array()) {
        return catalog;
    }
    for (const auto& itemJson : itemsArray) {
        ItemDef item;
        item.id = itemJson.value("id", std::string(""));
        // Sin id nadie lo puede referenciar: se descarta en vez de romper.
        if (item.id.empty()) {
            continue;
        }
        item.name = itemJson.value("name", item.id);

        const std::string kind = itemJson.value("kind", std::string("coin"));
        item.kind = kind == "weapon" ? ItemKind::Weapon
                    : kind == "healing" ? ItemKind::Healing
                                        : ItemKind::Coin;

        const std::string texture = itemJson.value("texture", std::string(""));
        if (!texture.empty()) {
            item.texture = &resources.GetTexture(assets.Resolve(texture));
        }
        if (itemJson.contains("sourceRect")) {
            const auto& source = itemJson.at("sourceRect");
            item.sourceRect = Rectangle{source.value("x", 0.0f), source.value("y", 0.0f),
                                        Positive(source, "width", 16.0f),
                                        Positive(source, "height", 16.0f)};
        }
        item.scale = Positive(itemJson, "scale", 1.0f);

        if (itemJson.contains("weapon")) {
            const auto& weaponJson = itemJson.at("weapon");
            item.weapon.category = weaponJson.value("category", std::string("melee")) == "ranged"
                                       ? WeaponCategory::Ranged
                                       : WeaponCategory::Melee;
            item.weapon.attack = ParseAttack(weaponJson.value("attack", json::object()));
            if (weaponJson.contains("ability")) {
                const auto& abilityJson = weaponJson.at("ability");
                AbilityDef& ability = item.weapon.ability;
                item.weapon.hasAbility = true;
                ability.name = abilityJson.value("name", std::string("Habilidad"));
                ability.hitsRequired = std::max(1, abilityJson.value("hitsRequired", 3));
                ability.manual = abilityJson.value("activation", std::string("auto")) == "manual";
                ability.resetAfter = NonNegative(abilityJson, "resetAfter", 0.0f);
                ability.attack = ParseAttack(abilityJson.value("attack", json::object()));
            }
        }
        item.heal = NonNegative(itemJson, "heal", 0.0f);
        item.value = std::max(1, itemJson.value("value", 1));

        catalog[item.id] = std::move(item);
    }
    return catalog;
}

Zone ItemLoader::ParseZone(const json& zoneJson) {
    Zone zone;
    zone.id = zoneJson.value("id", std::string(""));
    zone.col = zoneJson.value("col", 0);
    zone.row = zoneJson.value("row", 0);
    zone.width = std::max(1, zoneJson.value("width", 1));
    zone.height = std::max(1, zoneJson.value("height", 1));
    return zone;
}

void ItemLoader::ParseEntityCombat(const json& entityJson, LevelEntity& entity) {
    entity.hidden = entityJson.value("hidden", false);
    entity.boss = entityJson.value("boss", false);
    entity.itemId = entityJson.value("item", std::string(""));
    entity.weaponId = entityJson.value("weapon", std::string(""));

    if (entityJson.contains("drops") && entityJson.at("drops").is_array()) {
        for (const auto& dropJson : entityJson.at("drops")) {
            DropEntry drop{dropJson.value("item", std::string("")), Unit(dropJson, "chance", 0.0f)};
            if (!drop.item.empty()) {
                entity.drops.push_back(drop);
            }
        }
    }

    if (entityJson.contains("inventory")) {
        const auto& inventoryJson = entityJson.at("inventory");
        InventoryConfig& inventory = entity.inventory;
        inventory.present = true;
        inventory.slots = std::clamp(inventoryJson.value("slots", 3), 1, 9);
        inventory.locked = inventoryJson.value("locked", false);
        const std::string onFull = inventoryJson.value("onFull", std::string("manual_replace"));
        inventory.onFull = onFull == "auto_replace" ? OnFullInventory::AutoReplace
                           : onFull == "block"      ? OnFullInventory::Block
                                                    : OnFullInventory::ManualReplace;
        if (inventoryJson.contains("items") && inventoryJson.at("items").is_array()) {
            for (const auto& id : inventoryJson.at("items")) {
                if (id.is_string()) {
                    inventory.items.push_back(id.get<std::string>());
                }
            }
        }
        inventory.coins = std::max(0, inventoryJson.value("coins", 0));
    }

    if (entityJson.contains("mobility")) {
        const auto& mobilityJson = entityJson.at("mobility");
        if (mobilityJson.contains("dash")) {
            const auto& dashJson = mobilityJson.at("dash");
            DashConfig& dash = entity.dash;
            dash.enabled = true;
            dash.distance = Positive(dashJson, "distance", dash.distance);
            dash.duration = Positive(dashJson, "duration", dash.duration);
            dash.cooldown = NonNegative(dashJson, "cooldown", dash.cooldown);
            dash.iframes = NonNegative(dashJson, "iframes", dash.iframes);
        }
        if (mobilityJson.contains("defense")) {
            const auto& defenseJson = mobilityJson.at("defense");
            DefenseConfig& defense = entity.defense;
            defense.enabled = true;
            defense.reduction = Unit(defenseJson, "reduction", defense.reduction);
            defense.speedMultiplier = Unit(defenseJson, "speedMultiplier", defense.speedMultiplier);
        }
    }

    if (entityJson.contains("shop")) {
        const auto& shopItems = entityJson.at("shop").value("items", json::array());
        for (const auto& entryJson : shopItems) {
            ShopEntry entry{entryJson.value("item", std::string("")),
                            std::max(0, entryJson.value("price", 0))};
            if (!entry.item.empty()) {
                entity.shop.push_back(entry);
            }
        }
    }
}
