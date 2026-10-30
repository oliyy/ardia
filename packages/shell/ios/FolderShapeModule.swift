import AppKit
import ArdiaCore
import Carbon.HIToolbox
import ExpoModulesCore

public class FolderShapeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaFolderShape")
    View(FolderShape.self) {
      Prop("front") { (view: FolderShape, hex: String?) in view.frontColor = hex.flatMap { RGBA(hex: $0)?.srgb } }
      Prop("frontExtendedSRGB") { (view: FolderShape, v: [Double]?) in
        view.frontExtendedColor = v.flatMap { rgb in
          rgb.count == 3 && rgb.allSatisfy({ $0.isFinite && abs($0) < 4 })
            ? NSColor(colorSpace: .extendedSRGB, components: rgb.map { CGFloat($0) } + [1], count: 4) : nil
        }
      }
      Prop("back") { (view: FolderShape, hex: String?) in view.backColor = hex.flatMap { RGBA(hex: $0)?.srgb } }
      Prop("stroke") { (view: FolderShape, hex: String?) in view.strokeColor = hex.flatMap { RGBA(hex: $0)?.srgb } }
      Prop("open") { (view: FolderShape, v: Bool?) in view.isOpen = v ?? false }
      Prop("mark") { (view: FolderShape, value: [String: Any]?) in view.mark = value.flatMap(FolderMark.init) }
    }
  }
}
