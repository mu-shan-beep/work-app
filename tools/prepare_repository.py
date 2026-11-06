#!/usr/bin/env python3
"""Prepare source-only review directory; never contacts GitHub or pushes."""
import pathlib,shutil,json
root=pathlib.Path(__file__).resolve().parent.parent
dest=root/'output/repository-preview'
if (dest/'.git').exists():raise SystemExit('Refusing to overwrite a Git checkout')
if dest.exists():shutil.rmtree(dest)
dest.mkdir(parents=True)
files=['.gitignore','启动工作台.command','desktop/App.swift','desktop/Settings.swift','desktop/Icon.swift','desktop/NormalizeIcon.swift','desktop/build.py','desktop/requirements-build.txt','desktop/smoke.js','desktop/Workbench.png','desktop/Workbench-rounded.png','tests/test_native.py','tools/prepare_repository.py','docs/README.github.md']
files += ['00-入口/'+n for n in ['app.html','workbench.css','studio.css','workbench.js','shortcuts.js','server.py','native_folder_picker.js','initialize.py']]
for item in files:
 target=dest/item;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/item,target)
for folder in ['00-入口/assets','00-入口/defaults']:shutil.copytree(root/folder,dest/folder,ignore=shutil.ignore_patterns('.DS_Store','__pycache__'))
shutil.copy2(root/'docs/README.github.md',dest/'README.md')
assert not any((dest/'00-入口'/n).exists() for n in ['tasks.json','life.json','templates.json','seed.py'])
for p in (dest/'00-入口/defaults').glob('*.json'):json.loads(p.read_text())
print('Prepared source for review:',dest)
print('No personal records, business files, build output, Git history or network writes included.')
