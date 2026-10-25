import AppKit
import CoreImage
import ExpoModulesCore
import React

public class ArcFavoriteBackgroundModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaArcFavoriteBackground")

    View(ArcFavoriteBackground.self) {
      Prop("source") { (view: ArcFavoriteBackground, value: [String: Any]?) in
        view.source = value.flatMap(ArcFavoriteBackground.Source.init)
      }
      Prop("cornerRadius") { (view: ArcFavoriteBackground, value: Double?) in
        view.cornerRadius = value.flatMap { $0.isFinite && $0 >= 0 ? CGFloat($0) : nil } ?? 12
      }
      Prop("hovered") { (view: ArcFavoriteBackground, value: Bool?) in
        view.hovered = value ?? false
      }
      Prop("logicalWidth") { (view: ArcFavoriteBackground, value: Double?) in
        view.logicalWidth = value.flatMap { $0.isFinite && $0 > 0 ? CGFloat($0) : nil }
      }
      Prop("dark") { (view: ArcFavoriteBackground, value: Bool?) in
        view.dark = value ?? true
      }
      Prop("mutedColor") { (view: ArcFavoriteBackground, value: String?) in
        view.mutedColor = value.flatMap(NSColor.init(hex:))
      }
    }
  }
}

final class ArcFavoriteBackground: ExpoView {
  struct Source: Equatable {
    let uri: String
    let profileId: String

    init?(_ value: [String: Any]) {
      guard let uri = value["uri"] as? String, !uri.isEmpty, let profileId = value["profileId"] as? String else { return nil }
      self.uri = uri
      self.profileId = profileId
    }
  }

  var source: Source? {
    didSet {
      guard source != oldValue else { return }
      invalidate()
      canvas = nil
      field.removeAnimation(forKey: Self.fieldAnimationKey)
      apply()
      load()
    }
  }
  var cornerRadius: CGFloat = 12 { didSet { apply() } }
  var logicalWidth: CGFloat? { didSet { apply() } }
  var hovered = false {
    didSet {
      guard hovered != oldValue else { return }
      animateHover()
    }
  }
  var dark = true {
    didSet {
      guard dark != oldValue else { return }
      field.removeAnimation(forKey: Self.fieldAnimationKey)
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      field.opacity = fieldOpacity
      CATransaction.commit()
      apply()
    }
  }
  var mutedColor: NSColor? { didSet { apply() } }

  private static let context = CIContext()
  private static let queue = DispatchQueue(label: "ArcFavoriteBackground.field")
  private static let loopbackHosts: Set<String> = ["localhost", "127.0.0.1", "::1"]
  private static let sourceSide = 32
  private static let canvasSide: CGFloat = 47
  private static let drawnSide = canvasSide / 5 * 16
  private static let ringWidth: CGFloat = 2
  private static let restingFieldOpacity: Float = 0.2
  private static let hoveredFieldOpacity: Float = 0.3
  private static let lightRestingFieldOpacity: Float = 0
  private static let lightHoveredFieldOpacity: Float = 0.1
  private static let hoverDuration: CFTimeInterval = 0.12
  private static let fieldAnimationKey = "opacity"

  private let shadowLayer = CALayer()
  private let plate = CALayer()
  private let field = CALayer()
  private let ring = CALayer()
  private let ringMask = CAShapeLayer()
  private let ringImage = CALayer()
  private let ringGradient = CAGradientLayer()

