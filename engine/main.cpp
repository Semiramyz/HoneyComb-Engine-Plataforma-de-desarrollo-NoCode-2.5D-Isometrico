#include <fstream>
#include <iostream>

#include "raylib.h"
#include "nlohmann/json.hpp"

int main() {
    nlohmann::json level;
    std::ifstream file("levels/test_level.json");
    if (file.is_open()) {
        file >> level;
        std::cout << "Nivel cargado: " << level.value("name", "sin_nombre") << std::endl;
    } else {
        std::cout << "levels/test_level.json no encontrado, se omite la carga." << std::endl;
    }

    InitWindow(800, 450, "HoneyComb Engine - Runtime");
    SetTargetFPS(60);

    while (!WindowShouldClose()) {
        BeginDrawing();
        ClearBackground(RAYWHITE);
        DrawText("HoneyComb Engine - Runtime OK", 190, 200, 20, DARKGRAY);
        EndDrawing();
    }

    CloseWindow();
    return 0;
}
