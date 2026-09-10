// Implementacion de AnimationSystem y AnimationInstance. El contrato de ambas
// clases, y por que la definicion del clip vive separada de su estado de
// reproduccion, estan documentados en el .hpp.

#include "AnimationSystem.hpp"

void AnimationSystem::RegisterClip(const std::string& name, AnimationClip clip) {
    clips_[name] = std::move(clip);
}

// at() y no operator[]: pedir un clip que no existe es un error de programacion
// (un nivel que nombra una animacion no registrada), y conviene que reviente
// aca y no que devuelva un clip vacio que no se anima y no explica por que.
const AnimationClip& AnimationSystem::GetClip(const std::string& name) const {
    return clips_.at(name);
}

void AnimationInstance::Play(const AnimationClip& clip, bool restart) {
    // Pedir el clip que ya se esta reproduciendo no lo reinicia: asi se puede
    // llamar Play() cada frame (ej. "mientras camine, animacion de caminar")
    // sin que la animacion quede congelada en el primer frame.
    if (clip_ == &clip && !restart) {
        return;
    }
    clip_ = &clip;
    elapsed_ = 0.0f;
    currentFrame_ = 0;
    finished_ = false;
}

void AnimationInstance::Update(float deltaTime) {
    if (!clip_ || clip_->frames.empty() || finished_) {
        return;
    }

    elapsed_ += deltaTime;
    // while y no if: con un frame largo (un tiron de FPS) puede haber que
    // avanzar varios cuadros de golpe. Restar frameDuration en vez de poner
    // elapsed_ en cero conserva el sobrante y evita que la animacion se
    // desfase de a poco.
    while (elapsed_ >= clip_->frameDuration) {
        elapsed_ -= clip_->frameDuration;
        currentFrame_++;

        if (currentFrame_ >= static_cast<int>(clip_->frames.size())) {
            if (clip_->loop) {
                currentFrame_ = 0;
            } else {
                // Sin loop: se queda clavado en el ultimo cuadro y se marca
                // como terminado, para que quien la use pueda reaccionar.
                currentFrame_ = static_cast<int>(clip_->frames.size()) - 1;
                finished_ = true;
                break;
            }
        }
    }
}

Rectangle AnimationInstance::GetCurrentFrame() const {
    if (!clip_ || clip_->frames.empty()) {
        return Rectangle{0, 0, 0, 0};
    }
    return clip_->frames[currentFrame_];
}

bool AnimationInstance::IsFinished() const {
    return finished_;
}