  private var canvas: NSImage?
  private var fieldVisible = false
  private var generation = 0
  private var loading = false
  private var cancelLoad: (() -> Void)?
  private var activityObservers: [NSObjectProtocol] = []

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    shadowLayer.shadowColor = NSColor.black.cgColor
    shadowLayer.shadowOpacity = 0.1
    shadowLayer.shadowRadius = 2
    plate.cornerCurve = .continuous
    plate.masksToBounds = true
    plate.addSublayer(field)
    field.contentsGravity = .resize
    field.opacity = Self.restingFieldOpacity
    ringMask.fillRule = .evenOdd
    ringMask.fillColor = NSColor.black.cgColor
    ring.mask = ringMask
    ring.addSublayer(ringImage)
    ring.addSublayer(ringGradient)
    ringImage.contentsGravity = .resize
  }

  deinit {
    cancelLoad?()
    for token in activityObservers { NotificationCenter.default.removeObserver(token) }
  }

  override func hitTest(_ point: NSPoint) -> NSView? {
    let hit = super.hitTest(point)
    return hit === self ? nil : hit
  }

  override func isAccessibilityElement() -> Bool { false }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    observeActivity()
    if window == nil {
      invalidate()
      field.removeAnimation(forKey: Self.fieldAnimationKey)
    } else {
      load()
    }
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

  private var fieldOpacity: Float {
    dark ? (hovered ? Self.hoveredFieldOpacity : Self.restingFieldOpacity) : (hovered ? Self.lightHoveredFieldOpacity : Self.lightRestingFieldOpacity)
  }

  private func animateHover() {
    let low = dark ? Self.restingFieldOpacity : Self.lightRestingFieldOpacity
    let high = dark ? Self.hoveredFieldOpacity : Self.lightHoveredFieldOpacity
    let from = min(max(field.presentation()?.opacity ?? field.opacity, low), high)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    field.opacity = fieldOpacity
    CATransaction.commit()
    guard fieldVisible, window != nil else { return }
    let animation = CABasicAnimation(keyPath: "opacity")
    animation.fromValue = from
    animation.toValue = fieldOpacity
    animation.duration = Self.hoverDuration
    animation.timingFunction = CAMediaTimingFunction(name: .default)
    field.add(animation, forKey: Self.fieldAnimationKey)
  }

  private func invalidate() {
    cancelLoad?()
    cancelLoad = nil
    generation += 1
    loading = false
  }

  private func load() {
    guard window != nil, canvas == nil, !loading, let source, let url = Self.permittedURL(source.uri),
      let loader = appContext?.reactBridge?.module(forName: "ImageLoader", lazilyLoadIfNecessary: true) as? RCTImageLoaderProtocol
    else { return }
    loading = true
    let token = generation
    cancelLoad = loader.loadImage(with: URLRequest(url: url)) { [weak self] _, image in
      DispatchQueue.main.async { self?.loaded(image, source: source, token: token) }
    }
  }

  private func loaded(_ image: NSImage?, source: Source, token: Int) {
    guard token == generation, source == self.source, window != nil else { return }
    cancelLoad = nil
    guard let image, let normalized = Self.normalized(image) else {
      loading = false
      return
    }
    Self.queue.async { [weak self] in
      let filtered = Self.filtered(normalized)
      DispatchQueue.main.async {
        guard let self, token == self.generation, source == self.source, self.window != nil else { return }
        self.loading = false
        guard let filtered else { return }
        self.canvas = Self.canvas(filtered)
        self.apply()
      }
    }
  }

  private func apply() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if shadowLayer.superlayer !== layer {
      layer.insertSublayer(shadowLayer, at: 0)
      layer.insertSublayer(plate, above: shadowLayer)
      layer.insertSublayer(ring, above: plate)
    }
    let flipped = layer.isGeometryFlipped || isFlipped
    let scale = window?.backingScaleFactor ?? 2
    let rect = CGRect(x: bounds.minX, y: bounds.minY, width: logicalWidth ?? bounds.width, height: bounds.height)
    let radius = max(min(cornerRadius, rect.width / 2, rect.height / 2), 0)
    let active = windowActive
    let image = active ? canvas : nil

    shadowLayer.frame = rect
    shadowLayer.shadowPath = CGPath(roundedRect: logicalWidth == nil ? bounds : shadowLayer.bounds, cornerWidth: radius, cornerHeight: radius, transform: nil)
    shadowLayer.shadowOffset = CGSize(width: 0, height: flipped ? 1 : -1)
    shadowLayer.isHidden = !active

    plate.frame = rect
    plate.cornerRadius = radius
    plate.backgroundColor = NSColor.white.withAlphaComponent(dark ? (active ? 0.45 : 0.22325) : (active ? 0.8 : 0.4)).cgColor
    field.frame = plate.bounds
    field.contentsScale = scale
    field.contents = image
    field.isHidden = image == nil
    if (image != nil) != fieldVisible {
      fieldVisible = image != nil
      field.removeAnimation(forKey: Self.fieldAnimationKey)
      field.opacity = fieldOpacity
    }

    ring.frame = rect
    ringMask.frame = ring.bounds
    ringMask.contentsScale = scale
    let path = CGMutablePath()
    path.addRoundedRect(in: ring.bounds, cornerWidth: radius, cornerHeight: radius)
    let inner = ring.bounds.insetBy(dx: Self.ringWidth, dy: Self.ringWidth)
    if inner.width > 0, inner.height > 0 {
      let innerRadius = max(radius - Self.ringWidth, 0)
      path.addRoundedRect(in: inner, cornerWidth: innerRadius, cornerHeight: innerRadius)
    }
    ringMask.path = path
    ringImage.frame = ring.bounds
    ringImage.contentsScale = scale
    ringImage.contents = image
    ringImage.isHidden = image == nil
    ringGradient.frame = ring.bounds
    ringGradient.isHidden = active
    if !active, let muted = mutedColor?.withAlphaComponent(0.2).cgColor {
      ringGradient.colors = [muted, muted]
    } else {
      ringGradient.colors = (active ? [0.48, 0.3] : [0.15, 0.15]).map { NSColor.white.withAlphaComponent($0).cgColor }
    }
    ringGradient.startPoint = CGPoint(x: 0.5, y: flipped ? 0 : 1)
    ringGradient.endPoint = CGPoint(x: 0.5, y: flipped ? 1 : 0)
    CATransaction.commit()
  }

  private static func permittedURL(_ uri: String) -> URL? {
    guard let url = URL(string: uri), let scheme = url.scheme?.lowercased() else { return nil }
    if scheme == "file" || scheme == "data" { return url }
    #if DEBUG
      if scheme == "http", let host = url.host?.lowercased(), loopbackHosts.contains(host) { return url }
    #endif
    return nil
  }

  private static func normalized(_ image: NSImage) -> CGImage? {
    var rect = CGRect(x: 0, y: 0, width: sourceSide, height: sourceSide)
    guard let source = image.cgImage(forProposedRect: &rect, context: nil, hints: nil),
      let space = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(
        data: nil, width: sourceSide, height: sourceSide, bitsPerComponent: 8, bytesPerRow: sourceSide * 4, space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    context.interpolationQuality = .high
    context.draw(source, in: CGRect(x: 0, y: 0, width: sourceSide, height: sourceSide))
    return context.makeImage()
  }

  private static func filtered(_ image: CGImage) -> CGImage? {
    guard let blur = CIFilter(name: "CIGaussianBlur"), let colors = CIFilter(name: "CIColorControls") else { return nil }
    blur.setValue(CIImage(cgImage: image), forKey: kCIInputImageKey)
    blur.setValue(5, forKey: kCIInputRadiusKey)
    guard let blurred = blur.outputImage else { return nil }
    colors.setValue(blurred, forKey: kCIInputImageKey)
    colors.setValue(1.5, forKey: kCIInputSaturationKey)
    colors.setValue(0.05, forKey: kCIInputBrightnessKey)
    colors.setValue(0.85, forKey: kCIInputContrastKey)
    guard let output = colors.outputImage else { return nil }
    return context.createCGImage(output, from: output.extent)
  }

  private static func canvas(_ filtered: CGImage) -> NSImage {
    let image = NSImage(cgImage: filtered, size: NSSize(width: filtered.width, height: filtered.height))
    let canvas = NSImage(size: NSSize(width: canvasSide, height: canvasSide))
    canvas.lockFocus()
    let origin = (canvasSide - drawnSide) / 2
    image.draw(in: CGRect(x: origin, y: origin, width: drawnSide, height: drawnSide), from: .zero, operation: .sourceOver, fraction: 1)
    canvas.unlockFocus()
    return canvas
  }
}
