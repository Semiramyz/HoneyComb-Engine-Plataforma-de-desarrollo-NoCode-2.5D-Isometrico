#pragma once

#include <string>
#include <unordered_map>

#include "raylib.h"

// Envoltorio de entrada de teclado/mouse. Expone tanto consultas directas por
// codigo de tecla de raylib (sin indireccion, para el caso simple) como
// "acciones" con nombre enlazadas a una tecla (para que el editor permita
// reasignar controles sin tocar el JSON de eventos, que solo referencia el
// nombre de la accion).
class InputSystem {
public:
    bool IsKeyDown(int key) const;
    bool IsKeyPressed(int key) const;
    bool IsKeyReleased(int key) const;

    Vector2 GetMousePosition() const;
    bool IsMouseButtonDown(int button) const;
    bool IsMouseButtonPressed(int button) const;

    // Enlaza/reasigna que tecla dispara una accion con nombre (ej. "saltar").
    void BindAction(const std::string& actionName, int key);
    bool IsActionDown(const std::string& actionName) const;
    bool IsActionPressed(const std::string& actionName) const;

private:
    std::unordered_map<std::string, int> actionBindings_;
};
