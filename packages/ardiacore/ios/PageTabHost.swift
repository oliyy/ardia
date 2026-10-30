import AppKit
import ExpoModulesCore

class PageTabHost: ExpoView {
  let page: PageTab
  var pageEvents: Set<String> = []
  private var propsReady = false
  private var ownership: [String: Any] = [:]
  private(set) var viewportLeadingX: Double?

  class func makePage() -> PageTab {
    preconditionFailure("\(self) doesn't say which page view it hosts")
  }

  var pageEventDispatcher: EventDispatcher {
    preconditionFailure("\(type(of: self)) declares no onPageEvent of its own, so Expo can't find it")
  }

  required init(appContext: AppContext? = nil) {
    page = Self.makePage()
    super.init(appContext: appContext)
    wantsLayer = true
  }

  deinit {
    page.closePage()
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    layoutPage()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if viewportLeadingX != nil { layoutPage() }
  }

  func stageOwnership(_ key: String, _ value: Any?) {
    if ownership.isEmpty { page.beginOwnershipChange() }
    ownership[key] = value ?? NSNull()
  }

  func setViewportLeadingX(_ leadingX: Double?) {
    guard leadingX != viewportLeadingX else { return }
    viewportLeadingX = leadingX
    layoutPage()
  }

  func propsDidUpdate() {
    if !ownership.isEmpty {
      let changes = ownership
      ownership = [:]
      page.commitOwnership(changes)
    }
    guard !propsReady else { return }
    propsReady = true
    layoutPage()
    addSubview(page)
    page.startPage()
  }

  private func layoutPage() {
    page.frame = pageArea()
  }

  private func pageArea() -> NSRect {
    guard let leadingX = viewportLeadingX, let content = window?.contentView else { return bounds }
    let width = convert(bounds, to: content).maxX - leadingX
    guard width.isFinite, width > 0 else { return bounds }
    return NSRect(x: bounds.minX, y: bounds.minY, width: width, height: bounds.height)
  }

  func send(_ name: String, payload: [String: Any]) {
    PageEvents.send(pageEventDispatcher, wanted: pageEvents, name: name, payload: payload)
  }
}
