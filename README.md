# HoneyComb Engine — Plataforma de Desarrollo NoCode 2.5D Isométrico
## Guía del Entorno de Desarrollo

---

## Descripción del proyecto!

**HoneyComb Engine** es un prototipo de plataforma de desarrollo **NoCode** orientada a la creación de experiencias interactivas isométricas 2.5D de puzle y acción. El proyecto combina:

- Un **Editor de Mapas y Niveles** (interfaz de escritorio) donde el diseñador construye niveles mediante arrastrar y soltar (drag & drop) sobre una grilla isométrica, y configura la lógica del juego (eventos, condiciones, acciones) sin escribir código.
- Un **Motor de Ejecución (Runtime)** nativo de alto rendimiento, escrito en C++ sobre `raylib`, que interpreta los niveles diseñados y los ejecuta con estabilidad de fotogramas por segundo (FPS).

Ambos módulos son aplicaciones **independientes** que se comunican exclusivamente a través de un **contrato de datos en formato JSON** (`level.schema.json` y `event_catalog.json`). Este diseño *data-driven* elimina la necesidad de recompilar el motor cada vez que se modifica un nivel, y permite que el editor y el runtime evolucionen por separado.

---

## 0. Resumen de la Arquitectura del Proyecto

El proyecto está unificado para trabajar completamente desde **Visual Studio Code**, dividiendo la solución en dos módulos principales:

| Componente | Módulo | Tecnología | Función |
| :--- | :--- | :--- | :--- |
| **Editor** | `/editor` | Angular + Electron | Interfaz gráfica NoCode (canvas isométrico, eventos, gestión de tiles). |
| **Runtime** | `/engine` | C++17 + raylib 6.0 | Motor de ejecución del juego, renderizado 2.5D, Z-sorting, colisiones y lógica dirigida por JSON. |
| **Herramientas** | Transversal | CMake + vcpkg + VS Code | Construcción, depuración y gestión de paquetes. |

```
Editor (Angular/Electron)  ──►  proyecto.json / event_catalog.json  ──►  Runtime (C++/raylib)
      diseño del nivel                 contrato de datos                  ejecución nativa
```

---

## 1. Requisitos Base del Sistema

Instala estas herramientas en tu sistema operativo antes de proceder con el entorno de desarrollo:

| Herramienta | Propósito | Verificación |
| :--- | :--- | :--- |
| **Git** | Control de versiones | `git --version` |
| **Node.js (LTS v20+)** | Runtime para Angular y Electron (incluye `npm`) | `node -v` y `npm -v` |
| **CMake (3.20+)** | Sistema de construcción (*build system*) para el Motor | `cmake --version` |
| **Ninja** (recomendado) | Generador de build más rápido que el predeterminado | `ninja --version` |
| **Compilador C++17** | MinGW-w64, MSVC, GCC o Clang, según SO (ver sección 2) | Ver verificación específica por opción |
| **vcpkg** | Gestor de paquetes C++ (`sdl2`, `nlohmann-json`) | `./vcpkg version` |

> **Nota:** la verificación del compilador difiere según la ruta que elijas en la sección 2 — no todos los compiladores se verifican con el mismo comando.

---

## 2. Configuración del Compilador de C++ y Herramientas

Para compilar el módulo `/engine`, necesitas una cadena de herramientas (*toolchain*) C++17 válida según tu sistema operativo. Elige **una sola opción** y sé consistente con ella en la sección 3 (vcpkg).

### Opción A: Windows vía MSYS2 (MinGW-w64) — Recomendado

> **Requisito previo:** Windows 10 de 64 bits (versión 1809 o posterior).

