#!/usr/bin/env python3
"""把 output/mac 里的安装包与 update.json 发到 GitHub Release。

App 端走的是 api.github.com（本机直连 github.com 常超时，API 与资产接口稳定），
所以 update.json 里会额外记一个 assetId，App 用它取 zip。

用法：
  python3 desktop/publish.py --check                  # 只看线上最新版
  GH_TOKEN=ghp_xxx python3 desktop/publish.py         # 发布 output/mac 里的当前版本
  python3 desktop/publish.py --repo someone/other     # 换仓库

token 读取顺序：环境变量 GH_TOKEN / GITHUB_TOKEN → ~/.workbuddy/github-token
权限只要 repo 的 Contents: Read and write。
"""
import argparse
import hashlib
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
PACKAGES = ROOT / "output/mac"
DEFAULT_REPO = os.environ.get("WB_GITHUB_REPO", "mu-shan-beep/work-app")
API = "https://api.github.com"
UPLOADS = "https://uploads.github.com"
UA = "workbench-publish"
MANIFEST_NAME = "update.json"


def token():
    for key in ("GH_TOKEN", "GITHUB_TOKEN"):
        value = os.environ.get(key, "").strip()
        if value:
            return value
    # 只认 ~/.workbuddy/github-token：项目目录里放 token 容易被一起提交到公开仓库
    path = pathlib.Path.home() / ".workbuddy/github-token"
    if path.exists():
        return path.read_text().strip()
    return ""


def call(url, method="GET", body=None, content_type="application/json", accept=None):
    headers = {"Accept": accept or "application/vnd.github+json", "User-Agent": UA}
    value = token()
    if value:
        headers["Authorization"] = "Bearer " + value
    if body is not None and content_type == "application/json":
        body = json.dumps(body).encode()
    if body is not None:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            raw = response.read()
            if accept == "application/octet-stream":
                return raw
            text = raw.decode() or "{}"
            return json.loads(text) if text.lstrip().startswith(("{", "[")) else {"raw": text}
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:400]
        if error.code == 404:
            return {"_status": 404, "_detail": detail}
        raise SystemExit("GitHub API %s：%s" % (error.code, detail))


def check(repo):
    print("线上源：github:%s（https://api.github.com/repos/%s/releases/latest）" % (repo, repo))
    release = call("%s/repos/%s/releases/latest" % (API, repo))
    if release.get("_status") == 404 or "assets" not in release:
        print("还没有 Release，或仓库名不对。")
        return 1
    entry = next((a for a in (release.get("assets") or []) if a.get("name") == MANIFEST_NAME), None)
    if not entry:
        print("Release %s 里没有 update.json" % release.get("tag_name"))
        return 1
    manifest = json.loads(call(entry["url"], accept="application/octet-stream").decode())
    print("线上最新：%s build %s" % (manifest.get("version"), manifest.get("build")))
    print("安装包：%s（%s 字节，assetId=%s）"
          % (manifest.get("file"), manifest.get("size"), manifest.get("assetId")))
    return 0


def personal_guard(archive):
    """包里如果带了真实任务数据，就别往公开仓库传。"""
    with zipfile.ZipFile(archive) as bundle:
        for name in bundle.namelist():
            if name.endswith("Resources/seed/tasks.json"):
                try:
                    return len(json.loads(bundle.read(name).decode("utf-8")).get("tasks") or [])
                except Exception:  # noqa: BLE001
                    return 0
    return 0


def main():
    parser = argparse.ArgumentParser(description="发布 App 更新到 GitHub Release")
    parser.add_argument("--repo", default=DEFAULT_REPO, help="owner/name，默认 %s" % DEFAULT_REPO)
    parser.add_argument("--check", action="store_true", help="只检查线上最新版")
    parser.add_argument("--notes", default="", help="覆盖 Release 说明")
    parser.add_argument("--allow-personal", action="store_true", help="允许发布带真实任务数据的包")
    args = parser.parse_args()

    if args.check:
        return check(args.repo)

    directory = pathlib.Path(os.environ.get("WB_PACKAGES", PACKAGES))
    manifest_path = directory / MANIFEST_NAME
    if not manifest_path.exists():
        raise SystemExit("没有 %s，先跑 build.py" % manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    archive = directory / manifest["file"]
    if not archive.exists():
        raise SystemExit("找不到安装包 %s" % archive)

    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != manifest.get("sha256"):
        raise SystemExit("安装包和 update.json 里的 sha256 对不上，重新打包")

    count = personal_guard(archive)
    if count and not args.allow_personal:
        raise SystemExit("这个包里带着 %d 条真实任务数据，别传到公开仓库。"
                         "改用 WB_BUNDLE_PERSONAL_DATA=0 重新打包。" % count)

    if not token():
        raise SystemExit("没有 token。设置环境变量 GH_TOKEN，或写入 ~/.workbuddy/github-token")
    if not call("%s/repos/%s" % (API, args.repo)).get("full_name"):
        raise SystemExit("仓库 %s 不存在或没有权限" % args.repo)

    version = manifest["version"]
    tag = "v" + version
    release = call("%s/repos/%s/releases/tags/%s" % (API, args.repo, tag))
    if release.get("_status") == 404:
        release = call("%s/repos/%s/releases" % (API, args.repo), "POST", {
            "tag_name": tag,
            "name": "个人工作台 %s" % version,
            "body": (args.notes or manifest.get("notes", ""))
                    + "\n\nbuild %s · %s" % (manifest.get("build"), manifest.get("date", "")),
            "draft": False,
            "prerelease": False,
        })
        print("新建 Release", tag)
    else:
        print("复用已有 Release", tag)

    for asset in release.get("assets") or []:
        call("%s/repos/%s/releases/assets/%s" % (API, args.repo, asset["id"]), "DELETE")
        print("清掉旧资产", asset["name"])

    query = urllib.parse.urlencode({"name": archive.name})
    uploaded = call("%s/repos/%s/releases/%s/assets?%s" % (UPLOADS, args.repo, release["id"], query),
                    "POST", archive.read_bytes(), "application/zip")
    print("已上传", archive.name, "assetId =", uploaded.get("id"))

    manifest["assetId"] = uploaded.get("id")
    manifest["repo"] = args.repo
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    query = urllib.parse.urlencode({"name": MANIFEST_NAME})
    call("%s/repos/%s/releases/%s/assets?%s" % (UPLOADS, args.repo, release["id"], query),
         "POST", manifest_path.read_bytes(), "application/json")
    print("已上传", MANIFEST_NAME)

    print("发布完成，App 里更新源填：github:%s" % args.repo)
    return 0


if __name__ == "__main__":
    sys.exit(main())
