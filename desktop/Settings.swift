import AppKit
import SwiftUI
import ServiceManagement

final class AppPreferences: ObservableObject {
    let defaults: UserDefaults
    var onChange: (() -> Void)?
    @Published var startup: String { didSet { defaults.set(startup, forKey:"startup"); onChange?() } }
    @Published var quitOnClose: Bool { didSet { defaults.set(quitOnClose,forKey:"quitOnClose"); onChange?() } }
    @Published var rememberWindow: Bool { didSet { defaults.set(rememberWindow,forKey:"rememberWindow") } }
    @Published var menuBar: Bool { didSet { defaults.set(menuBar,forKey:"menuBar"); onChange?() } }
    @Published var zoom: Double { didSet { defaults.set(zoom,forKey:"zoom"); onChange?() } }
    @Published var reduceMotion: Bool { didSet { defaults.set(reduceMotion,forKey:"reduceMotion"); onChange?() } }
    @Published var decorations: Bool { didSet { defaults.set(decorations,forKey:"decorations"); onChange?() } }
    @Published var selectedData: String { didSet { defaults.set(selectedData,forKey:"selectedData") } }
    @Published var autoUpdate: Bool { didSet { defaults.set(autoUpdate,forKey:"autoUpdate") } }
    @Published var feed: String { didSet { defaults.set(feed,forKey:"feed") } }
    @Published var updateStatus = ""
    var onCheckUpdate: (() -> Void)?
    @Published var loginStatus = ""
    @Published var loginEnabled = false
    @Published var needsApproval = false
    @Published var loginBusy = false
    @Published var selectedTab = 0
    @Published var message = ""
    @Published var dataPath = ""
    @Published var backupBusy = false
    var lastRoute: String { get { defaults.string(forKey:"lastRoute") ?? "#/" } set { defaults.set(newValue,forKey:"lastRoute") } }
    init() {
        defaults = ProcessInfo.processInfo.environment["WB_APP_PREFS_SUITE"].flatMap { UserDefaults(suiteName:$0) } ?? .standard
        defaults.register(defaults:["startup":"overview","quitOnClose":true,"rememberWindow":true,"menuBar":false,"zoom":1.0,"reduceMotion":false,"decorations":true,"autoUpdate":true])
        startup=defaults.string(forKey:"startup") ?? "overview";quitOnClose=defaults.bool(forKey:"quitOnClose");rememberWindow=defaults.bool(forKey:"rememberWindow");menuBar=defaults.bool(forKey:"menuBar")
        zoom=defaults.double(forKey:"zoom");reduceMotion=defaults.bool(forKey:"reduceMotion");decorations=defaults.bool(forKey:"decorations");selectedData=defaults.string(forKey:"selectedData") ?? ""
        autoUpdate=defaults.bool(forKey:"autoUpdate");feed=defaults.string(forKey:"feed") ?? AppPreferences.bundledFeed()
        refreshLogin()
    }
    /// 打包时写进 workspace.json 的默认更新源，指向构建输出目录里的 update.json。
    static func bundledFeed() -> String {
        guard let url = Bundle.main.resourceURL?.appendingPathComponent("workspace.json"),
              let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let feed = object["updateFeed"] as? String else { return "" }
        return feed
    }
    static var appVersion: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0" }
    static var appBuild: String { Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1" }
    func refreshLogin() {
        let status=SMAppService.mainApp.status
        loginEnabled=status == .enabled || status == .requiresApproval
        needsApproval=status == .requiresApproval
        switch status {
        case .enabled:loginStatus="已开启：登录 Mac 后自动打开"
        case .requiresApproval:loginStatus="等待系统批准，请在「登录项」中允许"
        case .notRegistered:loginStatus="已关闭"
        case .notFound:loginStatus="系统暂未识别应用，请先放入「应用程序」再打开"
        @unknown default:loginStatus="请在系统登录项中检查"
        }
    }
    func setLogin(_ enabled: Bool) {
        guard !loginBusy else { return };loginBusy=true
        do { if enabled { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() };message="" }
        catch { message="未能更改登录自启：\(error.localizedDescription)\n可先将 App 放入「应用程序」，再从系统登录项检查。" }
        refreshLogin();loginBusy=false
    }
    func chooseData() {
        let panel=NSOpenPanel();panel.canChooseFiles=false;panel.canChooseDirectories=true;panel.allowsMultipleSelection=false;panel.message="选择含任务、生活记录和分组配置的已有工作台数据目录";panel.prompt="使用此目录"
        guard panel.runModal() == .OK, let url=panel.url else { return }
        do {
            for (name,key) in [("tasks.json","tasks"),("life.json","items"),("templates.json","lanes")] {
                let value=try JSONSerialization.jsonObject(with:Data(contentsOf:url.appendingPathComponent(name))) as? [String:Any]
                guard value?[key] is [Any] else { throw NSError(domain:"Workbench",code:1,userInfo:[NSLocalizedDescriptionKey:"\(name) 格式不正确"]) }
            }
            selectedData=url.path;message="数据目录已选择，下次打开 App 生效；现有文件不会被覆盖。"
        } catch {message="未切换数据目录：\(error.localizedDescription)"}
    }
    func exportBackup() {
        let panel=NSSavePanel();panel.nameFieldStringValue="工作台备份-"+ISO8601DateFormatter().string(from:Date()).replacingOccurrences(of:":",with:"-")+".json"
        panel.title="导出完整数据备份";panel.canCreateDirectories=true
        guard panel.runModal() == .OK, let target=panel.url else { return }
        backupBusy=true
        do {
            try backupData().write(to:target,options:.atomic)
            message="备份已导出：\(target.lastPathComponent)"
        } catch { message="备份失败：\(error.localizedDescription)" }
        backupBusy=false
    }
    func backupData() throws -> Data {
        var records:[String:Any]=[:]
        for name in ["tasks.json","life.json","templates.json"] {records[name]=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:dataPath).appendingPathComponent(name)))}
        return try JSONSerialization.data(withJSONObject:["format":"cn.mushan.workbench.backup","version":1,"exportedAt":ISO8601DateFormatter().string(from:Date()),"files":records],options:[.prettyPrinted,.sortedKeys])
    }
}

