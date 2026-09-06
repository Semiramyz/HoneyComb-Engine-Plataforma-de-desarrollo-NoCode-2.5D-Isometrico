#pragma once

#include "raylib.h"

struct GridCoord {
    int col;
    int row;
};

// Convierte coordenadas de grilla (columna/fila) a posicion en pantalla y
// viceversa, usando proyeccion isometrica. Todos los tamanos (grilla y tile)
// se reciben por constructor -- nada hardcodeado -- porque el editor visual
// permite que la persona los configure por proyecto/nivel (ver
// schema/level.schema.json: grid.width, grid.height, grid.tileWidth,
// grid.tileHeight). El estandar de pixel art isometrico es proporcion 2:1
// (tileWidth = 2 * tileHeight, ej. 64x32), pero cualquier proporcion es valida.
class IsoGridSystem {
public:
    IsoGridSystem(int gridWidth, int gridHeight, int tileWidth, int tileHeight);

    // Grilla (col, row) -> posicion en pantalla de la punta superior del tile
    // (sin offset de camara/origen; eso lo aplica quien dibuje).
    Vector2 GridToScreen(GridCoord coord) const;

    // Posicion en pantalla -> celda de grilla bajo ese punto (para mouse/click).
    GridCoord ScreenToGrid(Vector2 screenPos) const;

    bool IsValidCoord(GridCoord coord) const;

    int GetGridWidth() const;
    int GetGridHeight() const;
    int GetTileWidth() const;
    int GetTileHeight() const;

private:
    int gridWidth_;
    int gridHeight_;
    int tileWidth_;
    int tileHeight_;
};
