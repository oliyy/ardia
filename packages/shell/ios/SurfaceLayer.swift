import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class SurfaceLayer: CALayer {
  private var requestedMask: CALayer?
  var heldMask: CALayer? { didSet { super.mask = heldMask ?? requestedMask } }

  override var mask: CALayer? {
    get { super.mask }
    set {
      requestedMask = newValue
      super.mask = heldMask ?? newValue
    }
  }

  override init() { super.init() }
  override init(layer: Any) { super.init(layer: layer) }
  required init?(coder: NSCoder) { super.init(coder: coder) }
}
