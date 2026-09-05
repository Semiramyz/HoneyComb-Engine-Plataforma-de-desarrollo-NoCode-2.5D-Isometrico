# HoneyComb Engine-Plataforma de desarrollo NoCode 2.5D Isométrico

# Guía de Configuración del Entorno de Desarrollo

Este repositorio requiere la instalación previa de las herramientas del compilador C/C++ (**MinGW-w64 via MSYS2**) y el entorno de ejecución para JavaScript (**Node.js**).

---

## 1. Configuración del Compilador C/C++ (MSYS2 & MinGW-w64)

> **Requisito previo:** Windows 10 de 64 bits (versión 1809 o posterior).

<Sequence>
  <Step title="Descargar e instalar MSYS2" subtitle="Guardar la ruta predeterminada">
    Descarga el instalador desde la página oficial de [MSYS2](https://www.msys2.org/). Completa el asistente de instalación manteniendo la carpeta predeterminada (por defecto: `C:\msys64`). Asegúrate de marcar la casilla **Run MSYS2 now** al finalizar.
  </Step>

  <Step title="Instalar la herramienta de compilación" subtitle="Ejecutar en la terminal de MSYS2">
    En la consola de MSYS2 que se abre tras la instalación, ejecuta el siguiente comando:

    ```bash
    pacman -S --needed base-devel mingw-w64-ucrt-x86_64-toolchain
    ```

    Presiona `Enter` para aceptar el número predeterminado de paquetes del grupo y luego ingresa `Y` cuando te solicite confirmación para proceder.
  </Step>

  <Step title="Agregar la ruta al PATH de Windows" subtitle="Requerido para ejecutar GCC/G++ desde cualquier consola">
    1. En el buscador de Windows, escribe **Configuración** (*Settings*).
    2. Busca y selecciona **Editar las variables de entorno para su cuenta**.
    3. En la sección **Variables de usuario**, selecciona la variable **Path** y haz clic en **Editar**.
    4. Haz clic en **Nuevo** y agrega la ruta de los binarios:
       ```text
       C:\msys64\ucrt64\bin
       ```
    5. Guarda los cambios presionando **Aceptar** en ambas ventanas.
  </Step>
</Sequence>

---

## 2. Instalación del Runtime de Node.js

Para la ejecución de scripts o aplicaciones en JavaScript/TypeScript, se requiere Node.js:

1. Descarga e instala la versión recomendada (LTS) de Node.js desde su [sitio web oficial](https://nodejs.org/).
2. El gestor de paquetes **npm** se instalará automáticamente junto con Node.js.

# Guía del Entorno de Desarrollo

Documento técnico para la preparación y configuración del entorno de desarrollo. Este proyecto utiliza una arquitectura separada que combina un **Editor de Mapas/Niveles** basado en tecnologías web/escritorio y un **Motor de Ejecución (Runtime)** nativo de alto rendimiento.

---

## 0. Resumen de Cambios en la Arquitectura

Se ha actualizado el stack tecnológico del proyecto para unificar el flujo de trabajo dentro de **Visual Studio Code**:

| Componente | Configuración Anterior | Configuración Actual |
| :--- | :--- | :--- |
| **IDE Principal** | Visual Studio | **VS Code** |
| **Framework Frontend (Editor)** | React | **Angular** |
| **Plataforma de Escritorio** | Electron | **Electron** |
| **Motor / Runtime** | C++ / raylib | **C++ / raylib** *(Sin cambios)* |

> **Nota:** El Runtime en C++/raylib mantiene su arquitectura, pero ahora se compila, ejecuta y depura directamente desde VS Code mediante herramientas de CMake.

---

## 1. Requisitos Base del Sistema

Instala estas herramientas base en tu sistema operativo antes de configurar las extensiones o el código fuente:

| Herramienta | Propósito | Verificación |
| :--- | :--- | :--- |
| **Git** | Control de versiones | `git --version` |
| **Node.js (LTS v20+)** | Runtime para Angular y Electron (incluye `npm`) | `node -v` && `npm -v` |
| **CMake (3.20+)** | Sistema de construcción (*build system*) para C++ | `cmake --version` |
| **Compilador C++** | Compilación nativa del Motor (MSVC, GCC o Clang) | Depende del SO |
| **vcpkg** *(Recomendado)* | Gestor de paquetes C++ para librerías (`raylib`, `nlohmann-json`) | `./vcpkg version` |

---

## 2. Configuración del IDE: VS Code

Descarga e instala [Visual Studio Code](https://code.visualstudio.com/). A continuación, instala las siguientes extensiones requeridas según su área funcional:

### 2.1 Extensiones para C++ / Runtime
* **C/C++** (`ms-vscode.cpptools`): Navegación, IntelliSense y depuración.
* **CMake Tools** (`ms-vscode.cmake-tools`): Configuración, compilación y ejecución de proyectos CMake.
* **CMake Language Support** (`twxs.cmake`): Resaltado de sintaxis para archivos `CMakeLists.txt`.
* *(Opcional)* **CodeLLDB** (`vadimcn.vscode-lldb`): Depurador alternativo para entornos Linux/macOS.

### 2.2 Extensiones para Angular / Electron
* **Angular Language Service** (`Angular.ng-template`): Autocompletado y validación dentro de plantillas `.html`.
* **ESLint** (`dbaeumer.vscode-eslint`): Linter para TypeScript y JavaScript.
* **Prettier - Code Formatter** (`esbenp.prettier-vscode`): Formateo automático y consistente de código.
* **JavaScript Debugger** (`ms-vscode.js-debug`): Incluido por defecto para depuración de procesos Node/Electron.

### 2.3 Extensiones Transversales
* **GitLens** (`eamodio.gitlens`): Historial de cambios y atribución de líneas (*git blame*).
* **Live Share** (`ms-vsliveshare.vsliveshare`): Colaboración e inspección de código en tiempo real.
* **Error Lens** (`usernamehw.errorlens`): Diagnóstico visual de advertencias y errores en línea.
* *(Opcional)* **Todo Tree**: Seguimiento de anotaciones `TODO` y `FIXME` en la base de código.

---

## 3. Stack del Editor (`/editor`): Angular + Electron

### 3.1 Instalación de Herramientas Globales
```bash
npm install -g @angular/cli
ng version # Verificación
