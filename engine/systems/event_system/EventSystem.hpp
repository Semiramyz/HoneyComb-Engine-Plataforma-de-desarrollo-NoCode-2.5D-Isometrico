#pragma once

#include <functional>
#include <string>
#include <unordered_map>
#include <vector>

#include "nlohmann/json.hpp"

using TriggerFn = std::function<bool(const nlohmann::json& params)>;
using ConditionFn = std::function<bool(const nlohmann::json& params)>;
using ActionFn = std::function<void(const nlohmann::json& params)>;

// Un paso individual (trigger, condicion o accion) tal como aparece en el
// nivel: "type" coincide con un ID de schema/event_catalog.json, "params" son
// los parametros que la persona configuro en el editor para ese bloque.
struct EventStep {
    std::string type;
    nlohmann::json params;
};

struct EventDefinition {
    EventStep trigger;
    std::vector<EventStep> conditions;
    std::vector<EventStep> actions;
};

// Motor de eventos "condicion-accion" sin codigo. El comportamiento real de
// cada "type" del catalogo se registra una sola vez en C++ (RegisterTrigger/
// RegisterCondition/RegisterAction); agregar un bloque nuevo al catalogo del
// editor no requiere tocar esta clase ni recompilar por cada nivel.
class EventSystem {
public:
    void RegisterTrigger(const std::string& type, TriggerFn fn);
    void RegisterCondition(const std::string& type, ConditionFn fn);
    void RegisterAction(const std::string& type, ActionFn fn);

    void LoadEvents(std::vector<EventDefinition> events);

    // Evalua todos los eventos cargados: si el trigger dispara y todas las
    // condiciones se cumplen, ejecuta las acciones en orden. Un type sin
    // registrar se ignora (no rompe el nivel).
    void Update();

private:
    std::unordered_map<std::string, TriggerFn> triggers_;
    std::unordered_map<std::string, ConditionFn> conditions_;
    std::unordered_map<std::string, ActionFn> actions_;
    std::vector<EventDefinition> events_;
};
