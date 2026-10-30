import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class ActivitySpinner: ExpoView {
  private static let appearDuration: CFTimeInterval = 0.18
  private static let hideDelay: TimeInterval = 0.25
  private static let disappearDuration: CFTimeInterval = 0.2
  private static let hiddenScale: CGFloat = 0.6
  static let defaultPeriod: CFTimeInterval = 1.88

  private let glyph = CALayer()
  private let track = CAShapeLayer()
  private let ring = CAShapeLayer()
  private var shown = false
  private var visibilityTurn = 0

  var visible = true {
    didSet {
      guard visible != oldValue else { return }
      visibilityTurn += 1
      if visible {
        appear()
      } else {
        let turn = visibilityTurn
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.hideDelay) { [weak self] in
          guard let self, self.visibilityTurn == turn else { return }
          self.disappear()
        }
      }
    }
  }
  var tint: NSColor? { didSet { if tint != oldValue { recolor() } } }
  var period = ActivitySpinner.defaultPeriod {
    didSet {
      guard period != oldValue, ring.animation(forKey: "activityRotation") != nil else { return }
      ring.removeAnimation(forKey: "activityRotation")
      spin()
    }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    for shape in [track, ring] {
      shape.fillColor = nil
      shape.lineWidth = 1.5
      glyph.addSublayer(shape)
    }
    ring.lineCap = .round
    ring.strokeStart = 0
    ring.strokeEnd = 0.72
    glyph.opacity = 0
    glyph.transform = CATransform3DMakeScale(Self.hiddenScale, Self.hiddenScale, 1)
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    relayout()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    relayout()
    if shown { spin() } else if visible { appear() }
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    recolor()
  }

  private func relayout() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if glyph.superlayer !== layer { layer.addSublayer(glyph) }
    glyph.bounds = bounds
    glyph.position = CGPoint(x: bounds.midX, y: bounds.midY)
    let path = CGPath(ellipseIn: bounds.insetBy(dx: 1.25, dy: 1.25), transform: nil)
    for shape in [track, ring] {
      shape.frame = bounds
      shape.path = path
    }
    CATransaction.commit()
    recolor()
  }

  private func recolor() {
    effectiveAppearance.performAsCurrentDrawingAppearance {
      let stroke = tint ?? .secondaryLabelColor
      track.strokeColor = stroke.withAlphaComponent(tint == nil ? 0.18 : 0.25).cgColor
      ring.strokeColor = stroke.cgColor
    }
  }

  private func appear() {
    guard !shown, window != nil else { return }
    shown = true
    spin()
    fade(to: 1, scale: 1, duration: Self.appearDuration, timing: .easeOut)
  }

  private func disappear() {
    guard shown else { return }
    shown = false
    CATransaction.begin()
    CATransaction.setCompletionBlock { [weak self] in
      guard let self, !self.shown else { return }
      self.ring.removeAnimation(forKey: "activityRotation")
    }
    fade(to: 0, scale: Self.hiddenScale, duration: Self.disappearDuration, timing: .easeIn)
    CATransaction.commit()
  }

  private func fade(to opacity: Float, scale: CGFloat, duration: CFTimeInterval, timing: CAMediaTimingFunctionName) {
    let current = glyph.presentation() ?? glyph
    let transform = CATransform3DMakeScale(scale, scale, 1)
    let changes: [(String, Any, Any)] = [
      ("opacity", current.opacity, opacity),
      ("transform", NSValue(caTransform3D: current.transform), NSValue(caTransform3D: transform)),
    ]
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    glyph.opacity = opacity
    glyph.transform = transform
    for (keyPath, from, to) in changes {
      let animation = CABasicAnimation(keyPath: keyPath)
      animation.fromValue = from
      animation.toValue = to
      animation.duration = duration
      animation.timingFunction = CAMediaTimingFunction(name: timing)
      animation.fillMode = .backwards
      glyph.add(animation, forKey: keyPath)
    }
    CATransaction.commit()
  }

  private func spin() {
    guard window != nil, ring.animation(forKey: "activityRotation") == nil else { return }
    let turn = CABasicAnimation(keyPath: "transform.rotation.z")
    turn.fromValue = 0
    turn.toValue = isFlipped ? 2 * Double.pi : -2 * Double.pi
    turn.duration = period
    turn.repeatCount = .infinity
    turn.timingFunction = CAMediaTimingFunction(name: .linear)
    turn.isRemovedOnCompletion = false
    ring.add(turn, forKey: "activityRotation")
  }
}
