#!/usr/bin/env python
"""Utilidad de línea de comandos de Django (corre dentro de Docker: `make sh`)."""

import os
import sys


def main() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "src.config.settings")
    from django.core.management import execute_from_command_line

    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
