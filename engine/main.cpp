// =============================================================================
// HoneyComb Engine - Runtime (punto de entrada)
// =============================================================================
//
// Este archivo es el "juego" propiamente dicho: arma las capas del motor,
// carga un nivel desde JSON y corre el bucle principal.
//
//   Capa 1 (core/)     GraphicsDevice, ResourceManager -> unicos que hablan
//                      con raylib para ventana/dibujo y recursos.
//   Capa 2 (systems/)  IsoGrid, ZSort, Collision, Event, Animation, Audio,
//                      Input -> logica reutilizable, sin saber de niveles.
//   Capa 3 (loader/)   AssetResolver, LevelLoader, EventLoader -> leen el JSON
//                      y arman con el las estructuras de la Capa 2.
//   Capa 4 (game/)     Movement, Combat -> las reglas del juego sobre el nivel
//                      ya cargado: por donde se camina y quien le pega a quien.
//
// Nada de lo que hay aca esta atado a un nivel concreto: el tamano de la
// grilla, las texturas, las entidades y los eventos salen todos del archivo de
// nivel (ver schema/level.schema.json). Cambiar el juego = cambiar el JSON, sin
// recompilar. Eso es lo que hace que el editor NoCode tenga sentido.
//
// Uso:  engine.exe [ruta/al/nivel.json]     (por defecto: levels/test_level.json)
// Teclas: flechas o WASD = mover | Espacio o J = atacar | F1 = ver grilla |
//         F11 = pantalla completa
// =============================================================================

#include <algorithm>
#include <cmath>
#include <exception>
#include <filesystem>
#include <iostream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

#include "core/GraphicsDevice.hpp"
#include "core/ResourceManager.hpp"
#include "game/Combat.hpp"
#include "game/Movement.hpp"
#include "loader/AssetResolver.hpp"
#include "loader/LevelLoader.hpp"
#include "systems/animation/AnimationSystem.hpp"
#include "systems/audio/AudioSystem.hpp"
#include "systems/collision/CollisionSystem.hpp"
#include "systems/event_system/EventSystem.hpp"
#include "systems/input/InputSystem.hpp"
#include "systems/z_sort/ZSortSystem.hpp"

