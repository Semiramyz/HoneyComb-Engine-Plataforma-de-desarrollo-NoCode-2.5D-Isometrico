#include "ZSortSystem.hpp"

#include <algorithm>

ZSortSystem::ZSortSystem(GraphicsDevice& gfx) : gfx_(gfx) {}

void ZSortSystem::Submit(const SpriteInstance& sprite) {
    queue_.push_back(sprite);
}

void ZSortSystem::Flush() {
    std::sort(queue_.begin(), queue_.end(), [](const SpriteInstance& a, const SpriteInstance& b) {
        if (a.screenPosition.y != b.screenPosition.y) {
            return a.screenPosition.y < b.screenPosition.y;
        }
        return a.layer < b.layer;
    });

    for (const auto& sprite : queue_) {
        Rectangle dest{
            sprite.screenPosition.x, sprite.screenPosition.y,
            sprite.source.width, sprite.source.height
        };
        gfx_.DrawSprite(*sprite.texture, sprite.source, dest,
                         sprite.origin, sprite.rotation, sprite.tint);
    }

    queue_.clear();
}
