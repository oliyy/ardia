import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class Surface: ExpoView {
  var surfaceFill: NSColor? { didSet { apply() } }
  var surfaceRadius: Double = 0 { didSet { apply() } }
  var surfaceBorderColor: NSColor? { didSet { apply() } }
  var surfaceBorderWidth: Double = 0 { didSet { apply() } }
  var surfaceBorderColors: [NSColor] = [] { didSet { apply() } }
  var surfaceShadowColor: NSColor? { didSet { apply() } }
  var surfaceShadowOpacity: Double = 0 { didSet { apply() } }
  var surfaceShadowRadius: Double = 0 { didSet { apply() } }
  var surfaceShadowOffset: CGSize = .zero { didSet { apply() } }
  var surfaceCutout: [Double]? { didSet { apply() } }
  var surfaceLogicalWidth: CGFloat? { didSet { apply() } }
  var surfaceFadeMask: SurfaceFadeMask? {
    didSet {
      fadePending = surfaceFadeMask != nil
      if surfaceFadeMask == nil { fadeRamp.removeAllAnimations() }
      apply()
    }
  }
  var surfaceInactiveOpacity: Double? { didSet { observeActivity() } }
  var surfaceInactiveFillOpacity: Double? { didSet { observeActivity() } }
  var surfaceInactiveBorderColors: [NSColor]? { didSet { observeActivity() } }
  var surfaceHidesAccessibility = false {
    didSet {
      guard surfaceHidesAccessibility != oldValue, window != nil else { return }
      NSAccessibility.post(element: self, notification: .layoutChanged)
    }
  }
  var surfaceRefreshRasterOnRest = false {
    didSet {
      guard surfaceRefreshRasterOnRest, !oldValue, let scale = window?.backingScaleFactor else { return }
      markStaleRasters(scale)
    }
  }

  private var requestedAlpha: CGFloat = 1
  private var activityObservers: [NSObjectProtocol] = []

  override var alphaValue: CGFloat {
    get { super.alphaValue }
    set {
      requestedAlpha = newValue
      applyActivity()
    }
  }

  private let plate = CALayer()
  private let shadowLayer = CALayer()
  private let shadowMask = CAShapeLayer()
  private let borderGradient = CAGradientLayer()
  private let borderStroke = CAShapeLayer()
  private let cutoutMask = CAShapeLayer()
  private let fadeHolder = CALayer()
  private let fadeClip = CALayer()
  private let fadeRamp = CAGradientLayer()
  private let fadeBase = CALayer()
  private var fadePending = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
  }

  deinit {
    for token in activityObservers { NotificationCenter.default.removeObserver(token) }
  }

  override func makeBackingLayer() -> CALayer {
    SurfaceLayer()
  }

  override func isAccessibilityElement() -> Bool { !surfaceHidesAccessibility && super.isAccessibilityElement() }
  override func accessibilityChildren() -> [Any]? { surfaceHidesAccessibility ? [] : super.accessibilityChildren() }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    observeActivity()
    if surfaceLogicalWidth != nil { apply() }
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    if surfaceLogicalWidth != nil { apply() }
  }

  private func markStaleRasters(_ scale: CGFloat) {
    var pending: [NSView] = [self]
    while let view = pending.popLast() {
      if let layer = view.layer, layer.contents != nil, abs(layer.contentsScale - scale) > 0.001 { view.needsDisplay = true }
      pending.append(contentsOf: view.subviews)
    }
  }

  private var drawRect: CGRect {
    guard let width = surfaceLogicalWidth else { return bounds }
    return backingAlignedRect(CGRect(x: bounds.minX, y: bounds.minY, width: width, height: bounds.height), options: .alignAllEdgesNearest)
  }

  private func childBounds(_ rect: CGRect) -> CGRect {
    surfaceLogicalWidth == nil ? rect : CGRect(origin: .zero, size: rect.size)
  }

  private func observeActivity() {
    for token in activityObservers { NotificationCenter.default.removeObserver(token) }
    activityObservers = []
    if surfaceInactiveOpacity != nil || surfaceInactiveFillOpacity != nil || surfaceInactiveBorderColors != nil, window != nil {
      let names: [Notification.Name] = [
        NSApplication.didBecomeActiveNotification, NSApplication.didResignActiveNotification,
        NSWindow.didBecomeKeyNotification, NSWindow.didResignKeyNotification,
        NSWindow.didBecomeMainNotification, NSWindow.didResignMainNotification,
      ]
      activityObservers = names.map { name in
        NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.applyActivity() }
      }
    }
    applyActivity()
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

  private var effectiveFill: CGColor? {
    guard let fill = surfaceFill else { return nil }
    guard let factor = surfaceInactiveFillOpacity, !windowActive else { return fill.cgColor }
    return fill.withAlphaComponent(fill.alphaComponent * CGFloat(factor)).cgColor
  }

  private var effectiveBorderColors: [NSColor] {
    guard let colors = surfaceInactiveBorderColors, !windowActive else { return surfaceBorderColors }
    return colors
  }

  private func applyActivity() {
    let multiplier = surfaceInactiveOpacity.map { windowActive ? 1 : CGFloat($0) } ?? 1
    super.alphaValue = requestedAlpha * multiplier
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    plate.backgroundColor = effectiveFill
    applyBorder()
    CATransaction.commit()
  }

  override func layout() {
    super.layout()
    apply()
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    apply()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    apply()
  }

  override func updateLayer() {
    super.updateLayer()
    apply()
  }

  private func apply() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if borderGradient.superlayer !== layer {
      layer.insertSublayer(borderGradient, at: 0)
      borderStroke.fillColor = nil
      borderStroke.strokeColor = NSColor.black.cgColor
      borderGradient.mask = borderStroke
    }
    if plate.superlayer !== layer {
      layer.insertSublayer(plate, at: 0)
      layer.insertSublayer(shadowLayer, below: plate)
      shadowMask.fillRule = .evenOdd
      shadowLayer.mask = shadowMask
    }
    layer.masksToBounds = false
    let rect = drawRect
    let local = childBounds(rect)
    plate.frame = rect
    plate.cornerRadius = surfaceRadius
    plate.cornerCurve = .continuous
    plate.backgroundColor = effectiveFill
    applyBorder()

    let shape = CGPath(roundedRect: local, cornerWidth: surfaceRadius, cornerHeight: surfaceRadius, transform: nil)
    shadowLayer.frame = rect
    if let shadowColor = surfaceShadowColor, surfaceShadowOpacity > 0 {
      shadowLayer.shadowColor = shadowColor.cgColor
      shadowLayer.shadowOpacity = Float(surfaceShadowOpacity)
      shadowLayer.shadowRadius = surfaceShadowRadius
      shadowLayer.shadowOffset = CGSize(width: surfaceShadowOffset.width, height: layer.isGeometryFlipped || isFlipped ? surfaceShadowOffset.height : -surfaceShadowOffset.height)
      shadowLayer.shadowPath = shape
      let outset = surfaceShadowRadius * 3 + abs(surfaceShadowOffset.height) + abs(surfaceShadowOffset.width) + 4
      let mask = CGMutablePath()
      mask.addRect(local.insetBy(dx: -outset, dy: -outset))
      mask.addPath(shape)
      shadowMask.frame = local
      shadowMask.path = mask
      shadowLayer.isHidden = false
    } else {
      shadowLayer.isHidden = true
    }

    if let surfaceLayer = layer as? SurfaceLayer {
      if let cutout = surfaceCutout {
        let flipped = layer.isGeometryFlipped || isFlipped
        let radius = cutout[2]
        let centerY = flipped ? cutout[1] : bounds.height - cutout[1]
        let outset = max(bounds.width, bounds.height) + 32
        let path = CGMutablePath()
        path.addRect(bounds.insetBy(dx: -outset, dy: -outset))
        path.addEllipse(in: CGRect(x: cutout[0] - radius, y: centerY - radius, width: radius * 2, height: radius * 2))
        cutoutMask.fillRule = .evenOdd
        cutoutMask.frame = bounds
        cutoutMask.path = path
        surfaceLayer.heldMask = cutoutMask
      } else if let fade = surfaceFadeMask {
        layoutFade(fade)
        surfaceLayer.heldMask = fadeHolder
      } else if surfaceLayer.heldMask != nil {
        surfaceLayer.heldMask = nil
      }
    }
    CATransaction.commit()
  }

  private func layoutFade(_ fade: SurfaceFadeMask) {
    let flipped = layer?.isGeometryFlipped == true || isFlipped
    let height = bounds.height
    let ramp = fade.rampShare * height
    let bottom = min(max(height - fade.baseInset, 0), height)
    let edge = height - fade.edgeInset - fade.edgeShare * height
    let pad = (fade.offsetShares.map(abs).max() ?? 0) * height + ramp + 1
    let span = bottom + pad * 2
    if fadeClip.superlayer !== fadeHolder {
      fadeHolder.addSublayer(fadeClip)
      fadeHolder.addSublayer(fadeBase)
      fadeClip.addSublayer(fadeRamp)
      fadeClip.masksToBounds = true
      fadeBase.backgroundColor = NSColor.black.cgColor
    }
    fadeHolder.frame = bounds
    fadeClip.frame = CGRect(x: 0, y: flipped ? 0 : height - bottom, width: bounds.width, height: bottom)
    fadeBase.frame = CGRect(x: 0, y: flipped ? bottom : 0, width: bounds.width, height: height - bottom)
    fadeRamp.bounds = CGRect(x: 0, y: 0, width: bounds.width, height: span)
    fadeRamp.position = CGPoint(x: bounds.width / 2, y: span / 2 - pad)
    fadeRamp.startPoint = CGPoint(x: 0.5, y: flipped ? 0 : 1)
    fadeRamp.endPoint = CGPoint(x: 0.5, y: flipped ? 1 : 0)
    fadeRamp.locations = [0, NSNumber(value: Double((edge - ramp + pad) / span)), NSNumber(value: Double((edge + pad) / span)), 1]
    guard fadePending, height > 0 else { return }
    fadePending = false
    runFade(fade, scale: (flipped ? 1 : -1) * height)
  }

  private func fadeColors(_ fade: CGFloat) -> [CGColor] {
    let opaque = NSColor.black.cgColor
    let floor = NSColor.black.withAlphaComponent(1 - fade).cgColor
    return [opaque, opaque, floor, floor]
  }

  private func runFade(_ fade: SurfaceFadeMask, scale: CGFloat) {
    var offsets = fade.offsetShares.map { $0 * scale }
    var fades = fade.fades
    if fadeRamp.animationKeys()?.isEmpty == false, let shown = fadeRamp.presentation() {
      if let moved = shown.value(forKeyPath: "transform.translation.y") as? NSNumber { offsets[0] = CGFloat(moved.doubleValue) }
      if let colors = shown.colors as? [CGColor], colors.count == 4 { fades[0] = 1 - colors[2].alpha }
    }
    fadeRamp.removeAllAnimations()
    fadeRamp.colors = fadeColors(fades[fades.count - 1])
    fadeRamp.setValue(offsets[offsets.count - 1], forKeyPath: "transform.translation.y")
    guard let total = fade.times.last, total > 0 else { return }
    let keyTimes = fade.times.map { NSNumber(value: $0 / total) }
    let move = CAKeyframeAnimation(keyPath: "transform.translation.y")
    move.values = offsets
    let tint = CAKeyframeAnimation(keyPath: "colors")
    tint.values = fades.map(fadeColors)
    for animation in [move, tint] {
      animation.keyTimes = keyTimes
      animation.duration = total
      animation.calculationMode = .linear
      animation.fillMode = .backwards
      fadeRamp.add(animation, forKey: animation.keyPath)
    }
  }

  private func applyBorder() {
    guard let layer else { return }
    plate.borderColor = surfaceBorderColor?.cgColor
    plate.borderWidth = surfaceBorderWidth
    let colors = effectiveBorderColors
    if colors.count >= 2, surfaceBorderWidth > 0 {
      let rect = drawRect
      let local = childBounds(rect)
      borderGradient.isHidden = false
      borderGradient.frame = rect
      borderGradient.colors = colors.map(\.cgColor)
      let flipped = layer.isGeometryFlipped || isFlipped
      borderGradient.startPoint = CGPoint(x: 0.5, y: flipped ? 0 : 1)
      borderGradient.endPoint = CGPoint(x: 0.5, y: flipped ? 1 : 0)
      let inset = surfaceBorderWidth / 2
      borderStroke.frame = local
      borderStroke.lineWidth = surfaceBorderWidth
      borderStroke.path = CGPath(
        roundedRect: local.insetBy(dx: inset, dy: inset),
        cornerWidth: max(surfaceRadius - inset, 0), cornerHeight: max(surfaceRadius - inset, 0), transform: nil)
      plate.borderWidth = 0
    } else {
      borderGradient.isHidden = true
    }
  }
}
