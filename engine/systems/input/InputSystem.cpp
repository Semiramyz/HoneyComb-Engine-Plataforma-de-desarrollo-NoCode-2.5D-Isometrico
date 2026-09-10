#include "InputSystem.hpp"

// Implementacion de InputSystem. El contrato de la clase, y por que conviven
// las consultas por tecla con las acciones con nombre, estan en el .hpp.
//
// Todos los metodos de abajo se llaman igual que su funcion global de raylib
// correspondiente; se califican con :: para no recursar sobre si mismos.

bool InputSystem::IsKeyDown(int key) const {
    return ::IsKeyDown(key);
}

bool InputSystem::IsKeyPressed(int key) const {
    return ::IsKeyPressed(key);
}

bool InputSystem::IsKeyReleased(int key) const {
    return ::IsKeyReleased(key);
}

Vector2 InputSystem::GetMousePosition() const {
    return ::GetMousePosition();
}

bool InputSystem::IsMouseButtonDown(int button) const {
    return ::IsMouseButtonDown(button);
}

bool InputSystem::IsMouseButtonPressed(int button) const {
    return ::IsMouseButtonPressed(button);
}

// Enlaza una accion a una tecla. Reasignar es simplemente volver a llamar con
// la misma accion: el mapa pisa el valor anterior.
void InputSystem::BindAction(const std::string& actionName, int key) {
    actionBindings_[actionName] = key;
}

// Los dos IsAction* de abajo traducen nombre -> tecla y recien ahi preguntan.
// Una accion sin enlazar devuelve false en vez de reventar: es lo seguro, un
// control sin asignar simplemente no responde.

bool InputSystem::IsActionDown(const std::string& actionName) const {
    auto it = actionBindings_.find(actionName);
    if (it == actionBindings_.end()) {
        return false;
    }
    return IsKeyDown(it->second);
}

bool InputSystem::IsActionPressed(const std::string& actionName) const {
    auto it = actionBindings_.find(actionName);
    if (it == actionBindings_.end()) {
        return false;
    }
    return IsKeyPressed(it->second);
}
