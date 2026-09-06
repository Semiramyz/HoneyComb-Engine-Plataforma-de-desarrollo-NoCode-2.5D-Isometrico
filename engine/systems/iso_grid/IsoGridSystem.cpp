#include "IsoGridSystem.hpp"

#include <cmath>

IsoGridSystem::IsoGridSystem(int gridWidth, int gridHeight, int tileWidth, int tileHeight)
    : gridWidth_(gridWidth), gridHeight_(gridHeight),
      tileWidth_(tileWidth), tileHeight_(tileHeight) {}

Vector2 IsoGridSystem::GridToScreen(GridCoord coord) const {
    float halfW = tileWidth_ / 2.0f;
    float halfH = tileHeight_ / 2.0f;
    return Vector2{
        (coord.col - coord.row) * halfW,
        (coord.col + coord.row) * halfH
    };
}

GridCoord IsoGridSystem::ScreenToGrid(Vector2 screenPos) const {
    float halfW = tileWidth_ / 2.0f;
    float halfH = tileHeight_ / 2.0f;
    float colF = (screenPos.x / halfW + screenPos.y / halfH) / 2.0f;
    float rowF = (screenPos.y / halfH - screenPos.x / halfW) / 2.0f;
    return GridCoord{
        static_cast<int>(std::floor(colF)),
        static_cast<int>(std::floor(rowF))
    };
}

bool IsoGridSystem::IsValidCoord(GridCoord coord) const {
    return coord.col >= 0 && coord.col < gridWidth_ &&
           coord.row >= 0 && coord.row < gridHeight_;
}

int IsoGridSystem::GetGridWidth() const { return gridWidth_; }
int IsoGridSystem::GetGridHeight() const { return gridHeight_; }
int IsoGridSystem::GetTileWidth() const { return tileWidth_; }
int IsoGridSystem::GetTileHeight() const { return tileHeight_; }
