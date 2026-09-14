#pragma once

#include "nlohmann/json.hpp"

#include "core/ResourceManager.hpp"
#include "loader/AssetResolver.hpp"
#include "loader/ItemDefs.hpp"

struct LevelEntity;

// Lee del JSON del nivel todo lo del sistema de combate y objetos: las
// definiciones de "items", las zonas, y los bloques de combate de cada entidad.
// Esta aparte de LevelLoader para no mezclar el formato de un arma con el de
// una grilla, pero sigue su misma convencion: lo opcional con value() y
// default, y un numero fuera de rango se lleva al rango en vez de romper el
// nivel (el editor lo valida, pero el JSON se puede editar a mano).
namespace ItemLoader {

ItemCatalog ParseItems(const nlohmann::json& itemsArray, ResourceManager& resources,
                       AssetResolver& assets);

AttackDef ParseAttack(const nlohmann::json& attackJson);

Zone ParseZone(const nlohmann::json& zoneJson);

// hidden, boss, item, weapon, drops, inventory, mobility y shop de una entidad.
void ParseEntityCombat(const nlohmann::json& entityJson, LevelEntity& entity);

}  // namespace ItemLoader
