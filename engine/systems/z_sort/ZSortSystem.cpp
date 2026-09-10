#include "ZSortSystem.hpp"

#include <algorithm>

ZSortSystem::ZSortSystem(GraphicsDevice& gfx) : gfx_(gfx) {}

void ZSortSystem::Submit(const SpriteInstance& sprite) {
    queue_.push_back(sprite);
}

void ZSortSystem::Flush() {
std::sort(queue_.begin(), queue_.end(),
    [](const SpriteInstance& a, const SpriteInstance& b) {

        if (a.sortPosition.y != b.sortPosition.y) {
            return a.sortPosition.y < b.sortPosition.y;
        }

        return a.layer < b.layer;
    });

    for (const auto& sprite : queue_) {
        Rectangle dest{
            sprite.screenPosition.x, sprite.screenPosition.y,
            sprite.destinationSize.x > 0 ? sprite.destinationSize.x : sprite.source.width,
            sprite.destinationSize.y > 0 ? sprite.destinationSize.y : sprite.source.height
        };
        gfx_.DrawSprite(*sprite.texture, sprite.source, dest,
                         sprite.origin, sprite.rotation, sprite.tint);
    }

    queue_.clear();
}
