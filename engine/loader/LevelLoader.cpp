#include "LevelLoader.hpp"

#include <fstream>
#include <stdexcept>

#include "nlohmann/json.hpp"

#include "loader/EventLoader.hpp"

LevelLoader::LevelLoader(ResourceManager& resources, AssetResolver& assets)
    : resources_(resources), assets_(assets) {}

LoadedLevel LevelLoader::Load(const std::string& levelPath, EventSystem& eventSystem) {
    std::ifstream file(levelPath);
    if (!file.is_open()) {
        throw std::runtime_error("LevelLoader: no se pudo abrir " + levelPath);
    }

    nlohmann::json levelJson;
    file >> levelJson;

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
        Rectangle{0, 0, 0, 0}
    };

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
            entity.precisePosition = Vector2{
                static_cast<float>(entity.position.col),
                static_cast<float>(entity.position.row)
            };

            std::string texturePath = assets_.Resolve(entityJson.at("texture").get<std::string>());
            entity.texture = &resources_.GetTexture(texturePath);

            const auto& srcJson = entityJson.at("sourceRect");
            entity.sourceRect = Rectangle{
                srcJson.at("x").get<float>(), srcJson.at("y").get<float>(),
                srcJson.at("width").get<float>(), srcJson.at("height").get<float>()
            };

            entity.animationClip = entityJson.value("animation", std::string(""));

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

    if (levelJson.contains("events")) {
        eventSystem.LoadEvents(EventLoader::Parse(levelJson.at("events")));
    }

    return level;
}