struct WorkbenchSettings: View {
    @ObservedObject var prefs: AppPreferences
    var body: some View {
        VStack(spacing:0) {
            HStack(spacing:13) {
                Image(nsImage:NSImage(contentsOf:Bundle.main.resourceURL!.appendingPathComponent("Workbench.icns")) ?? NSImage()).resizable().frame(width:52,height:52)
                VStack(alignment:.leading,spacing:3) { Text("个人工作台设置").font(.title2.bold());Text("让工作台按你的习惯运行").font(.subheadline).foregroundStyle(.secondary) }
                Spacer();Text("\(AppPreferences.appVersion)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }.padding(22)
            Divider()
            HStack(spacing:8) {
                ForEach(Array([("通用","gearshape"),("外观","paintpalette"),("数据","externaldrive"),("关于","info.circle")].enumerated()),id:\.offset) { index,item in
                    Button {prefs.selectedTab=index} label:{Label(item.0,systemImage:item.1).font(.system(size:13,weight:.medium)).frame(maxWidth:.infinity).padding(.vertical,9).background(prefs.selectedTab == index ? Color.accentColor.opacity(0.14) : Color.clear,in:RoundedRectangle(cornerRadius:9)).foregroundStyle(prefs.selectedTab == index ? Color.accentColor : Color.secondary)}.buttonStyle(.plain)
                }
            }.padding(.horizontal,22).padding(.top,14)
            Group {
                if prefs.selectedTab == 0 {
                Form {
                    Section("启动与窗口") {
                        Toggle("登录 Mac 时自动打开",isOn:Binding(get:{prefs.loginEnabled},set:{prefs.setLogin($0)})).disabled(prefs.loginBusy)
                        HStack {Text(prefs.loginStatus).font(.caption).foregroundStyle(.secondary);Spacer();Button("系统登录项…"){SMAppService.openSystemSettingsLoginItems()}.font(.caption)}
                        Picker("打开 App 时显示",selection:$prefs.startup) {Text("工作进度").tag("overview");Text("今日安排").tag("today");Text("生活清单").tag("life");Text("上次打开的页面").tag("last")}
                        Toggle("关闭主窗口时退出 App",isOn:$prefs.quitOnClose)
                        Text(prefs.quitOnClose ? "退出前保存输入，随后停止本机服务。" : "关闭后继续运行；点击程序坞图标或菜单栏重新打开。").font(.caption).foregroundStyle(.secondary)
                        Toggle("记住窗口大小与位置",isOn:$prefs.rememberWindow)
                        Toggle("在系统菜单栏显示快捷入口",isOn:$prefs.menuBar)
                    }
                }.formStyle(.grouped)
                } else if prefs.selectedTab == 1 {
                Form {
                    Section("显示与动态效果") {
                        Picker("界面大小",selection:$prefs.zoom) {Text("紧凑 · 85%").tag(0.85);Text("标准 · 100%").tag(1.0);Text("舒适 · 110%").tag(1.1);Text("大字 · 125%").tag(1.25)}
                        Toggle("减少动画与动态效果",isOn:$prefs.reduceMotion)
                        Toggle("显示页面装饰",isOn:$prefs.decorations)
                        Text("显示设置立即生效。页面仍会遵循系统的「减少动态效果」设置。").font(.caption).foregroundStyle(.secondary)
                    }
                }.formStyle(.grouped)
                } else if prefs.selectedTab == 2 {
                Form {
                    Section("本机数据") {
                        LabeledContent("当前数据目录") {Text(prefs.dataPath).font(.caption).textSelection(.enabled).lineLimit(3)}
                        HStack {Button("打开数据目录"){NSWorkspace.shared.open(URL(fileURLWithPath:prefs.dataPath))};Button("选择已有数据目录…"){prefs.chooseData()}}
                        if !prefs.selectedData.isEmpty && prefs.selectedData != prefs.dataPath {Text("下次使用："+prefs.selectedData).font(.caption).foregroundStyle(.secondary)}
                    }
                    Section("备份") {
                        Button("导出完整数据备份…"){prefs.exportBackup()}.disabled(prefs.backupBusy)
                        Text("包含任务、生活记录、分组和已移除记录；不复制任务指向的原始文件。备份是普通 JSON，可独立保存。").font(.caption).foregroundStyle(.secondary)
                    }
                }.formStyle(.grouped)
                } else if prefs.selectedTab == 3 {
                Form {
                    Section("个人工作台 \(AppPreferences.appVersion)") {
                        LabeledContent("版本",value:"\(AppPreferences.appVersion)（build \(AppPreferences.appBuild)）")
                        LabeledContent("运行方式",value:"原生 Mac 窗口 · 本机离线保存")
                        LabeledContent("平台",value:"Apple 芯片 · macOS 14 及以上")
                    }
                    Section("自动更新") {
                        Toggle("启动时自动检查更新",isOn:$prefs.autoUpdate)
                        TextField("更新源",text:$prefs.feed,prompt:Text("github:owner/repo 或 update.json 网址"))
                            .textFieldStyle(.roundedBorder)
                        HStack(alignment:.firstTextBaseline) {
                            Button("立即检查更新"){prefs.onCheckUpdate?()}
                            Spacer()
                            Text(prefs.updateStatus.isEmpty ? "更新只替换应用本体，任务数据不受影响。" : prefs.updateStatus)
                                .font(.caption).foregroundStyle(.secondary).lineLimit(2).multilineTextAlignment(.trailing)
                        }
                    }
                    Section {
                        Text("任务数据独立于 App 保存。更换应用不会重置你的任务。登录自启由 macOS 管理，App 不会默认开启。").font(.caption).foregroundStyle(.secondary)
                    }
                }.formStyle(.grouped)
                }
            }.padding(14)
            if !prefs.message.isEmpty {Divider();Text(prefs.message).font(.caption).foregroundStyle(.secondary).frame(maxWidth:.infinity,alignment:.leading).padding(14)}
        }.frame(width:680,height:560).background(Color(nsColor:.windowBackgroundColor)).tint(Color(red:0.05,green:0.57,blue:0.49))
    }
}
