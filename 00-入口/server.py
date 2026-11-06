#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
个人工作台 · 本地服务

只监听 127.0.0.1，仅本机可访问。负责：
  - 提供界面
  - 读写 tasks.json（点一下状态就落盘）
  - 打开本地文件 / 在访达中定位
  - 按文件重新检测产出份数

启动：python3 server.py    或双击 启动工作台.command
"""

import os
import sys
import json
import time
import hashlib
import subprocess
import webbrowser
import threading
import uuid
from datetime import date, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_BASE = os.path.abspath(os.environ.get("WB_DATA_DIR", BASE))


def resolve_web_base():
    """界面资源目录：优先外部源码目录，改界面不必重新打包 App。

    顺序为 WB_WEB_DIR（显式指定）→ 数据目录（本机即 00-入口）→ 程序自身目录
    （打包后的包内快照）。只有目录里确实存在 app.html 才算数。
    """
    for cand in (os.environ.get("WB_WEB_DIR"), DATA_BASE, BASE):
        if not cand:
            continue
        cand = os.path.abspath(cand)
        if os.path.isfile(os.path.join(cand, "app.html")):
            return cand
    return BASE


WEB_BASE = resolve_web_base()
WEB_FILES = ("app.html", "workbench.js", "workbench.css", "studio.css", "shortcuts.js",
             "native_folder_picker.js")
TASKS = os.path.join(DATA_BASE, "tasks.json")
TEMPLATES = os.path.join(DATA_BASE, "templates.json")
LIFE = os.path.join(DATA_BASE, "life.json")
APP = os.path.join(WEB_BASE, "app.html")
PORT = int(os.environ.get("WB_PORT", "8765"))


def web_stamp():
    """界面指纹：任一端文件改动都会变，用于前端判断要不要自动刷新。"""
    h = hashlib.sha1()
    for name in WEB_FILES:
        try:
            st = os.stat(os.path.join(WEB_BASE, name))
            h.update(("%s:%d:%d|" % (name, st.st_mtime_ns, st.st_size)).encode())
        except OSError:
            h.update((name + ":-|").encode())
    return h.hexdigest()[:12]


def web_info():
    """bundled 为真表示界面取自打包快照（文件不会变），前端据此停掉轮询。"""
    return {
        "base": WEB_BASE,
        "external": WEB_BASE != BASE,
        "bundled": WEB_BASE == BASE and bool(getattr(sys, "frozen", False) or hasattr(sys, "_MEIPASS")),
        "stamp": web_stamp(),
    }


def web_path(name):
    """取界面资源实际路径：外部目录有就用外部的，否则回退包内副本。"""
    fp = os.path.join(WEB_BASE, name)
    return fp if os.path.isfile(fp) else os.path.join(BASE, name)

SKIP_DIRS = {".workbuddy", "versions", "output", "草稿", "node_modules", ".git", "__pycache__", "tmp"}
EXT_OK = {".docx", ".pptx", ".pdf", ".md", ".html", ".png", ".jpg", ".jpeg", ".mp3", ".mp4", ".zip", ".xlsx"}


def read(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


FOLDER_PICKER_LOCK = threading.Lock()
DATA_LOCK = threading.RLock()


def choose_native_folder(start=""):
    """调用系统文件夹选择器；取消返回 None，不写入任何数据。"""
    if sys.platform != "darwin":
        raise RuntimeError("当前系统暂不支持原生文件夹选择器")
    initial = os.path.realpath(os.path.expanduser(start or "~"))
    if not os.path.isdir(initial):
        initial = os.path.expanduser("~")
    result = subprocess.run(
        ["/usr/bin/osascript", "-l", "JavaScript",
         web_path("native_folder_picker.js"), initial],
        capture_output=True, text=True, timeout=600,
    )
    if result.returncode:
        raise RuntimeError("系统文件夹选择器未能打开，请重新尝试")
    selected = result.stdout.strip()
    if not selected:
        return None
    selected = os.path.realpath(selected)
    if not os.path.isdir(selected):
        raise RuntimeError("选中的文件夹已不存在，请重新选择")
    return selected


def list_files(root):
    out = []
    if not os.path.isdir(root):
        return out
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in SKIP_DIRS and not d.startswith(".")]
        for f in fn:
            if f.startswith(".") or f.startswith("~$"):
                continue
            if os.path.splitext(f)[1].lower() in EXT_OK:
                out.append(os.path.join(dp, f))
    return out


def hours_in(name):
    got = set()
    if "两课时" in name or "二课时" in name:
        return {1, 2}
    if "第一课时" in name:
        got.add(1)
    if "第二课时" in name:
        got.add(2)
    return got


def calc_streak(logs):
    """当前连续天数：今天没打就从昨天往前数"""
    if not logs:
        return 0
    s = set(logs)
    d = date.today()
    if d.isoformat() not in s:
        d = d - timedelta(days=1)
    n = 0
    while d.isoformat() in s:
        n += 1
        d = d - timedelta(days=1)
    return n


def calc_best(logs):
    """历史最长连续"""
    if not logs:
        return 0
    ds = sorted({date.fromisoformat(x) for x in logs})
    best = run = 1
    for prev, cur in zip(ds, ds[1:]):
        run = run + 1 if (cur - prev).days == 1 else 1
        best = max(best, run)
    return best


def decorate_life(items):
    """补上 streak / best / 今天是否已打，供前端直接用"""
    today = date.today().isoformat()
    out = []
    for it in items:
        it = dict(it)
        if it.get("kind") == "habit":
            logs = it.get("logs") or []
            it["streak"] = calc_streak(logs)
            it["best"] = max(it.get("best") or 0, calc_best(logs))
            it["doneToday"] = today in logs
            it["last"] = logs[-1] if logs else ""
        out.append(it)
    return out


def inside(path, root):
    return path == root or path.startswith(root + os.sep)


def new_id(prefix):
    """够用的唯一 id：前缀 + 毫秒时间戳"""
    return "%s%s" % (prefix, uuid.uuid4().hex[:16])


def norm_outputs(raw):
    """把界面传来的一串产出定义整理成模板格式。key 沿用旧的，新项自动生成。
    产出项的顺序 = 用户排的顺序，不重排"""
    out = []
    for i, o in enumerate(raw or []):
        name = (o.get("name") or "").strip()
        if not name:
            continue
        per = o.get("per")
        per = "hours" if per in ("hours", "h", "课时") else 1
        key = (o.get("key") or "").strip()
        if not key:
            key = "k%s_%d" % (int(time.time() * 1000) % 1000000, i)
        def _list(v):
            if isinstance(v, str):
                v = v.replace("，", ",").split(",")
            return [str(x).strip().lower() for x in (v or []) if str(x).strip()]
        if "detect" in o and o.get("detect") is not None:
            # 界面里只有一个「认文件」输入框：.docx 这类算扩展名，其余算关键词
            toks = _list(o.get("detect"))
            ext = [t for t in toks if t.startswith(".")]
            kw = [t for t in toks if not t.startswith(".")]
        else:
            ext = _list(o.get("ext"))
            kw = _list(o.get("kw"))
        out.append({
            "key": key, "name": name, "per": per,
            "ext": ext, "kw": kw,
        })
    return out


def norm_preset(raw):
    """把一条任务模板整理成存储格式。outputs 为空表示沿用所属分组的默认清单。"""
    if not isinstance(raw, dict):
        return None
    name = (raw.get("name") or "").strip()
    if not name:
        return None
    try:
        hours = max(1, min(12, int(raw.get("hours") or 1)))
    except Exception:
        hours = 1
    outs = raw.get("outputs")
    outs = norm_outputs(outs) if isinstance(outs, list) else []
    return {
        "id": (raw.get("id") or "").strip() or new_id("p"),
        "name": name[:24],
        "lane": (raw.get("lane") or "").strip(),
        "hours": hours,
        "parent": (raw.get("parent") or "").strip(),
        "next": (raw.get("next") or "").strip()[:200],
        "meta": (raw.get("meta") or "").strip()[:80],
        "outputs": outs or None,
    }


def make_task(lane, preset, title, hours, path, parent, next_text, meta):
    """按分组模板（可被任务模板覆盖）生成一条任务，不写盘。"""
    eff = lane
    if preset and preset.get("outputs"):
        eff = dict(lane)
        eff["outputs"] = preset["outputs"]
    if not path and parent and title:
        cand = os.path.join(parent, title)
        if os.path.isdir(cand):
            path = cand
        elif os.path.isdir(parent):
            # 只下探一层：四年级/已发布/颐和园 这类归档子目录也要认到
            try:
                for sub in sorted(os.listdir(parent)):
                    d1 = os.path.join(parent, sub)
                    cand2 = os.path.join(d1, title)
                    if os.path.isdir(d1) and os.path.isdir(cand2):
                        path = cand2
                        break
            except OSError:
                pass
    task = {
        "id": new_id("t"), "lane": lane["id"], "title": title[:40],
        "hours": hours, "meta": (meta or "").strip()[:80], "path": path, "today": False,
        "next": (next_text or "").strip()[:200], "order": -1,
        "touched": time.strftime("%Y-%m-%d %H:%M"),
        "outputs": build_outputs(eff, {"hours": hours, "_archive": {}}),
    }
    if not task["meta"]:
        holder = os.path.dirname(path.rstrip("/")) if path else (parent.rstrip("/") if parent else "")
        part = os.path.basename(holder) if holder else ""
        seg = [x for x in [part, ("%d 课时" % hours if hours > 1 else "")] if x]
        task["meta"] = " · ".join(seg)
    if path and os.path.isdir(path):
        rescan_task(task, eff)
    return task


def lane_sort_key(l):
    return l.get("order", 0)


def archive_outputs(task):
    """把当前产出清单归档到 _archive（按 key 保存），换归类时用来还原状态。
    got 取最大值：换到需求份数更少的分组时会被裁小，来回切不能越切越少"""
    arch = dict(task.get("_archive") or {})
    for o in task.get("outputs") or []:
        k = o.get("key")
        prev = arch.get(k) or {}
        arch[k] = {
            "got": max(int(prev.get("got") or 0), int(o.get("got") or 0)),
            "status": o.get("status") or "todo",
            "files": o.get("files") or prev.get("files") or [],
            "note": o.get("note") or prev.get("note") or "",
        }
    task["_archive"] = arch


def build_outputs(lane_tpl, task):
    """按泳道模板重建产出清单。同名 key 复用旧状态，来回换归类不丢打过的勾"""
    hours = task.get("hours") or 1
    arch = task.get("_archive") or {}
    old = {o.get("key"): o for o in (task.get("outputs") or [])}
    out = []
    for od in lane_tpl.get("outputs") or []:
        per = od.get("per", 1)
        need = hours if per == "hours" else int(per or 1)
        po = old.get(od["key"]) or {}
        pa = arch.get(od["key"]) or {}
        got = max(int(po.get("got") or 0), int(pa.get("got") or 0))
        out.append({
            "key": od["key"],
            "name": od["name"],
            "need": need,
            "got": min(got, need),
            "detect": bool(od.get("kw") or od.get("ext")),
            "status": po.get("status") or pa.get("status") or "todo",
            "files": po.get("files") or pa.get("files") or [],
            "note": po.get("note") or pa.get("note") or "",
        })
    return out


def rescan_task(task, tpl):
    """按文件重新统计某任务的产出份数，返回是否有变化"""
    if not os.path.isdir(task["path"]):
        return False
    files = list_files(task["path"])
    changed = False
    for od, out in zip(tpl["outputs"], task["outputs"]):
        kws, exts = od.get("kw") or [], od.get("ext") or []
        if not kws and not exts:
            continue
        hits, covered = [], set()
        for p in files:
            b = os.path.basename(p)
            if exts and not any(b.lower().endswith(e) for e in exts):
                continue
            if kws and not any(k in b for k in kws):
                continue
            hits.append(p)
            covered |= hours_in(b)
        if not covered and hits:
            covered = {1}
        got = min(len(covered), out["need"]) if out["need"] > 1 else min(len(hits), 1)
        if got != out["got"] or hits[:8] != out["files"]:
            out["got"] = got
            out["files"] = hits[:8]
            changed = True
        if got >= out["need"] and out["status"] == "todo":
            out["status"] = "done"
            changed = True
    return changed


class Handler(BaseHTTPRequestHandler):
    server_version = "Workbench/1.0"

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return {}

    def do_GET(self):
        p = urlparse(self.path).path
        if p in ("/", "/index.html"):
            try:
                with open(APP, encoding="utf-8") as f:
                    return self._send(200, f.read(), "text/html; charset=utf-8")
            except Exception as e:
                return self._send(500, {"error": str(e)})
        if p == "/api/state":
            life = read(LIFE, {"items": []})
            life["items"] = decorate_life(life.get("items", []))
            return self._send(200, {
                "templates": read(TEMPLATES, {"lanes": []}),
                "state": read(TASKS, {"tasks": []}),
                "life": life,
                "features": {"nativeFolderPicker": sys.platform == "darwin"},
                "web": web_info(),
            })
        if p == "/api/webinfo":
            return self._send(200, web_info())
        if p == "/favicon.ico":
            return self._send(204, b"")
        if p == "/api/browse":
            q = parse_qs(urlparse(self.path).query)
            target = (q.get("path", [""])[0] or os.path.expanduser("~")).strip()
            target = os.path.realpath(os.path.expanduser(target))
            home = os.path.realpath(os.path.expanduser("~"))
            roots = [home, "/Volumes"]
            if not any(inside(target, r) for r in roots):
                return self._send(403, {"error": "只能浏览本机个人目录"})
            if not os.path.isdir(target):
                return self._send(404, {"error": "目录不存在", "path": target})
            dirs = []
            try:
                for name in sorted(os.listdir(target)):
                    if name.startswith("."):
                        continue
                    fp = os.path.join(target, name)
                    if os.path.isdir(fp):
                        dirs.append({"name": name, "path": fp})
            except Exception as e:
                return self._send(500, {"error": str(e)})
            parent = os.path.dirname(target)
            if not any(inside(parent, r) for r in roots):
                parent = None
            jumps = []
            for label, jp in (("个人目录", home), ("桌面", home + "/Desktop"),
                              ("文稿", home + "/Documents"), ("下载", home + "/Downloads"),
                              ("Volumes", "/Volumes"), ("D 盘", "/Volumes/D")):
                if os.path.isdir(jp):
                    jumps.append({"name": label, "path": jp})
            return self._send(200, {"path": target, "parent": parent, "dirs": dirs,
                                    "home": home, "jumps": jumps})
        # 静态文件：只允许 WEB_BASE 目录内的文件
        rel = p.lstrip("/")
        if rel and ".." not in rel:
            fp = os.path.normpath(os.path.join(WEB_BASE, rel))
            if fp.startswith(WEB_BASE + os.sep) and os.path.isfile(fp):
                ctype = {
                    ".html": "text/html; charset=utf-8",
                    ".css": "text/css; charset=utf-8",
                    ".js": "application/javascript; charset=utf-8",
                    ".json": "application/json; charset=utf-8",
                    ".svg": "image/svg+xml",
                    ".png": "image/png",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".webp": "image/webp",
                    ".woff2": "font/woff2",
                }.get(os.path.splitext(fp)[1].lower(), "application/octet-stream")
                with open(fp, "rb") as f:
                    return self._send(200, f.read(), ctype)
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if urlparse(self.path).path == "/api/pick-folder":
            return self._post()
        with DATA_LOCK:
            return self._post()

    def _post(self):
        p = urlparse(self.path).path
        body = self._body()

        if p == "/api/pick-folder":
            origin = self.headers.get("Origin")
            if origin and urlparse(origin).netloc not in (self.headers.get("Host"),):
                return self._send(403, {"error": "请在本机工作台中选择文件夹"})
            if not FOLDER_PICKER_LOCK.acquire(blocking=False):
                return self._send(409, {"error": "文件夹选择窗口已经打开"})
            try:
                selected = choose_native_folder(body.get("start") or "")
                return self._send(200, {"cancelled": selected is None, "path": selected})
            except (RuntimeError, subprocess.TimeoutExpired) as e:
                return self._send(500, {"error": str(e) if isinstance(e, RuntimeError) else "选择超时，请重新打开文件夹选择窗口"})
            finally:
                FOLDER_PICKER_LOCK.release()

        if p in ("/api/record/remove", "/api/record/restore"):
            kind = body.get("kind")
            if kind not in ("task", "life", "output"):
                return self._send(400, {"error": "记录类型无效"})
            path = LIFE if kind == "life" else TASKS
            doc = read(path, {})
            collection = doc.setdefault("items" if kind == "life" else "tasks", [])
            records = collection
            if kind == "output":
                parent = next((t for t in collection if t["id"] == body.get("taskId")), None)
                if not parent:
                    return self._send(404, {"error": "任务不存在"})
                records = parent.setdefault("outputs", [])
            trash = doc.setdefault("_trash", [])
            key = "key" if kind == "output" else "id"
            if p.endswith("remove"):
                index = next((i for i, x in enumerate(records) if x[key] == body.get("id")), None)
                if index is None:
                    return self._send(404, {"error": "记录不存在"})
                entry = {"id": uuid.uuid4().hex, "kind": kind, "taskId": body.get("taskId"),
                         "index": index, "item": records.pop(index), "deletedAt": time.strftime("%Y-%m-%d %H:%M")}
                trash.append(entry)
                write(path, doc)
                return self._send(200, {"ok": True, "trashId": entry["id"]})
            entry = next((x for x in trash if x["id"] == body.get("trashId") and x["kind"] == kind), None)
            if not entry:
                return self._send(404, {"error": "找不到可恢复记录"})
            if any(x[key] == entry["item"][key] for x in records):
                return self._send(409, {"error": "记录已经存在"})
            if kind == "output" and entry.get("taskId") != body.get("taskId"):
                return self._send(400, {"error": "任务不匹配"})
            records.insert(min(entry["index"], len(records)), entry["item"])
            trash.remove(entry)
            write(path, doc)
            return self._send(200, {"ok": True})

        if p == "/api/output":
            st = read(TASKS, {"tasks": []})
            for t in st["tasks"]:
                if t["id"] != body.get("taskId"):
                    continue
                for o in t["outputs"]:
                    if o["key"] != body.get("key"):
                        continue
                    if "status" in body:
                        o["status"] = body["status"]
                    if "note" in body:
                        o["note"] = str(body["note"])
                    if "name" in body and str(body["name"]).strip():
                        o["name"] = str(body["name"]).strip()[:40]
                    if "need" in body:
                        try:
                            o["need"] = max(1, min(100, int(body["need"])))
                        except (TypeError, ValueError):
                            return self._send(400, {"error": "份数应为正整数"})
                    t["touched"] = time.strftime("%Y-%m-%d %H:%M")
                    write(TASKS, st)
                    return self._send(200, {"ok": True, "output": o})
            return self._send(404, {"error": "task or output not found"})

        if p == "/api/task":
            st = read(TASKS, {"tasks": []})
            lanes = {l["id"]: l for l in read(TEMPLATES, {"lanes": []})["lanes"]}
            for t in st["tasks"]:
                if t["id"] != body.get("taskId"):
                    continue
                for k in ("next", "today", "meta", "title", "path"):
                    if k in body:
                        t[k] = body[k]
                # 课时数改了：按新课时重建产出，同名 key 复用已打的状态
                nh = body.get("hours")
                if nh not in (None, ""):
                    try:
                        nh = max(1, min(12, int(nh)))
                    except Exception:
                        nh = None
                    if nh and nh != t.get("hours"):
                        archive_outputs(t)
                        t["hours"] = nh
                        tpl_now = lanes.get(t.get("lane"))
                        if tpl_now:
                            t["outputs"] = build_outputs(tpl_now, t)
                # 换归类：重套目标泳道的产出模板，旧状态进归档
                nl = body.get("lane")
                if nl and nl != t.get("lane"):
                    tpl = lanes.get(nl)
                    if not tpl or tpl.get("kind") != "work":
                        return self._send(400, {"error": "目标分组不可放置"})
                    archive_outputs(t)
                    t["lane"] = nl
                    t["outputs"] = build_outputs(tpl, t)
                    # 刚移入的排到该分组最前，避免落在卡片第 7 位而看不见
                    t["order"] = -1
                # 看板拖拽：整件事的产出一起改状态
                allst = body.get("allStatus")
                if allst in ("todo", "doing", "confirm", "done"):
                    for o in t.get("outputs") or []:
                        o["status"] = allst
                # 撤销用：整份还原产出状态（放在 allStatus 之后，撤销优先）
                if isinstance(body.get("outputs"), list):
                    t["outputs"] = body["outputs"]
                t["touched"] = time.strftime("%Y-%m-%d %H:%M")
                write(TASKS, st)
                return self._send(200, {"ok": True, "task": t})
            return self._send(404, {"error": "task not found"})

        # ── 分组（泳道）：自己建、自己改、自己删 ──
        if p == "/api/lane/add":
            doc = read(TEMPLATES, {"lanes": []})
            lanes = doc.setdefault("lanes", [])
            name = (body.get("name") or "").strip()
            if not name:
                return self._send(400, {"error": "分组名称不能为空"})
            kind = body.get("kind") if body.get("kind") in ("work", "life") else "work"
            lane = {
                "id": new_id("l"),
                "name": name[:24],
                "kind": kind,
                "model": body.get("model") or ("project" if kind == "work" else "wish"),
                "accent": body.get("accent") or "#8A8377",
                "template": (body.get("template") or "").strip(),
                "outputs": norm_outputs(body.get("outputs")) if kind == "work" else [],
                "order": len(lanes),
            }
            lanes.append(lane)
            write(TEMPLATES, doc)
            return self._send(200, {"ok": True, "lane": lane})

        if p == "/api/lane/item":
            doc = read(TEMPLATES, {"lanes": []})
            st = read(TASKS, {"tasks": []})
            for lane in doc.get("lanes") or []:
                if lane["id"] != body.get("laneId"):
                    continue
                if (body.get("name") or "").strip():
                    lane["name"] = body["name"].strip()[:24]
                if "accent" in body and body["accent"]:
                    lane["accent"] = body["accent"]
                if "template" in body:
                    lane["template"] = (body["template"] or "").strip()
                if isinstance(body.get("outputs"), list) and lane.get("kind") == "work":
                    lane["outputs"] = norm_outputs(body["outputs"])
                    # 这条线已有任务：按新清单重建，同名 key 保留打过的状态
                    for t in st["tasks"]:
                        if t.get("lane") == lane["id"]:
                            archive_outputs(t)
                            t["outputs"] = build_outputs(lane, t)
                    write(TASKS, st)
                write(TEMPLATES, doc)
                return self._send(200, {"ok": True, "lane": lane})
            return self._send(404, {"error": "分组不存在"})

        if p == "/api/lane/del":
            lid = body.get("laneId")
            doc = read(TEMPLATES, {"lanes": []})
            st = read(TASKS, {"tasks": []})
            life = read(LIFE, {"items": []})
            n_work = len([t for t in st["tasks"] if t.get("lane") == lid])
            n_life = len([i for i in life.get("items", []) if i.get("lane") == lid])
            if n_work or n_life:
                return self._send(400, {
                    "error": "分组里还有 %d 个任务、%d 条生活条目，先删掉或移走" % (n_work, n_life)})
            doc["lanes"] = [l for l in (doc.get("lanes") or []) if l.get("id") != lid]
            write(TEMPLATES, doc)
            return self._send(200, {"ok": True})

        # ── 任务模板：新建时预填一层，只作用于套用它的新任务 ──
        if p in ("/api/preset/add", "/api/preset/item"):
            doc = read(TEMPLATES, {"lanes": []})
            lanes = {l["id"]: l for l in (doc.get("lanes") or [])}
            presets = doc.get("presets") or []
            pid = (body.get("id") or "").strip()
            cur = next((x for x in presets if x.get("id") == pid), None)
            if p.endswith("/item") and not cur:
                return self._send(404, {"error": "模板不存在"})
            merged = dict(cur or {})
            for k in ("name", "lane", "parent", "next", "meta", "hours"):
                if k in body:
                    merged[k] = body[k]
            if "outputs" in body:
                merged["outputs"] = body["outputs"]
            if not (merged.get("name") or "").strip():
                return self._send(400, {"error": "模板名称不能为空"})
            if merged.get("lane") not in lanes or lanes[merged["lane"]].get("kind") != "work":
                return self._send(400, {"error": "请选一个工作分组"})
            preset = norm_preset(merged)
            if cur:
                presets = [preset if x.get("id") == pid else x for x in presets]
            else:
                presets.append(preset)
            doc["presets"] = presets
            write(TEMPLATES, doc)
            return self._send(200, {"ok": True, "preset": preset})

        if p == "/api/preset/del":
            doc = read(TEMPLATES, {"lanes": []})
            presets = doc.get("presets") or []
            left = [x for x in presets if x.get("id") != body.get("id")]
            if len(left) == len(presets):
                return self._send(404, {"error": "模板不存在"})
            doc["presets"] = left
            write(TEMPLATES, doc)
            return self._send(200, {"ok": True})

        # ── 任务：新建 / 删除（产出项可单加单删） ──
        if p == "/api/task/add":
            doc_t = read(TEMPLATES, {"lanes": []})
            lanes = {l["id"]: l for l in (doc_t.get("lanes") or [])}
            presets = {x.get("id"): x for x in (doc_t.get("presets") or [])}
            preset = presets.get(body.get("presetId") or "") or {}
            lane = lanes.get(body.get("lane") or preset.get("lane"))
            title = (body.get("title") or "").strip()
            if not lane or lane.get("kind") != "work":
                return self._send(400, {"error": "请选一个工作分组"})
            if not title:
                return self._send(400, {"error": "任务名称不能为空"})
            try:
                hours = max(1, min(12, int(body["hours"] if "hours" in body else (preset.get("hours") or 1))))
            except Exception:
                hours = 1
            parent = (body["parent"] if "parent" in body else preset.get("parent", "")) or ""
            next_text = (body["next"] if "next" in body else preset.get("next", "")) or ""
            meta = (body["meta"] if "meta" in body else preset.get("meta", "")) or ""
            task = make_task(lane, preset, title, hours, (body.get("path") or "").strip(),
                             parent.strip(), next_text, meta)
            st = read(TASKS, {"tasks": []})
            st["tasks"].insert(0, task)
            write(TASKS, st)
            return self._send(200, {"ok": True, "task": task})

        if p == "/api/task/batch":
            doc_t = read(TEMPLATES, {"lanes": []})
            lanes = {l["id"]: l for l in (doc_t.get("lanes") or [])}
            presets = {x.get("id"): x for x in (doc_t.get("presets") or [])}
            preset = presets.get(body.get("presetId") or "") or {}
            lane = lanes.get(body.get("lane") or preset.get("lane"))
            if not lane or lane.get("kind") != "work":
                return self._send(400, {"error": "请选一个工作分组"})
            raw = body.get("titles")
            if isinstance(raw, str):
                raw = raw.replace("，", "\n").replace(",", "\n").split("\n")
            titles, seen = [], set()
            for x in raw or []:
                t = (x or "").strip()[:40]
                if t and t not in seen:
                    seen.add(t)
                    titles.append(t)
            if not titles:
                return self._send(400, {"error": "至少填一个任务名称"})
            if len(titles) > 60:
                return self._send(400, {"error": "一次最多建 60 条，请分批"})
            try:
                hours = max(1, min(12, int(body["hours"] if "hours" in body else (preset.get("hours") or 1))))
            except Exception:
                hours = 1
            parent = (body["parent"] if "parent" in body else preset.get("parent", "")) or ""
            next_text = (body["next"] if "next" in body else preset.get("next", "")) or ""
            meta = (body["meta"] if "meta" in body else preset.get("meta", "")) or ""
            st = read(TASKS, {"tasks": []})
            made, matched = [], 0
            for title in titles:
                task = make_task(lane, preset, title, hours, "", parent.strip(), next_text, meta)
                if task.get("path"):
                    matched += 1
                st["tasks"].insert(0, task)
                made.append(task)
            write(TASKS, st)
            return self._send(200, {"ok": True, "tasks": made, "paths": matched})

        if p == "/api/task/del":
            st = read(TASKS, {"tasks": []})
            before = len(st["tasks"])
            st["tasks"] = [t for t in st["tasks"] if t["id"] != body.get("taskId")]
            if len(st["tasks"]) == before:
                return self._send(404, {"error": "任务不存在"})
            write(TASKS, st)
            return self._send(200, {"ok": True})

        if p == "/api/output/add":
            st = read(TASKS, {"tasks": []})
            for t in st["tasks"]:
                if t["id"] != body.get("taskId"):
                    continue
                name = (body.get("name") or "").strip()
                if not name:
                    return self._send(400, {"error": "名称不能为空"})
                t.setdefault("outputs", []).append({
                    "key": new_id("o"), "name": name[:20], "need": 1, "got": 0,
                    "detect": False, "status": "todo", "files": [], "note": "",
                })
                t["touched"] = time.strftime("%Y-%m-%d %H:%M")
                write(TASKS, st)
                return self._send(200, {"ok": True, "task": t})
            return self._send(404, {"error": "任务不存在"})

        if p == "/api/output/del":
            st = read(TASKS, {"tasks": []})
            for t in st["tasks"]:
                if t["id"] != body.get("taskId"):
                    continue
                k = body.get("key")
                n = len(t.get("outputs") or [])
                t["outputs"] = [o for o in (t.get("outputs") or []) if o.get("key") != k]
                if len(t["outputs"]) == n:
                    return self._send(404, {"error": "产出项不存在"})
                t["touched"] = time.strftime("%Y-%m-%d %H:%M")
                write(TASKS, st)
                return self._send(200, {"ok": True, "task": t})
            return self._send(404, {"error": "任务不存在"})

        if p == "/api/reorder":
            st = read(TASKS, {"tasks": []})
            lane, ids = body.get("lane"), body.get("ids") or []
            pos = {tid: i for i, tid in enumerate(ids)}
            hit = 0
            for t in st["tasks"]:
                if t.get("lane") == lane and t["id"] in pos:
                    t["order"] = pos[t["id"]]
                    hit += 1
            if hit:
                write(TASKS, st)
            return self._send(200, {"ok": True, "changed": hit})

        if p == "/api/sync":
            st = read(TASKS, {"tasks": []})
            tpls = {l["id"]: l for l in read(TEMPLATES, {"lanes": []})["lanes"]}
            n = 0
            for t in st["tasks"]:
                if body.get("taskId") and t["id"] != body["taskId"]:
                    continue
                if rescan_task(t, tpls[t["lane"]]):
                    n += 1
            st["updated"] = time.strftime("%Y-%m-%d %H:%M")
            write(TASKS, st)
            return self._send(200, {"ok": True, "changed": n, "state": st})

        if p in ("/api/life/check", "/api/life/item", "/api/life/add", "/api/life/del"):
            life = read(LIFE, {"version": 1, "items": []})
            items = life.setdefault("items", [])
            iid = body.get("id")

            if p == "/api/life/check":
                for it in items:
                    if it.get("id") != iid:
                        continue
                    day = body.get("day") or date.today().isoformat()
                    logs = set(it.get("logs") or [])
                    if body.get("on") is True:
                        logs.add(day)
                    elif body.get("on") is False:
                        logs.discard(day)
                    elif day in logs:
                        logs.discard(day)
                    else:
                        logs.add(day)
                    it["logs"] = sorted(logs)
                    it["best"] = max(it.get("best") or 0, calc_best(it["logs"]))
                    write(LIFE, life)
                    return self._send(200, {"ok": True, "item": decorate_life([it])[0]})
                return self._send(404, {"error": "habit not found"})

            if p == "/api/life/item":
                for it in items:
                    if it.get("id") != iid:
                        continue
                    for k in ("title", "note", "amount", "dueDay", "paidMonth", "doneAt", "lane"):
                        if k in body:
                            it[k] = body[k]
                    write(LIFE, life)
                    return self._send(200, {"ok": True, "item": decorate_life([it])[0]})
                return self._send(404, {"error": "item not found"})

            if p == "/api/life/add":
                kind = body.get("kind") or "wish"
                lane = body.get("lane") or ("health" if kind == "habit" else "learn")
                nid = new_id("n")
                it = {"id": nid, "lane": lane, "kind": kind,
                      "title": body.get("title") or "新的", "note": body.get("note") or ""}
                if kind == "habit":
                    it.update({"freq": "daily", "logs": [], "best": 0})
                elif kind == "bill":
                    it.update({"amount": max(0, float(body.get("amount") or 0)), "dueDay": max(1, min(31, int(body.get("dueDay") or 1))), "paidMonth": ""})
                else:
                    it["doneAt"] = None
                items.append(it)
                write(LIFE, life)
                return self._send(200, {"ok": True, "item": decorate_life([it])[0]})

            if p == "/api/life/del":
                life["items"] = [x for x in items if x.get("id") != iid]
                write(LIFE, life)
                return self._send(200, {"ok": True})

        if p == "/api/open":
            path = body.get("path") or ""
            reveal = bool(body.get("reveal"))
            if not path or not os.path.exists(path):
                return self._send(404, {"error": "路径不存在", "path": path})
            try:
                if os.path.isdir(path):
                    subprocess.Popen(["open", path])
                elif reveal:
                    subprocess.Popen(["open", "-R", path])
                else:
                    subprocess.Popen(["open", path])
                return self._send(200, {"ok": True})
            except Exception as e:
                return self._send(500, {"error": str(e)})

        if p == "/api/quit":
            self._send(200, {"ok": True})
            os._exit(0)

        return self._send(404, {"error": "not found"})

    def log_message(self, *a):
        pass


def open_browser(url):
    """优先用独立宽窗口打开，保证三栏分区能显示出来"""
    chrome = "/Applications/Google Chrome.app"
    edge = "/Applications/Microsoft Edge.app"
    if os.path.isdir(chrome):
        subprocess.Popen(["open", "-na", "Google Chrome", "--args",
                          "--window-size=1480,940", "--new-window", url])
    elif os.path.isdir(edge):
        subprocess.Popen(["open", "-na", "Microsoft Edge", "--args",
                          "--window-size=1480,940", url])
    else:
        webbrowser.open(url)


def main():
    global PORT
    if not os.path.exists(TASKS):
        print("未找到 tasks.json，请先运行 seed.py")
        sys.exit(1)
    url = "http://127.0.0.1:%d/" % PORT
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print("端口 %d 已被占用，可能工作台已在运行：%s" % (PORT, url))
        open_browser(url)
        return
    PORT = httpd.server_address[1]
    url = "http://127.0.0.1:%d/" % PORT
    if os.environ.get("WB_APP"):
        print("WB_READY=%d" % PORT, flush=True)
    print("工作台已启动：%s" % url)
    print("界面目录：%s%s" % (WEB_BASE, "" if WEB_BASE == BASE else "（外部源码，改完自动生效）"))
    print("关闭此窗口或按 Ctrl+C 退出")
    if not os.environ.get("WB_NO_OPEN"):
        open_browser(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已退出")


if __name__ == "__main__":
    main()
