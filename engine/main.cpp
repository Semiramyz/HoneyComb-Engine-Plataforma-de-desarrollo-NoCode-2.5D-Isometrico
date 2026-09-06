#include <iostream>
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

int main() {
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

    // --- InputSystem: acciones de movimiento en grilla, una celda por vez ---
    InputSystem input;
    input.BindAction("move_up", KEY_UP);
    input.BindAction("move_down", KEY_DOWN);
    input.BindAction("move_left", KEY_LEFT);
    input.BindAction("move_right", KEY_RIGHT);

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
        // --- Movimiento del jugador (una celda por pulsacion, con limites) ---
        if (player && !player->destroyed) {
            GridCoord next = player->position;
            if (input.IsActionPressed("move_up")) next.row -= 1;
            else if (input.IsActionPressed("move_down")) next.row += 1;
            else if (input.IsActionPressed("move_left")) next.col -= 1;
            else if (input.IsActionPressed("move_right")) next.col += 1;

            if (level.grid.IsValidCoord(next)) {
                player->position = next;
            }
        }

        gfx.BeginFrame(RAYWHITE);

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

            Vector2 screenPos = level.grid.GridToScreen(entity.position);
            // Offset simple de "camara" para centrar la grilla en la ventana;
            // IsoGridSystem no conoce pantalla/camara a proposito.
            screenPos.x += gfx.GetScreenWidth() / 2.0f;
            screenPos.y += 50.0f;

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

        gfx.DrawText(defaultFont, "HoneyComb Engine - Runtime OK (usa las flechas)", {10, 10}, 20, DARKGRAY);
        gfx.EndFrame();
    }

    return 0;
}
