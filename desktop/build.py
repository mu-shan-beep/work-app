#!/usr/bin/env python3
"""Reproducible local arm64 Mac app build; never modifies business JSON files."""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = ROOT / "00-入口"
BUILD = ROOT / "output/mac-build"
APP = ROOT / "个人工作台.app"
PACKAGES = ROOT / "output/mac"
PYTHON = os.environ.get("WB_BUILD_PYTHON", sys.executable)
VERSION = "1.3.3"
BUILD_NUMBER = "8"
NOTES = "设置页精简：App 设置与本地文件同步收进顶部状态栏图标，去掉界面更新模块。"
# 更新源：GitHub Releases。发布脚本 desktop/publish.py 把 update.json 和 zip 传上去。
# 地址用 api.github.com 而不是 github.com：本机直连 github.com 会超时，API 与资产接口稳定。
GITHUB_REPO = os.environ.get("WB_GITHUB_REPO", "mu-shan-beep/work-app")
UPDATE_FEED = os.environ.get(
    "WB_UPDATE_FEED",
    "https://api.github.com/repos/%s/releases/latest" % GITHUB_REPO)
DATA_DIR = os.environ.get("WB_APP_DATA_DIR", str(SOURCE))

def run(*args):
    subprocess.run([str(a) for a in args], check=True)

# 旧的构建目录与旧 App 先挪开再重建：本环境对大批量删除有保护，原地删会失败。
STALE_BUILD = ROOT / "output/.build-stale"
STALE_APP = ROOT / "output/.app-stale"
for stale in (STALE_BUILD, STALE_APP):
    if stale.exists():
        shutil.rmtree(stale, ignore_errors=True)
if BUILD.exists():
    BUILD.rename(STALE_BUILD)
if APP.exists():
    APP.rename(STALE_APP)
BUILD.mkdir(parents=True, exist_ok=True)
PACKAGES.mkdir(parents=True, exist_ok=True)
args = [PYTHON, "-m", "PyInstaller", "--noconfirm", "--onedir", "--name", "workbench-server",
        "--distpath", str(BUILD / "dist"), "--workpath", str(BUILD / "work"), "--specpath", str(BUILD)]
for name in ["app.html", "workbench.js", "workbench.css", "shortcuts.js", "studio.css", "native_folder_picker.js", "assets"]:
    args += ["--add-data", str(SOURCE / name) + ":" + ("assets" if name == "assets" else ".")]
run(*args, SOURCE / "server.py")
# The app bundle contains code + runtime; writable data stays outside the bundle.
resources = APP / "Contents/Resources"
macos = APP / "Contents/MacOS"
resources.mkdir(parents=True)
macos.mkdir()
shutil.copytree(BUILD / "dist/workbench-server", resources / "server", symlinks=True)
(resources / "seed").mkdir()
personal = os.environ.get("WB_BUNDLE_PERSONAL_DATA") == "1"
for name in ["tasks.json", "life.json", "templates.json"]:
    shutil.copy2((SOURCE if personal else SOURCE / "defaults") / name, resources / "seed" / name)
(resources / "workspace.json").write_text(json.dumps(
    {"dataDirectory": DATA_DIR, "updateFeed": UPDATE_FEED}, ensure_ascii=False), encoding="utf-8")
import plistlib
with (APP / "Contents/Info.plist").open("wb") as file:
    plistlib.dump({"CFBundleName":"个人工作台", "CFBundleDisplayName":"个人工作台", "CFBundleIdentifier":"cn.mushan.workbench",
                  "CFBundleExecutable":"Workbench", "CFBundlePackageType":"APPL", "CFBundleShortVersionString":VERSION,
                  "CFBundleVersion":BUILD_NUMBER, "LSMinimumSystemVersion":"14.0", "NSHighResolutionCapable":True,
                  "CFBundleIconFile":"Workbench", "NSAppTransportSecurity":{"NSAllowsLocalNetworking":True},
                  "NSSupportsAutomaticTermination":False, "NSSupportsSuddenTermination":False}, file)
run("/usr/bin/xcrun", "swiftc", "-O", "-target", "arm64-apple-macosx14.0", "-module-cache-path", BUILD / "swift-cache",
    ROOT / "desktop/App.swift", ROOT / "desktop/Settings.swift", ROOT / "desktop/Updater.swift", "-o", macos / "Workbench", "-framework", "AppKit", "-framework", "WebKit", "-framework", "SwiftUI", "-framework", "ServiceManagement")
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
archive = PACKAGES / "Workbench-Mac-arm64.zip"
# 资产名用纯 ASCII：GitHub Release 下载地址里带中文要转义，容易踩坑
for old in PACKAGES.glob("*.zip"):
    if old != archive:
        old.unlink()
if archive.exists(): archive.unlink()
run("/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", APP, archive)
# 更新清单：App 启动时读它判断有没有新版本
import hashlib
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(PACKAGES / "update.json").write_text(json.dumps({
    "version": VERSION, "build": int(BUILD_NUMBER), "file": archive.name,
    "sha256": digest, "size": archive.stat().st_size, "notes": NOTES,
    "date": time.strftime("%Y-%m-%d %H:%M"),
}, ensure_ascii=False, indent=2), encoding="utf-8")
shutil.rmtree(STALE_BUILD, ignore_errors=True)
shutil.rmtree(STALE_APP, ignore_errors=True)
print("APP:", APP)
print("UPDATE:", PACKAGES / "update.json")
print("ZIP:", archive)
