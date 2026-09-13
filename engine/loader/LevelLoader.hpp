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
    Vector2 precisePosition;
    const Texture2D* texture;
    Rectangle sourceRect;
    std::string animationClip;  // vacio si la entidad no se anima
    // Pixeles que el sprite baja al dibujarse. 0 = el borde de abajo del
    // sprite va en el punto de la celda (los "pies" de un personaje). Un
    // solido que llena la casilla usa este campo para apoyar el centro del
    // rombo de su base ahi, que es donde se centra el tile de piso.
    float groundOffset = 0.0f;
    // Celdas por lado que ocupa, desde position hacia +col y +row. El sprite
    // se agranda span veces y se apoya en el centro del bloque; el collider
    // ya viene del tamano del bloque entero. 1 = una casilla.
    int span = 1;
    Vector2 colliderSize;        // {0,0} si la entidad no colisiona
    bool colliderSolid = false;  // true si el collider bloquea el movimiento
    bool destroyed = false;      // borrado suave: la accion destroy_entity solo marca esto
};

struct LoadedLevel {
    std::string name;
    IsoGridSystem grid;
    std::vector<LevelEntity> entities;
    const Texture2D* floorTexture;
    Rectangle floorSourceRect;
    const Texture2D* wallTexture;
    Rectangle wallSourceRect;
    std::vector<GridCoord> floorTiles;
    std::vector<GridCoord> wallTiles;
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
