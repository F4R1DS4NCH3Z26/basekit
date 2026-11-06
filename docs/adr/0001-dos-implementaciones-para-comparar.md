---
status: accepted
---

# Dos implementaciones del CLI en paralelo (Node y Go)

basekit se mantiene a la vez en Node/TypeScript (`guiade-project`) y en Go (`basekit-go`) para comparar con uso real qué lenguaje funciona mejor, cuál da mejor resultado y cuál ofrece mejor compatibilidad. Para que la comparación mida el CLI y no lo que genera, las plantillas son iguales en las dos versiones: todo arreglo de plantilla se aplica en ambas, y antes de cada release de basekit-go se revisa el diff de `plantillas/` contra Node. La versión que queda se elegirá, sin plazo fijo, por compatibilidad entre sistemas operativos, facilidad de instalación, experiencia de uso y mantenibilidad; entonces este ADR se reemplaza.
