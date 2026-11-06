# basekit

CLI que prepara la base de un proyecto para trabajar con agentes de código: deja el proyecto listo para que un agente lo continúe con reglas, zonas y entorno ya definidos.

## Lenguaje

**Stack**:
Combinación de lenguaje, framework, roles y entorno que basekit sabe preparar; cada proyecto se prepara con exactamente un stack.
_Evitar_: template

**Plantilla**:
Cada archivo que basekit copia o completa al preparar un proyecto.
_Evitar_: template

**Agente**:
Herramienta de IA que trabaja sobre el proyecto, como Claude Code, OpenCode o Codex.
_Evitar_: herramienta, asistente

**Rol**:
Instrucciones y zona de archivos con las que un agente se encarga de una parte del proyecto; fuera de su zona no edita.
_Evitar_: agente, writer, subagente