namespace {

// Cuanto dura la pantalla entre un nivel y el siguiente. Lo justo para leer el
// mensaje; mas largo se siente como una carga lenta.
constexpr float kTransitionSeconds = 2.0f;
// Cuanto se ve un aviso de error (por ejemplo, un nivel siguiente que no existe).
constexpr float kNoticeSeconds = 4.0f;

// Dibuja un texto centrado en X. raylib no centra solo: hay que medirlo.
void DrawCentered(GraphicsDevice& gfx, const Font& font, const std::string& text, float centerX,
                  float y, float size, Color color) {
    const Vector2 measured = MeasureTextEx(font, text.c_str(), size, size / 10.0f);
    gfx.DrawText(font, text.c_str(), Vector2{centerX - measured.x / 2.0f, y}, size, color);
}

// Barra de vida: fondo oscuro y relleno proporcional a la vida que queda.
void DrawHealthBar(float x, float y, float width, float height, float ratio, Color fill) {
    DrawRectangle(static_cast<int>(x), static_cast<int>(y), static_cast<int>(width),
                  static_cast<int>(height), Color{30, 30, 30, 200});
    DrawRectangle(static_cast<int>(x), static_cast<int>(y),
                  static_cast<int>(width * std::clamp(ratio, 0.0f, 1.0f)), static_cast<int>(height),
                  fill);
}

}  // namespace

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
    const std::filesystem::path assetsRoot = levelPath.parent_path().parent_path() / "assets";
    AssetResolver assets(assetsRoot.string());
    EventSystem events;
    LevelLoader loader(resources, assets);

    // Load() concentra todo el trabajo de Capa 3: parsea el JSON, construye la
    // grilla con las medidas del nivel, resuelve y carga las texturas, y deja
    // los eventos del nivel ya cargados dentro de "events".
    LoadedLevel level = loader.Load(levelPath.string(), events);
    // El nivel EN CURSO: cambia al pasar de nivel, y es la base contra la que
    // se resuelve el archivo del nivel siguiente.
    std::filesystem::path currentLevelPath = levelPath;

    // --- Estado que depende del nivel cargado -------------------------------
    // Todo esto se vuelve a armar cada vez que se carga un nivel (ver
    // prepareLevel). Vive afuera, y no dentro de un objeto por nivel, porque
    // los eventos registrados mas abajo lo capturan por referencia: al pasar
    // de nivel se rellena, y las mismas funciones siguen apuntando bien.
    //
    // entityById: indice por id para los eventos (entity_ref) y el jugador.
    // Los punteros son estables mientras el vector de entidades no cambie.
    std::unordered_map<std::string, LevelEntity *> entityById;
    AnimationSystem animations;
    std::unordered_map<std::string, AnimationInstance> animInstances;
    // Marcas del puzzle ("tiene_llave"): las activa set_flag, las consulta
    // flag_is_set. Son del nivel: se borran al cambiar de nivel.
    std::unordered_set<std::string> flags;
    // El jugador es, por convencion, la entidad con id "player_1". Si el nivel
    // no define ninguna, el nivel igual corre: solo que no hay nada que mover.
    LevelEntity *player = nullptr;

    auto prepareLevel = [&]()
    {
        entityById.clear();
        animInstances.clear();
        flags.clear();
        for (auto &entity : level.entities)
        {
            entityById[entity.id] = &entity;
        }

        // AnimationSystem: un clip por entidad animada, armado desde el nivel.
        // Cada entidad declara cuantos cuadros tiene ("frames") y el clip se
        // arma desde SU recorte: los cuadros van uno al lado del otro, del
        // ancho de ese recorte. (Antes habia un unico clip escrito aca, con
        // cuadros fijos de 16x16, y ese era el tope de tamano del jugador.)
        for (auto &entity : level.entities)
        {
            if (entity.frames <= 1)
            {
                continue;
            }
            AnimationClip clip{{}, entity.frameDuration, true};
            for (int frame = 0; frame < entity.frames; ++frame)
            {
                clip.frames.push_back(Rectangle{
                    entity.sourceRect.x + frame * entity.sourceRect.width,
                    entity.sourceRect.y,
                    entity.sourceRect.width,
                    entity.sourceRect.height});
            }
            // Registrado con el id de la entidad. Registrar de nuevo el mismo
            // id (al recargar) pisa el clip en su lugar, y GetClip devuelve una
            // referencia al elemento del mapa, que sigue valida.
            animations.RegisterClip(entity.id, std::move(clip));
            AnimationInstance instance;
            instance.Play(animations.GetClip(entity.id));
            animInstances[entity.id] = instance;
        }

        player = entityById.count("player_1") ? entityById["player_1"] : nullptr;
        std::cout << "Nivel cargado: " << level.name
                  << " (" << level.entities.size() << " entidades)" << std::endl;
    };
    prepareLevel();

    // --- AudioSystem ---
    AudioSystem audio;

    // --- InputSystem ---
    // Cada accion se enlaza dos veces (flechas y WASD, Espacio y J) en vez de
    // leer las teclas sueltas, para que el resto del codigo pregunte por la
    // ACCION ("move_up") y no por la tecla: asi se puede reasignar sin tocar la
    // logica.
    InputSystem input;
    input.BindAction("move_up", KEY_UP);
    input.BindAction("move_down", KEY_DOWN);
    input.BindAction("move_left", KEY_LEFT);
    input.BindAction("move_right", KEY_RIGHT);
    input.BindAction("move_up_wasd", KEY_W);
    input.BindAction("move_down_wasd", KEY_S);
    input.BindAction("move_left_wasd", KEY_A);
    input.BindAction("move_right_wasd", KEY_D);
    input.BindAction("attack", KEY_SPACE);
    input.BindAction("attack_alt", KEY_J);

    // --- Paso entre niveles -------------------------------------------------
    // Pasar de nivel no es instantaneo: primero se muestra la pantalla con el
    // mensaje ("¡Nivel superado!") durante kTransitionSeconds, con el juego
    // congelado, y recien al terminar se carga el nivel siguiente. La carga
    // pasa FUERA de events.Update(): reemplaza los eventos del nivel, y hacerlo
    // mientras se recorren seria pisar la lista que se esta leyendo.
    struct Transition
    {
        bool active = false;
        std::filesystem::path target;
        std::string title;
        std::string detail;
        float remaining = 0.0f;
    };
    Transition transition;

    auto beginTransition = [&](const std::filesystem::path &target, const std::string &title)
    {
        // Una sola a la vez: la primera que se pida es la que vale.
        if (transition.active)
        {
            return;
        }
        transition = Transition{true, target, title,
                                "Cargando " + target.stem().string() + "...", kTransitionSeconds};
        std::cout << title << " -> " << target.string() << std::endl;
    };

    std::string notice;
    float noticeRemaining = 0.0f;

    // --- EventSystem: registro de triggers, condiciones y acciones ---------
    // Cada "type" de schema/event_catalog.json necesita su implementacion en
    // C++ registrada UNA sola vez aca. El nivel dice "que" pasa; este bloque
    // define "como". Sumar un bloque nuevo al catalogo = sumar un Register aca;
    // no hay que recompilar por cada nivel nuevo.
    //
    // Se llena en cada frame con lo que devuelve CollisionSystem::Flush(); el
    // trigger on_collision consulta esta lista.
    std::vector<CollisionPair> currentCollisions;

    // Trigger "on_collision": las dos entidades nombradas se tocan en este frame.
    events.RegisterTrigger("on_collision", [&currentCollisions, &entityById](const nlohmann::json &params) -> bool
                           {
        auto itA = entityById.find(params.value("entityA", std::string("")));
        auto itB = entityById.find(params.value("entityB", std::string("")));
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

    // Trigger "on_entity_destroyed": la entidad ya no esta en el nivel, porque
    // la vencieron en combate o la destruyo un evento. Es el "al eliminar a
    // este enemigo, pasar de nivel".
    events.RegisterTrigger("on_entity_destroyed", [&entityById](const nlohmann::json &params) -> bool
                           {
        auto it = entityById.find(params.value("entity", std::string("")));
        return it != entityById.end() && it->second->destroyed; });

    // Trigger "on_all_enemies_defeated": no queda ningun enemigo en pie. Un
    // nivel sin enemigos no lo dispara nunca: "vencer a todos" tiene que costar
    // algo, no cumplirse solo al arrancar.
    events.RegisterTrigger("on_all_enemies_defeated", [&level](const nlohmann::json &) -> bool
                           {
        bool anyEnemy = false;
        for (const auto& entity : level.entities) {
            if (!Combat::IsEnemy(entity)) {
                continue;
            }
            if (!entity.destroyed) {
                return false;
            }
            anyEnemy = true;
        }
        return anyEnemy; });

    // Condicion "flag_is_set": una accion set_flag ya activo esa marca.
    events.RegisterCondition("flag_is_set", [&flags](const nlohmann::json &params) -> bool
                             { return flags.count(params.value("flag", std::string(""))) > 0; });

    // Accion "set_flag": activa una marca con nombre (la llave de un puzzle).
    events.RegisterAction("set_flag", [&flags](const nlohmann::json &params)
                          {
        std::string flag = params.value("flag", std::string(""));
        if (!flag.empty()) {
            flags.insert(flag);
        } });

    // Accion "destroy_entity": borrado suave. No se saca del vector porque eso
    // invalidaria los punteros de entityById; se marca la entidad y el resto
    // del bucle la saltea al dibujar y al colisionar.
    events.RegisterAction("destroy_entity", [&entityById](const nlohmann::json &params)
                          {
        auto it = entityById.find(params.value("entity", std::string("")));
        if (it != entityById.end() && !it->second->destroyed) {
            it->second->destroyed = true;
            std::cout << "Accion destroy_entity ejecutada sobre '" << it->first << "'" << std::endl;
        } });

    // Accion "play_sound": ResourceManager cachea por ruta, asi que dispararla
    // varias veces no vuelve a leer el .wav del disco.
    events.RegisterAction("play_sound", [&resources, &assets, &audio](const nlohmann::json &params)
                          {
        const Sound& sound = resources.GetSound(assets.Resolve(params.value("soundPath", std::string(""))));
        audio.PlaySoundEffect(sound); });

    // Accion "load_level": agenda el paso a otro nivel de la MISMA carpeta
    // levels/ que el actual. "level" es el nombre del archivo; si viene sin
    // extension se le agrega .json.
    events.RegisterAction("load_level", [&beginTransition, &currentLevelPath](const nlohmann::json &params)
                          {
        std::string file = params.value("level", std::string(""));
        if (file.empty()) {
            std::cerr << "load_level sin nivel de destino: se ignora." << std::endl;
            return;
        }
        std::filesystem::path target = currentLevelPath.parent_path() / file;
        if (!target.has_extension()) {
            target += ".json";
        }
        std::string title = params.value("message", std::string(""));
        beginTransition(target, title.empty() ? "¡Nivel superado!" : title); });

    ZSortSystem zsort(gfx);
    CollisionSystem collision;
    Font defaultFont = GetFontDefault();
    gfx.SetTargetFPS(60);
    bool showGrid = false;
    // Cuanto le queda al dibujo del golpe del jugador.
    float swingRemaining = 0.0f;

    // Barras de vida a dibujar encima de la escena, juntadas mientras se
    // encolan las entidades (ahi se sabe donde queda cada sprite en pantalla).
    struct HealthBarMark
    {
        Vector2 topCenter;
        float ratio;
        bool isPlayer;
    };
    std::vector<HealthBarMark> healthBars;

    // =========================================================================
    // BUCLE PRINCIPAL
    //
    // Orden de cada frame:
    //   1. teclas de depuracion (F1 grilla / F11 pantalla completa)
    //   2. encuadre de camara (se recalcula: la ventana es redimensionable)
    //   3. si no se esta pasando de nivel: movimiento del jugador y combate
    //   4. encolar en el ZSortSystem: piso -> paredes -> entidades
    //   5. Flush del ZSort (ordena por profundidad y recien ahi dibuja)
    //   6. overlays: grilla (F1), golpe, barras de vida, HUD
    //   7. resolver colisiones -> correr eventos -> actualizar audio
    //   8. pantalla de paso de nivel, y la carga cuando termina
    // =========================================================================
    while (!gfx.ShouldClose())
    {
        const float deltaTime = gfx.GetDeltaTime();

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

        // --- Movimiento del jugador y combate ------------------------------
        // Con la pantalla de paso de nivel en marcha el juego queda congelado:
        // ni el jugador ni los enemigos se mueven, y nadie pega.
        if (!transition.active)
        {
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
                    // Celdas por segundo: la velocidad configurada ("stats.speed").
                    const float movementSpeed = player->speed;
                    // Se calcula una posicion CANDIDATA y solo se acepta si no
                    // choca con nada. Mover primero y corregir despues produce un
                    // tembleque visible al arrastrarse contra una pared.
                    const Vector2 candidate = Movement::ClampToGrid(level, Vector2{
                        player->precisePosition.x + direction.x * movementSpeed * deltaTime,
                        player->precisePosition.y + direction.y * movementSpeed * deltaTime});

                    if (Movement::CanOccupy(level, *player, candidate))
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

            const bool attackPressed =
                input.IsActionPressed("attack") || input.IsActionPressed("attack_alt");
            const Combat::FrameResult combat = Combat::Update(level, player, attackPressed, deltaTime);
            if (combat.playerSwung)
            {
                swingRemaining = Combat::kSwingDuration;
            }
            for (const auto &id : combat.defeated)
            {
                std::cout << "Enemigo vencido: '" << id << "'" << std::endl;
            }
            // Perder vuelve a empezar el MISMO nivel, con la misma pantalla de
            // paso: recargarlo desde el disco lo deja exactamente como arranca.
            if (combat.playerDefeated)
            {
                beginTransition(currentLevelPath, "Derrotado");
            }
        }
        swingRemaining = std::max(0.0f, swingRemaining - deltaTime);

        // Fondo elegido en el editor. El texto del HUD cambia a claro sobre un
        // fondo oscuro, porque el gris oscuro de siempre ahi no se leeria.
        const Color background = level.backgroundColor;
        const bool darkBackground =
            0.299f * background.r + 0.587f * background.g + 0.114f * background.b < 128.0f;
        const Color hudText = darkBackground ? LIGHTGRAY : DARKGRAY;
        gfx.BeginFrame(background);

        // --- Piso (SpriteLayer::Ground) --------------------------------------
        // Nada se dibuja directo: todo se ENCOLA en el ZSortSystem, que al final
        // ordena por profundidad y recien ahi dibuja. Por eso un personaje puede
        // quedar tapado por una pared que se encolo antes que el.
        //
        // El piso es la excepcion: el ZSortSystem lo saca del orden por
        // profundidad y lo dibuja entero primero, asi nunca tapa a nadie.
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
                    SpriteLayer::Ground});
            }
        }

        // --- Paredes (SpriteLayer::Object) -----------------------------------
        // Se generan desde las celdas de pared del nivel, no desde el array de
        // entidades. Mismo recorrido de celdas que usa Movement para frenar.
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
                    SpriteLayer::Object,  // desempata contra otros objetos a igual profundidad

                    // Destino cuadrado de tileWidth x tileWidth: la textura
                    // fuente es de 32px y hay que estirarla al tamano del tile.
                    Vector2{
                        static_cast<float>(level.grid.GetTileWidth()),
                        static_cast<float>(level.grid.GetTileWidth())}});
            }
        }

        healthBars.clear();
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
                animIt->second.Update(deltaTime);
                sourceRect = animIt->second.GetCurrentFrame();
            }

            // Una entidad de span N ocupa NxN celdas a partir de su celda y se
            // apoya en el CENTRO de ese bloque. El tamano de dibujo combina las
            // celdas que ocupa (span) con la escala configurada (scale).
            const float spanScale = static_cast<float>(entity.span) * entity.scale;
            const Vector2 sortPosition = gridToScreen(Movement::BoxCenter(entity));

            // El sprite se apoya en el suelo: centrado en X y con los "pies"
            // sobre el punto de la celda, por eso se resta el alto completo.
            //
            // groundOffset corrige eso para el arte que no se apoya en su
            // borde inferior: un solido que llena la casilla lo usa para bajar
            // medio tile y apoyar el centro del rombo de su base en el punto de
            // la celda. Se agranda con el sprite, porque esta medido en pixeles
            // del sprite original.
            const float drawWidth = sourceRect.width * spanScale;
            const float drawHeight = sourceRect.height * spanScale;
            const Vector2 drawPosition{
                sortPosition.x - drawWidth / 2.0f,
                sortPosition.y - drawHeight + entity.groundOffset * spanScale};

            // Rojo mientras dura el destello de un golpe recibido; si no, el
            // tinte de depuracion de siempre para los obstaculos.
            Color tint = WHITE;
            if (entity.hurtTimer > 0.0f)
            {
                tint = Color{255, 90, 90, 255};
            }
            else if (entity.type == "obstacle")
            {
                tint = RED;
            }

            zsort.Submit(SpriteInstance{
                entity.texture,
                sourceRect,

                drawPosition, // visual

                sortPosition, // profundidad

                Vector2{0, 0},
                0.0f,
                tint,
                SpriteLayer::Entity,

                Vector2{drawWidth, drawHeight}
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

            // Barra de vida sobre el jugador y sobre cada enemigo.
            if (&entity == player || Combat::IsEnemy(entity))
            {
                healthBars.push_back(HealthBarMark{
                    Vector2{sortPosition.x, drawPosition.y - 8.0f},
                    entity.health / entity.maxHealth,
                    &entity == player});
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

        // --- Golpe del jugador ------------------------------------------------
        // El alcance del ataque dibujado sobre el piso. Un circulo en celdas se
        // ve como una elipse en isometrico: un paso de celda mide medio tile a
        // lo ancho y medio tile a lo alto, por eso los dos radios.
        if (swingRemaining > 0.0f && player && !player->destroyed)
        {
            const Vector2 center = gridToScreen(player->precisePosition);
            const float radiusX = Combat::kPlayerAttackRange * level.grid.GetTileWidth() / 2.0f * 1.414f;
            const float radiusY = Combat::kPlayerAttackRange * level.grid.GetTileHeight() / 2.0f * 1.414f;
            DrawEllipseLines(static_cast<int>(center.x), static_cast<int>(center.y), radiusX, radiusY,
                             Color{255, 220, 120, 230});
        }

        // --- Barras de vida sobre las cabezas --------------------------------
        for (const auto &bar : healthBars)
        {
            DrawHealthBar(bar.topCenter.x - 16.0f, bar.topCenter.y, 32.0f, 4.0f, bar.ratio,
                          bar.isPlayer ? Color{90, 200, 90, 255} : Color{220, 70, 70, 255});
        }

        // --- Cierre del frame -----------------------------------------------
        // Flush() devuelve los pares que se solapan y vacia la cola; hay que
        // llamarlo SIEMPRE, aunque el juego este congelado, o la cola crece.
        // Con la pantalla de paso activa los eventos no corren: el nivel ya
        // termino, y un evento mas podria pedir otro cambio encima.
        currentCollisions = collision.Flush();
        if (!transition.active)
        {
            events.Update();
        }
        audio.Update();  // raylib necesita esto continuo para musica en streaming

        // --- HUD --------------------------------------------------------------
        if (player)
        {
            gfx.DrawText(defaultFont, "Vida", {10, 10}, 20, hudText);
            DrawHealthBar(60.0f, 13.0f, 160.0f, 14.0f, player->health / player->maxHealth,
                          Color{90, 200, 90, 255});
            const std::string lifeText = std::to_string(static_cast<int>(std::ceil(player->health))) +
                                         " / " + std::to_string(static_cast<int>(player->maxHealth));
            gfx.DrawText(defaultFont, lifeText.c_str(), {230, 10}, 20, hudText);
        }
        gfx.DrawText(defaultFont, "Flechas/WASD mover  |  Espacio o J atacar",
                     {10, static_cast<float>(gfx.GetScreenHeight() - 28)}, 18, hudText);

        if (noticeRemaining > 0.0f)
        {
            noticeRemaining = std::max(0.0f, noticeRemaining - deltaTime);
            gfx.DrawText(defaultFont, notice.c_str(), {10, 40}, 18, MAROON);
        }

        // --- Pantalla de paso de nivel --------------------------------------
        if (transition.active)
        {
            const float width = static_cast<float>(gfx.GetScreenWidth());
            const float height = static_cast<float>(gfx.GetScreenHeight());
            DrawRectangle(0, 0, static_cast<int>(width), static_cast<int>(height), Color{0, 0, 0, 210});
            DrawCentered(gfx, defaultFont, transition.title, width / 2.0f, height / 2.0f - 40.0f, 48.0f,
                         Color{255, 214, 102, 255});
            DrawCentered(gfx, defaultFont, transition.detail, width / 2.0f, height / 2.0f + 24.0f, 20.0f,
                         RAYWHITE);
            transition.remaining -= deltaTime;
        }

        gfx.EndFrame();

        // --- Carga del nivel siguiente ---------------------------------------
        // Despues de EndFrame y fuera de events.Update(): cambiar de nivel
        // reemplaza las entidades (y con ellas todos los punteros de este
        // frame) y la lista de eventos.
        if (transition.active && transition.remaining <= 0.0f)
        {
            try
            {
                level = loader.Load(transition.target.string(), events);
                currentLevelPath = transition.target;
                prepareLevel();
            }
            catch (const std::exception &error)
            {
                // Un nivel siguiente que no existe o esta roto no cierra el
                // juego: se sigue en el nivel actual y se avisa en pantalla.
                std::cerr << "No se pudo cargar " << transition.target.string() << ": " << error.what()
                          << std::endl;
                notice = "No se pudo cargar " + transition.target.filename().string();
                noticeRemaining = kNoticeSeconds;
            }
            currentCollisions.clear();
            swingRemaining = 0.0f;
            transition = Transition{};
        }
    }

    // Sin limpieza manual: ResourceManager y GraphicsDevice liberan todo en sus
    // destructores (RAII), en orden inverso al de construccion.
    return 0;
}
