#pragma once

#include <vector>

#include "nlohmann/json.hpp"

#include "systems/event_system/EventSystem.hpp"

// Traduce el array "events" de un nivel (ver schema/level.schema.json) a la
// forma que EventSystem::LoadEvents() espera. Sin estado -- solo parseo.
class EventLoader {
public:
    static std::vector<EventDefinition> Parse(const nlohmann::json& eventsArray);
};
