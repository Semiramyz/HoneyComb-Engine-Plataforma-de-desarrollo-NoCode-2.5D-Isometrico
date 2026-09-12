#pragma once

#include <vector>

#include "raylib.h"

#include "core/GraphicsDevice.hpp"

// Capas de dibujo. El suelo es un caso aparte: no compite en profundidad con
// nadie, siempre queda debajo. Paredes y entidades si se intercalan entre si
// segun su Y en pantalla, y la capa solo los desempata a igual profundidad.
namespace SpriteLayer {
    constexpr int Ground = 0;  // piso: plano de fondo, nunca tapa nada
    constexpr int Object = 1;  // paredes y props apoyados en la grilla
    constexpr int Entity = 2;  // jugador, enemigos, objetos moviles
}

struct SpriteInstance {
    const Texture2D* texture;
    Rectangle source;

    Vector2 screenPosition;  // dónde se dibuja el sprite
    Vector2 sortPosition;    // punto de apoyo para profundidad

    Vector2 origin;
    float rotation;
    Color tint;
    int layer = SpriteLayer::Ground;
    Vector2 destinationSize = Vector2{0, 0};
};

// Ordena sprites por profundidad (algoritmo del pintor: menor Y en pantalla
// primero) y los dibuja via GraphicsDevice. No conoce grillas ni coordenadas
// de mundo -- solo posiciones ya proyectadas a pantalla -- para servir tanto
// a tiles alineados a la grilla como a entidades que se mueven libremente.
class ZSortSystem {
public:
    explicit ZSortSystem(GraphicsDevice& gfx);

    void Submit(const SpriteInstance& sprite);
    void Flush();

private:
    GraphicsDevice& gfx_;
    std::vector<SpriteInstance> queue_;
};
