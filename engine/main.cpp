// =============================================================================
// HoneyComb Engine - Runtime (punto de entrada)
// =============================================================================
//
// Este archivo es el "juego" propiamente dicho: arma las tres capas del motor,
// carga un nivel desde JSON y corre el bucle principal.
//
//   Capa 1 (core/)     GraphicsDevice, ResourceManager -> unicos que hablan
//                      con raylib para ventana/dibujo y recursos.
//   Capa 2 (systems/)  IsoGrid, ZSort, Collision, Event, Animation, Audio,
//                      Input -> logica reutilizable, sin saber de niveles.
//   Capa 3 (loader/)   AssetResolver, LevelLoader, EventLoader -> leen el JSON
//                      y arman con el las estructuras de la Capa 2.
//
// Nada de lo que hay aca esta atado a un nivel concreto: el tamano de la
// grilla, las texturas, las entidades y los eventos salen todos del archivo de
// nivel (ver schema/level.schema.json). Cambiar el juego = cambiar el JSON, sin
// recompilar. Eso es lo que hace que el editor NoCode tenga sentido.
//
// Uso:  engine.exe [ruta/al/nivel.json]     (por defecto: levels/test_level.json)
// Teclas: flechas o WASD = mover | F1 = ver grilla | F11 = pantalla completa
// =============================================================================

#include <iostream>
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <string>
#include <unordered_map>
#include <vector>

#include "core/GraphicsDevice.hpp"
#include "core/ResourceManager.hpp"
#include "loader/AssetResolver.hpp"
#include "loader/LevelLoader.hpp"
#include "systems/animation/AnimationSystem.hpp"
#include "systems/audio/AudioSystem.hpp"
#include "systems/collision/CollisionSystem.hpp"
#include "systems/event_system/EventSystem.hpp"
#include "systems/input/InputSystem.hpp"
#include "systems/z_sort/ZSortSystem.hpp"

