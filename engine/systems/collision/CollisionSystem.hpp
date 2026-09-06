#pragma once

#include <vector>

#include "raylib.h"

struct ColliderInstance {
    void* owner;       // token opaco: quien llama sabe a que entidad pertenece
    Rectangle bounds;   // caja delimitadora (AABB) en espacio de pantalla/mundo
};

struct CollisionPair {
    void* a;
    void* b;
};

// Detecta solapamientos entre cajas delimitadoras (AABB) en espacio continuo.
// Mismo patron Submit/Flush que ZSortSystem: no depende de un registro
// persistente de entidades (todavia no existe en el motor) -- cada frame
// quien mueve/dibuja algo encola su collider, y al final se consultan los
// pares que se solapan.
class CollisionSystem {
public:
    void Submit(const ColliderInstance& collider);
    std::vector<CollisionPair> Flush();

private:
    std::vector<ColliderInstance> queue_;
};
