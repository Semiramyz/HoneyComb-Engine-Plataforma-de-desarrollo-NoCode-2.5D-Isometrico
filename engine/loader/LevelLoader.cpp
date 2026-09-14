#include "LevelLoader.hpp"

#include <fstream>
#include <stdexcept>

#include <algorithm>

#include "nlohmann/json.hpp"

#include "loader/EventLoader.hpp"
#include "loader/ItemLoader.hpp"

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

    // --- Color de fondo ----------------------------------------------------
    // Opcional: {r, g, b} de 0 a 255. Sin el bloque queda RAYWHITE, el fondo
    // de siempre, asi que los niveles viejos se ven igual.
    if (levelJson.contains("backgroundColor")) {
        const auto& colorJson = levelJson.at("backgroundColor");
        const auto channel = [&colorJson](const char* key) {
            return static_cast<unsigned char>(std::clamp(colorJson.value(key, 245), 0, 255));
        };
        level.backgroundColor = Color{channel("r"), channel("g"), channel("b"), 255};
    }

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

            // Animacion. "frames" manda; sin el, un nivel viejo con
            // "animation": "player_idle" conserva exactamente lo que tenia
            // (dos cuadros de 0.4 s), pero ahora medidos desde su propio
            // recorte y no desde uno fijo de 16x16.
            if (entityJson.contains("frames")) {
                int frames = entityJson.value("frames", 1);
                entity.frames = frames < 1 ? 1 : frames;
                float frameDuration = entityJson.value("frameDuration", 0.15f);
                entity.frameDuration = frameDuration > 0.0f ? frameDuration : 0.15f;
            } else if (entityJson.value("animation", std::string("")) == "player_idle") {
                entity.frames = 2;
                entity.frameDuration = 0.4f;
            }

            // Opcional y por defecto 0: los niveles escritos antes de que
            // existiera este campo se siguen dibujando exactamente igual.
            entity.groundOffset = entityJson.value("groundOffset", 0.0f);

            // Opcional y por defecto 1, por el mismo motivo. Un valor menor que
            // 1 no tiene sentido (no se puede ocupar media casilla) y se trata
            // como 1 en vez de dejar que el sprite se dibuje con tamano cero.
            int span = entityJson.value("span", 1);
            entity.span = span < 1 ? 1 : span;

            float scale = entityJson.value("scale", 1.0f);
            entity.scale = scale > 0.0f ? scale : 1.0f;

            // Lo que no declara el JSON queda con los valores del struct, que
            // son los de siempre: un jugador sin "stats" se mueve a 3 celdas/s.
            if (entityJson.contains("stats")) {
                const auto& statsJson = entityJson.at("stats");
                entity.health = statsJson.value("health", entity.health);
                entity.damage = statsJson.value("damage", entity.damage);
                entity.speed = statsJson.value("speed", entity.speed);
            }
            // La barra de vida se dibuja contra la vida inicial.
            entity.maxHealth = entity.health > 0.0f ? entity.health : 1.0f;

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

            // Combate, objetos y puzzles: todo opcional (ver ItemLoader).
            ItemLoader::ParseEntityCombat(entityJson, entity);
            entity.startPosition = entity.precisePosition;

            level.entities.push_back(entity);
        }
    }

    // --- Objetos y zonas -------------------------------------------------------
    // Los objetos se leen enteros (no son referencias a otro archivo): el nivel
    // se juega solo, sin la biblioteca items.json del editor.
    if (levelJson.contains("items")) {
        level.items = ItemLoader::ParseItems(levelJson.at("items"), resources_, assets_);
    }
    // Las salas del editor tambien son zonas: asi "Al limpiar una zona" sirve
    // con una sala sin tener que dibujar la zona dos veces.
    for (const char* key : {"rooms", "zones"}) {
        if (levelJson.contains(key) && levelJson.at(key).is_array()) {
            for (const auto& zoneJson : levelJson.at(key)) {
                level.zones.push_back(ItemLoader::ParseZone(zoneJson));
            }
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
