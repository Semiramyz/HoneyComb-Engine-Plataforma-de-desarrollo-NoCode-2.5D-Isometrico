#pragma once

#include <string>
#include <vector>

#include "raylib.h"

#include "core/ResourceManager.hpp"
#include "loader/AssetResolver.hpp"
#include "loader/ItemDefs.hpp"
#include "systems/event_system/EventSystem.hpp"
#include "systems/iso_grid/IsoGridSystem.hpp"

struct LevelEntity {
    std::string id;
    std::string type;
    GridCoord position;
    Vector2 precisePosition;
    const Texture2D* texture;
    Rectangle sourceRect;
    // Animacion: "frames" cuadros uno al lado del otro desde sourceRect, del
    // mismo ancho. 1 = quieto. Reemplaza al clip unico escrito en main.cpp.
    int frames = 1;
    float frameDuration = 0.15f;
    // Pixeles que el sprite baja al dibujarse. 0 = el borde de abajo del
    // sprite va en el punto de la celda (los "pies" de un personaje). Un
    // solido que llena la casilla usa este campo para apoyar el centro del
    // rombo de su base ahi, que es donde se centra el tile de piso.
    float groundOffset = 0.0f;
    // Celdas por lado que ocupa, desde position hacia +col y +row. El sprite
    // se agranda span veces y se apoya en el centro del bloque; el collider
    // ya viene del tamano del bloque entero. 1 = una casilla.
    int span = 1;
    // Tamano de dibujo del sprite (2 = el doble del recorte). Se multiplica
    // con span; el collider no cambia, se declara aparte en pixeles.
    float scale = 1.0f;
    // Caracteristicas ("stats" en el JSON). speed ya mueve al jugador; health y
    // damage quedan cargadas para el sistema de combate.
    float health = 100.0f;
    float damage = 0.0f;
    float speed = 3.0f;  // celdas de grilla por segundo
    // Estado de combate EN EJECUCION: no viene del JSON, lo lleva Combat.
    float maxHealth = 100.0f;  // la vida con la que arranco, para la barra
    float attackTimer = 0.0f;  // segundos hasta poder volver a pegar
    float hurtTimer = 0.0f;    // segundos de destello rojo por un golpe recibido
    Vector2 colliderSize;        // {0,0} si la entidad no colisiona
    bool colliderSolid = false;  // true si el collider bloquea el movimiento
    bool destroyed = false;      // borrado suave: la accion destroy_entity solo marca esto

    // --- Combate, objetos y puzzles (ver loader/ItemDefs.hpp) ----------------
    // Oculta pero no destruida: no se dibuja, no bloquea, no colisiona ni
    // pelea. La cambian show_entity / hide_entity (las puertas de un puzzle).
    bool hidden = false;
    bool boss = false;
    std::string itemId;    // objeto para juntar ("item" en el JSON)
    std::string weaponId;  // arma de un enemigo ("weapon")
    std::vector<DropEntry> drops;
    InventoryConfig inventory;
    DashConfig dash;
    DefenseConfig defense;
    std::vector<ShopEntry> shop;
    // En ejecucion: donde arranco, para "Al limpiar una zona" (un enemigo que
    // sale persiguiendo sigue contando para su sala), y el contador de la
    // habilidad de su arma si es un enemigo armado.
    Vector2 startPosition{0, 0};
    ComboState combo;
};

struct LoadedLevel {
    std::string name;
    IsoGridSystem grid;
    std::vector<LevelEntity> entities;
    const Texture2D* floorTexture;
    Rectangle floorSourceRect;
    const Texture2D* wallTexture;
    Rectangle wallSourceRect;
    std::vector<GridCoord> floorTiles;
    std::vector<GridCoord> wallTiles;
    // Fondo de la escena ("backgroundColor" en el JSON). RAYWHITE si falta.
    Color backgroundColor = RAYWHITE;
    // Definiciones de objetos ("items") por id, y las zonas de los puzzles: las
    // de "zones" mas una por cada sala de "rooms".
    ItemCatalog items;
    std::vector<Zone> zones;
};

// Orquestador de la Capa 3: lee un archivo de nivel (ver
// schema/level.schema.json), construye IsoGridSystem con los valores reales
// del nivel, resuelve y carga las texturas de cada entidad via
// AssetResolver/ResourceManager, y parsea+carga los eventos en el
// EventSystem que se le pase.
class LevelLoader {
public:
    LevelLoader(ResourceManager& resources, AssetResolver& assets);

    LoadedLevel Load(const std::string& levelPath, EventSystem& eventSystem);

private:
    ResourceManager& resources_;
    AssetResolver& assets_;
};
