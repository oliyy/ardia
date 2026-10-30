import AppKit
import ArdiaCore
import Carbon.HIToolbox
import ExpoModulesCore

final class ExtensionPopupWindowHost: ExpoView, NSWindowDelegate {
  private static let originKey = "ArdiaExtensionPopupOrigin"
  private static var hiddenInstanceOrigin: NSPoint?

  private static var savedOrigin: NSPoint? {
    get {
      if LaunchConfig.shared.background { return hiddenInstanceOrigin }
      guard let pair = UserDefaults.standard.array(forKey: originKey) as? [Double], pair.count == 2 else { return nil }
      return NSPoint(x: pair[0], y: pair[1])
    }
    set {
      if LaunchConfig.shared.background {
        hiddenInstanceOrigin = newValue
        return
      }
      UserDefaults.standard.set(newValue.map { [Double($0.x), Double($0.y)] }, forKey: originKey)
    }
  }

  let onClose = EventDispatcher()
  private let content = ExtensionPopupWindowContent()
  private var popup: NSWindow?
  private var parentClosing: NSObjectProtocol?
  private var userMoved = false

  var shown = false {
    didSet {
      guard shown, !oldValue else { return }
      DispatchQueue.main.async { [weak self] in self?.present() }
    }
  }
  var dark = true { didSet { popup?.appearance = NSAppearance(named: dark ? .darkAqua : .aqua) } }
  var title = "" { didSet { popup?.title = title } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    alphaValue = 0
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func didUpdateReactSubviews() {
    guard popup != nil else { return super.didUpdateReactSubviews() }
    for view in reactSubviews() ?? [] where view.superview !== content { content.addSubview(view) }
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    fitPopup()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    guard window == nil, popup != nil else { return }
    DispatchQueue.main.async { [self] in
      if window == nil { dismiss() }
    }
  }

  private func present() {
    guard shown, popup == nil, let parent = window else { return }
    let made = NSWindow(contentRect: NSRect(origin: .zero, size: bounds.size), styleMask: [.titled, .closable], backing: .buffered, defer: false)
    made.title = title
    made.titleVisibility = .hidden
    made.titlebarSeparatorStyle = .line
    made.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
    made.isReleasedWhenClosed = false
    made.isExcludedFromWindowsMenu = true
    made.tabbingMode = .disallowed
    made.contentView = content
    made.delegate = self
    popup = made
    didUpdateReactSubviews()
    let origin = topLeft(of: made.frame.size, under: parent)
    made.setFrameTopLeftPoint(origin)
    parentClosing = NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: parent, queue: .main) {
      [weak self] _ in
      self?.dismiss()
      self?.onClose()
    }
    parent.addChildWindow(made, ordered: .above)
    made.setFrameTopLeftPoint(origin)
    made.makeKeyAndOrderFront(nil)
  }

  private func topLeft(of size: NSSize, under parent: NSWindow) -> NSPoint {
    let anchor = parent.convertToScreen(convert(bounds, to: nil))
    let wanted = Self.savedOrigin ?? NSPoint(x: anchor.minX, y: anchor.maxY)
    guard let screen = NSScreen.screens.first(where: { NSPointInRect(wanted, $0.frame) }) ?? parent.screen else { return wanted }
    let visible = screen.visibleFrame
    return NSPoint(
      x: min(max(wanted.x, visible.minX), visible.maxX - size.width),
      y: max(min(wanted.y, visible.maxY), visible.minY + size.height))
  }

  private func fitPopup() {
    guard let popup else { return }
    let frame = popup.frameRect(forContentRect: NSRect(origin: .zero, size: bounds.size))
    guard frame.size != popup.frame.size else { return }
    popup.setFrame(NSRect(x: popup.frame.minX, y: popup.frame.maxY - frame.height, width: frame.width, height: frame.height), display: true)
  }

  private func dismiss() {
    guard let popup else { return }
    self.popup = nil
    if let parentClosing { NotificationCenter.default.removeObserver(parentClosing) }
    parentClosing = nil
    popup.delegate = nil
    for view in content.subviews { view.removeFromSuperview() }
    popup.parent?.removeChildWindow(popup)
    popup.close()
  }

  func windowWillMove(_ notification: Notification) {
    userMoved = true
  }

  func windowDidMove(_ notification: Notification) {
    guard userMoved, let popup else { return }
    Self.savedOrigin = NSPoint(x: popup.frame.minX, y: popup.frame.maxY)
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    onClose()
    return true
  }
}
