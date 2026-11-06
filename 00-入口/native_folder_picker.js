// macOS 原生目录选择；参数通过 argv 传入，不拼接可执行代码。
ObjC.import('AppKit');
function run(argv) {
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy(1);
  const panel = $.NSOpenPanel.openPanel;
  panel.canChooseFiles = false;
  panel.canChooseDirectories = true;
  panel.allowsMultipleSelection = false;
  panel.canCreateDirectories = true;
  panel.title = '选择任务文件夹';
  panel.message = '选择一个文件夹，将它关联到任务。';
  panel.prompt = '选择文件夹';
  if (argv[0]) panel.directoryURL = $.NSURL.fileURLWithPath(argv[0]);
  app.activateIgnoringOtherApps(true);
  return Number(panel.runModal) === 1 ? ObjC.unwrap(panel.URL.path) : '';
}
