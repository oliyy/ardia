import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

public class ExtensionPopupWindowModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaExtensionPopupWindow")

    View(ExtensionPopupWindowHost.self) {
      Events("onClose")
      Prop("shown") { (view: ExtensionPopupWindowHost, shown: Bool) in view.shown = shown }
      Prop("dark") { (view: ExtensionPopupWindowHost, dark: Bool) in view.dark = dark }
      Prop("title") { (view: ExtensionPopupWindowHost, title: String?) in view.title = title ?? "" }
    }
  }
}
