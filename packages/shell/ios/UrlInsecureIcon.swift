import AppKit
import ExpoModulesCore

public class UrlInsecureIconModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaUrlInsecureIcon")

    View(UrlInsecureIcon.self) {
      Prop("dark") { (view: UrlInsecureIcon, value: Bool?) in
        view.dark = value ?? true
      }
      Prop("hovered") { (view: UrlInsecureIcon, value: Bool?) in
        view.hovered = value ?? false
      }
      OnViewDidUpdateProps { (view: UrlInsecureIcon) in
        view.propsDidUpdate()
      }
    }
  }
}

final class UrlInsecureIcon: ExpoView {
  private static let lightRest = NSColor(displayP3Red: 245 / 255, green: 55 / 255, blue: 20 / 255, alpha: 0.75)
  private static let lightHover = NSColor(displayP3Red: 245 / 255, green: 55 / 255, blue: 20 / 255, alpha: 0.95)
  private static let darkRest = NSColor(displayP3Red: 242 / 255, green: 94 / 255, blue: 107 / 255, alpha: 0.75)
  private static let darkHover = NSColor(displayP3Red: 242 / 255, green: 94 / 255, blue: 107 / 255, alpha: 0.95)
  private static let glyph: NSImage? = {
    let fitSide: CGFloat = 14
    guard let source = NSImage(systemSymbolName: "lock.slash.fill", accessibilityDescription: nil)?
      .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 13, weight: .semibold))
    else { return nil }
    let scale = min(fitSide / source.size.width, fitSide / source.size.height, 1)
    let size = NSSize(width: (source.size.width * scale).rounded(.up), height: (source.size.height * scale).rounded(.up))
    let fitted = NSImage(size: size, flipped: false) { rect in
      source.draw(in: rect)
      return true
    }
    fitted.isTemplate = true
    return fitted
  }()

  var dark = true
  var hovered = false

  private let imageView = UrlInsecureIconImage(frame: .zero)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    imageView.imageScaling = .scaleNone
    imageView.imageAlignment = .alignCenter
    imageView.image = Self.glyph
    imageView.setAccessibilityElement(false)
    imageView.cell?.setAccessibilityElement(false)
    addSubview(imageView)
    layoutImage()
    propsDidUpdate()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func isAccessibilityElement() -> Bool { false }

  override func accessibilityChildren() -> [Any]? { [] }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    layoutImage()
  }

  func propsDidUpdate() {
    imageView.contentTintColor = dark ? (hovered ? Self.darkHover : Self.darkRest) : (hovered ? Self.lightHover : Self.lightRest)
  }

  private func layoutImage() {
    let size = Self.glyph?.size ?? .zero
    imageView.frame = NSRect(x: bounds.midX - size.width / 2, y: bounds.midY - size.height / 2, width: size.width, height: size.height)
  }
}

private final class UrlInsecureIconImage: NSImageView {
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
