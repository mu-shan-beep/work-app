#!/usr/bin/env python3
"""Reproducible local arm64 Mac app build; never modifies business JSON files."""
import json
import os
import pathlib
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "00-入口"
BUILD = ROOT / "output/mac-build"
APP = ROOT / "个人工作台.app"
PACKAGES = ROOT / "output/mac"
PYTHON = os.environ.get("WB_BUILD_PYTHON", sys.executable)

def run(*args):
    subprocess.run([str(a) for a in args], check=True)

BUILD.mkdir(parents=True, exist_ok=True)
PACKAGES.mkdir(parents=True, exist_ok=True)
args = [PYTHON, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--name", "workbench-server",
        "--distpath", str(BUILD / "dist"), "--workpath", str(BUILD / "work"), "--specpath", str(BUILD)]
for name in ["app.html", "workbench.js", "workbench.css", "shortcuts.js", "studio.css", "native_folder_picker.js", "assets"]:
    args += ["--add-data", str(SOURCE / name) + ":" + ("assets" if name == "assets" else ".")]
run(*args, SOURCE / "server.py")
# The app bundle contains code + runtime; writable data stays outside the bundle.
if APP.exists():
    shutil.rmtree(APP)
resources = APP / "Contents/Resources"
macos = APP / "Contents/MacOS"
resources.mkdir(parents=True)
macos.mkdir()
shutil.copytree(BUILD / "dist/workbench-server", resources / "server", symlinks=True)
(resources / "seed").mkdir()
personal = os.environ.get("WB_BUNDLE_PERSONAL_DATA") == "1"
for name in ["tasks.json", "life.json", "templates.json"]:
    shutil.copy2((SOURCE if personal else SOURCE / "defaults") / name, resources / "seed" / name)
(resources / "workspace.json").write_text(json.dumps({"dataDirectory": str(SOURCE) if personal else ""}, ensure_ascii=False), encoding="utf-8")
import plistlib
with (APP / "Contents/Info.plist").open("wb") as file:
    plistlib.dump({"CFBundleName":"个人工作台", "CFBundleDisplayName":"个人工作台", "CFBundleIdentifier":"cn.mushan.workbench",
                  "CFBundleExecutable":"Workbench", "CFBundlePackageType":"APPL", "CFBundleShortVersionString":"1.1.0",
                  "CFBundleVersion":"3", "LSMinimumSystemVersion":"14.0", "NSHighResolutionCapable":True,
                  "CFBundleIconFile":"Workbench", "NSAppTransportSecurity":{"NSAllowsLocalNetworking":True},
                  "NSSupportsAutomaticTermination":False, "NSSupportsSuddenTermination":False}, file)
run("/usr/bin/xcrun", "swiftc", "-O", "-target", "arm64-apple-macosx14.0", "-module-cache-path", BUILD / "swift-cache",
    ROOT / "desktop/App.swift", ROOT / "desktop/Settings.swift", "-o", macos / "Workbench", "-framework", "AppKit", "-framework", "WebKit", "-framework", "SwiftUI", "-framework", "ServiceManagement")
provided_icon=ROOT / "desktop/Workbench.png"
if provided_icon.exists():
    run("/usr/bin/xcrun", "swiftc", "-O", "-module-cache-path", BUILD / "swift-cache", ROOT / "desktop/NormalizeIcon.swift", "-o", BUILD / "normalize-icon")
    run(BUILD / "normalize-icon", provided_icon, BUILD / "icon.png")
else:
    run("/usr/bin/xcrun", "swiftc", "-O", "-module-cache-path", BUILD / "swift-cache", ROOT / "desktop/Icon.swift", "-o", BUILD / "make-icon")
    run(BUILD / "make-icon", BUILD / "icon.png")
icons = BUILD / "Workbench.iconset"
icons.mkdir(exist_ok=True)
for size in [16,32,128,256,512]:
    for scale in [1,2]:
        suffix = "@2x" if scale == 2 else ""
        run("/usr/bin/sips", "-z", size*scale, size*scale, BUILD / "icon.png", "--out", icons / ("icon_%dx%d%s.png" % (size,size,suffix)))
run("/usr/bin/iconutil", "-c", "icns", icons, "-o", resources / "Workbench.icns")
run("/usr/bin/codesign", "--force", "--deep", "--sign", "-", "--timestamp=none", APP)
run("/usr/bin/codesign", "--verify", "--deep", "--strict", APP)
archive = PACKAGES / "个人工作台-Mac-arm64.zip"
if archive.exists(): archive.unlink()
run("/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", APP, archive)
print("APP:", APP)
print("ZIP:", archive)
