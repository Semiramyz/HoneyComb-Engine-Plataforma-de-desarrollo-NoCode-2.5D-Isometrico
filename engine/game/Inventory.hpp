#pragma once

#include <string>
#include <vector>

#include "loader/ItemDefs.hpp"

// Un casillero con un arma. Guarda la definicion ENTERA y no solo el id: el
// inventario pasa de un nivel a otro, y el nivel siguiente puede no declarar
// esa arma en sus "items". El contador de la habilidad es de cada arma: cambiar
// de arma no pierde lo cargado en la otra.
struct InventorySlot {
    ItemDef item;
    ComboState combo;
};

// Las armas y las monedas del jugador.
//
// Las armas ocupan casilleros contiguos (el 1, el 2, el 3...) hasta el limite,
// y una es la activa: la que ataca. Las teclas 1 a 9 eligen casillero. Lo que
// pasa al juntar un arma con todo lleno lo decide la configuracion del jugador
// en el nivel (OnFullInventory); esta clase solo sabe agregar o reemplazar, y
// quien la usa (game/Loot) decide cual de las dos pedir.
class Inventory {
public:
    enum class AddResult { Added, Replaced, AlreadyOwned, Full };

    // El inventario con el que arranca el jugador del nivel: limite, bloqueo,
    // regla de lleno, armas y monedas. Las armas se buscan en "items"; una que
    // el nivel no define se ignora.
    void Configure(const InventoryConfig& config, const ItemCatalog& items);

    // Al pasar de nivel se conservan armas y monedas. Si el jugador del nivel
    // nuevo declara inventario, manda su limite, su bloqueo y su regla, y se
    // suman sus armas iniciales que falten (mientras haya lugar).
    void CarryInto(const InventoryConfig& config, const ItemCatalog& items);

    bool HasItem(const std::string& itemId) const;
    bool IsFull() const;

    // nullptr si no hay ninguna arma: el jugador pega con las manos.
    InventorySlot* ActiveSlot();
    const InventorySlot* ActiveSlot() const;
    InventorySlot* SlotFor(const std::string& itemId);
    int ActiveIndex() const { return active_; }

    // Casillero por indice (0 = tecla 1). Uno vacio no hace nada.
    void Select(int index);
    // La siguiente o la anterior, dando la vuelta (rueda del mouse).
    void Cycle(int step);

    // Con lugar, el arma entra en el primer casillero libre. Lleno, solo se
    // cambia por la activa si "replace" es true, y la que sale queda en
    // "dropped" para dejarla en el piso.
    AddResult AddWeapon(const ItemDef& weapon, bool replace, ItemDef& dropped);

    // Cambia el limite (1 a 9). No hace nada con el limite bloqueado. Devuelve
    // las armas que ya no entran, para soltarlas.
    std::vector<ItemDef> SetSlots(int slots);

    int Slots() const { return slots_; }
    bool Locked() const { return locked_; }
    OnFullInventory OnFull() const { return onFull_; }
    const std::vector<InventorySlot>& Weapons() const { return weapons_; }

    int coins = 0;

private:
    void AddStartingWeapons(const InventoryConfig& config, const ItemCatalog& items);

    int slots_ = 3;
    bool locked_ = false;
    OnFullInventory onFull_ = OnFullInventory::ManualReplace;
    std::vector<InventorySlot> weapons_;
    int active_ = -1;
};
