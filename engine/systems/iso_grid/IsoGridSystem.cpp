// Implementacion de IsoGridSystem: las dos conversiones entre coordenadas de
// grilla y coordenadas de pantalla. El contrato de la clase esta en el .hpp.
//
// Su espejo en el editor es editor/src/app/core/iso-projection.ts, y las
// formulas tienen que ser identicas en los dos lados: si divergen, lo que el
// disenador ve en el canvas deja de coincidir con lo que dibuja el runtime.

#include "IsoGridSystem.hpp"

#include <cmath>

IsoGridSystem::IsoGridSystem(int gridWidth, int gridHeight, int tileWidth, int tileHeight)
    : gridWidth_(gridWidth), gridHeight_(gridHeight),
      tileWidth_(tileWidth), tileHeight_(tileHeight) {}

Vector2 IsoGridSystem::GridToScreen(GridCoord coord) const {
    return GridToScreen(Vector2{static_cast<float>(coord.col), static_cast<float>(coord.row)});
}

// Toma Vector2 (y no GridCoord) para aceptar posiciones fraccionarias: una
// entidad que se mueve suave esta en la celda 3.4, no en la 3 ni en la 4.
Vector2 IsoGridSystem::GridToScreen(Vector2 coord) const {
    // La proyeccion isometrica clasica ("diamante"): avanzar una columna mueve
    // media celda a la derecha y media hacia abajo; avanzar una fila, media a
    // la izquierda y media hacia abajo. De ahi la resta en X y la suma en Y.
    float halfW = tileWidth_ / 2.0f;
    float halfH = tileHeight_ / 2.0f;
    return Vector2{
        (coord.x - coord.y) * halfW,
        (coord.x + coord.y) * halfH
    };
}

// Inversa exacta de GridToScreen: se despeja col y row del sistema de dos
// ecuaciones (x = (col-row)*halfW, y = (col+row)*halfH).
GridCoord IsoGridSystem::ScreenToGrid(Vector2 screenPos) const {
    float halfW = tileWidth_ / 2.0f;
    float halfH = tileHeight_ / 2.0f;
    float colF = (screenPos.x / halfW + screenPos.y / halfH) / 2.0f;
    float rowF = (screenPos.y / halfH - screenPos.x / halfW) / 2.0f;
    // floor y no cast a int: el cast trunca hacia cero, lo que haria que las
    // coordenadas negativas (clicks fuera de la grilla) devuelvan la celda
    // equivocada. Ver el mismo detalle en el editor: iso-projection.ts.
    return GridCoord{
        static_cast<int>(std::floor(colF)),
        static_cast<int>(std::floor(rowF))
    };
}

// Una celda es valida solo si cae DENTRO de la grilla declarada por el nivel.
// Lo usa el editor para no colocar entidades fuera, y el runtime para frenar al
// jugador en los bordes.
bool IsoGridSystem::IsValidCoord(GridCoord coord) const {
    return coord.col >= 0 && coord.col < gridWidth_ &&
           coord.row >= 0 && coord.row < gridHeight_;
}

int IsoGridSystem::GetGridWidth() const { return gridWidth_; }
int IsoGridSystem::GetGridHeight() const { return gridHeight_; }
int IsoGridSystem::GetTileWidth() const { return tileWidth_; }
int IsoGridSystem::GetTileHeight() const { return tileHeight_; }
