import AppKit
import ArdiaCore
import Carbon.HIToolbox
import ExpoModulesCore

public class ActivitySpinnerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaActivitySpinner")

    View(ActivitySpinner.self) {
      Prop("visible") { (view: ActivitySpinner, visible: Bool) in view.visible = visible }
      Prop("color") { (view: ActivitySpinner, hex: String?) in view.tint = hex.flatMap { RGBA(hex: $0)?.srgb } }
      Prop("period") { (view: ActivitySpinner, period: Double?) in view.period = period.flatMap { $0 > 0 ? $0 : nil } ?? ActivitySpinner.defaultPeriod }
    }
  }
}
