import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class PulseDot: ExpoView {
  private static let halfPeriod: CFTimeInterval = 0.9

  private let dot = CALayer()

  var color: NSColor = .labelColor { didSet { recolor() } }
  var pulsing = false { didSet { if pulsing != oldValue { syncPulse() } } }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    relayout()
    syncPulse()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    relayout()
    syncPulse()
  }

  override func viewDidHide() {
    super.viewDidHide()
    syncPulse()
  }

  override func viewDidUnhide() {
    super.viewDidUnhide()
    syncPulse()
  }

  override func updateTrackingAreas() {
    super.updateTrackingAreas()
    syncPulse()
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    recolor()
  }

  private func relayout() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if dot.superlayer !== layer { layer.addSublayer(dot) }
    let side = min(bounds.width, bounds.height)
    dot.bounds = CGRect(x: 0, y: 0, width: side, height: side)
    dot.position = CGPoint(x: bounds.midX, y: bounds.midY)
    dot.cornerRadius = side / 2
    CATransaction.commit()
    recolor()
  }

  private func recolor() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    effectiveAppearance.performAsCurrentDrawingAppearance { dot.backgroundColor = color.cgColor }
    CATransaction.commit()
  }

  private var onScreen: Bool {
    window != nil && !isHiddenOrHasHiddenAncestor && !bounds.intersection(visibleRect).isEmpty
  }

  private func syncPulse() {
    let wanted = pulsing && onScreen
    guard wanted != (dot.animation(forKey: "pulse") != nil) else { return }
    guard wanted else { return dot.removeAnimation(forKey: "pulse") }
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 1
    fade.toValue = 0.3
    let shrink = CABasicAnimation(keyPath: "transform.scale")
    shrink.fromValue = 1
    shrink.toValue = 0.8
    let pulse = CAAnimationGroup()
    pulse.animations = [fade, shrink]
    pulse.duration = Self.halfPeriod
    pulse.autoreverses = true
    pulse.repeatCount = .infinity
    pulse.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    dot.add(pulse, forKey: "pulse")
  }
}
