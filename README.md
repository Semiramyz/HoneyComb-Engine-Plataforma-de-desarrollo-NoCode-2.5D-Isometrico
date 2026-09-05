# HoneyComb Engine — Plataforma de Desarrollo NoCode 2.5D Isométrico

## Guía del Entorno de Desarrollo

Documento técnico para la preparación y configuración del entorno de desarrollo. **HoneyComb Engine** utiliza una arquitectura desacoplada que combina un **Editor de Mapas y Niveles** basado en tecnologías web/escritorio y un **Motor de Ejecución (Runtime)** nativo de alto rendimiento.

---

## 0. Resumen de la Arquitectura del Proyecto

El proyecto está unificado para trabajar completamente desde **Visual Studio Code**, dividiendo la solución en dos módulos principales:

| Componente | Módulo | Tecnología | Función |
| :--- | :--- | :--- | :--- |
| **Editor** | `/editor` | Angular + Electron | Interfaz gráfica NoCode (canvas isométrico, eventos, gestión de tiles). |
| **Runtime** | `/engine` | C++17 + raylib | Motor de ejecución del juego, renderizado 2.5D y lógica física/JSON. |
| **Herramientas** | Transversal | CMake + vcpkg + VS Code | Construcción, depuración y gestión de paquetes. |

---

## 1. Requisitos Base del Sistema

Instala estas herramientas en tu sistema operativo antes de proceder con el entorno de desarrollo:

| Herramienta | Propósito | Verificación |
| :--- | :--- | :--- |
| **Git** | Control de versiones | `git --version` |
| **Node.js (LTS v20+)** | Runtime para Angular y Electron (incluye `npm`) | `node -v` y `npm -v` |
| **CMake (3.20+)** | Sistema de construcción (*build system*) para el Motor | `cmake --version` |
| **Compilador C++** | Compilador nativo para C++17 (MSVC, MinGW-w64, GCC o Clang) | `gcc --version` o `cl.exe` |
| **vcpkg** | Gestor de paquetes C++ (`raylib`, `nlohmann-json`) | `./vcpkg version` |

---

## 2. Configuración del Compilador de C++ y Herramientas

Para compilar el módulo `/engine`, necesitas una cadena de herramientas C++ válida según tu sistema operativo:

### Opción A: Windows vía MSYS2 (MinGW-w64) — Recomendado

> **Requisito previo:** Windows 10 (64 bits, versión 1809 o posterior).

1. **Instalar MSYS2 (Guardar ruta por defecto):** Descarga el instalador desde [msys2.org](https://www.msys2.org/). Completa la instalación en la ruta predeterminada (`C:\msys64`). Asegúrate de marcar la casilla **Run MSYS2 now** al finalizar.
2. **Instalar MinGW-w64 (Ejecutar dentro de la terminal MSYS2):** En la consola de MSYS2, ejecuta el siguiente comando. Presiona `Enter` para aceptar el grupo completo de paquetes e ingresa `Y` para proceder.
   ```bash
   pacman -S --needed base-devel mingw-w64-ucrt-x86_64-toolchain
