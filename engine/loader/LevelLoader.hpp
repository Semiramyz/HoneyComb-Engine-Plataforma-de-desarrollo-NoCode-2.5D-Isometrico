#pragma once

#include <string>
#include <vector>

#include "raylib.h"

#include "core/ResourceManager.hpp"
#include "loader/AssetResolver.hpp"
#include "systems/event_system/EventSystem.hpp"
#include "systems/iso_grid/IsoGridSystem.hpp"

struct LevelEntity {
    std::string id;
    std::string type;
    GridCoord position;
    const Texture2D* texture;
    Rectangle sourceRect;
    std::string animationClip;  // vacio si la entidad no se anima
    Vector2 colliderSize;        // {0,0} si la entidad no colisiona
    bool destroyed = false;      // borrado suave: la accion destroy_entity solo marca esto
};

struct LoadedLevel {
    std::string name;
    IsoGridSystem grid;
    std::vector<LevelEntity> entities;
};

// Orquestador de la Capa 3: lee un archivo de nivel (ver
// schema/level.schema.json), construye IsoGridSystem con los valores reales
// del nivel, resuelve y carga las texturas de cada entidad via
// AssetResolver/ResourceManager, y parsea+carga los eventos en el
// EventSystem que se le pase.
class LevelLoader {
public:
    LevelLoader(ResourceManager& resources, AssetResolver& assets);

    LoadedLevel Load(const std::string& levelPath, EventSystem& eventSystem);

private:
    ResourceManager& resources_;
    AssetResolver& assets_;
};
