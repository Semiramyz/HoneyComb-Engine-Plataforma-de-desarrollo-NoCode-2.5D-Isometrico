// Implementacion de EventLoader. El contrato esta documentado en el .hpp.

#include "EventLoader.hpp"

// Anonimo: ParseStep es un detalle interno de este archivo y no debe verse
// desde afuera.
namespace {

// Trigger, condicion y accion tienen la misma forma en el JSON ({type, params}),
// asi que un solo parser sirve para los tres.
EventStep ParseStep(const nlohmann::json& stepJson) {
    EventStep step;
    // at() para "type": si falta, el nivel esta mal y conviene que reviente
    // aca con un mensaje claro y no mas tarde con un evento que no hace nada.
    step.type = stepJson.at("type").get<std::string>();
    // value() para "params": un bloque sin parametros es perfectamente valido.
    step.params = stepJson.value("params", nlohmann::json::object());
    return step;
}

}  // namespace

std::vector<EventDefinition> EventLoader::Parse(const nlohmann::json& eventsArray) {
    std::vector<EventDefinition> events;
    events.reserve(eventsArray.size());

    for (const auto& eventJson : eventsArray) {
        EventDefinition def;
        // El trigger es obligatorio (un evento sin disparador no existe);
        // conditions y actions son opcionales.
        def.trigger = ParseStep(eventJson.at("trigger"));

        if (eventJson.contains("conditions")) {
            for (const auto& conditionJson : eventJson.at("conditions")) {
                def.conditions.push_back(ParseStep(conditionJson));
            }
        }

        if (eventJson.contains("actions")) {
            for (const auto& actionJson : eventJson.at("actions")) {
                def.actions.push_back(ParseStep(actionJson));
            }
        }

        events.push_back(std::move(def));
    }

    return events;
}
