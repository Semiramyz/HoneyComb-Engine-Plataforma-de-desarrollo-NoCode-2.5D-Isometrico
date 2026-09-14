// Implementacion de Inventory. Las reglas estan documentadas en el .hpp.

#include "Inventory.hpp"

#include <algorithm>

void Inventory::Configure(const InventoryConfig& config, const ItemCatalog& items) {
    slots_ = std::clamp(config.slots, 1, 9);
    locked_ = config.locked;
    onFull_ = config.onFull;
    weapons_.clear();
    active_ = -1;
    coins = config.coins;
    AddStartingWeapons(config, items);
}

void Inventory::CarryInto(const InventoryConfig& config, const ItemCatalog& items) {
    if (!config.present) {
        return;
    }
    slots_ = std::clamp(config.slots, 1, 9);
    locked_ = config.locked;
    onFull_ = config.onFull;
    if (static_cast<int>(weapons_.size()) > slots_) {
        weapons_.resize(slots_);
    }
    active_ = std::min(active_, static_cast<int>(weapons_.size()) - 1);
    AddStartingWeapons(config, items);
}

void Inventory::AddStartingWeapons(const InventoryConfig& config, const ItemCatalog& items) {
    for (const auto& id : config.items) {
        auto it = items.find(id);
        if (it == items.end() || it->second.kind != ItemKind::Weapon) {
            continue;
        }
        ItemDef ignored;
        AddWeapon(it->second, false, ignored);
    }
}

bool Inventory::HasItem(const std::string& itemId) const {
    return std::any_of(weapons_.begin(), weapons_.end(),
                       [&itemId](const InventorySlot& slot) { return slot.item.id == itemId; });
}

bool Inventory::IsFull() const {
    return static_cast<int>(weapons_.size()) >= slots_;
}

InventorySlot* Inventory::ActiveSlot() {
    return active_ >= 0 && active_ < static_cast<int>(weapons_.size()) ? &weapons_[active_] : nullptr;
}

const InventorySlot* Inventory::ActiveSlot() const {
    return active_ >= 0 && active_ < static_cast<int>(weapons_.size()) ? &weapons_[active_] : nullptr;
}

InventorySlot* Inventory::SlotFor(const std::string& itemId) {
    for (auto& slot : weapons_) {
        if (slot.item.id == itemId) {
            return &slot;
        }
    }
    return nullptr;
}

void Inventory::Select(int index) {
    if (index >= 0 && index < static_cast<int>(weapons_.size())) {
        active_ = index;
    }
}

void Inventory::Cycle(int step) {
    const int count = static_cast<int>(weapons_.size());
    if (count == 0) {
        return;
    }
    active_ = ((active_ + step) % count + count) % count;
}

Inventory::AddResult Inventory::AddWeapon(const ItemDef& weapon, bool replace, ItemDef& dropped) {
    if (HasItem(weapon.id)) {
        return AddResult::AlreadyOwned;
    }
    if (!IsFull()) {
        weapons_.push_back(InventorySlot{weapon, ComboState{}});
        // Sin arma en la mano, la que se junta pasa a ser la activa: juntar la
        // primera espada y seguir pegando con las manos no tendria sentido.
        if (active_ < 0) {
            active_ = static_cast<int>(weapons_.size()) - 1;
        }
        return AddResult::Added;
    }
    if (!replace || active_ < 0) {
        return AddResult::Full;
    }
    dropped = weapons_[active_].item;
    weapons_[active_] = InventorySlot{weapon, ComboState{}};
    return AddResult::Replaced;
}

std::vector<ItemDef> Inventory::SetSlots(int slots) {
    std::vector<ItemDef> dropped;
    if (locked_) {
        return dropped;
    }
    slots_ = std::clamp(slots, 1, 9);
    while (static_cast<int>(weapons_.size()) > slots_) {
        dropped.push_back(weapons_.back().item);
        weapons_.pop_back();
    }
    active_ = std::min(active_, static_cast<int>(weapons_.size()) - 1);
    return dropped;
}
