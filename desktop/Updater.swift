import AppKit
import CryptoKit
import Foundation

/// 新版本清单，与打包脚本写出的 update.json 对应。
struct UpdateManifest: Codable {
    var version: String
    var build: Int
    var file: String?
    var url: String?
    var sha256: String?
    var size: Int?
    var notes: String?
    var date: String?
    /// 发布脚本上传安装包后回填的 Release 资产编号；有它就直接走 API 取包。
    var assetId: Int?
}

/// GitHub Release 里的一项资产。
struct ReleaseAsset: Codable {
    var id: Int
    var name: String
    var url: String?
    var size: Int?
}

/// GitHub Release 本体（只取用得到的字段）。
struct ReleaseInfo: Codable {
    var tagName: String?
    var assets: [ReleaseAsset]?

    enum CodingKeys: String, CodingKey {
        case tagName = "tag_name"
        case assets
    }
}

enum UpdateError: LocalizedError {
    case badFeed(String)
    case badManifest(String)
    case checksum
    case unpack(String)
    case notInstalled(String)
    case script(String)

    var errorDescription: String? {
        switch self {
        case .badFeed(let s): return "更新源地址不可用：\(s)"
        case .badManifest(let s): return "版本清单无法读取：\(s)"
        case .checksum: return "下载的安装包校验不一致，已停止更新"
        case .unpack(let s): return "安装包解压失败：\(s)"
        case .notInstalled(let s): return "当前不是以 .app 形式运行，无法自更新（\(s)）"
        case .script(let s): return "替换脚本未能启动：\(s)"
        }
    }
}

