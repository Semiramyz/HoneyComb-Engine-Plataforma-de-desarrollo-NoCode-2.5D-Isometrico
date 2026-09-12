#include "LevelLoader.hpp"

#include <fstream>
#include <stdexcept>

#include "nlohmann/json.hpp"

#include "loader/EventLoader.hpp"

LevelLoader::LevelLoader(ResourceManager& resources, AssetResolver& assets)
    : resources_(resources), assets_(assets) {}

// Lee el archivo de nivel y devuelve todo lo que el runtime necesita para
// correrlo. Los eventos no van en el LoadedLevel: se cargan directo en el
// EventSystem que se recibe, porque es ahi donde se evaluan.
//
// Convencion en todo el metodo: at() para lo obligatorio (si falta, el nivel
// esta roto y conviene enterarse ya), value() con default para lo opcional.
LoadedLevel LevelLoader::Load(const std::string& levelPath, EventSystem& eventSystem) {
    std::ifstream file(levelPath);
    if (!file.is_open()) {
        throw std::runtime_error("LevelLoader: no se pudo abrir " + levelPath);
    }

    nlohmann::json levelJson;
    file >> levelJson;

    // --- Grilla -------------------------------------------------------------
    // Las medidas del tile son opcionales; el default 64x32 es la proporcion
    // 2:1 estandar del pixel art isometrico (mismo default que el editor).
    const auto& gridJson = levelJson.at("grid");
    int gridWidth = gridJson.at("width").get<int>();
    int gridHeight = gridJson.at("height").get<int>();
    int tileWidth = gridJson.value("tileWidth", 64);
    int tileHeight = gridJson.value("tileHeight", 32);

    LoadedLevel level{
        levelJson.value("name", std::string("sin_nombre")),
        IsoGridSystem(gridWidth, gridHeight, tileWidth, tileHeight),
        {},
        nullptr,
        Rectangle{0, 0, 0, 0},
        nullptr,
        Rectangle{0, 0, 0, 0},
        {},
        {}
    };

    // --- Visuales del nivel (piso y pared) ----------------------------------
    // Bloque opcional. Si falta, las texturas quedan en nullptr y main.cpp
    // simplemente no dibuja piso ni paredes (y sin pared tampoco hay bloqueo
    // en el perimetro). Los punteros apuntan a la cache del ResourceManager,
    // que es duena de las texturas y las libera al final.
    if (levelJson.contains("visuals")) {
        const auto& visualsJson = levelJson.at("visuals");
        if (visualsJson.contains("floor")) {
            const auto& floorJson = visualsJson.at("floor");
            level.floorTexture = &resources_.GetTexture(
                assets_.Resolve(floorJson.at("texture").get<std::string>()));
            const auto& source = floorJson.at("sourceRect");
            level.floorSourceRect = Rectangle{
                source.at("x").get<float>(), source.at("y").get<float>(),
                source.at("width").get<float>(), source.at("height").get<float>()
            };
        }
        if (visualsJson.contains("wall")) {
            const auto& wallJson = visualsJson.at("wall");
            level.wallTexture = &resources_.GetTexture(
                assets_.Resolve(wallJson.at("texture").get<std::string>()));
            const auto& source = wallJson.at("sourceRect");
            level.wallSourceRect = Rectangle{
                source.at("x").get<float>(), source.at("y").get<float>(),
                source.at("width").get<float>(), source.at("height").get<float>()
            };
        }
    }

    // Sin "tiles" se conserva el nivel rectangular legacy. Con "tiles", el
    // editor puede omitir celdas y decidir pared por pared.
    if (levelJson.contains("tiles")) {
        for (const auto& tileJson : levelJson.at("tiles")) {
            GridCoord tile{
                tileJson.at("col").get<int>(),
                tileJson.at("row").get<int>()
            };
            if (!level.grid.IsValidCoord(tile)) {
                throw std::runtime_error("LevelLoader: tile fuera de la grilla");
            }
            if (tileJson.value("floor", true)) {
                level.floorTiles.push_back(tile);
            }
            if (tileJson.value("wall", false)) {
                level.wallTiles.push_back(tile);
            }
        }
    } else {
        for (int row = 0; row < gridHeight; ++row) {
            for (int col = 0; col < gridWidth; ++col) {
                GridCoord tile{col, row};
                level.floorTiles.push_back(tile);
                if (col == 0 || row == 0 || col == gridWidth - 1 || row == gridHeight - 1) {
                    level.wallTiles.push_back(tile);
                }
            }
        }
    }

    // --- Entidades ----------------------------------------------------------
    if (levelJson.contains("entities")) {
        for (const auto& entityJson : levelJson.at("entities")) {
            LevelEntity entity;
            entity.id = entityJson.value("id", std::string(""));
            entity.type = entityJson.value("type", std::string(""));

            const auto& posJson = entityJson.at("position");
            entity.position = GridCoord{
                posJson.at("col").get<int>(),
                posJson.at("row").get<int>()
            };
            // El JSON solo guarda celdas enteras (el editor coloca sobre la
            // grilla), pero el runtime mueve en continuo: precisePosition
            // arranca en la celda declarada y desde ahi lleva los decimales.
            entity.precisePosition = Vector2{
                static_cast<float>(entity.position.col),
                static_cast<float>(entity.position.row)
            };

            // La ruta del JSON es relativa a assets/; AssetResolver la
            // completa y ResourceManager cachea, asi que dos entidades con la
            // misma textura comparten una sola carga en GPU.
            std::string texturePath = assets_.Resolve(entityJson.at("texture").get<std::string>());
            entity.texture = &resources_.GetTexture(texturePath);

            const auto& srcJson = entityJson.at("sourceRect");
            entity.sourceRect = Rectangle{
                srcJson.at("x").get<float>(), srcJson.at("y").get<float>(),
                srcJson.at("width").get<float>(), srcJson.at("height").get<float>()
            };

            entity.animationClip = entityJson.value("animation", std::string(""));

            // Collider opcional. size {0,0} = la entidad no participa de la
            // deteccion; solid=false = participa (dispara on_collision) pero
            // no frena al jugador, o sea, funciona como sensor/trigger.
            if (entityJson.contains("collider")) {
                const auto& colliderJson = entityJson.at("collider");
                entity.colliderSize = Vector2{
                    colliderJson.value("width", 0.0f),
                    colliderJson.value("height", 0.0f)
                };
                entity.colliderSolid = colliderJson.value("solid", false);
            } else {
                entity.colliderSize = Vector2{0, 0};
                entity.colliderSolid = false;
            }

            level.entities.push_back(entity);
        }
    }

    // --- Eventos ------------------------------------------------------------
    // Se cargan directo en el EventSystem (no viajan dentro de LoadedLevel):
    // el nivel describe QUE eventos hay, y el EventSystem ya tiene registrado
    // COMO se ejecuta cada type.
    if (levelJson.contains("events")) {
        eventSystem.LoadEvents(EventLoader::Parse(levelJson.at("events")));
    }

    return level;
}
