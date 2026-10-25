import AppKit
import ExpoModulesCore

public class TabRowBackgroundModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaTabRowBackground")

    View(TabRowBackground.self) {
      Prop("dark") { (view: TabRowBackground, value: Bool?) in
        view.dark = value ?? true
      }
      Prop("current") { (view: TabRowBackground, value: Bool?) in
        view.current = value ?? false
      }
      Prop("contentVisible") { (view: TabRowBackground, value: Bool?) in
        view.contentVisible = value ?? false
      }
      Prop("multiSelected") { (view: TabRowBackground, value: Bool?) in
        view.multiSelected = value ?? false
      }
      Prop("hovered") { (view: TabRowBackground, value: Bool?) in
        view.hovered = value ?? false
      }
      Prop("canReset") { (view: TabRowBackground, value: Bool?) in
        view.canReset = value ?? false
      }
      Prop("iconMinX") { (view: TabRowBackground, value: Double?) in
        view.iconMinX = value.flatMap { $0.isFinite && $0 >= 0 ? CGFloat($0) : nil } ?? 0
      }
      Prop("iconWidth") { (view: TabRowBackground, value: Double?) in
        view.iconWidth = value.flatMap { $0.isFinite && $0 >= 0 ? CGFloat($0) : nil } ?? 0
      }
      Prop("regionHovered") { (view: TabRowBackground, value: Bool?) in
        view.regionHovered = value ?? false
      }
      Prop("regionPressed") { (view: TabRowBackground, value: Bool?) in
        view.regionPressed = value ?? false
      }
    }
  }
}

final class TabRowBackground: ExpoView {
  private struct Palette {
    let current: CGColor
    let contentVisible: CGColor
    let multiSelected: CGColor
    let itemBackground: CGColor
    let pressed: CGColor
    let selectedShadow: CGColor
  }

