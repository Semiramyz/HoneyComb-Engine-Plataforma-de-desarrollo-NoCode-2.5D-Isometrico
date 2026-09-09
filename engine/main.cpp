#include <iostream>
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <string>
#include <unordered_map>
#include <vector>

#include "core/GraphicsDevice.hpp"
#include "core/ResourceManager.hpp"
#include "loader/AssetResolver.hpp"
#include "loader/LevelLoader.hpp"
#include "systems/animation/AnimationSystem.hpp"
#include "systems/audio/AudioSystem.hpp"
#include "systems/collision/CollisionSystem.hpp"
#include "systems/event_system/EventSystem.hpp"
#include "systems/input/InputSystem.hpp"
#include "systems/z_sort/ZSortSystem.hpp"

int main(int argc, char* argv[]) {
    if (argc > 0) {
        std::filesystem::current_path(
            std::filesystem::absolute(argv[0]).parent_path());
    }

    GraphicsDevice gfx(800, 450, "HoneyComb Engine - Runtime");
    ResourceManager resources;
    AssetResolver assets;
    EventSystem events;
    LevelLoader loader(resources, assets);

    LoadedLevel level = loader.Load("levels/test_level.json", events);
    std::cout << "Nivel cargado: " << level.name
              << " (" << level.entities.size() << " entidades)" << std::endl;

    // Indice por id, para que los eventos (entity_ref en el JSON) y el
    // control del jugador puedan resolver a que LevelEntity se refieren. Los
    // punteros son estables porque el vector no se modifica tras cargar.
    std::unordered_map<std::string, LevelEntity*> entityById;
    for (auto& entity : level.entities) {
        entityById[entity.id] = &entity;
    }

    // --- AnimationSystem: catalogo + una instancia por entidad animada ---
    AnimationSystem animations;
    animations.RegisterClip("player_idle", AnimationClip{
        { Rectangle{0, 0, 16, 16}, Rectangle{16, 0, 16, 16} },
        0.4f,
        true
    });

    std::unordered_map<std::string, AnimationInstance> animInstances;
    for (auto& entity : level.entities) {
        if (!entity.animationClip.empty()) {
            AnimationInstance instance;
            instance.Play(animations.GetClip(entity.animationClip));
            animInstances[entity.id] = instance;
        }
    }

    // --- AudioSystem ---
    AudioSystem audio;

    // --- InputSystem: movimiento continuo en coordenadas de grilla ---
    InputSystem input;
    input.BindAction("move_up", KEY_UP);
    input.BindAction("move_down", KEY_DOWN);
    input.BindAction("move_left", KEY_LEFT);
    input.BindAction("move_right", KEY_RIGHT);
    input.BindAction("move_up_wasd", KEY_W);
    input.BindAction("move_down_wasd", KEY_S);
    input.BindAction("move_left_wasd", KEY_A);
    input.BindAction("move_right_wasd", KEY_D);

    // --- EventSystem: registro de trigger/acciones del catalogo minimo ---
    std::vector<CollisionPair> currentCollisions;

    events.RegisterTrigger("on_collision", [&currentCollisions, &entityById](const nlohmann::json& params) -> bool {
        auto itA = entityById.find(params.at("entityA").get<std::string>());
        auto itB = entityById.find(params.at("entityB").get<std::string>());
        if (itA == entityById.end() || itB == entityById.end()) {
            return false;
        }
        void* a = itA->second;
        void* b = itB->second;
        for (const auto& pair : currentCollisions) {
            if ((pair.a == a && pair.b == b) || (pair.a == b && pair.b == a)) {
                return true;
            }
        }
        return false;
    });

    events.RegisterAction("destroy_entity", [&entityById](const nlohmann::json& params) {
        auto it = entityById.find(params.at("entity").get<std::string>());
        if (it != entityById.end() && !it->second->destroyed) {
            it->second->destroyed = true;
            std::cout << "Accion destroy_entity ejecutada sobre '" << it->first << "'" << std::endl;
        }
    });

    events.RegisterAction("play_sound", [&resources, &assets, &audio](const nlohmann::json& params) {
        const Sound& sound = resources.GetSound(assets.Resolve(params.at("soundPath").get<std::string>()));
        audio.PlaySoundEffect(sound);
    });

    ZSortSystem zsort(gfx);
    CollisionSystem collision;
    Font defaultFont = GetFontDefault();
    gfx.SetTargetFPS(60);

    LevelEntity* player = entityById.count("player_1") ? entityById["player_1"] : nullptr;

    while (!gfx.ShouldClose()) {
        // --- Movimiento continuo con limites y bloqueo contra obstaculos ---
        if (player && !player->destroyed) {
            Vector2 screenDirection{0, 0};
            if (input.IsActionDown("move_up") || input.IsActionDown("move_up_wasd")) screenDirection.y -= 1;
            if (input.IsActionDown("move_down") || input.IsActionDown("move_down_wasd")) screenDirection.y += 1;
            if (input.IsActionDown("move_left") || input.IsActionDown("move_left_wasd")) screenDirection.x -= 1;
            if (input.IsActionDown("move_right") || input.IsActionDown("move_right_wasd")) screenDirection.x += 1;

            Vector2 direction{
                screenDirection.x + screenDirection.y,
                screenDirection.y - screenDirection.x
            };
            float directionLength = std::sqrt(direction.x * direction.x + direction.y * direction.y);
            if (directionLength > 0) {
                direction.x /= directionLength;
                direction.y /= directionLength;
                float movementSpeed = 3.0f;
                Vector2 candidate = player->precisePosition;
                candidate.x += direction.x * movementSpeed * gfx.GetDeltaTime();
                candidate.y += direction.y * movementSpeed * gfx.GetDeltaTime();

                float edgePadding = 0.45f;
                candidate.x = std::clamp(candidate.x, edgePadding,
                                         level.grid.GetGridWidth() - 1.0f - edgePadding);
                candidate.y = std::clamp(candidate.y, edgePadding,
                                         level.grid.GetGridHeight() - 1.0f - edgePadding);

                bool blocked = false;
                for (const auto& entity : level.entities) {
                    if (entity.destroyed || entity.type != "obstacle") {
                        continue;
                    }
                    if (std::fabs(candidate.x - entity.precisePosition.x) < 0.7f &&
                        std::fabs(candidate.y - entity.precisePosition.y) < 0.7f) {
                        blocked = true;
                        break;
                    }
                }

                if (!blocked) {
                    player->precisePosition = candidate;
                    player->position = GridCoord{
                        static_cast<int>(std::round(candidate.x)),
                        static_cast<int>(std::round(candidate.y))
                    };
                }
            }
        }

        gfx.BeginFrame(RAYWHITE);
        float levelOriginY = gfx.GetScreenHeight() / 2.0f -
            (level.grid.GetGridWidth() + level.grid.GetGridHeight() - 2) *
            level.grid.GetTileHeight() / 4.0f;

        for (int row = 0; row < level.grid.GetGridHeight(); ++row) {
            for (int col = 0; col < level.grid.GetGridWidth(); ++col) {
                Vector2 screenPos = level.grid.GridToScreen(GridCoord{col, row});
                screenPos.x += gfx.GetScreenWidth() / 2.0f;
                screenPos.y += levelOriginY;

                if (level.floorTexture) {
                    zsort.Submit(SpriteInstance{
                        level.floorTexture, level.floorSourceRect,
                        Vector2{screenPos.x - level.floorSourceRect.width / 2.0f,
                                screenPos.y - level.floorSourceRect.height / 2.0f},
                        Vector2{0, 0}, 0.0f, WHITE, 0
                    });
                }

                if (level.wallTexture &&
                    (col == 0 || row == 0 ||
                     col == level.grid.GetGridWidth() - 1 ||
                     row == level.grid.GetGridHeight() - 1)) {
                    zsort.Submit(SpriteInstance{
                        level.wallTexture, level.wallSourceRect,
                        Vector2{screenPos.x - level.wallSourceRect.width / 2.0f,
                                screenPos.y - level.wallSourceRect.height},
                        Vector2{0, 0}, 0.0f, WHITE, 1
                    });
                }
            }
        }

        for (auto& entity : level.entities) {
            if (entity.destroyed) {
                continue;
            }

            Rectangle sourceRect = entity.sourceRect;
            auto animIt = animInstances.find(entity.id);
            if (animIt != animInstances.end()) {
                animIt->second.Update(gfx.GetDeltaTime());
                sourceRect = animIt->second.GetCurrentFrame();
            }

            Vector2 screenPos = level.grid.GridToScreen(entity.precisePosition);
            // Offset simple de "camara" para centrar la grilla en la ventana;
            // IsoGridSystem no conoce pantalla/camara a proposito.
            screenPos.x += gfx.GetScreenWidth() / 2.0f;
            screenPos.y += levelOriginY;

            Color tint = (entity.type == "obstacle") ? RED : WHITE;
            zsort.Submit(SpriteInstance{
                entity.texture, sourceRect, screenPos,
                Vector2{0, 0}, 0.0f, tint
            });

            if (entity.colliderSize.x > 0 && entity.colliderSize.y > 0) {
                collision.Submit(ColliderInstance{
                    &entity,
                    Rectangle{screenPos.x, screenPos.y, entity.colliderSize.x, entity.colliderSize.y}
                });
            }
        }

        zsort.Flush();
        currentCollisions = collision.Flush();
        events.Update();
        audio.Update();

        gfx.DrawText(defaultFont, "HoneyComb Engine - Runtime OK (flechas o WASD)", {10, 10}, 20, DARKGRAY);
        gfx.EndFrame();
    }

    return 0;
}
