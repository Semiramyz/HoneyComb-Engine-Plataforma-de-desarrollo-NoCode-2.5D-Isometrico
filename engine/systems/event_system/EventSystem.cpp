// Implementacion de EventSystem: el motor NoCode de "cuando pase X, si se
// cumple Y, haces Z". El contrato de la clase esta documentado en el .hpp.
//
// Los Register* de abajo son la tabla de traduccion entre el catalogo del
// editor y el codigo C++: la clave es el "type" que aparece en el JSON del
// nivel, y el valor es la funcion que lo ejecuta. Se llenan una sola vez al
// arrancar (ver main.cpp); despues solo se consultan.

#include "EventSystem.hpp"

void EventSystem::RegisterTrigger(const std::string& type, TriggerFn fn) {
    triggers_[type] = std::move(fn);
}

void EventSystem::RegisterCondition(const std::string& type, ConditionFn fn) {
    conditions_[type] = std::move(fn);
}

void EventSystem::RegisterAction(const std::string& type, ActionFn fn) {
    actions_[type] = std::move(fn);
}

// Reemplaza los eventos cargados (no los suma): cargar un nivel nuevo tiene que
// dejar afuera los del anterior. El recuerdo de "ya se cumplia" arranca en
// falso para todos, asi un evento del nivel nuevo puede dispararse desde el
// primer frame.
void EventSystem::LoadEvents(std::vector<EventDefinition> events) {
    events_ = std::move(events);
    wasActive_.assign(events_.size(), false);
}

// true si el trigger dispara y se cumplen TODAS las condiciones.
bool EventSystem::IsActive(const EventDefinition& event) const {
    // Trigger. Un type sin registrar se trata como "no dispara": un nivel que
    // use un bloque que este binario no conoce sigue corriendo en vez de
    // romper. Ese perdon es lo que permite que el catalogo del editor y el
    // motor evolucionen a distinto ritmo.
    auto triggerIt = triggers_.find(event.trigger.type);
    if (triggerIt == triggers_.end() || !triggerIt->second(event.trigger.params)) {
        return false;
    }

    // Condiciones: se exigen TODAS (AND), y se corta en la primera que falle.
    // Una condicion sin registrar cuenta como no cumplida, que es el lado
    // seguro: ante la duda no se ejecuta.
    for (const auto& condition : event.conditions) {
        auto conditionIt = conditions_.find(condition.type);
        if (conditionIt == conditions_.end() || !conditionIt->second(condition.params)) {
            return false;
        }
    }
    return true;
}

// Se llama una vez por frame. Recorre los eventos del nivel en el orden en que
// los guardo el editor y ejecuta los que EMPIEZAN a cumplirse.
//
// Antes se ejecutaban en cada frame mientras se cumplieran. Con "destruir"
// daba igual, pero "Al eliminar una entidad -> pasar de nivel" o "al tocar ->
// reproducir sonido" se repetian sesenta veces por segundo. Un evento de
// NoCode se lee como "cuando pase X", y eso es un instante, no un estado.
void EventSystem::Update() {
    // Por indice y no con for-each: wasActive_ va en paralelo a events_.
    for (std::size_t index = 0; index < events_.size(); ++index) {
        const EventDefinition& event = events_[index];
        const bool active = IsActive(event);
        const bool starts = active && !wasActive_[index];
        wasActive_[index] = active;
        if (!starts) {
            continue;
        }

        // Acciones: en el orden en que el usuario las puso en el editor. Una
        // accion desconocida se saltea sin cortar las siguientes.
        for (const auto& action : event.actions) {
            auto actionIt = actions_.find(action.type);
            if (actionIt != actions_.end()) {
                actionIt->second(action.params);
            }
        }
    }
}
