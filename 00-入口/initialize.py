#!/usr/bin/env python3
"""Initialize empty local data without scanning folders or replacing records."""
import pathlib
import shutil

base=pathlib.Path(__file__).resolve().parent
for name in ["tasks.json","life.json","templates.json"]:
    target=base/name
    if not target.exists():
        shutil.copy2(base/"defaults"/name,target)
        print("Created",name)
    else:
        print("Kept existing",name)
