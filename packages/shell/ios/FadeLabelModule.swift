import AppKit
import ArdiaCore
import Carbon.HIToolbox
import ExpoModulesCore

public class FadeLabelModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaFadeLabel")

    View(FadeLabel.self) {
      Prop("text") { (view: FadeLabel, v: String) in view.text = v }
      Prop("fontSize") { (view: FadeLabel, v: Double) in view.fontSize = v }
      Prop("weight") { (view: FadeLabel, v: String) in view.weight = v }
      Prop("color") { (view: FadeLabel, hex: String) in view.color = RGBA(hex: hex)?.srgb ?? .labelColor }
      Prop("fadeWidth") { (view: FadeLabel, v: Double) in view.fadeWidth = v }
      Prop("letterSpacing") { (view: FadeLabel, v: Double?) in view.letterSpacing = v.flatMap { $0.isFinite ? $0 : nil } ?? 0 }
      Prop("glyphs") { (view: FadeLabel, v: [[String: Any]]?) in view.glyphs = (v ?? []).map(FadeLabelGlyph.init) }
      Prop("transitions") { (view: FadeLabel, v: Bool?) in view.transitions = v ?? false }
      OnViewDidUpdateProps { (view: FadeLabel) in view.propsDidUpdate() }
    }
  }
}
