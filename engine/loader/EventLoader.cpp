#include "EventLoader.hpp"

namespace {

EventStep ParseStep(const nlohmann::json& stepJson) {
    EventStep step;
    step.type = stepJson.at("type").get<std::string>();
    step.params = stepJson.value("params", nlohmann::json::object());
    return step;
}

}  // namespace

std::vector<EventDefinition> EventLoader::Parse(const nlohmann::json& eventsArray) {
    std::vector<EventDefinition> events;
    events.reserve(eventsArray.size());

    for (const auto& eventJson : eventsArray) {
        EventDefinition def;
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
