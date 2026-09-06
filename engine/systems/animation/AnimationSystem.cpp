#include "AnimationSystem.hpp"

void AnimationSystem::RegisterClip(const std::string& name, AnimationClip clip) {
    clips_[name] = std::move(clip);
}

const AnimationClip& AnimationSystem::GetClip(const std::string& name) const {
    return clips_.at(name);
}

void AnimationInstance::Play(const AnimationClip& clip, bool restart) {
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
    while (elapsed_ >= clip_->frameDuration) {
        elapsed_ -= clip_->frameDuration;
        currentFrame_++;

        if (currentFrame_ >= static_cast<int>(clip_->frames.size())) {
            if (clip_->loop) {
                currentFrame_ = 0;
            } else {
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
