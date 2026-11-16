// Leon Gold for the Mac (WebKit). Two builds (build.sh):
//   «لئون گلد» (owner only, default): «دفتر» and «حساب من» in one window, switched from the toolbar (⌘1 / ⌘2);
//   «حساب من» (-D HESAB, for the public site): «حساب من» alone.
// Each section keeps its own page; the start page is shown from the Mac at once (kept from last time, refreshed behind);
// the data (api.leongold.net) is always live. Other sites open in the default browser.
import Cocoa
import WebKit
import UserNotifications
import CryptoKit

struct Section { let key: String, title: String, start: URL }
let LEDGER = Section(key: "ledger", title: "دفتر", start: URL(string: "https://leon-gold.github.io/leon-gold-app/")!)
let HESAB_S = Section(key: "hesab", title: "حساب من", start: URL(string: "https://leongold.net/hesab/")!)
#if HESAB
let APP_TITLE = "حساب من · لئون گلد", SECTIONS = [HESAB_S]
#else
let APP_TITLE = "لئون گلد", SECTIONS = [LEDGER, HESAB_S]
#endif
let VERSION = "1.2"
#if TEST
// test build only: the local test server and page (never shipped)
let API = "http://127.0.0.1:8797"
let HOSTS: Set<String> = ["leon-gold.github.io", "leongold.net", "www.leongold.net", "127.0.0.1"]
func ours(_ u: URL?) -> Bool { guard let u = u, let h = u.host?.lowercased() else { return false }; return (u.scheme == "https" || h == "127.0.0.1") && HOSTS.contains(h) }
#else
let API = "https://api.leongold.net"
let HOSTS: Set<String> = ["leon-gold.github.io", "leongold.net", "www.leongold.net"]
func ours(_ u: URL?) -> Bool { guard let u = u, u.scheme == "https", let h = u.host?.lowercased() else { return false }; return HOSTS.contains(h) }
#endif
let BG = NSColor(red: 0x0c/255.0, green: 0x1d/255.0, blue: 0x15/255.0, alpha: 1)
let ENV = ProcessInfo.processInfo.environment
let TESTING = ENV["LG_SCRIPT"] != nil
func log(_ s: String) { if TESTING { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) } }
let support: URL = {
  let d = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(Bundle.main.bundleIdentifier ?? "LeonGold")
  try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true); return d
}()

