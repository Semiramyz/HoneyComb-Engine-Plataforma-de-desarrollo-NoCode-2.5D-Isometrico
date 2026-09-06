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

void EventSystem::LoadEvents(std::vector<EventDefinition> events) {
    events_ = std::move(events);
}

void EventSystem::Update() {
    for (const auto& event : events_) {
        auto triggerIt = triggers_.find(event.trigger.type);
        if (triggerIt == triggers_.end() || !triggerIt->second(event.trigger.params)) {
            continue;
        }

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

        for (const auto& action : event.actions) {
            auto actionIt = actions_.find(action.type);
            if (actionIt != actions_.end()) {
                actionIt->second(action.params);
            }
        }
    }
}
