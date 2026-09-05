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

---

## 3. Verificación de la Instalación

Cierra todas las terminales abiertas y abre una nueva ventana de la Línea de comandos (`cmd`), PowerShell o la terminal integrada de **Visual Studio Code**. Verifica las herramientas ejecutando:

```bash
# Verificación de compiladores C/C++
gcc --version
g++ --version

# Verificación de Node.js y npm
node -v
npm -v
