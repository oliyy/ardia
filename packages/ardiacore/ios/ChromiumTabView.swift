import AppKit
import ExpoModulesCore

final class ChromiumTabView: PageTabHost, ArdiaWebViewDelegate {
  let onPageEvent = EventDispatcher()

  override var pageEventDispatcher: EventDispatcher { onPageEvent }

  override class func makePage() -> PageTab { ArdiaWebView(frame: .zero) }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    (page as? ArdiaWebView)?.delegate = self
  }

  override func setViewportLeadingX(_ leadingX: Double?) {
    (page as? ArdiaWebView)?.viewportLeadingX = leadingX.map { NSNumber(value: $0) }
  }

  func webView(_ view: ArdiaWebView, event name: String, payload: [String: Any]) {
    send(name, payload: payload)
  }
}
