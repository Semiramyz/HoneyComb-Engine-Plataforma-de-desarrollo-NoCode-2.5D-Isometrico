// Implementacion de CollisionSystem. El contrato de la clase y el porque del
// patron Submit/Flush estan documentados en el .hpp.

#include "CollisionSystem.hpp"

#include <cstddef>

void CollisionSystem::Submit(const ColliderInstance& collider) {
    queue_.push_back(collider);
}

// Cruza todos los colliders encolados y devuelve los pares que se solapan,
// vaciando la cola para el frame siguiente.
std::vector<CollisionPair> CollisionSystem::Flush() {
    std::vector<CollisionPair> collisions;

    // Fuerza bruta O(n^2), con j = i + 1 para no repetir el par (a,b) como
    // (b,a) ni comparar un collider contra si mismo. Alcanza de sobra para la
    // escala de un nivel isometrico (decenas de entidades); si algun dia hay
    // cientos, aca va una grilla espacial o un quadtree.
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
