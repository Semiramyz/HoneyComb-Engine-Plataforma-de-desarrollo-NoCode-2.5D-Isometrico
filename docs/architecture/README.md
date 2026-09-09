# Diagramas de arquitectura

Los diagramas de esta carpeta usan PlantUML y describen las dos aplicaciones
principales de HoneyComb Engine por separado.

## Editor

- `editor-context.puml`: contexto del editor y sus dependencias externas.
- `editor-components.puml`: componentes internos de Angular, Electron y el sistema de archivos.
- `editor-open-edit-save.puml`: flujo de abrir, modificar y guardar un nivel.
- `editor-deployment.puml`: procesos y artefactos durante desarrollo y distribucion.

## Runtime

- `runtime-components.puml`: componentes internos del ejecutable C++.
- `runtime-level-loading.puml`: carga de un nivel y resolucion de recursos.
- `runtime-game-loop.puml`: ciclo principal de simulacion y renderizado.
- `runtime-deployment.puml`: ejecutable, DLLs y datos necesarios para ejecutar un proyecto.

## Relacion entre aplicaciones

- `system-context.puml`: contrato comun y flujo de trabajo completo entre editor y runtime.

Los diagramas reflejan el estado actual del codigo. La comunicacion editor-runtime
se realiza actualmente mediante archivos del proyecto; un canal en vivo para
preview seria una evolucion posterior.