// Implementacion de ZSortSystem. El contrato de la clase esta en el .hpp.
//
// La idea entera del archivo: durante el frame nadie dibuja: todos ENCOLAN con
// Submit(). Al final del frame, Flush() ordena la cola por profundidad y recien
// ahi dibuja. Eso es lo que hace que en isometrico una pared pueda tapar a un
// personaje que se encolo despues que ella.

#include "ZSortSystem.hpp"

#include <algorithm>

ZSortSystem::ZSortSystem(GraphicsDevice& gfx) : gfx_(gfx) {}

// Encolar es barato a proposito: no ordena ni dibuja nada. Todo el trabajo se
// hace de una sola vez en Flush().
void ZSortSystem::Submit(const SpriteInstance& sprite) {
    queue_.push_back(sprite);
}

// Ordena la cola por profundidad y la dibuja de una sola pasada, dejandola
// vacia para el frame siguiente.
void ZSortSystem::Flush() {
    // Algoritmo del pintor: lo que esta mas "atras" (menor Y en pantalla) se
    // dibuja primero, para que lo de adelante lo tape. En isometrico, la Y de
    // pantalla del punto de apoyo es exactamente la profundidad.
    //
    // Se usa sortPosition y no screenPosition a proposito: screenPosition
    // incluye los offsets visuales (centrar el sprite, levantar una pared), y
    // ordenar por eso daria un orden equivocado.
    std::sort(queue_.begin(), queue_.end(),
        [](const SpriteInstance& a, const SpriteInstance& b) {

            if (a.sortPosition.y != b.sortPosition.y) {
                return a.sortPosition.y < b.sortPosition.y;
            }

            // En un empate, el layer garantiza piso -> pared -> entidad sin
            // depender del orden en que se hayan encolado.
            return a.layer < b.layer;
        });

    for (const auto& sprite : queue_) {
        // destinationSize en {0,0} significa "sin escalar": se dibuja al tamano
        // original del recorte del spritesheet.
        Rectangle dest{
            sprite.screenPosition.x, sprite.screenPosition.y,
            sprite.destinationSize.x > 0 ? sprite.destinationSize.x : sprite.source.width,
            sprite.destinationSize.y > 0 ? sprite.destinationSize.y : sprite.source.height
        };
        gfx_.DrawSprite(*sprite.texture, sprite.source, dest,
                         sprite.origin, sprite.rotation, sprite.tint);
    }

    // La cola es por frame: quien dibuja vuelve a encolar todo el frame que viene.
    queue_.clear();
}
