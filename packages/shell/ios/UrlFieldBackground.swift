import AppKit
import ExpoModulesCore

public class UrlFieldBackgroundModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaUrlFieldBackground")

    View(UrlFieldBackground.self) {
      Prop("dark") { (view: UrlFieldBackground, value: Bool?) in
        view.dark = value ?? true
      }
      Prop("hovered") { (view: UrlFieldBackground, value: Bool?) in
        view.hovered = value ?? false
      }
      OnViewDidUpdateProps { (view: UrlFieldBackground) in
        view.propsDidUpdate()
      }
    }
  }
}

final class UrlFieldBackground: ExpoView {
  private static let lightRest = NSColor(displayP3Red: 0.054999999701976776, green: 0.05900000035762787, blue: 0.06300000101327896, alpha: 0.05000000074505806).cgColor
  private static let lightHover = NSColor(displayP3Red: 0.054999999701976776, green: 0.05900000035762787, blue: 0.06300000101327896, alpha: 0.10000000149011612).cgColor
  private static let darkRest = NSColor(displayP3Red: 0.9800000190734863, green: 0.984000027179718, blue: 1, alpha: 0.10000000149011612).cgColor
  private static let darkHover = NSColor(displayP3Red: 0.9800000190734863, green: 0.984000027179718, blue: 1, alpha: 0.15000000596046448).cgColor
  private static let cornerRadius: CGFloat = 12
  private static let transitionDuration: CFTimeInterval = 0.12
  private static let transitionKey = "backgroundColor"
  private static let boundsLimit = CGRect(x: -0x1p63, y: -0x1p63, width: 0x1p64, height: 0x1p64)

  var dark = true
  var hovered = false

  private let fill = CALayer()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    fill.cornerRadius = Self.cornerRadius
    fill.cornerCurve = .continuous
    fill.masksToBounds = true
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func isAccessibilityElement() -> Bool { false }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    fill.removeAnimation(forKey: Self.transitionKey)
    layoutFill()
  }

  override func layout() {
    super.layout()
    layoutFill()
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    layoutFill()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    layoutFill()
  }

  func propsDidUpdate() {
    layoutFill()
    showTarget(animated: canAnimate)
  }

  private var target: CGColor {
    dark ? (hovered ? Self.darkHover : Self.darkRest) : (hovered ? Self.lightHover : Self.lightRest)
  }

  private var canAnimate: Bool {
    Self.isAnimatableBounds(bounds) && layer?.presentation() != nil
  }

  private static func isAnimatableBounds(_ rect: CGRect) -> Bool {
    guard !rect.isNull, !rect.isInfinite, [rect.origin.x, rect.origin.y, rect.size.width, rect.size.height].allSatisfy(\.isFinite) else { return false }
    return boundsLimit.contains(rect) && !rect.isEmpty
  }

  private func layoutFill() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if fill.superlayer !== layer { layer.insertSublayer(fill, at: 0) }
    fill.frame = bounds
    CATransaction.commit()
  }

  private func showTarget(animated: Bool) {
    let next = target
    guard fill.backgroundColor != next else { return }
    let from = fill.presentation()?.backgroundColor ?? fill.backgroundColor
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    fill.backgroundColor = next
    CATransaction.commit()
    guard animated, let from else {
      fill.removeAnimation(forKey: Self.transitionKey)
      return
    }
    let transition = CABasicAnimation(keyPath: "backgroundColor")
    transition.fromValue = from
    transition.toValue = next
    transition.duration = Self.transitionDuration
    transition.timingFunction = CAMediaTimingFunction(name: .easeOut)
    fill.add(transition, forKey: Self.transitionKey)
  }
}
