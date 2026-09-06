#pragma once

#include <string>
#include <unordered_map>
#include <vector>

#include "raylib.h"

struct AnimationClip {
    std::vector<Rectangle> frames;  // sub-rects dentro del spritesheet
    float frameDuration;             // segundos por frame
    bool loop;
};

// Catalogo de clips de animacion cargados del nivel/JSON, identificados por
// nombre (ej. "player_walk"). Mismo patron que ResourceManager con texturas:
// carga/cachea definiciones, no es dueno del estado de reproduccion (eso vive
// en AnimationInstance, que cada entidad posee por separado ya que el motor
// todavia no tiene un registro persistente de entidades).
class AnimationSystem {
public:
    void RegisterClip(const std::string& name, AnimationClip clip);
    const AnimationClip& GetClip(const std::string& name) const;

private:
    std::unordered_map<std::string, AnimationClip> clips_;
};

// Estado de reproduccion de UNA animacion en curso (ej. la animacion actual
// de un personaje).
class AnimationInstance {
public:
    void Play(const AnimationClip& clip, bool restart = false);
    void Update(float deltaTime);

    // Listo para usar directo como ZSortSystem::SpriteInstance::source.
    Rectangle GetCurrentFrame() const;

    bool IsFinished() const;  // solo relevante si el clip no hace loop

private:
    const AnimationClip* clip_ = nullptr;
    float elapsed_ = 0.0f;
    int currentFrame_ = 0;
    bool finished_ = false;
};