int main(int argc, char *argv[])
{
    // --- Resolucion de rutas ------------------------------------------------
    // Hay dos directorios en juego y casi nunca son el mismo:
    //   launchDirectory     - desde donde el usuario ejecuto el .exe
    //   executableDirectory - donde vive el .exe (ahi CMake copia assets/ y levels/)
    // Se guarda el primero ANTES de movernos, porque una ruta de nivel relativa
    // escrita en la terminal es relativa a el, no al binario.
    const std::filesystem::path launchDirectory = std::filesystem::current_path();
    const std::filesystem::path executableDirectory =
        std::filesystem::absolute(argv[0]).parent_path();

    // Nos paramos junto al .exe: AssetResolver busca "assets/" relativo al
    // directorio de trabajo, asi que abrirlo con doble clic desde el explorador
    // tiene que funcionar igual que lanzarlo desde una terminal.
    if (argc > 0)
    {
        std::filesystem::current_path(executableDirectory);
    }

    std::filesystem::path levelPath = "levels/test_level.json";
    if (argc >= 2)
    {
        levelPath = std::filesystem::path(argv[1]);
        if (levelPath.is_relative())
        {
            // Una ruta relativa puede apuntar a cualquiera de los dos lugares.
            // Gana el directorio de lanzamiento si el archivo existe ahi (es lo
            // que el usuario quiso decir); si no, se prueba junto al binario.
            const std::filesystem::path launchRelativePath = launchDirectory / levelPath;
            const std::filesystem::path executableRelativePath = executableDirectory / levelPath;
            if (std::filesystem::exists(launchRelativePath))
            {
                levelPath = launchRelativePath;
            }
            else
            {
                levelPath = executableRelativePath;
            }
        }
    }

    // --- Capa 1 + Capa 3: ventana, recursos y carga del nivel ---------------
    // El orden importa: GraphicsDevice abre la ventana y con ella el contexto
    // de OpenGL, y sin contexto activo LoadTexture() no puede subir nada a la
    // GPU. Por eso la ventana se crea antes que el ResourceManager.
    GraphicsDevice gfx(800, 450, "HoneyComb Engine - Runtime");
    ResourceManager resources;
    AssetResolver assets;
    EventSystem events;
    LevelLoader loader(resources, assets);

    // Load() concentra todo el trabajo de Capa 3: parsea el JSON, construye la
    // grilla con las medidas del nivel, resuelve y carga las texturas, y deja
    // los eventos del nivel ya cargados dentro de "events".
    LoadedLevel level = loader.Load(levelPath.string(), events);
    std::cout << "Nivel cargado: " << level.name
              << " (" << level.entities.size() << " entidades)" << std::endl;

    // Indice por id, para que los eventos (entity_ref en el JSON) y el
    // control del jugador puedan resolver a que LevelEntity se refieren. Los
    // punteros son estables porque el vector no se modifica tras cargar.
    std::unordered_map<std::string, LevelEntity *> entityById;
    for (auto &entity : level.entities)
    {
        entityById[entity.id] = &entity;
    }

    // --- AnimationSystem: catalogo + una instancia por entidad animada ---
    // El catalogo guarda las DEFINICIONES de clip (que frames, a que ritmo); el
    // estado de reproduccion de cada entidad vive aparte, en su propia
    // AnimationInstance, para que dos entidades puedan compartir el mismo clip
    // sin pisarse el frame actual.
    //
    // TODO: este clip esta escrito a mano. Cuando el schema permita declarar
    // clips por nivel, deberia salir del JSON como todo lo demas.
    AnimationSystem animations;
    animations.RegisterClip("player_idle", AnimationClip{
                                               {Rectangle{0, 0, 16, 16}, Rectangle{16, 0, 16, 16}},
                                               0.4f,
                                               true});

    std::unordered_map<std::string, AnimationInstance> animInstances;
    for (auto &entity : level.entities)
    {
        if (!entity.animationClip.empty())
        {
            AnimationInstance instance;
            instance.Play(animations.GetClip(entity.animationClip));
            animInstances[entity.id] = instance;
        }
    }

    // --- AudioSystem ---
    AudioSystem audio;

    // --- InputSystem: movimiento continuo en coordenadas de grilla ---
    // Cada direccion se enlaza dos veces (flechas y WASD) en vez de leer las
    // teclas sueltas, para que el resto del codigo pregunte por la ACCION
    // ("move_up") y no por la tecla: asi se puede reasignar sin tocar la logica.
    InputSystem input;
    input.BindAction("move_up", KEY_UP);
    input.BindAction("move_down", KEY_DOWN);
    input.BindAction("move_left", KEY_LEFT);
    input.BindAction("move_right", KEY_RIGHT);
    input.BindAction("move_up_wasd", KEY_W);
    input.BindAction("move_down_wasd", KEY_S);
    input.BindAction("move_left_wasd", KEY_A);
    input.BindAction("move_right_wasd", KEY_D);

    // --- EventSystem: registro de trigger/acciones del catalogo minimo ---
    // Cada "type" de schema/event_catalog.json necesita su implementacion en
    // C++ registrada UNA sola vez aca. El nivel dice "que" pasa; este bloque
    // define "como". Sumar un bloque nuevo al catalogo = sumar un Register aca;
    // no hay que recompilar por cada nivel nuevo.
    //
    // Se llena en cada frame con lo que devuelve CollisionSystem::Flush(); el
    // trigger on_collision consulta esta lista.
    std::vector<CollisionPair> currentCollisions;

    // Trigger "on_collision": cierto mientras las dos entidades nombradas en
    // los params esten dentro de las colisiones de ESTE frame.
    events.RegisterTrigger("on_collision", [&currentCollisions, &entityById](const nlohmann::json &params) -> bool
                           {
        auto itA = entityById.find(params.at("entityA").get<std::string>());
        auto itB = entityById.find(params.at("entityB").get<std::string>());
        // Un id inexistente no rompe el nivel: el evento simplemente nunca
        // dispara (el editor pudo dejar guardada una referencia a algo borrado).
        if (itA == entityById.end() || itB == entityById.end()) {
            return false;
        }
        void* a = itA->second;
        void* b = itB->second;
        // CollisionSystem no garantiza el orden dentro del par: hay que probar
        // las dos combinaciones.
        for (const auto& pair : currentCollisions) {
            if ((pair.a == a && pair.b == b) || (pair.a == b && pair.b == a)) {
                return true;
            }
        }
        return false; });

    // Accion "destroy_entity": borrado suave. No se saca del vector porque eso
    // invalidaria los punteros de entityById; se marca la entidad y el resto
    // del bucle la saltea al dibujar y al colisionar.
    events.RegisterAction("destroy_entity", [&entityById](const nlohmann::json &params)
                          {
        auto it = entityById.find(params.at("entity").get<std::string>());
        if (it != entityById.end() && !it->second->destroyed) {
            it->second->destroyed = true;
            std::cout << "Accion destroy_entity ejecutada sobre '" << it->first << "'" << std::endl;
        } });

    // Accion "play_sound": ResourceManager cachea por ruta, asi que dispararla
    // en frames seguidos no vuelve a leer el .wav del disco cada vez.
    events.RegisterAction("play_sound", [&resources, &assets, &audio](const nlohmann::json &params)
                          {
        const Sound& sound = resources.GetSound(assets.Resolve(params.at("soundPath").get<std::string>()));
        audio.PlaySoundEffect(sound); });

    ZSortSystem zsort(gfx);
    CollisionSystem collision;
    Font defaultFont = GetFontDefault();
    gfx.SetTargetFPS(60);
    bool showGrid = false;

    // El jugador es, por convencion, la entidad con id "player_1". Si el nivel
    // no define ninguna, el nivel igual corre: solo que no hay nada que mover.
    LevelEntity *player = entityById.count("player_1") ? entityById["player_1"] : nullptr;

    // =========================================================================
    // BUCLE PRINCIPAL
    //
    // Orden de cada frame:
    //   1. teclas de depuracion (F1 grilla / F11 pantalla completa)
    //   2. encuadre de camara (se recalcula: la ventana es redimensionable)
    //   3. movimiento del jugador, con deteccion de bloqueo
    //   4. encolar en el ZSortSystem: piso -> paredes -> entidades
    //   5. Flush del ZSort (ordena por profundidad y recien ahi dibuja)
    //   6. overlay de grilla (F1), por encima de todo
    //   7. resolver colisiones -> correr eventos -> actualizar audio
    // =========================================================================
    while (!gfx.ShouldClose())
    {
        if (IsKeyPressed(KEY_F1))
        {
            showGrid = !showGrid;
        }
        if (IsKeyPressed(KEY_F11))
        {
            ToggleFullscreen();
        }

        // --- Encuadre: centrar el rombo del nivel en la ventana -------------
        // Proyectado, el nivel completo mide (ancho + alto - 2) * tileHeight/2
        // de alto; se le resta la mitad de eso al centro vertical para que la
        // grilla quede centrada. Se recalcula cada frame porque la ventana se
        // puede redimensionar en cualquier momento.
        float levelOriginY = gfx.GetScreenHeight() / 2.0f -
                             (level.grid.GetGridWidth() + level.grid.GetGridHeight() - 2) *
                                 level.grid.GetTileHeight() / 4.0f;
        // Atajo local: proyeccion isometrica + offset de camara en un solo paso.
        // El editor hace exactamente lo mismo en App.origin() (app.ts), y ese
        // paralelismo es lo que garantiza que lo que se ve en el canvas del
        // editor coincida con lo que termina dibujando el runtime.
        auto gridToScreen = [&](Vector2 gridPosition)
        {
            Vector2 screenPosition = level.grid.GridToScreen(gridPosition);
            screenPosition.x += gfx.GetScreenWidth() / 2.0f;
            screenPosition.y += levelOriginY;
            return screenPosition;
        };

        // --- Movimiento continuo con limites y bloqueo contra obstaculos ---
        if (player && !player->destroyed)
        {
            // Primero se lee la intencion EN PANTALLA (arriba = arriba visual),
            // no en coordenadas de grilla: en isometrico son cosas distintas.
            Vector2 screenDirection{0, 0};
            if (input.IsActionDown("move_up") || input.IsActionDown("move_up_wasd"))
                screenDirection.y -= 1;
            if (input.IsActionDown("move_down") || input.IsActionDown("move_down_wasd"))
                screenDirection.y += 1;
            if (input.IsActionDown("move_left") || input.IsActionDown("move_left_wasd"))
                screenDirection.x -= 1;
            if (input.IsActionDown("move_right") || input.IsActionDown("move_right_wasd"))
                screenDirection.x += 1;

            // Pantalla -> grilla: es la inversa de la proyeccion isometrica.
            // Sin esta conversion, apretar "arriba" moveria en diagonal dentro
            // del mundo, que es el error clasico de los juegos isometricos.
            Vector2 direction{
                screenDirection.x + screenDirection.y,
                screenDirection.y - screenDirection.x};
            float directionLength = std::sqrt(direction.x * direction.x + direction.y * direction.y);
            if (directionLength > 0)
            {
                // Normalizar: sin esto, moverse en diagonal (dos teclas a la
                // vez) seria ~1.41x mas rapido que moverse en linea recta.
                direction.x /= directionLength;
                direction.y /= directionLength;
                float movementSpeed = 3.0f;  // celdas de grilla por segundo
                // Se calcula una posicion CANDIDATA y solo se acepta si no
                // choca con nada. Mover primero y corregir despues produce un
                // tembleque visible al arrastrarse contra una pared.
                Vector2 candidate = player->precisePosition;
                candidate.x += direction.x * movementSpeed * gfx.GetDeltaTime();
                candidate.y += direction.y * movementSpeed * gfx.GetDeltaTime();

                // Limite duro contra los bordes de la grilla, aparte de las paredes.
                candidate.x = std::clamp(candidate.x, 0.0f,
                                         level.grid.GetGridWidth() - 1.0f);
                candidate.y = std::clamp(candidate.y, 0.0f,
                                         level.grid.GetGridHeight() - 1.0f);

                bool blocked = false;
                // Los colliders se declaran en pixeles (es lo que el editor
                // muestra), pero la posicion se lleva en celdas: hay que pasar
                // a celdas dividiendo por el tamano del tile.
                float playerHalfWidth = player->colliderSize.x /
                                        static_cast<float>(level.grid.GetTileWidth()) / 2.0f;
                float playerHalfHeight = player->colliderSize.y /
                                         static_cast<float>(level.grid.GetTileHeight()) / 2.0f;

                // Solapamiento AABB contra el cuadrado de una celda: media celda
                // a cada lado de su centro, mas el radio de quien se mueve.
                auto overlapsTile = [&](Vector2 position, float halfWidth, float halfHeight,
                                        int tileCol, int tileRow)
                {
                    return std::fabs(position.x - static_cast<float>(tileCol)) <
                               0.5f + halfWidth &&
                           std::fabs(position.y - static_cast<float>(tileRow)) <
                               0.5f + halfHeight;
                };

                // Una forma irregular tambien es una frontera fisica: no se
                // puede avanzar a una celda que no declara piso.
                bool candidateHasFloor = false;
                for (const auto& floorTile : level.floorTiles)
                {
                    if (overlapsTile(candidate, playerHalfWidth, playerHalfHeight,
                                     floorTile.col, floorTile.row))
                    {
                        candidateHasFloor = true;
                        break;
                    }
                }
                if (!candidateHasFloor)
                {
                    blocked = true;
                }

                // 1) Paredes declaradas por celda en el nivel.
                if (level.wallTexture)
                {
                    for (const auto& wallTile : level.wallTiles)
                    {
                        if (overlapsTile(candidate, playerHalfWidth, playerHalfHeight,
                                         wallTile.col, wallTile.row))
                        {
                            blocked = true;
                            break;
                        }
                    }
                }

                // 2) Entidades solidas del nivel. Un collider con solid=false
                // NO bloquea: funciona como sensor, dispara on_collision y nada
                // mas (por eso se puede caminar a traves de "pass_through_1"
                // en levels/test_level.json).
                for (const auto &entity : level.entities)
                {
                    if (blocked || entity.destroyed || !entity.colliderSolid || &entity == player)
                    {
                        continue;
                    }
                    float entityHalfWidth = entity.colliderSize.x /
                                            static_cast<float>(level.grid.GetTileWidth()) / 2.0f;
                    float entityHalfHeight = entity.colliderSize.y /
                                             static_cast<float>(level.grid.GetTileHeight()) / 2.0f;
                    if (std::fabs(candidate.x - entity.precisePosition.x) <
                            playerHalfWidth + entityHalfWidth &&
                        std::fabs(candidate.y - entity.precisePosition.y) <
                            playerHalfHeight + entityHalfHeight)
                    {
                        blocked = true;
                        break;
                    }
                }

                if (!blocked)
                {
                    player->precisePosition = candidate;
                    // La celda entera se mantiene sincronizada para lo que
                    // razona por celdas; precisePosition es la que manda para
                    // dibujar y para colisionar.
                    player->position = GridCoord{
                        static_cast<int>(std::round(candidate.x)),
                        static_cast<int>(std::round(candidate.y))};
                }
            }
        }

        gfx.BeginFrame(RAYWHITE);

        // --- Piso (layer 0) -------------------------------------------------
        // Nada se dibuja directo: todo se ENCOLA en el ZSortSystem, que al final
        // ordena por profundidad y recien ahi dibuja. Por eso un personaje puede
        // quedar tapado por una pared que se encolo antes que el.
        for (const auto& floorTile : level.floorTiles)
        {
            Vector2 screenPos = gridToScreen(
                Vector2{static_cast<float>(floorTile.col), static_cast<float>(floorTile.row)});

            if (level.floorTexture)
            {
                zsort.Submit(SpriteInstance{
                        level.floorTexture,
                        level.floorSourceRect,

                        // posición visual: la textura se centra sobre el rombo
                        Vector2{
                            screenPos.x - level.floorSourceRect.width / 2.0f,
                            screenPos.y - level.floorSourceRect.height / 2.0f},

                        // posición para Z-sort: el centro de la celda, que es el
                        // punto de apoyo real. Va separado de la posicion visual
                        // justamente para que el offset de arriba no altere el
                        // orden de profundidad.
                        screenPos,

                        Vector2{0, 0},
                        0.0f,
                    WHITE,
                    0});
            }
        }

        // --- Paredes del perimetro (layer 1) --------------------------------
        // Se generan desde la grilla, no desde el array de entidades: son el
        // "cuarto" por defecto que encierra el nivel. Mismo recorrido de celdas
        // que la deteccion de bloqueo de mas arriba.
        if (level.wallTexture)
        {
            for (const auto& wallTile : level.wallTiles)
            {
                Vector2 screenPos = gridToScreen(
                    Vector2{static_cast<float>(wallTile.col), static_cast<float>(wallTile.row)});
                    zsort.Submit(SpriteInstance{
                        level.wallTexture,
                        level.wallSourceRect,

                        // posición visual: la pared se "levanta" sobre su celda,
                        // por eso el offset vertical es mayor que medio tile
                        Vector2{
                            screenPos.x - level.grid.GetTileWidth() / 2.0f,
                            screenPos.y - level.grid.GetTileWidth() / 1.5f},

                        // posición lógica/depth: sigue siendo el centro de la
                        // celda, para ordenar igual que el piso y las entidades
                        screenPos,

                        Vector2{0, 0},
                        0.0f,
                        WHITE,
                        1,  // layer 1: desempata contra el piso a igual profundidad

                        // Destino cuadrado de tileWidth x tileWidth: la textura
                        // fuente es de 32px y hay que estirarla al tamano del tile.
                    Vector2{
                        static_cast<float>(level.grid.GetTileWidth()),
                        static_cast<float>(level.grid.GetTileWidth())}});
            }
        }

        for (auto &entity : level.entities)
        {
            if (entity.destroyed)
            {
                continue;
            }

            // Si la entidad se anima, el frame actual reemplaza al sourceRect
            // fijo del JSON. El Update() se hace aca y no en un paso aparte
            // para que una entidad destruida deje de animarse sola.
            Rectangle sourceRect = entity.sourceRect;
            auto animIt = animInstances.find(entity.id);
            if (animIt != animInstances.end())
            {
                animIt->second.Update(gfx.GetDeltaTime());
                sourceRect = animIt->second.GetCurrentFrame();
            }

            Vector2 sortPosition = gridToScreen(entity.precisePosition);

            // El sprite se apoya en el suelo: centrado en X y con los "pies"
            // sobre el punto de la celda, por eso se resta el alto completo.
            Vector2 drawPosition{
                sortPosition.x - sourceRect.width / 2.0f,
                sortPosition.y - sourceRect.height};
            // Tinte de depuracion, mientras no haya arte propio por tipo.
            Color tint = entity.type == "obstacle" ? RED : WHITE;

            zsort.Submit(SpriteInstance{
                entity.texture,
                sourceRect,

                drawPosition, // visual

                sortPosition, // profundidad

                Vector2{0, 0},
                0.0f,
                tint,
                2
            });
            // Los colliders se encolan en este mismo recorrido para no volver a
            // iterar el vector; CollisionSystem los cruza todos contra todos
            // cuando se le pida el Flush().
            if (entity.colliderSize.x > 0 && entity.colliderSize.y > 0)
            {
                collision.Submit(ColliderInstance{
                    &entity,
                    Rectangle{sortPosition.x, sortPosition.y,
                              entity.colliderSize.x, entity.colliderSize.y}});
            }
        }

        // Recien aca se dibuja todo lo encolado, ya ordenado por profundidad.
        zsort.Flush();

        // --- Overlay de grilla (F1) -----------------------------------------
        // Va despues del Flush a proposito: tiene que verse ENCIMA de todo.
        // Dibuja directo con raylib porque es ayuda de depuracion, no parte de
        // la escena, y no debe participar del orden por profundidad.
        if (showGrid)
        {
            const Color gridColor{255, 105, 180, 220};
            float halfTileWidth = level.grid.GetTileWidth() / 2.0f;
            float halfTileHeight = level.grid.GetTileHeight() / 2.0f;
            for (int row = 0; row < level.grid.GetGridHeight(); ++row)
            {
                for (int col = 0; col < level.grid.GetGridWidth(); ++col)
                {
                    Vector2 screenPos = gridToScreen(
                        Vector2{static_cast<float>(col), static_cast<float>(row)});

                    // Los cuatro vertices del rombo que representa la celda.
                    Vector2 top{screenPos.x, screenPos.y - halfTileHeight};
                    Vector2 right{screenPos.x + halfTileWidth, screenPos.y};
                    Vector2 bottom{screenPos.x, screenPos.y + halfTileHeight};
                    Vector2 left{screenPos.x - halfTileWidth, screenPos.y};
                    DrawLineV(top, right, gridColor);
                    DrawLineV(right, bottom, gridColor);
                    DrawLineV(bottom, left, gridColor);
                    DrawLineV(left, top, gridColor);
                }
            }
        }

        // --- Cierre del frame -----------------------------------------------
        // Flush() devuelve los pares que se solapan y vacia la cola. El trigger
        // on_collision lee esa lista, por eso va justo antes de events.Update().
        currentCollisions = collision.Flush();
        events.Update();
        audio.Update();  // raylib necesita esto continuo para musica en streaming

        gfx.DrawText(defaultFont, "HoneyComb Engine - Runtime OK (flechas o WASD)", {10, 10}, 20, DARKGRAY);
        gfx.EndFrame();
    }

    // Sin limpieza manual: ResourceManager y GraphicsDevice liberan todo en sus
    // destructores (RAII), en orden inverso al de construccion.
    return 0;
}