  private static let lightPalette = Palette(
    current: NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.8500000238418579).cgColor,
    contentVisible: NSColor(srgbRed: 1, green: 1, blue: 1, alpha: 0.699999988079071).cgColor,
    multiSelected: NSColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.10000000149011612).cgColor,
    itemBackground: NSColor(displayP3Red: 0.054999999701976776, green: 0.05900000035762787, blue: 0.06300000101327896, alpha: 0.05000000074505806).cgColor,
    pressed: NSColor(displayP3Red: 0.054999999701976776, green: 0.05900000035762787, blue: 0.06300000101327896, alpha: 0.06499999761581421).cgColor,
    selectedShadow: NSColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.20000000298023224).cgColor
  )
  private static let darkPalette = Palette(
    current: NSColor(displayP3Red: 0.9800000190734863, green: 0.984000027179718, blue: 1, alpha: 0.20000000298023224).cgColor,
    contentVisible: NSColor(displayP3Red: 0.9800000190734863, green: 0.984000027179718, blue: 1, alpha: 0.15000000596046448).cgColor,
    multiSelected: NSColor(displayP3Red: 0.9800000190734863, green: 0.984000027179718, blue: 1, alpha: 0.10000000149011612).cgColor,
    itemBackground: NSColor(displayP3Red: 0.9800000190734863, green: 0.984000027179718, blue: 1, alpha: 0.10000000149011612).cgColor,
    pressed: NSColor(displayP3Red: 0.9800000190734863, green: 0.984000027179718, blue: 1, alpha: 0.06499999761581421).cgColor,
    selectedShadow: NSColor(srgbRed: 0, green: 0, blue: 0, alpha: 0).cgColor
  )
  private static let cornerRadius: CGFloat = 12
  private static let inactiveOpacity: Float = 0.5
  private static let shadowRadius: CGFloat = 1
  private static let minXCorners: CACornerMask = [.layerMinXMinYCorner, .layerMinXMaxYCorner]
  private static let allCorners: CACornerMask = [.layerMinXMinYCorner, .layerMaxXMinYCorner, .layerMinXMaxYCorner, .layerMaxXMaxYCorner]
  private static let frameLimit = CGRect(x: -0x1p63, y: -0x1p63, width: 0x1p64, height: 0x1p64)

  var dark = true { didSet { apply() } }
  var current = false { didSet { apply() } }
  var contentVisible = false { didSet { apply() } }
  var multiSelected = false { didSet { apply() } }
  var hovered = false { didSet { apply() } }
  var canReset = false { didSet { apply() } }
  var iconMinX: CGFloat = 0 { didSet { apply() } }
  var iconWidth: CGFloat = 0 { didSet { apply() } }
  var regionHovered = false { didSet { apply() } }
  var regionPressed = false { didSet { apply() } }

  private let background = CALayer()
  private let iconRegion = CALayer()
  private var activityObservers: [NSObjectProtocol] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    background.cornerCurve = .continuous
    background.masksToBounds = false
    background.shadowOpacity = 1
    background.shadowRadius = Self.shadowRadius
  }

  deinit {
    for token in activityObservers { NotificationCenter.default.removeObserver(token) }
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func isAccessibilityElement() -> Bool { false }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    observeActivity()
    apply()
  }

  override func layout() {
    super.layout()
    apply()
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    apply()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    apply()
  }

  private var windowActive: Bool {
    guard NSApp.isActive else { return false }
    var current = window
    while let candidate = current {
      if candidate.isKeyWindow || candidate.isMainWindow { return true }
      current = candidate.sheetParent ?? candidate.parent
    }
    return false
  }

  private func observeActivity() {
    for token in activityObservers { NotificationCenter.default.removeObserver(token) }
    activityObservers = []
    guard window != nil else { return }
    let names: [Notification.Name] = [
      NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification,
      NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
      NSWindow.didBecomeMainNotification, NSWindow.didResignMainNotification,
    ]
    activityObservers = names.map { name in
      NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.apply() }
    }
  }

  private func backgroundFill(_ palette: Palette) -> CGColor? {
    if current { return palette.current }
    if contentVisible { return palette.contentVisible }
    if multiSelected { return palette.multiSelected }
    if hovered { return canReset ? nil : palette.itemBackground }
    return nil
  }

  private static func isValidFrame(_ rect: CGRect) -> Bool {
    guard !rect.isNull, !rect.isInfinite, [rect.minX, rect.minY, rect.width, rect.height].allSatisfy(\.isFinite) else { return false }
    return frameLimit.contains(rect)
  }

  private func apply() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if background.superlayer !== layer {
      layer.insertSublayer(background, at: 0)
      layer.insertSublayer(iconRegion, above: background)
    }
    let palette = dark ? Self.darkPalette : Self.lightPalette
    let flipped = layer.isGeometryFlipped || isFlipped
    let radius = max(min(Self.cornerRadius, bounds.width / 2, bounds.height / 2), 0)
    let fill = backgroundFill(palette)

    background.frame = bounds
    background.backgroundColor = fill
    background.opacity = windowActive ? 1 : Self.inactiveOpacity
    background.cornerRadius = radius
    background.shadowColor = current ? palette.selectedShadow : CGColor.clear
    background.shadowOffset = CGSize(width: 0, height: flipped ? 1 : -1)
    background.shadowPath = CGPath(roundedRect: background.bounds, cornerWidth: radius, cornerHeight: radius, transform: nil)

    let iconFrame = CGRect(x: bounds.minX, y: bounds.minY, width: 2 * iconMinX + iconWidth, height: bounds.height)
    if Self.isValidFrame(iconFrame) { iconRegion.frame = iconFrame }
    iconRegion.cornerRadius = Self.cornerRadius
    iconRegion.maskedCorners = fill == nil ? Self.allCorners : Self.minXCorners
    iconRegion.backgroundColor = regionPressed ? palette.pressed : regionHovered ? palette.itemBackground : nil
    CATransaction.commit()
  }
}
