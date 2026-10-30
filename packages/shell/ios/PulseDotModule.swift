import AppKit
import ArdiaCore
import Carbon.HIToolbox
import ExpoModulesCore

public class PulseDotModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaPulseDot")

    View(PulseDot.self) {
      Prop("color") { (view: PulseDot, hex: String) in view.color = RGBA(hex: hex)?.srgb ?? .labelColor }
      Prop("pulsing") { (view: PulseDot, pulsing: Bool) in view.pulsing = pulsing }
    }
  }
}
