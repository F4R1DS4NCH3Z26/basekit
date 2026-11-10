---
status: accepted
---

# Menú interactivo con @clack/prompts

El CLI de Node tenía cero dependencias de runtime y un menú propio en modo raw. basekit-go usa huh (Charm) para sus formularios, así que la comparación de experiencia de uso del ADR 0001 medía un menú hecho a mano contra una librería madura. Node pasa a usar `@clack/prompts` (versión exacta, hoy 1.8.1) para las preguntas en una terminal: menús con flechas, selección múltiple, sí/no, texto y cancelación. Es su única dependencia de runtime; la regla "cero dependencias de runtime" se reemplaza por "solo `@clack/prompts`, en `src/ui/`". El modo numerado por líneas se conserva para cuando no hay modo raw y para los tests. Costo aceptado: `basekit install` descarga la dependencia (unos pocos paquetes pequeños) y clack exige Node >= 20.12.
