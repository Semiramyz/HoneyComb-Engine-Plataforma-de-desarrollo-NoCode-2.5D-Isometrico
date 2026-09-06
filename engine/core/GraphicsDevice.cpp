#include "GraphicsDevice.hpp"

GraphicsDevice::GraphicsDevice(int width, int height, const char* title) {
    InitWindow(width, height, title);
}

GraphicsDevice::~GraphicsDevice() {
    CloseWindow();
}

bool GraphicsDevice::ShouldClose() const {
    return WindowShouldClose();
}

void GraphicsDevice::SetTargetFPS(int fps) {
    // Calificado con :: para llamar a la funcion global de raylib y no
    // recursar sobre este mismo metodo (mismo nombre).
    ::SetTargetFPS(fps);
}

float GraphicsDevice::GetDeltaTime() const {
    return GetFrameTime();
}

void GraphicsDevice::BeginFrame(Color clearColor) {
    BeginDrawing();
    ClearBackground(clearColor);
}

void GraphicsDevice::EndFrame() {
    EndDrawing();
}

void GraphicsDevice::DrawSprite(const Texture2D& texture, Rectangle source, Rectangle dest,
                                 Vector2 origin, float rotation, Color tint) {
    DrawTexturePro(texture, source, dest, origin, rotation, tint);
}

void GraphicsDevice::DrawText(const Font& font, const char* text, Vector2 position,
                               float fontSize, Color color) {
    DrawTextEx(font, text, position, fontSize, 1.0f, color);
}

int GraphicsDevice::GetScreenWidth() const {
    return ::GetScreenWidth();
}

int GraphicsDevice::GetScreenHeight() const {
    return ::GetScreenHeight();
}