1. **Instalar MSYS2:** Descarga el instalador desde [msys2.org](https://www.msys2.org/). Completa la instalación en la ruta predeterminada (`C:\msys64`). Marca **Run MSYS2 now** al finalizar.
2. **Instalar el toolchain y herramientas de build:** en la consola **MSYS2 UCRT64** (no la consola MSYS genérica), ejecuta:
   ```bash
   pacman -Syu
   pacman -S --needed base-devel mingw-w64-ucrt-x86_64-toolchain \
       mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-ninja
   ```
   Presiona `Enter` para aceptar el grupo completo de paquetes e ingresa `Y` para proceder. Si `pacman -Syu` pide reiniciar la terminal, ciérrala y reábrela antes de continuar.
3. **Añadir MinGW-w64 al PATH del sistema:** agrega `C:\msys64\ucrt64\bin` a la variable de entorno `PATH` de Windows (Panel de Control → Variables de entorno), para que VS Code y la terminal normal de Windows encuentren `g++`, `cmake` y `ninja`.
4. **Verificación** (desde una terminal normal de Windows, no MSYS2):
   ```bash
   g++ --version
   cmake --version
   ninja --version
   ```

> **Nota sobre MSVC:** si en cambio prefieres el compilador de Microsoft (`cl.exe`), instala **Build Tools for Visual Studio** (sin el IDE completo) y usa el **"Developer Command Prompt for VS"** — `cl.exe` no funciona desde una terminal genérica, a diferencia de `g++`. Si eliges esta ruta, el triplet de vcpkg en la sección 3 es distinto (ver nota ahí).

### Opción B: Linux

```bash
sudo apt update
sudo apt install build-essential cmake ninja-build git
```
Verificación:
```bash
g++ --version
cmake --version
```

### Opción C: macOS

```bash
xcode-select --install
brew install cmake ninja
```
Verificación:
```bash
clang++ --version
cmake --version
```

---

## 3. vcpkg — Gestor de Paquetes C++

### 3.1 Clonar y arrancar vcpkg (una sola vez)
```bash
git clone https://github.com/microsoft/vcpkg.git
cd vcpkg
./bootstrap-vcpkg.sh      # Linux / macOS
.\bootstrap-vcpkg.bat     # Windows
```

### 3.2 Instalar las dependencias del motor — atención al *triplet*

⚠️ **Importante:** el *triplet* de vcpkg debe coincidir con el compilador elegido en la sección 2, o el linkeo del motor fallará por incompatibilidad de ABI.

El proyecto trabaja en **modo manifiesto**: con el `vcpkg.json` de `/engine` presente, no hace falta correr `vcpkg install` a mano — CMake lo dispara automáticamente al configurar (sección 5), instalando lo que declara el manifiesto (`sdl2` y `nlohmann-json`; ver 3.3 sobre por qué `raylib` no está ahí). Aun así, el triplet debe coincidir con el compilador elegido:

- **MinGW-w64 (Opción A recomendada):** triplet `x64-mingw-dynamic`.
- **MSVC:** triplet `x64-windows`.
- **Linux/macOS:** el triplet por defecto (`x64-linux` / `x64-osx` / `arm64-osx`) es correcto sin configuración adicional.

El triplet se fija en `/engine/CMakePresets.json` (ver sección 5.2), no como variable de entorno ni flag manual.

### 3.3 raylib se compila desde el código fuente (no vía vcpkg) — backend SDL2

Todo el diseño de arquitectura de este proyecto parte específicamente del diagrama **raylib 6.0**, pero **raylib no aparece en `vcpkg.json`**: se descarga y compila automáticamente desde el código fuente oficial mediante `FetchContent` en `engine/CMakeLists.txt`, fijado al tag `6.0`.

¿Por qué no usar el paquete precompilado de vcpkg? Por defecto, raylib usa **GLFW** para crear la ventana. En pruebas de desarrollo se encontró que, en ciertas combinaciones de driver NVIDIA + Windows, GLFW cuelga la ventana al arrancar (confirmado con depurador: el hilo principal queda bloqueado dentro de la propia DLL del driver). Cambiar raylib al backend **SDL2** evita ese problema por completo, y como el paquete de vcpkg para raylib solo ofrece GLFW, la solución es compilar raylib nosotros mismos con `-DPLATFORM=SDL`. `sdl2` sí es una dependencia declarada en `vcpkg.json`, y CMake la instala igual que `nlohmann-json`, en modo manifiesto.

Como este proceso está completamente declarado en `engine/CMakeLists.txt` y `engine/vcpkg.json` (ambos versionados), no requiere ningún paso manual adicional: `CMake: Configure` descarga SDL2 vía vcpkg y clona/compila raylib vía `FetchContent` automáticamente.

---

## 4. VS Code — Extensiones Necesarias

### 4.1 Para el Runtime (C++ / raylib / CMake)
| Extensión | ID | Función |
| :--- | :--- | :--- |
| C/C++ | `ms-vscode.cpptools` | IntelliSense, depuración y navegación de código C++ |
| CMake Tools | `ms-vscode.cmake-tools` | Configurar, compilar y depurar el proyecto CMake |
| CMake Language Support | `twxs.cmake` | Resaltado de sintaxis de `CMakeLists.txt` |
| CodeLLDB *(opcional, Linux/macOS)* | `vadimcn.vscode-lldb` | Depurador alternativo a GDB |

### 4.2 Para el Editor (Angular / Electron / TypeScript)
| Extensión | ID | Función |
| :--- | :--- | :--- |
| Angular Language Service | `Angular.ng-template` | Autocompletado y validación de templates Angular |
| ESLint | `dbaeumer.vscode-eslint` | Linting de TypeScript/JavaScript |
| Prettier — Code formatter | `esbenp.prettier-vscode` | Formateo consistente de código |
| *(Incluido por defecto)* JavaScript Debugger | `ms-vscode.js-debug` | Depuración de Node/Electron sin instalación adicional |

### 4.3 Transversales / equipo
| Extensión | ID | Función |
| :--- | :--- | :--- |
| GitLens | `eamodio.gitlens` | Historial y blame de Git enriquecido |
| Error Lens | `usernamehw.errorlens` | Resalta errores/warnings inline |
| Live Share *(opcional)* | `ms-vsliveshare.vsliveshare` | Colaboración en tiempo real |

---

## 5. Configuración del módulo `/engine` (Runtime C++/raylib)

### 5.1 `CMakeLists.txt`
```cmake
cmake_minimum_required(VERSION 3.20)
project(honeycomb_engine CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(SDL2 CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)

# raylib se compila desde el codigo fuente (no via vcpkg) para usar el backend
# de ventanas SDL2 en vez de GLFW (ver seccion 3.3 del README).
set(PLATFORM "SDL" CACHE STRING "" FORCE)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)

include(FetchContent)
FetchContent_Declare(
    raylib
    GIT_REPOSITORY https://github.com/raysan5/raylib.git
    GIT_TAG 6.0
    GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(raylib)

add_executable(engine main.cpp)
target_link_libraries(engine PRIVATE raylib SDL2::SDL2 nlohmann_json::nlohmann_json)

if(TARGET SDL2::SDL2)
    add_custom_command(TARGET engine POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:SDL2::SDL2>" "$<TARGET_FILE_DIR:engine>"
    )
endif()
```

### 5.2 Conectar VS Code con el toolchain de vcpkg
El proyecto usa `/engine/CMakePresets.json` (versionado en el repo) para apuntar al toolchain de vcpkg a través de la variable de entorno `VCPKG_ROOT`, en vez de una ruta fija — así cada persona del equipo puede tener vcpkg clonado donde quiera, sin tocar ningún archivo versionado.

Define `VCPKG_ROOT` una sola vez en tu máquina, apuntando a donde clonaste vcpkg en la sección 3:
```powershell
[Environment]::SetEnvironmentVariable("VCPKG_ROOT", "C:\ruta\a\tu\vcpkg", "User")
```
(cierra y vuelve a abrir la terminal/VS Code para que tome la variable). `CMakePresets.json` ya trae dos presets listos: `default` (MinGW-w64, `x64-mingw-dynamic`) y `msvc` (`x64-windows`) — CMake Tools los detecta automáticamente al abrir `/engine`.

### 5.3 Flujo de trabajo en VS Code
1. Abrir la carpeta `/engine` en VS Code.
2. `CMake Tools` detecta el `CMakeLists.txt` y pide seleccionar un **kit** (el compilador detectado: GCC/MinGW, Clang o MSVC).
3. `Ctrl+Shift+P → CMake: Configure`, luego `CMake: Build`.
4. Depurar con `F5` (CMake Tools genera el `launch.json` automáticamente).

### 5.4 Herramientas de calidad de memoria (mitigan el riesgo de "gestión manual de memoria")
- **AddressSanitizer (ASan):** agrega `-fsanitize=address` (GCC/Clang) a los flags de compilación en modo Debug.
- **Valgrind** *(solo Linux)*: análisis de leaks más exhaustivo.
- **Catch2** o **GoogleTest** *(instalables vía vcpkg)*: pruebas unitarias de `LevelLoader`, `ZSortSystem`, `EventSystem`.

---

## 6. Configuración del módulo `/editor` (Angular + Electron)

### 6.1 Instalar Angular CLI
```bash
npm install -g @angular/cli
```
Verificación: `ng version`.

### 6.2 Crear el proyecto Angular
```bash
ng new editor --routing --style=scss
cd editor
```

### 6.3 Añadir Electron
```bash
npm install --save-dev electron electron-builder
```
- **electron** → runtime de escritorio que envuelve la app Angular.
- **electron-builder** → empaquetado final (`.exe`, `.dmg`, `.AppImage`).

Se necesita un `main.js` (proceso principal de Electron) que cargue el build de Angular (`dist/editor/index.html`) dentro de una `BrowserWindow`, y un `preload.js` que exponga de forma segura el acceso al sistema de archivos vía `contextBridge` (para guardar/abrir proyectos `.json` en disco).

### 6.4 Librerías adicionales según necesidades del editor
| Necesidad del proyecto | Librería recomendada |
| :--- | :--- |
| Drag & drop de tiles/entidades en el canvas isométrico | `@angular/cdk` (módulo `DragDropModule`) |
| Formularios de configuración de eventos (Trigger→Condición→Acción) | `Reactive Forms` (`@angular/forms`) |
| Validación del JSON contra `level.schema.json` / `event_catalog.json` | `ajv` (JSON Schema validator) |

### 6.5 Testing del Editor
- **Jasmine + Karma** (incluidos por defecto con `ng new`) para pruebas unitarias de componentes.
- **Playwright** para pruebas end-to-end sobre la app Electron ya empaquetada.

---

## 7. Estructura de Carpetas del Proyecto

```
/honeycomb-engine
├── editor/                       # Angular + Electron
│   ├── src/
│   │   ├── canvas/                 # Render isométrico del editor (preview)
│   │   ├── panels/                 # Propiedades, capas, assets
│   │   └── events/                  # UI del editor de eventos
│   ├── main.js                      # Proceso principal de Electron
│   └── preload.js                   # Puente seguro renderer ↔ sistema de archivos
├── engine/                        # C++17 / raylib
│   ├── core/                        # Wrapper de abstracción sobre raylib
│   ├── systems/
│   │   ├── iso_grid/
│   │   ├── z_sort/
│   │   ├── collision/
│   │   └── event_system/
│   ├── loader/                      # LevelLoader, EventLoader
│   ├── vcpkg.json                    # Manifiesto de dependencias (sdl2, nlohmann-json; raylib se compila vía FetchContent)
│   ├── CMakePresets.json             # Toolchain de vcpkg vía $env{VCPKG_ROOT} (portable entre máquinas)
│   ├── CMakeLists.txt
│   └── main.cpp
├── schema/
│   ├── level.schema.json            # Contrato de niveles
│   └── event_catalog.json           # Catálogo de triggers/condiciones/acciones
├── tools/
│   └── profiling/                    # Scripts de evaluación de rendimiento
├── assets/
└── levels/
```

---

## 8. Checklist de Instalación (orden recomendado)

1. [ ] Instalar **Git**.
2. [ ] Instalar **Node.js LTS** (v20+).
3. [ ] Instalar **VS Code**.
4. [ ] Instalar las extensiones de VS Code de la sección 4 (Runtime, Editor y Transversales).
5. [ ] Elegir e instalar el **compilador C++17** según tu SO (sección 2 — Opción A, B o C).
6. [ ] Instalar **CMake** y **Ninja** (si no vinieron incluidos con la opción elegida en el paso 5).
7. [ ] Clonar y arrancar **vcpkg** (`bootstrap-vcpkg`).
8. [ ] Confirmar el **triplet correcto** de vcpkg según el compilador elegido (sección 3.2).
9. [ ] Clonar el repositorio del proyecto (`honeycomb-engine`).
10. [ ] Confirmar `vcpkg.json` en `/engine` (`sdl2`, `nlohmann-json`) — ya versionado, no requiere cambios.
11. [ ] Definir la variable de entorno `VCPKG_ROOT` en tu máquina, apuntando a tu clon de vcpkg (sección 5.2). Abrir `/engine` en VS Code — `CMakePresets.json` ya está versionado y CMake Tools lo detecta solo.
12. [ ] `CMake: Configure` → `CMake: Build` en `/engine`. Confirmar que compila sin errores. La primera vez tarda varios minutos (vcpkg compila SDL2 y CMake clona/compila raylib desde el código fuente); las siguientes son incrementales y rápidas.
13. [ ] Instalar `@angular/cli` globalmente.
14. [ ] Dentro de `/editor`: `npm install` (Angular, Electron, electron-builder, @angular/cdk, ajv).
15. [ ] Levantar el editor en modo desarrollo (`ng serve` + `electron .`) y confirmar que abre la ventana de escritorio.
16. [ ] Verificar que ambos módulos (`/editor` y `/engine`) compilan/corren **de forma independiente** antes de conectar el flujo de niveles JSON entre ambos.

---

## 9. Verificación Final (smoke test)

Antes de empezar a desarrollar funcionalidades, confirma este flujo mínimo end-to-end:

1. El editor Angular/Electron abre y permite guardar un archivo `.json` de prueba en disco.
2. El runtime C++/raylib abre una ventana (`InitWindow`) sin errores de linkeo.
3. El runtime puede leer y parsear ese mismo `.json` de prueba usando `nlohmann::json`, sin necesidad de recompilar el motor si el archivo cambia.

Si los tres puntos funcionan, el entorno está listo para empezar a implementar los sistemas del motor (`IsoGridSystem`, `ZSortSystem`, `CollisionSystem`, `EventSystem`) y las pantallas del editor.