// ---------- the start page, kept on the Mac ----------
enum PageCache {
  static func file(_ u: URL) -> URL {
    let k = (u.scheme ?? "") + "://" + (u.host ?? "") + u.path
    let h = SHA256.hash(data: Data(k.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
    return support.appendingPathComponent("page-" + h)
  }
  static func get(_ u: URL) -> Data? { try? Data(contentsOf: file(u)) }
  static func refresh(_ u: URL) {
    var r = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
    r.setValue("text/html", forHTTPHeaderField: "Accept")
    URLSession.shared.dataTask(with: r) { d, res, _ in
      guard let h = res as? HTTPURLResponse, h.statusCode == 200, let d = d, (h.mimeType ?? "").contains("html") else { return }
      try? d.write(to: file(u), options: .atomic)
    }.resume()
  }
}

// ---------- «حساب من»: notifications from the server's inbox (no Web Push in an app's WebKit) ----------
final class Inbox {
  let ud = UserDefaults.standard
  var token: String { get { ud.string(forKey: "token") ?? "" } set { ud.set(newValue, forKey: "token") } }
  var last: Int { get { ud.integer(forKey: "last") } set { ud.set(newValue, forKey: "last") } }
  lazy var dev: String = { if let d = ud.string(forKey: "dev") { return d }; let d = UUID().uuidString; ud.set(d, forKey: "dev"); return d }()
  var busy = false

  func call(_ method: String, _ path: String, _ tok: String, _ body: [String: Any]?, _ cb: @escaping (Int, [String: Any]?) -> Void) {
    var r = URLRequest(url: URL(string: API + path)!, timeoutInterval: 20)
    r.httpMethod = method; r.setValue("Bearer " + tok, forHTTPHeaderField: "Authorization")
    if let b = body { r.setValue("application/json", forHTTPHeaderField: "Content-Type"); r.httpBody = try? JSONSerialization.data(withJSONObject: b) }
    URLSession.shared.dataTask(with: r) { d, res, _ in
      let code = (res as? HTTPURLResponse)?.statusCode ?? 0
      let j = d.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
      DispatchQueue.main.async { cb(code, j) }
    }.resume()
  }
  func session(_ t: String) {
    let t = t.trimmingCharacters(in: .whitespaces); guard t.count <= 200, t != token else { return }
    if !token.isEmpty { call("POST", "/api/portal/push/app/off", token, ["dev": dev]) { _, _ in } }
    if t.isEmpty { token = ""; last = 0; log("inbox: signed out"); return }
    call("POST", "/api/portal/push/app", t, ["dev": dev]) { code, j in
      if code == 200, j?["ok"] as? Bool == true { self.token = t; self.last = j?["last"] as? Int ?? 0; log("inbox: registered") }
      else { log("inbox: register failed \(code)") }
    }
  }
  func poll(show: @escaping ([[String: Any]]) -> Void) {
    guard !token.isEmpty, !busy else { return }; busy = true
    call("GET", "/api/portal/push/inbox?after=\(last)", token, nil) { code, j in
      self.busy = false
      if code == 401 { self.token = ""; return }
      guard code == 200, let j = j else { return }
      let items = j["items"] as? [[String: Any]] ?? []
      if let l = j["last"] as? Int, l > self.last { self.last = l }
      log("inbox: \(items.count) new")
      if !items.isEmpty { show(items) }
    }
  }
}

// ---------- the window ----------
final class App: NSObject, NSApplicationDelegate, NSToolbarDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler, UNUserNotificationCenterDelegate {
  var win: NSWindow!
  var webs: [WKWebView] = []
  var offline: NSView!
  var current = 0
  var switcher: NSSegmentedControl?
  let inbox = Inbox()
  var timers: [Timer] = []
  let born = Date()
  var loaded = Set<Int>()

  func applicationDidFinishLaunching(_ n: Notification) {
    buildMenu()
    let vis = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 860)
    win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: min(1280, vis.width * 0.9), height: min(860, vis.height * 0.9)),
                   styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    win.title = APP_TITLE; win.backgroundColor = BG; win.minSize = NSSize(width: 420, height: 560)
    win.setFrameAutosaveName("main"); if win.frame.origin == .zero { win.center() }
    let root = NSView(); root.wantsLayer = true; root.layer?.backgroundColor = BG.cgColor
    for (i, s) in SECTIONS.enumerated() {
      let w = makeWeb(); w.isHidden = true; webs.append(w); root.addSubview(w); pin(w, root)
      _ = i; _ = s
    }
    offline = makeOffline(); offline.isHidden = true; root.addSubview(offline); pin(offline, root)
    win.contentView = root
    if SECTIONS.count > 1 {
      let tb = NSToolbar(identifier: "main"); tb.delegate = self; tb.displayMode = .iconOnly
      win.toolbar = tb; win.titleVisibility = .hidden
      if #available(macOS 11.0, *) { win.toolbarStyle = .unified }
    }
    if TESTING {
      // test runs stay out of the way: an invisible window that takes no clicks or typing (snapshots still render)
      win.alphaValue = 0; win.ignoresMouseEvents = true; win.orderBack(nil)
      NSApp.setActivationPolicy(.accessory)
    } else {
      win.makeKeyAndOrderFront(nil)
      NSApp.activate(ignoringOtherApps: true)
    }
    let saved = UserDefaults.standard.string(forKey: "tab"), want = ENV["LG_TAB"] ?? saved
    show(SECTIONS.firstIndex { $0.key == want } ?? 0)
    if SECTIONS.contains(where: { $0.key == "hesab" }) { startInbox() }
    if let path = ENV["LG_SCRIPT"] { runScript(path) }
  }
  func pin(_ v: NSView, _ root: NSView) {
    v.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([v.leadingAnchor.constraint(equalTo: root.leadingAnchor), v.trailingAnchor.constraint(equalTo: root.trailingAnchor), v.topAnchor.constraint(equalTo: root.topAnchor), v.bottomAnchor.constraint(equalTo: root.bottomAnchor)])
  }
  func makeWeb() -> WKWebView {
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .default()
    cfg.applicationNameForUserAgent = "LeonGoldApp/\(VERSION) Mac"
    if #available(macOS 12.3, *) { cfg.preferences.isElementFullscreenEnabled = true }
    // window.print() inside the page → the Mac's own print sheet
    cfg.userContentController.add(self, name: "lgPrint")
    cfg.userContentController.addUserScript(WKUserScript(source: "window.print=function(){window.webkit.messageHandlers.lgPrint.postMessage(1)};", injectionTime: .atDocumentStart, forMainFrameOnly: false))
    if TESTING {
      cfg.userContentController.add(self, name: "lgLog")
      cfg.userContentController.addUserScript(WKUserScript(source: "addEventListener('error',function(e){window.webkit.messageHandlers.lgLog.postMessage('page error: '+e.message+' @'+e.filename+':'+e.lineno)});addEventListener('unhandledrejection',function(e){window.webkit.messageHandlers.lgLog.postMessage('page rejection: '+e.reason)});", injectionTime: .atDocumentStart, forMainFrameOnly: false))
    }
    let w = WKWebView(frame: .zero, configuration: cfg)
    w.navigationDelegate = self; w.uiDelegate = self
    w.allowsBackForwardNavigationGestures = true
    w.setValue(false, forKey: "drawsBackground")
    // test runs: the hidden window must still count as visible, or the site's entrance animations wait forever
    let occ = Selector(("_setWindowOcclusionDetectionEnabled:"))
    if TESTING, w.responds(to: occ) { w.perform(occ, with: NSNumber(value: false)) }
    return w
  }
  func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { false }
  func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows f: Bool) -> Bool { win.makeKeyAndOrderFront(nil); return true }

  // ---------- sections ----------
  func show(_ i: Int) {
    guard i >= 0, i < SECTIONS.count else { return }
    current = i
    for (j, w) in webs.enumerated() { w.isHidden = j != i }
    offline.isHidden = true
    switcher?.selectedSegment = i
    win.title = SECTIONS.count > 1 ? APP_TITLE + " · " + SECTIONS[i].title : APP_TITLE
    UserDefaults.standard.set(SECTIONS[i].key, forKey: "tab")
    if !loaded.contains(i) { loaded.insert(i); openStart(i, SECTIONS[i].start) }
    if !TESTING { win.makeFirstResponder(webs[i]) }
    log("tab: \(SECTIONS[i].key)")
  }
  @objc func pick(_ s: NSSegmentedControl) { show(s.selectedSegment) }
  @objc func tab1() { show(0) }
  @objc func tab2() { show(1) }
  func index(of w: WKWebView) -> Int { webs.firstIndex(of: w) ?? 0 }

  func toolbarAllowedItemIdentifiers(_ t: NSToolbar) -> [NSToolbarItem.Identifier] { [.flexibleSpace, NSToolbarItem.Identifier("tabs")] }
  func toolbarDefaultItemIdentifiers(_ t: NSToolbar) -> [NSToolbarItem.Identifier] { [.flexibleSpace, NSToolbarItem.Identifier("tabs"), .flexibleSpace] }
  func toolbar(_ t: NSToolbar, itemForItemIdentifier id: NSToolbarItem.Identifier, willBeInsertedIntoToolbar f: Bool) -> NSToolbarItem? {
    guard id.rawValue == "tabs" else { return nil }
    let s = NSSegmentedControl(labels: SECTIONS.map { $0.title }, trackingMode: .selectOne, target: self, action: #selector(pick(_:)))
    s.selectedSegment = current; s.segmentStyle = .automatic; switcher = s
    let item = NSToolbarItem(itemIdentifier: id); item.view = s; item.label = "بخش"
    return item
  }

  /// shown from the Mac at once when kept from last time (same address, so the page's own data and sign-in stay)
  func openStart(_ i: Int, _ u: URL) {
    let start = SECTIONS[i].start, w = webs[i]
    if let d = PageCache.get(start) {
      w.loadSimulatedRequest(URLRequest(url: u), response: HTTPURLResponse(url: u, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/html; charset=utf-8"])!, responseData: d)
      log("start \(SECTIONS[i].key): from the Mac")
    } else {
      w.load(URLRequest(url: u)); log("start \(SECTIONS[i].key): from the network")
    }
    PageCache.refresh(start)
  }

  // ours inside, everything else in the default browser
  func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if a.shouldPerformDownload { return decisionHandler(.download) }
    guard let u = a.request.url else { return decisionHandler(.cancel) }
    if ours(u) || ["about", "blob", "data"].contains(u.scheme ?? "") { return decisionHandler(.allow) }
    log("external: \(u.absoluteString)")
    if ENV["LG_NO_EXTERNAL"] == nil { NSWorkspace.shared.open(u) }
    decisionHandler(.cancel)
  }
  func webView(_ w: WKWebView, decidePolicyFor r: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
    decisionHandler(r.canShowMIMEType ? .allow : .download)
  }
  func webView(_ w: WKWebView, navigationAction: WKNavigationAction, didBecome d: WKDownload) { d.delegate = self }
  func webView(_ w: WKWebView, navigationResponse: WKNavigationResponse, didBecome d: WKDownload) { d.delegate = self }
  // a download (backup, PDF, Excel) goes to Downloads, never over an existing file
  func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename name: String, completionHandler: @escaping (URL?) -> Void) {
    let dl = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
    var dest = dl.appendingPathComponent(name), i = 1
    let base = (name as NSString).deletingPathExtension, ext = (name as NSString).pathExtension
    while FileManager.default.fileExists(atPath: dest.path) { i += 1; dest = dl.appendingPathComponent("\(base) (\(i))" + (ext.isEmpty ? "" : "." + ext)) }
    log("download to: \(dest.path)")
    completionHandler(dest)
  }
  func downloadDidFinish(_ d: WKDownload) { log("download: done"); NSSound(named: "Glass")?.play() }
  func download(_ d: WKDownload, didFailWithError e: Error, resumeData: Data?) { log("download: failed \(e.localizedDescription)") }

  // target=_blank: ours in this section, others in the browser
  func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
    if let u = a.request.url {
      if ours(u) { w.load(a.request) } else { log("external: \(u.absoluteString)"); if ENV["LG_NO_EXTERNAL"] == nil { NSWorkspace.shared.open(u) } }
    }
    return nil
  }
  func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) {
    if (e as NSError).code != NSURLErrorCancelled, index(of: w) == current { offline.isHidden = false; log("offline: shown") }
  }
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
    if index(of: w) == current { offline.isHidden = true }
    log("ready \(SECTIONS[index(of: w)].key) in \(Int(Date().timeIntervalSince(born) * 1000)) ms")
  }

  // the page's alert / confirm / prompt / file picker (test mode answers them itself and logs them)
  func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
    if TESTING { log("alert: \(m)"); return completionHandler() }
    let a = NSAlert(); a.messageText = m; a.addButton(withTitle: "باشه"); a.beginSheetModal(for: win) { _ in completionHandler() }
  }
  func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    if TESTING { log("confirm: \(m)"); return completionHandler(true) }
    let a = NSAlert(); a.messageText = m; a.addButton(withTitle: "تأیید"); a.addButton(withTitle: "انصراف")
    a.beginSheetModal(for: win) { completionHandler($0 == .alertFirstButtonReturn) }
  }
  func webView(_ w: WKWebView, runJavaScriptTextInputPanelWithPrompt p: String, defaultText t: String?, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
    if TESTING { log("prompt: \(p)"); return completionHandler("test") }
    let a = NSAlert(); a.messageText = p; let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24)); field.stringValue = t ?? ""
    a.accessoryView = field; a.addButton(withTitle: "تأیید"); a.addButton(withTitle: "انصراف")
    a.beginSheetModal(for: win) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) }
  }
  func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    if TESTING, let f = ENV["LG_PICK"] { log("file picker: gave \(f)"); return completionHandler([URL(fileURLWithPath: f)]) }
    let o = NSOpenPanel(); o.allowsMultipleSelection = p.allowsMultipleSelection; o.canChooseDirectories = false
    o.beginSheetModal(for: win) { completionHandler($0 == .OK ? o.urls : nil) }
  }
  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
    if m.name == "lgLog" { log("\(m.body)"); return }
    if m.name == "lgPrint" {
      log("print: sheet requested"); if TESTING { return }
      let w = webs[current], op = w.printOperation(with: NSPrintInfo.shared); op.view?.frame = w.bounds
      op.runModal(for: win, delegate: nil, didRun: nil, contextInfo: nil)
    }
  }

  // ---------- «حساب من» notifications ----------
  func startInbox() {
    let c = UNUserNotificationCenter.current(); c.delegate = self
    c.requestAuthorization(options: [.alert, .sound, .badge]) { ok, e in log("notifications allowed: \(ok)\(e.map { " (\($0.localizedDescription))" } ?? "")") }
    guard let hi = SECTIONS.firstIndex(where: { $0.key == "hesab" }) else { return }
    var seen: String? = nil
    timers.append(Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
      // only a settled page answers: while one loads, its storage reads as empty, which is not a sign-out
      guard let self = self, self.loaded.contains(hi), !self.webs[hi].isLoading, ours(self.webs[hi].url) else { return }
      self.webs[hi].evaluateJavaScript("(function(){try{return localStorage.getItem('leon-hesab')||''}catch(e){return null}})()") { r, e in
        guard e == nil, let t = r as? String, !self.webs[hi].isLoading else { return }
        if t != seen { seen = t; self.inbox.session(t) }
      }
    })
    timers.append(Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in self?.pollNow() })
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.pollNow() }
  }
  func pollNow() { inbox.poll { [weak self] items in self?.notify(items) } }
  func notify(_ items: [[String: Any]]) {
    for m in items {
      let c = UNMutableNotificationContent(); c.title = m["title"] as? String ?? "لئون گلد"; c.body = m["body"] as? String ?? ""; c.sound = .default
      c.userInfo = ["url": m["url"] as? String ?? ""]
      log("notification: \(c.title) — \(c.body)")
      UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "lg\(m["id"] ?? 0)", content: c, trigger: nil)) { e in if let e = e { log("notification failed: \(e.localizedDescription)") } }
    }
  }
  func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler h: @escaping (UNNotificationPresentationOptions) -> Void) { h([.banner, .sound]) }
  // a tapped notification: «حساب من» at its own address, with only the section it points to
  func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler h: @escaping () -> Void) {
    openNotice(r.notification.request.content.userInfo["url"] as? String); h()
  }
  func openNotice(_ s: String?) {
    if !TESTING { win.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true) }
    guard let hi = SECTIONS.firstIndex(where: { $0.key == "hesab" }) else { return }
    show(hi)
    var target = SECTIONS[hi].start
    if let s = s, let t = URLComponents(string: s)?.queryItems?.first(where: { $0.name == "t" })?.value,
       t.range(of: "^[a-z]{1,20}$", options: .regularExpression) != nil, let u = URL(string: target.absoluteString + "?t=" + t) { target = u }
    log("open from notification: \(target.absoluteString)")
    webs[hi].load(URLRequest(url: target))
  }

  // ---------- no internet ----------
  func makeOffline() -> NSView {
    let v = NSView(); v.wantsLayer = true; v.layer?.backgroundColor = BG.cgColor
    let t = NSTextField(labelWithString: "اینترنت وصل نیست. دوباره امتحان کن.")
    t.textColor = NSColor(red: 0.91, green: 0.85, blue: 0.69, alpha: 1); t.font = .systemFont(ofSize: 16); t.alignment = .center
    let b = NSButton(title: "تلاش دوباره", target: self, action: #selector(retry)); b.bezelStyle = .rounded; b.bezelColor = NSColor(red: 0.85, green: 0.71, blue: 0.42, alpha: 1)
    let s = NSStackView(views: [t, b]); s.orientation = .vertical; s.spacing = 16; s.translatesAutoresizingMaskIntoConstraints = false
    v.addSubview(s); NSLayoutConstraint.activate([s.centerXAnchor.constraint(equalTo: v.centerXAnchor), s.centerYAnchor.constraint(equalTo: v.centerYAnchor)])
    return v
  }
  @objc func retry() { offline.isHidden = true; webs[current].load(URLRequest(url: SECTIONS[current].start)) }
  @objc func reloadPage() { webs[current].reload() }
  @objc func zoomIn() { webs[current].pageZoom = min(2, webs[current].pageZoom + 0.1) }
  @objc func zoomOut() { webs[current].pageZoom = max(0.5, webs[current].pageZoom - 0.1) }
  @objc func zoomReset() { webs[current].pageZoom = 1 }

  func buildMenu() {
    let main = NSMenu(), appItem = NSMenuItem(); main.addItem(appItem)
    let app = NSMenu(); appItem.submenu = app
    app.addItem(withTitle: "پنهان کردن", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
    app.addItem(.separator())
    app.addItem(withTitle: "خروج از " + APP_TITLE, action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
    let editItem = NSMenuItem(); main.addItem(editItem); let edit = NSMenu(title: "ویرایش"); editItem.submenu = edit
    edit.addItem(withTitle: "برگرداندن", action: Selector(("undo:")), keyEquivalent: "z")
    edit.addItem(withTitle: "بریدن", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
    edit.addItem(withTitle: "کپی", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
    edit.addItem(withTitle: "چسباندن", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
    edit.addItem(withTitle: "انتخاب همه", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
    let viewItem = NSMenuItem(); main.addItem(viewItem); let view = NSMenu(title: "نما"); viewItem.submenu = view
    if SECTIONS.count > 1 {
      view.addItem(withTitle: SECTIONS[0].title, action: #selector(tab1), keyEquivalent: "1")
      view.addItem(withTitle: SECTIONS[1].title, action: #selector(tab2), keyEquivalent: "2")
      view.addItem(.separator())
    }
    view.addItem(withTitle: "بارگذاری دوباره", action: #selector(reloadPage), keyEquivalent: "r")
    view.addItem(withTitle: "بزرگ‌تر", action: #selector(zoomIn), keyEquivalent: "+")
    view.addItem(withTitle: "کوچک‌تر", action: #selector(zoomOut), keyEquivalent: "-")
    view.addItem(withTitle: "اندازه‌ی اصلی", action: #selector(zoomReset), keyEquivalent: "0")
    let winItem = NSMenuItem(); main.addItem(winItem); let w = NSMenu(title: "پنجره"); winItem.submenu = w
    w.addItem(withTitle: "کوچک کردن", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
    w.addItem(withTitle: "بستن", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
    NSApp.mainMenu = main
  }

  // ---------- test mode (LG_SCRIPT=<file>): one command per line, results to stderr ----------
  //   tab <key> · wait <s> · eval <js> (logs the result) · snap <file.png> · menu <1|2> · poll · notice <url> · reload · quit
  func runScript(_ path: String) {
    let lines = ((try? String(contentsOfFile: path, encoding: .utf8)) ?? "").split(separator: "\n").map(String.init).filter { !$0.hasPrefix("#") && !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    func step(_ i: Int) {
      guard i < lines.count else { return }
      let line = lines[i], parts = line.split(separator: " ", maxSplits: 1).map(String.init), cmd = parts[0], arg = parts.count > 1 ? parts[1] : ""
      let next = { DispatchQueue.main.async { step(i + 1) } }
      switch cmd {
      case "tab": show(SECTIONS.firstIndex { $0.key == arg } ?? 0); next()
      case "menu": arg == "2" ? tab2() : tab1(); next()
      case "wait": DispatchQueue.main.asyncAfter(deadline: .now() + (Double(arg) ?? 1)) { step(i + 1) }
      case "eval":
        webs[current].evaluateJavaScript(arg) { r, e in log("eval → \(e.map { "error \($0.localizedDescription)" } ?? String(describing: r ?? "nil"))"); next() }
      case "snap":
        webs[current].takeSnapshot(with: nil) { img, _ in
          if let t = img?.tiffRepresentation, let b = NSBitmapImageRep(data: t)?.representation(using: .png, properties: [:]) { try? b.write(to: URL(fileURLWithPath: arg)); log("snap: \(arg)") }
          next()
        }
      case "poll": pollNow(); next()
      case "notice": openNotice(arg); next()
      case "reload": reloadPage(); next()
      case "quit": log("quit"); NSApp.terminate(nil)
      default: log("unknown: \(line)"); next()
      }
    }
    step(0)
  }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
