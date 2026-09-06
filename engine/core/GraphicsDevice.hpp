#pragma once

#include "raylib.h"

// Unico punto de entrada a rcore/rlgl para ventana y dibujo. Ningun System de
// la Capa 2 debe llamar funciones de raylib directamente: todo pasa por aca.
class GraphicsDevice {
public:
    GraphicsDevice(int width, int height, const char* title);
    ~GraphicsDevice();

    GraphicsDevice(const GraphicsDevice&) = delete;
    GraphicsDevice& operator=(const GraphicsDevice&) = delete;

    bool ShouldClose() const;
    void SetTargetFPS(int fps);
    float GetDeltaTime() const;

    void BeginFrame(Color clearColor);
    void EndFrame();

    void DrawSprite(const Texture2D& texture, Rectangle source, Rectangle dest,
                     Vector2 origin, float rotation, Color tint);
    void DrawText(const Font& font, const char* text, Vector2 position,
                  float fontSize, Color color);

    int GetScreenWidth() const;
    int GetScreenHeight() const;
};
