#!/usr/bin/env python3
"""Compatibility entrypoint for rebuilding Folio's transparent pet animations."""

from pathlib import Path
import runpy


runpy.run_path(
    str(Path(__file__).with_name("build-transparent-cat-assets.py")),
    run_name="__main__",
)
