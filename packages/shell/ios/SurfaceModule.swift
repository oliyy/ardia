import AppKit
import ArdiaCore
import Carbon.HIToolbox
import ExpoModulesCore

public class SurfaceModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaSurface")

    View(Surface.self) {
      Prop("fill") { (view: Surface, hex: String?) in view.surfaceFill = hex.flatMap { RGBA(hex: $0)?.srgb } }
      Prop("cornerRadius") { (view: Surface, v: Double) in view.surfaceRadius = v }
      Prop("borderColor") { (view: Surface, hex: String?) in view.surfaceBorderColor = hex.flatMap { RGBA(hex: $0)?.srgb } }
      Prop("borderWidth") { (view: Surface, v: Double) in view.surfaceBorderWidth = v }
      Prop("borderColors") { (view: Surface, hexes: [String]?) in view.surfaceBorderColors = (hexes ?? []).compactMap { RGBA(hex: $0)?.srgb } }
      Prop("surfaceShadowColor") { (view: Surface, hex: String?) in view.surfaceShadowColor = hex.flatMap { RGBA(hex: $0)?.srgb } }
      Prop("surfaceShadowOpacity") { (view: Surface, v: Double) in view.surfaceShadowOpacity = v }
      Prop("surfaceShadowRadius") { (view: Surface, v: Double) in view.surfaceShadowRadius = v }
      Prop("surfaceShadowOffset") { (view: Surface, v: [Double]) in view.surfaceShadowOffset = v.count == 2 ? CGSize(width: v[0], height: v[1]) : .zero }
      Prop("cutout") { (view: Surface, v: [Double]?) in
        view.surfaceCutout = v.flatMap { $0.count == 3 && $0.allSatisfy(\.isFinite) && $0[2] > 0 ? $0 : nil }
      }
      Prop("inactiveOpacity") { (view: Surface, v: Double?) in
        view.surfaceInactiveOpacity = v.flatMap { $0.isFinite ? min(max($0, 0), 1) : nil }
      }
      Prop("inactiveFillOpacity") { (view: Surface, v: Double?) in
        view.surfaceInactiveFillOpacity = v.flatMap { $0.isFinite ? min(max($0, 0), 1) : nil }
      }
      Prop("inactiveBorderColors") { (view: Surface, hexes: [String]?) in
        let colors = hexes?.compactMap { RGBA(hex: $0)?.srgb } ?? []
        view.surfaceInactiveBorderColors = colors.count >= 2 && colors.count == hexes?.count ? colors : nil
      }
      Prop("hidesAccessibility") { (view: Surface, v: Bool?) in view.surfaceHidesAccessibility = v ?? false }
      Prop("refreshRasterOnRest") { (view: Surface, v: Bool?) in view.surfaceRefreshRasterOnRest = v ?? false }
      Prop("logicalWidth") { (view: Surface, v: Double?) in
        view.surfaceLogicalWidth = v.flatMap { $0.isFinite && $0 > 0 ? CGFloat($0) : nil }
      }
      Prop("fadeMask") { (view: Surface, v: [String: Any]?) in view.surfaceFadeMask = v.flatMap(SurfaceFadeMask.init) }
    }
  }
}
