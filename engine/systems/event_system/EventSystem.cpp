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
// dejar afuera los del anterior.
void EventSystem::LoadEvents(std::vector<EventDefinition> events) {
    events_ = std::move(events);
}

// Se llama una vez por frame. Recorre los eventos del nivel en el orden en que
// los guardo el editor y ejecuta los que corresponda.
void EventSystem::Update() {
    for (const auto& event : events_) {
        // 1) Trigger. Un type sin registrar se trata como "no dispara": un
        // nivel que use un bloque que este binario no conoce sigue corriendo
        // en vez de romper. Ese perdon es lo que permite que el catalogo del
        // editor y el motor evolucionen a distinto ritmo.
        auto triggerIt = triggers_.find(event.trigger.type);
        if (triggerIt == triggers_.end() || !triggerIt->second(event.trigger.params)) {
            continue;
        }

        // 2) Condiciones: se exigen TODAS (AND), y se corta en la primera que
        // falle para no evaluar de mas. Una condicion sin registrar cuenta
        // como no cumplida, que es el lado seguro: ante la duda no se ejecuta.
        bool allConditionsMet = true;
        for (const auto& condition : event.conditions) {
            auto conditionIt = conditions_.find(condition.type);
            if (conditionIt == conditions_.end() || !conditionIt->second(condition.params)) {
                allConditionsMet = false;
                break;
            }
        }
        if (!allConditionsMet) {
            continue;
        }

        // 3) Acciones: en el orden en que el usuario las puso en el editor.
        // Una accion desconocida se saltea sin cortar las siguientes.
        for (const auto& action : event.actions) {
            auto actionIt = actions_.find(action.type);
            if (actionIt != actions_.end()) {
                actionIt->second(action.params);
            }
        }
    }
}
