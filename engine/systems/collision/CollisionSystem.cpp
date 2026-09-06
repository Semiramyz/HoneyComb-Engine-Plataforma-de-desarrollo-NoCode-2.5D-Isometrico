#include "CollisionSystem.hpp"

#include <cstddef>

void CollisionSystem::Submit(const ColliderInstance& collider) {
    queue_.push_back(collider);
}

std::vector<CollisionPair> CollisionSystem::Flush() {
    std::vector<CollisionPair> collisions;

    for (std::size_t i = 0; i < queue_.size(); ++i) {
        for (std::size_t j = i + 1; j < queue_.size(); ++j) {
            if (CheckCollisionRecs(queue_[i].bounds, queue_[j].bounds)) {
                collisions.push_back(CollisionPair{queue_[i].owner, queue_[j].owner});
            }
        }
    }

    queue_.clear();
    return collisions;
}
