# 个人工作台 · Work App

一个面向个人日常工作的本地 Mac 工作台。任务、产出进度、今日安排、生活记录和本地文件入口集中在一个窗口里，离线运行，不要求账号。

![应用图标](desktop/Workbench-rounded.png)

## 功能

- 任务与分组管理：快速新建、改名、课时、下一步、关联文件夹。
- 多色分段进度圆环：按产出项计算完成率，直接切换未开始、进行中、待确认和完成。
- 未完成／已完成独立分区，搜索、筛选与按窗口大小分页。
- 今日安排、习惯补记、愿望、账单记录与误删后的即时撤销。
- macOS 原生文件夹选择、打开目录、重新检查本地文件。
- 原生 App 设置：登录自启、默认页面、记住窗口、关闭行为、菜单栏快捷入口、缩放、减少动画、装饰开关、数据目录选择和 JSON 备份。
- 独立应用图标；内置 Python 运行环境，使用 App 时不需要终端。

## 系统要求

当前提供 Apple 芯片 Mac（arm64）构建，最低系统声明 macOS 14。实际验证在开发用 Mac 上完成；Intel 和 Windows 暂未提供构建。

本地构建使用临时签名，没有 Developer ID 签名与 Apple 公证。用于公开分发时，应另行配置正式签名与公证。

## 使用 App

双击 `个人工作台.app`。建议放到「应用程序」后固定到程序坞。

设置入口：应用菜单「个人工作台 → 设置…」（`Command+,`），或工作台「我的 → App 设置」。默认不打开登录自启；开关使用 macOS 的 SMAppService，真实状态由系统返回。需要批准时，设置页会提供系统登录项入口。仅实现登录后启动，不是未登录时运行的后台守护服务。

普通构建首次启动会在 `~/Library/Application Support/个人工作台/` 建立空数据。任务文件实际内容仍留在用户选择的文件夹，App 只保存入口与进度。通过设置可以选择含三个有效 JSON 文件的已有数据目录，下次启动生效。

备份在设置页「数据 → 导出完整数据备份」。备份含任务、生活记录、分组与已移除记录，不包含任务关联的原始文件。当前尚未提供备份导入向导、云同步、自动更新和独立回收站列表。

## 从源码运行浏览器版

需要 Python 3（建议 3.12）。

```sh
python3 00-入口/initialize.py
python3 00-入口/server.py
```

打开 `http://127.0.0.1:8765/`。初始化只补缺失数据文件，不替换已有记录。浏览器版不显示原生 App 设置入口。

## 构建 Mac App

需要 Apple 芯片 Mac、Xcode Command Line Tools、Python 3.12。

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r desktop/requirements-build.txt
.venv/bin/python desktop/build.py
```

输出：项目根目录的 `个人工作台.app`，以及 `output/mac/Workbench-Mac-arm64.zip`。构建包含 Python 运行环境、网页资源、原生窗口和多尺寸图标，并执行本地签名验证。当前图标以 `desktop/Workbench.png` 为原图，通过 `desktop/NormalizeIcon.swift` 加上真正透明的圆角和安全边距，输出 `Workbench-rounded.png` 同步用于页面标识。顶部导航固定显示；「我的」页使用自适应双列模块布局。

默认使用 `00-入口/defaults/` 的空白数据，不把开发者记录装入发布包。如果明确需要个人使用包，可设置 `WB_BUNDLE_PERSONAL_DATA=1`；这会包含本机记录快照并关联当前项目数据目录，不能当作公共空白安装包分享。

## 验证

```sh
python3 tests/test_native.py
python3 tests/test_native.py --settings
```

验证在临时数据和独立偏好配置中运行：任务操作、进度分区、退出保存、设置持久化和备份。测试只读取系统自启状态，不会开启登录自启或重启 Mac。设置自启在真实系统登录时的行为需要用户授权后的人工验收。

## 目录

| 路径 | 用途 |
| --- | --- |
| `00-入口/` | 页面、交互、本地 HTTP 服务、系统选目录 |
| `00-入口/defaults/` | 无个人记录的初始化数据 |
| `desktop/App.swift` | 原生窗口、生命周期、网页与设置桥接 |
| `desktop/Settings.swift` | 原生设置、登录项、偏好和备份 |
| `desktop/Icon.swift` | 缺少 PNG 时使用的备用图标绘制代码 |
| `desktop/build.py` | 打包、图标多尺寸生成和签名 |
| `desktop/smoke.js` | 原生网页内的交互验证 |
| `tests/` | 隔离原生测试 |
| `tools/prepare_repository.py` | 以明确文件清单整理待发布源码 |

## 数据与贡献

真实 `tasks.json`、`life.json`、`templates.json`、本地业务文件、个人目录扫描脚本、归档和构建产物都不应提交。源码提供空白默认数据。App 设置使用当前用户的系统偏好存储，与任务记录分离。

修改页面或服务后需重新构建 App；直接刷新不会把源码改动带进已打包应用。修改可先在浏览器版验证，再构建并运行原生回归。

第三方图标使用 Lucide，许可见 `00-入口/assets/lucide/LICENSE`。部分装饰图片由 AI 生成，原始生成说明随素材目录保留。系统登录项实现参考 [Apple SMAppService](https://developer.apple.com/documentation/servicemanagement/smappservice)，原生网页窗口使用 [WKWebView](https://developer.apple.com/documentation/webkit/wkwebview)。
