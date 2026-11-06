import AppKit
import WebKit
import SwiftUI

final class WorkbenchApp: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var web: WKWebView!
    var server: Process?
    var pipe: Pipe?
    var output = ""
    var baseURL: URL?
    var dataURL: URL!
    var startupTimer: Timer?
    var quitting = false
    var smokeStarted = false
    let env = ProcessInfo.processInfo.environment
    let prefs = AppPreferences()
    var settingsWindow: NSWindow?
    var statusItem: NSStatusItem?
    var terminationReplied = false
    var autoUpdateChecked = false
    var updating = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Finder/Launch Services handles reopening the existing app instance.
        setupMenu()
        NSApp.applicationIconImage = NSImage(contentsOf:Bundle.main.resourceURL!.appendingPathComponent("Workbench.icns"))
        prefs.onChange = { [weak self] in self?.applyPreferences();self?.updateStatusItem() }
        prefs.onCheckUpdate = { [weak self] in self?.checkUpdate(silent: false, autoInstall: false) }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController.add(self,name:"workbench")
        config.userContentController.addUserScript(WKUserScript(source: "window.wbAppErrors=[];window.addEventListener('error',e=>wbAppErrors.push(e.message));window.addEventListener('unhandledrejection',e=>wbAppErrors.push(String(e.reason)));", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "个人工作台"
        window.minSize = NSSize(width: 720, height: 520)
        window.contentView = web
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        if prefs.rememberWindow { window.setFrameAutosaveName("WorkbenchMainWindow") }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.loadHTMLString("<meta charset='utf-8'><body style='background:#f5f8ff;font:17px -apple-system;text-align:center;padding-top:20vh;color:#275be8'>正在打开个人工作台…</body>", baseURL: nil)
        do { try startServer() } catch { fail("无法启动工作台", error.localizedDescription) }
        updateStatusItem()
    }

    func setupMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem(); menu.addItem(appItem)
        let appMenu = NSMenu(); appItem.submenu = appMenu
        appMenu.addItem(withTitle: "关于个人工作台", action: #selector(about), keyEquivalent: "").target = self
        appMenu.addItem(withTitle: "设置…", action: #selector(showSettings), keyEquivalent: ",").target = self
        appMenu.addItem(withTitle: "检查更新…", action: #selector(checkUpdateMenu), keyEquivalent: "").target = self
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏个人工作台", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "退出个人工作台", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let edit = NSMenuItem(); menu.addItem(edit); edit.submenu = NSMenu(title: "编辑")
        for (title, action, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edit.submenu!.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        let view = NSMenuItem(); menu.addItem(view); view.submenu = NSMenu(title: "工作台")
        for (title, action, key) in [("重新加载", #selector(reload), "r"), ("打开数据目录", #selector(showData), ""), ("在浏览器中打开", #selector(openBrowser), "")] {
            view.submenu!.addItem(withTitle: title, action: action, keyEquivalent: key).target = self
        }
        NSApp.mainMenu = menu
    }

    func startServer() throws {
        let resources = Bundle.main.resourceURL!
        let fm = FileManager.default
        let settings = try Data(contentsOf: resources.appendingPathComponent("workspace.json"))
        let workspace = (try JSONSerialization.jsonObject(with: settings) as! [String: String])["dataDirectory"]!
        if let override = env["WB_APP_DATA_DIR"] {
            dataURL = URL(fileURLWithPath: override, isDirectory: true)
        } else if !prefs.selectedData.isEmpty {
            guard fm.fileExists(atPath:prefs.selectedData+"/tasks.json") else { throw NSError(domain:"Workbench",code:1,userInfo:[NSLocalizedDescriptionKey:"选择的数据目录已不可用："+prefs.selectedData]) }
            dataURL = URL(fileURLWithPath:prefs.selectedData,isDirectory:true)
        } else if fm.fileExists(atPath: workspace + "/tasks.json") {
            dataURL = URL(fileURLWithPath: workspace, isDirectory: true)
        } else {
            dataURL = try fm.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("个人工作台", isDirectory: true)
        }
        try fm.createDirectory(at: dataURL, withIntermediateDirectories: true)
        prefs.dataPath = dataURL.path
        for file in ["tasks.json", "life.json", "templates.json"] {
            let target = dataURL.appendingPathComponent(file)
            if !fm.fileExists(atPath: target.path) {
                try fm.copyItem(at: resources.appendingPathComponent("seed/" + file), to: target)
            }
        }
        let task = Process()
        task.executableURL = resources.appendingPathComponent("server/workbench-server")
        task.currentDirectoryURL = dataURL
        var variables = env
        variables["WB_DATA_DIR"] = dataURL.path
        variables["WB_NO_OPEN"] = "1"
        variables["WB_APP"] = "1"
        variables["WB_PORT"] = "0"  // OS chooses a free local port.
        variables["PYTHONUNBUFFERED"] = "1"
        task.environment = variables
        let channel = Pipe(); pipe = channel
        task.standardOutput = channel; task.standardError = channel
        channel.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
            DispatchQueue.main.async { self?.receive(text) }
        }
        task.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self, !self.quitting else { return }
                self.fail("工作台服务已停止", "请退出后重新打开 App。\n" + String(self.output.suffix(1500)))
            }
        }
        server = task
        try task.run()
        startupTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: false) { [weak self] _ in
            guard let self, self.baseURL == nil else { return }
            self.fail("启动超时", "请确认数据目录仍然可访问。\n" + String(self.output.suffix(1500)))
        }
    }

    func receive(_ text: String) {
        output += text
        if baseURL == nil, let start = output.range(of: "WB_READY="), let newline = output[start.upperBound...].firstIndex(of: "\n"),
           let port = Int(output[start.upperBound..<newline].trimmingCharacters(in: .whitespacesAndNewlines)) {
            baseURL = URL(string: "http://127.0.0.1:\(port)/")!
            startupTimer?.invalidate()
            let route=prefs.startup == "last" ? prefs.lastRoute : prefs.startup == "overview" ? "#/" : "#/\(prefs.startup)/main"
            web.load(URLRequest(url:URL(string:baseURL!.absoluteString+route)!))
            scheduleUpdateCheck()
        }
        if output.count > 10000 { output = String(output.suffix(5000)) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "about" || (url.host == "127.0.0.1" && url.port == baseURL?.port) { decisionHandler(.allow) }
        else { NSWorkspace.shared.open(url); decisionHandler(.cancel) }
    }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = message; a.beginSheetModal(for: window) { _ in completionHandler() }
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = message; a.addButton(withTitle: "确定"); a.addButton(withTitle: "取消")
        a.beginSheetModal(for: window) { result in completionHandler(result == .alertFirstButtonReturn) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView.url?.host == "127.0.0.1" { applyPreferences() }
        if CommandLine.arguments.contains("--settings"),webView.url?.host == "127.0.0.1",settingsWindow == nil {showSettings()}
        if env["WB_APP_SETTINGS_SMOKE"] == "1", webView.url?.host == "127.0.0.1", !smokeStarted {
            smokeStarted=true
            if env["WB_APP_SETTINGS_RELOAD"] != "1" {prefs.startup="today";prefs.zoom=1.1;prefs.reduceMotion=true;prefs.decorations=false;prefs.menuBar=true;prefs.quitOnClose=false}
            showSettings()
            DispatchQueue.main.asyncAfter(deadline:.now()+1) {
                let report=self.env["WB_APP_SMOKE_REPORT"]!
                let info:[String:Any]=["ready":true,"startup":self.prefs.startup,"zoom":self.prefs.zoom,"reduceMotion":self.prefs.reduceMotion,"decorations":self.prefs.decorations,"menuBar":self.prefs.menuBar,"quitOnClose":self.prefs.quitOnClose,"loginStatus":self.prefs.loginStatus,"dataPath":self.prefs.dataPath,"hasSettings":self.settingsWindow?.isVisible == true,"hasStatusItem":self.statusItem != nil]
                try? JSONSerialization.data(withJSONObject:info,options:.prettyPrinted).write(to:URL(fileURLWithPath:report))
                try? self.prefs.backupData().write(to:URL(fileURLWithPath:report+".backup.json"))
                if let view=self.settingsWindow?.contentView,let bitmap=view.bitmapImageRepForCachingDisplay(in:view.bounds) {view.cacheDisplay(in:view.bounds,to:bitmap);try? bitmap.representation(using:.png,properties:[:])?.write(to:URL(fileURLWithPath:report+".png"))}
                NSApp.terminate(nil)
            }
            return
        }
        guard let report = env["WB_APP_SMOKE_REPORT"], webView.url?.host == "127.0.0.1", !smokeStarted else { return }
        smokeStarted = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            let fallback = "await new Promise(r=>setTimeout(r,500));return JSON.stringify({tasks:S.tasks.length,life:S.life.length,errors:window.wbAppErrors,ready:!!document.querySelector('.wb-task-sections')});"
            let script = self.env["WB_APP_TEST_SCRIPT"].flatMap { try? String(contentsOfFile: $0, encoding: .utf8) } ?? fallback
            self.web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
                let body: String
                switch result { case .success(let value): body = value as? String ?? String(describing: value)
                case .failure(let error): body = "{\"error\":\"\(error.localizedDescription.replacingOccurrences(of: "\"", with: "'"))\"}" }
                try? body.write(toFile: report, atomically: true, encoding: .utf8)
                self.web.takeSnapshot(with: nil) { image, _ in
                    if let data = image?.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data), let png = bitmap.representation(using: .png, properties: [:]) {
                        try? png.write(to: URL(fileURLWithPath: report + ".png"))
                    }
                    NSApp.terminate(nil)
                }
            }
        }
    }
    // MARK: - 自动更新

    /// 启动后检查一次；测试时可用 WB_APP_UPDATE_AUTORUN=1 直接安装。
    func scheduleUpdateCheck() {
        guard !autoUpdateChecked else { return }
        autoUpdateChecked = true
        let autorun = env["WB_APP_UPDATE_AUTORUN"] == "1"
        let delay: TimeInterval = autorun ? 0.2 : 3.0
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self else { return }
            if autorun { self.checkUpdate(silent: true, autoInstall: true) }
            else if self.prefs.autoUpdate { self.checkUpdate(silent: true, autoInstall: false) }
        }
    }

    @objc func checkUpdateMenu() { checkUpdate(silent: false, autoInstall: false) }

    func checkUpdate(silent: Bool, autoInstall: Bool) {
        guard !updating else { return }
        let feed = prefs.feed.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !feed.isEmpty else {
            prefs.updateStatus = "没有设置更新源"
            if !silent { alert("还没有设置更新源", "在「设置 → 关于 → 更新」里填 github:owner/repo，或 update.json 的地址。") }
            return
        }
        prefs.updateStatus = "正在检查更新…"
        DispatchQueue.global().async {
            do {
                let (manifest, payload) = try WorkbenchUpdater.loadManifest(feed)
                let newer = manifest.build > WorkbenchUpdater.currentBuild
                DispatchQueue.main.async {
                    guard newer else {
                        self.prefs.updateStatus = "已是最新版本 \(WorkbenchUpdater.currentVersion)"
                        self.writeUpdateReport(["result": "uptodate", "version": WorkbenchUpdater.currentVersion])
                        if !silent { self.alert("已是最新版本", "当前 \(WorkbenchUpdater.currentVersion)（build \(WorkbenchUpdater.currentBuild)）") }
                        return
                    }
                    self.prefs.updateStatus = "发现新版本 \(manifest.version)"
                    if autoInstall { self.runUpdate(manifest, payload); return }
                    let ask = NSAlert()
                    ask.messageText = "发现新版本 \(manifest.version)"
                    let notes = manifest.notes?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    ask.informativeText = (notes.isEmpty ? "" : notes + "\n\n")
                        + "当前 \(WorkbenchUpdater.currentVersion)。更新会替换应用本体，任务数据不受影响；完成后自动重新打开。"
                    ask.addButton(withTitle: "现在更新")
                    ask.addButton(withTitle: "稍后")
                    ask.beginSheetModal(for: self.window) { response in
                        if response == .alertFirstButtonReturn { self.runUpdate(manifest, payload) }
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self.prefs.updateStatus = "检查失败：\(error.localizedDescription)"
                    self.writeUpdateReport(["result": "error", "stage": "check", "message": error.localizedDescription])
                    if !silent { self.alert("检查更新失败", error.localizedDescription) }
                }
            }
        }
    }

    func runUpdate(_ manifest: UpdateManifest, _ payload: URL) {
        guard !updating else { return }
        updating = true
        showUpdatingPage(manifest.version)
        DispatchQueue.global().async {
            do {
                let prepared = try WorkbenchUpdater.prepare(manifest: manifest, payload: payload)
                if self.env["WB_APP_UPDATE_DRYRUN"] == "1" {
                    self.writeUpdateReport(["result": "dryrun", "app": prepared.app.path, "work": prepared.work.path])
                    DispatchQueue.main.async {
                        self.updating = false
                        self.prefs.updateStatus = "试运行完成，已解压 \(manifest.version)"
                        if let base = self.baseURL { self.web.load(URLRequest(url: base)) }
                    }
                    return
                }
                try WorkbenchUpdater.install(app: prepared.app, work: prepared.work)
                self.writeUpdateReport(["result": "installing", "version": manifest.version, "build": manifest.build])
                DispatchQueue.main.async {
                    self.quitting = true
                    NSApp.terminate(nil)
                }
            } catch {
                DispatchQueue.main.async {
                    self.updating = false
                    self.prefs.updateStatus = "更新失败：\(error.localizedDescription)"
                    self.writeUpdateReport(["result": "error", "stage": "install", "message": error.localizedDescription])
                    self.alert("更新失败", error.localizedDescription)
                    if let base = self.baseURL { self.web.load(URLRequest(url: base)) }
                }
            }
        }
    }

    func showUpdatingPage(_ version: String) {
        let html = """
        <meta charset="utf-8"><body style="margin:0;background:#f5f8ff;font:15px -apple-system;color:#275be8;display:flex;align-items:center;justify-content:center;height:100vh">
        <div style="text-align:center">
          <div style="font-size:17px;font-weight:600;margin-bottom:8px">正在更新到 \(version)</div>
          <div style="color:#7b8a9c;font-size:13px">下载、校验、替换应用，完成后会自动重新打开。</div>
        </div></body>
        """
        web.loadHTMLString(html, baseURL: nil)
    }

    func writeUpdateReport(_ info: [String: Any]) {
        guard let path = env["WB_APP_UPDATE_REPORT"] else { return }
        var payload = info
        payload["at"] = ISO8601DateFormatter().string(from: Date())
        try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            .write(to: URL(fileURLWithPath: path))
    }

    func alert(_ title: String, _ message: String) {
        let sheet = NSAlert()
        sheet.messageText = title
        sheet.informativeText = message
        sheet.addButton(withTitle: "好")
        if let window = window, window.isVisible { sheet.beginSheetModal(for: window, completionHandler: nil) }
        else { sheet.runModal() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { prefs.quitOnClose }
    func windowShouldClose(_ sender:NSWindow)->Bool {if sender === window && prefs.quitOnClose {NSApp.terminate(nil);return false};return true}
    func applicationShouldHandleReopen(_ sender: NSApplication,hasVisibleWindows flag: Bool) -> Bool {showMain();return true}
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        // Flush text drafts before terminating the owned local server.
        if !quitting, baseURL != nil {
            quitting = true
            web.callAsyncJavaScript("document.activeElement?.blur();if(typeof SC!=='undefined')await SC.queue;return location.hash;", arguments: [:], in: nil, in: .page) { result in
                if case .success(let value)=result,let route=value as? String,route.hasPrefix("#/") {self.prefs.lastRoute=route}
                self.finishTermination()
            }
            DispatchQueue.main.asyncAfter(deadline: .now()+3) { self.finishTermination() }
            return .terminateLater
        }
        quitting = true; return .terminateNow
    }
    func finishTermination(){guard !terminationReplied else{return};terminationReplied=true;NSApp.reply(toApplicationShouldTerminate:true)}
    func userContentController(_ userContentController: WKUserContentController,didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,message.frameInfo.request.url?.host == "127.0.0.1",message.frameInfo.request.url?.port == baseURL?.port else{return}
        if (message.body as? [String:String])?["action"] == "settings" {showSettings()}
    }
    func applyPreferences(){
        guard web != nil else{return};web.pageZoom=prefs.zoom
        let css=(prefs.reduceMotion ? "*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}" : "")+(prefs.decorations ? "" : "body:before,.wb-header-art,.wb-toolbar h2:after{display:none!important}")
        let encoded=String(data:try! JSONSerialization.data(withJSONObject:[css]),encoding:.utf8)!
        web.evaluateJavaScript("(()=>{let s=document.getElementById('wb-native-prefs');if(!s){s=document.createElement('style');s.id='wb-native-prefs';document.head.appendChild(s)}s.textContent=\(encoded)[0]})()",completionHandler:nil)
    }
    @objc func showSettings(){
        prefs.refreshLogin()
        if let raw = env["WB_APP_SETTINGS_TAB"], let index = Int(raw), (0...3).contains(index) { prefs.selectedTab = index }
        if let raw = env["WB_APP_SETTINGS_TAB"], let index = Int(raw), (0...3).contains(index) { prefs.selectedTab = index }
        if settingsWindow == nil {
            let host=NSHostingView(rootView:WorkbenchSettings(prefs:prefs))
            let panel=NSWindow(contentRect:NSRect(x:0,y:0,width:680,height:560),styleMask:[.titled,.closable],backing:.buffered,defer:false)
            panel.title="个人工作台设置";panel.contentView=host;panel.isReleasedWhenClosed=false;panel.center();settingsWindow=panel
        }
        settingsWindow!.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
    }
    @objc func showMain(){window?.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)}
    func updateStatusItem(){
        if prefs.menuBar {
            if statusItem == nil {statusItem=NSStatusBar.system.statusItem(withLength:NSStatusItem.squareLength);statusItem?.button?.image=NSImage(systemSymbolName:"square.grid.2x2",accessibilityDescription:"个人工作台");let menu=NSMenu();for (label,action) in [("打开工作台",#selector(showMain)),("设置…",#selector(showSettings)),("退出",#selector(NSApplication.terminate(_:)))] {let item=menu.addItem(withTitle:label,action:action,keyEquivalent:"");if label != "退出"{item.target=self}};statusItem?.menu=menu}
        }else if let item=statusItem {NSStatusBar.system.removeStatusItem(item);statusItem=nil}
    }
    func applicationWillTerminate(_ notification: Notification) {
        quitting = true; startupTimer?.invalidate()
        pipe?.fileHandleForReading.readabilityHandler = nil
        if server?.isRunning == true { server?.terminate(); server?.waitUntilExit() }
    }
    @objc func reload() { web?.reload() }
    @objc func showData() { if let dataURL { NSWorkspace.shared.open(dataURL) } }
    @objc func openBrowser() { if let baseURL { NSWorkspace.shared.open(baseURL) } }
    @objc func about() { showSettings() }
    func fail(_ title: String, _ message: String) {
        if let report = env["WB_APP_SMOKE_REPORT"] { try? (title + ": " + message).write(toFile: report, atomically: true, encoding: .utf8); quitting = true; NSApp.terminate(nil); return }
        let alert = NSAlert(); alert.messageText = title; alert.informativeText = message; alert.runModal(); quitting = true; NSApp.terminate(nil)
    }
}

@main struct WorkbenchMain {
    static func main() {
        let app=NSApplication.shared
        app.setActivationPolicy(.regular)
        let delegate=WorkbenchApp()
        app.delegate=delegate
        withExtendedLifetime(delegate){app.run()}
    }
}