/// 检查、下载、替换自身。整包替换走一个独立 shell 脚本：
/// App 退出后脚本再把旧包挪走、把新包放回原位并重新打开。
enum WorkbenchUpdater {
    static var currentVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }
    static var currentBuild: Int {
        Int(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "0") ?? 0
    }
    static var appBundle: URL { Bundle.main.bundleURL }

    /// 把设置里的地址规范化：支持 http(s)、file://、本地路径，以及 `github:owner/repo` 简写。
    static func feedURL(_ raw: String) throws -> URL {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw UpdateError.badFeed("未填写") }
        // github:owner/repo → 该仓库最新 Release 的 API 地址（国内直连 github.com 常超时，API 与
        // raw 域名稳定，安装包也走 assets 接口取，见 loadManifest）
        if text.lowercased().hasPrefix("github:") {
            let repo = text.dropFirst("github:".count).trimmingCharacters(in: CharacterSet(charactersIn: "/ "))
            guard !repo.isEmpty, !repo.contains(" ") else { throw UpdateError.badFeed(text) }
            guard let url = URL(string: "https://api.github.com/repos/\(repo)/releases/latest") else {
                throw UpdateError.badFeed(text)
            }
            return url
        }
        if let url = URL(string: text), let scheme = url.scheme?.lowercased(),
           ["http", "https", "file"].contains(scheme) {
            if url.pathExtension.lowercased() == "json" { return url }
            if scheme == "file" { return url.appendingPathComponent("update.json") }
            return url.appendingPathComponent("update.json")
        }
        var path = (text as NSString).expandingTildeInPath
        if path.hasSuffix("/") { path.removeLast() }
        if !path.hasSuffix(".json") { path += "/update.json" }
        return URL(fileURLWithPath: path)
    }

    /// 形如 https://api.github.com/repos/o/r/releases/latest 的地址按 Release 处理。
    static func releaseAPIBase(_ url: URL) -> (base: String, repo: String)? {
        guard url.host?.lowercased() == "api.github.com" else { return nil }
        guard let range = url.path.range(of: "/releases/", options: .backwards) else { return nil }
        let repo = String(url.path[url.path.startIndex..<range.lowerBound])
            .replacingOccurrences(of: "/repos/", with: "")
        guard !repo.isEmpty else { return nil }
        let base = "https://api.github.com/repos/\(repo)"
        return (base, repo)
    }

    /// workspace.json 里可选的更新 token，只给私有仓库用；公开仓库留空即可。
    static var feedToken: String {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("workspace.json"),
              let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = object["updateToken"] as? String else { return "" }
        return token.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func loadManifest(_ feed: String) throws -> (UpdateManifest, URL) {
        let url = try feedURL(feed)
        guard FileManager.default.fileExists(atPath: url.path) || url.scheme?.hasPrefix("http") == true else {
            throw UpdateError.badFeed(url.path)
        }
        // GitHub Release：先读 Release JSON，再从 assets 里取 update.json 与安装包
        if let release = releaseAPIBase(url) {
            let data = try fetch(url, accept: "application/vnd.github+json")
            guard let info = try? JSONDecoder().decode(ReleaseInfo.self, from: data) else {
                throw UpdateError.badManifest("Release 信息读不出来，仓库可能是私有的")
            }
            let assets = info.assets ?? []
            guard !assets.isEmpty else { throw UpdateError.badManifest("这个 Release 还没上传资产") }
            guard let entry = assets.first(where: { $0.name == "update.json" }),
                  let entryText = entry.url, let manifestURL = URL(string: entryText) else {
                throw UpdateError.badManifest("Release 里没有 update.json")
            }
            let raw = try fetch(manifestURL, accept: "application/octet-stream")
            guard let manifest = try? JSONDecoder().decode(UpdateManifest.self, from: raw) else {
                throw UpdateError.badManifest("缺少 version / build 字段")
            }
            let payload: URL
            if let id = manifest.assetId, let target = URL(string: "\(release.base)/releases/assets/\(id)") {
                payload = target
            } else if let file = manifest.file, let asset = assets.first(where: { $0.name == file }),
                      let assetText = asset.url, let target = URL(string: assetText) {
                payload = target
            } else if let direct = manifest.url, !direct.isEmpty, let target = URL(string: direct) {
                payload = target
            } else {
                throw UpdateError.badManifest("Release 里找不到安装包")
            }
            return (manifest, payload)
        }
        let data = try fetch(url)
        guard let manifest = try? JSONDecoder().decode(UpdateManifest.self, from: data) else {
            throw UpdateError.badManifest("缺少 version / build 字段")
        }
        let base = url.deletingLastPathComponent()
        let payload: URL
        if let raw = manifest.url, !raw.isEmpty {
            payload = URL(string: raw, relativeTo: base)?.absoluteURL ?? base.appendingPathComponent(raw)
        } else if let file = manifest.file, !file.isEmpty {
            payload = base.appendingPathComponent(file)
        } else {
            throw UpdateError.badManifest("未指定安装包文件名")
        }
        return (manifest, payload)
    }

    static func download(_ source: URL, to target: URL, expectSha: String?) throws {
        let fm = FileManager.default
        try? fm.removeItem(at: target)
        if source.isFileURL {
            try fm.copyItem(at: source, to: target)
        } else {
            let data = try fetch(source, timeout: 600, accept: "application/octet-stream")
            try data.write(to: target, options: .atomic)
        }
        if let expect = expectSha?.lowercased(), !expect.isEmpty {
            let digest = SHA256.hash(data: try Data(contentsOf: target, options: .mappedIfSafe))
            let hex = digest.map { String(format: "%02x", $0) }.joined()
            guard hex == expect else { throw UpdateError.checksum }
        }
    }

    /// 下载并解压到临时目录，返回解出来的 .app。
    static func prepare(manifest: UpdateManifest, payload: URL) throws -> (app: URL, work: URL) {
        let fm = FileManager.default
        let work = fm.temporaryDirectory.appendingPathComponent(
            "workbench-update-\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString.prefix(4))")
        try fm.createDirectory(at: work, withIntermediateDirectories: true)
        let zip = work.appendingPathComponent("payload.zip")
        try download(payload, to: zip, expectSha: manifest.sha256)
        let unpacked = work.appendingPathComponent("unpacked")
        let result = try run("/usr/bin/ditto", ["-x", "-k", zip.path, unpacked.path])
        guard result == 0 else { throw UpdateError.unpack("ditto 返回 \(result)") }
        guard let app = try fm.contentsOfDirectory(at: unpacked, includingPropertiesForKeys: nil)
            .first(where: { $0.pathExtension == "app" }) else {
            throw UpdateError.unpack("压缩包里没有 .app")
        }
        guard let info = NSDictionary(contentsOf: app.appendingPathComponent("Contents/Info.plist")),
              let exe = info["CFBundleExecutable"] as? String,
              fm.isExecutableFile(atPath: app.appendingPathComponent("Contents/MacOS/\(exe)").path) else {
            throw UpdateError.unpack("应用包结构不完整")
        }
        return (app, work)
    }

    /// 生成并启动替换脚本；调用方随后应退出 App。
    static func install(app newApp: URL, work: URL) throws {
        let target = appBundle
        guard target.pathExtension == "app" else { throw UpdateError.notInstalled(target.path) }
        let old = work.appendingPathComponent("old.app")
        let script = work.appendingPathComponent("swap.sh")
        let pid = ProcessInfo.processInfo.processIdentifier
        let body = """
        #!/bin/sh
        # 等旧进程彻底退出（最多 80 秒）
        APP=\(quote(target.path))
        NEW=\(quote(newApp.path))
        OLD=\(quote(old.path))
        PID=\(pid)
        i=0
        while kill -0 "$PID" 2>/dev/null && [ $i -lt 400 ]; do /bin/sleep 0.2; i=$((i+1)); done
        /bin/sleep 0.4
        /bin/mv "$APP" "$OLD" 2>/dev/null || exit 1
        if /bin/mv "$NEW" "$APP"; then
          /usr/bin/xattr -dr com.apple.quarantine "$APP" >/dev/null 2>&1
          if ! /usr/bin/codesign --verify --deep --strict "$APP" >/dev/null 2>&1; then
            /usr/bin/codesign --force --deep --sign - "$APP" >/dev/null 2>&1
          fi
          /usr/bin/open "$APP"
          if [ -x /usr/bin/trash ]; then /usr/bin/trash "$OLD" >/dev/null 2>&1; fi
          [ -d "$OLD" ] && /bin/mv "$OLD" "$HOME/.Trash/个人工作台-旧版-$(date +%s).app" >/dev/null 2>&1
          /bin/rm -rf "$(dirname "$0")" >/dev/null 2>&1
        else
          # 放不回去就把旧版还原，避免只剩一个空的路径
          /bin/mv "$OLD" "$APP" 2>/dev/null
          /usr/bin/open "$APP"
        fi
        """
        try body.write(to: script, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [script.path]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
    }

    // MARK: - 内部工具

    private static func fetch(_ url: URL, timeout: TimeInterval = 25, accept: String? = nil) throws -> Data {
        if url.isFileURL { return try Data(contentsOf: url) }
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        request.cachePolicy = .reloadIgnoringLocalCacheData
        // GitHub 要求带 UA；仓库私有时再补一个 token（公开仓库不需要）
        request.setValue("Workbench-Updater/\(currentVersion)", forHTTPHeaderField: "User-Agent")
        if let accept { request.setValue(accept, forHTTPHeaderField: "Accept") }
        let token = feedToken
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let semaphore = DispatchSemaphore(value: 0)
        var outcome: Result<Data, Error> = .failure(URLError(.unknown))
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { outcome = .failure(error) }
            else if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
                outcome = .failure(UpdateError.badFeed("HTTP \(http.statusCode)"))
            } else if let data { outcome = .success(data) }
            semaphore.signal()
        }.resume()
        if semaphore.wait(timeout: .now() + timeout + 10) == .timedOut { throw URLError(.timedOut) }
        return try outcome.get()
    }

    private static func run(_ path: String, _ args: [String]) throws -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = args
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus
    }

    private static func quote(_ text: String) -> String {
        "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
