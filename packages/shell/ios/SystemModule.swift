import AppKit
import ArdiaCore
import ExpoModulesCore
import QuickLookThumbnailing
import ServiceManagement
import UniformTypeIdentifiers

public class SystemModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaSystem")

    Constant("backgroundInstance") { () -> Bool in LaunchConfig.shared.background }

    AsyncFunction("isDefaultBrowser") { () -> Bool in
      guard let probe = URL(string: "https://example.com"),
            let handler = NSWorkspace.shared.urlForApplication(toOpen: probe) else { return false }
      return handler.standardizedFileURL == Bundle.main.bundleURL.standardizedFileURL
    }.runOnQueue(.main)

    AsyncFunction("setAsDefaultBrowser") { (promise: Promise) in
      if LaunchConfig.shared.background {
        NSLog("ArdiaSystem: background instance, not setting the default browser")
        return promise.resolve(false)
      }
      let app = Bundle.main.bundleURL
      NSWorkspace.shared.setDefaultApplication(at: app, toOpenURLsWithScheme: "http") { error in
        guard error == nil else { return promise.resolve(false) }
        NSWorkspace.shared.setDefaultApplication(at: app, toOpenURLsWithScheme: "https") { _ in
          DispatchQueue.main.async {
            let handler = URL(string: "https://example.com").flatMap(NSWorkspace.shared.urlForApplication(toOpen:))
            promise.resolve(handler?.standardizedFileURL == app.standardizedFileURL)
          }
        }
      }
    }.runOnQueue(.main)

    AsyncFunction("launchAtLoginStatus") { () -> String in
      switch SMAppService.mainApp.status {
      case .enabled: return "enabled"
      case .requiresApproval: return "requiresApproval"
      case .notFound: return "notFound"
      default: return "notRegistered"
      }
    }.runOnQueue(.main)

    AsyncFunction("setLaunchAtLogin") { (enabled: Bool) in
      if LaunchConfig.shared.background {
        NSLog("ArdiaSystem: background instance, not changing launch at login")
        return
      }
      if enabled {
        try SMAppService.mainApp.register()
      } else {
        try SMAppService.mainApp.unregister()
      }
    }.runOnQueue(.main)

    Function("fileExists") { (path: String) -> Bool in FileManager.default.fileExists(atPath: path) }

    AsyncFunction("openFile") { (path: String) -> Bool in
      guard FileManager.default.fileExists(atPath: path) else { return false }
      if LaunchConfig.shared.background {
        NSLog("ArdiaSystem: background instance, not opening %@", path)
        return true
      }
      return NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }.runOnQueue(.main)

    AsyncFunction("revealFile") { (path: String) -> Bool in
      guard FileManager.default.fileExists(atPath: path) else { return false }
      if LaunchConfig.shared.background {
        NSLog("ArdiaSystem: background instance, not revealing %@", path)
        return true
      }
      NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
      return true
    }.runOnQueue(.main)

    AsyncFunction("moveToTrash") { (path: String) -> Bool in
      guard FileManager.default.fileExists(atPath: path) else { return false }
      do {
        try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: nil)
        return true
      } catch {
        return false
      }
    }.runOnQueue(.main)

    AsyncFunction("copyFile") { (path: String) -> Bool in
      guard FileManager.default.fileExists(atPath: path) else { return false }
      let url = URL(fileURLWithPath: path)
      let item = NSPasteboardItem()
      item.setString(url.absoluteString, forType: .fileURL)
      item.setString(url.lastPathComponent, forType: .string)
      if UTType(filenameExtension: url.pathExtension)?.conforms(to: .image) == true, let image = NSImage(contentsOf: url) {
        if let tiff = image.tiffRepresentation { item.setData(tiff, forType: .tiff) }
        if let png = NSBitmapImageRep(data: image.tiffRepresentation ?? Data())?.representation(using: .png, properties: [:]) {
          item.setData(png, forType: .png)
        }
      }
      if LaunchConfig.shared.background {
        NSLog("ArdiaSystem: background instance, not copying %@ (%@)", path, item.types.map(\.rawValue).joined(separator: ","))
        return true
      }
      NSPasteboard.general.clearContents()
      return NSPasteboard.general.writeObjects([item])
    }.runOnQueue(.main)

    AsyncFunction("fileOpenerName") { (path: String) -> String? in
      guard let app = NSWorkspace.shared.urlForApplication(toOpen: URL(fileURLWithPath: path)) else { return nil }
      let name = FileManager.default.displayName(atPath: app.path)
      return name.hasSuffix(".app") ? String(name.dropLast(4)) : name
    }.runOnQueue(.main)

    AsyncFunction("fileIcon") { (path: String, size: Double) -> String? in
      let icon = FileManager.default.fileExists(atPath: path)
        ? NSWorkspace.shared.icon(forFile: path)
        : NSWorkspace.shared.icon(for: .init(filenameExtension: (path as NSString).pathExtension) ?? .data)
      return icon.pngDataURL(points: CGFloat(size), scale: 2)
    }.runOnQueue(.main)

    AsyncFunction("fileThumbnail") { (path: String, size: Double, promise: Promise) in
      var info = stat()
      guard size.isFinite, (path as NSString).isAbsolutePath, lstat(path, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
            info.st_flags & UInt32(SF_DATALESS) == 0, FileManager.default.isReadableFile(atPath: path)
      else { return promise.resolve(nil) }
      let points = min(max(size, 16), 128)
      let limit = Int((points * 2).rounded(.up))
      let request = QLThumbnailGenerator.Request(
        fileAt: URL(fileURLWithPath: path), size: CGSize(width: points, height: points), scale: 2, representationTypes: .thumbnail)
      request.iconMode = false
      QLThumbnailGenerator.shared.generateBestRepresentation(for: request) { thumbnail, error in
        guard error == nil, let image = thumbnail?.cgImage, image.width > 0, image.height > 0, image.width <= limit, image.height <= limit,
              let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
        else { return promise.resolve(nil) }
        promise.resolve(png.pngDataURL)
      }
    }

    AsyncFunction("runningAppIcon") { (pid: Int, size: Double) -> String? in
      NSRunningApplication(processIdentifier: pid_t(pid))?.icon?.pngDataURL(points: CGFloat(size), scale: 2)
    }.runOnQueue(.main)

    Function("hapticTick") {
      DispatchQueue.main.async {
        NSHapticFeedbackManager.defaultPerformer.perform(.alignment, performanceTime: .now)
        HapticLog.note("alignment")
      }
    }

    AsyncFunction("setThinScrollBars") { (thin: Bool) in ThinScrollBars.set(thin) }.runOnQueue(.main)
  }
}
