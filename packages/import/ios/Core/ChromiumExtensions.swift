import Foundation

public struct ImportedExtension: Codable, Equatable, Sendable {
  public var id: String
  public var name: String
  public var webStoreUrl: String
  public var source: String
  public var enabled: Bool
  public var incognito: Bool
  public var pinned: Bool
  public var needsApproval: Bool
}

public enum ChromiumExtensions {
  static let uBlockOrigin = "cjpalhdlnbpafiamejdnhcphjbkeiagm"
  static let uBlockOriginLite = "ddkjiahejlhfcafbddmgiahcphecmpfh"
  static let notOffered: Set<String> = [uBlockOrigin, uBlockOriginLite]

  public static func list(profile: URL) -> [ImportedExtension] {
    var settings: [String: Any] = [:]
    var pinned: Set<String> = []
    for file in ["Preferences", "Secure Preferences"] {
      guard let data = try? Data(contentsOf: profile.appendingPathComponent(file)),
            let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let extensions = root["extensions"] as? [String: Any] else { continue }
      pinned.formUnion(extensions["pinned_extensions"] as? [String] ?? [])
      guard let found = extensions["settings"] as? [String: Any] else { continue }
      settings.merge(found) { old, new in
        guard var a = old as? [String: Any], let b = new as? [String: Any] else { return new }
        a.merge(b) { $1 }
        return a
      }
    }
    var out: [ImportedExtension] = []
    for (id, value) in settings {
      guard isExtensionId(id), !notOffered.contains(id), let entry = value as? [String: Any],
            entry["was_installed_by_default"] as? Bool != true, let source = source(entry) else { continue }
      out.append(ImportedExtension(id: id, name: name(id: id, entry: entry, profile: profile) ?? id,
                                   webStoreUrl: "https://chromewebstore.google.com/detail/\(id)",
                                   source: source, enabled: enabled(entry),
                                   incognito: entry["incognito"] as? Bool ?? false, pinned: pinned.contains(id),
                                   needsApproval: disabledByBrowser(entry)))
    }
    return out.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
  }

  static func source(_ entry: [String: Any]) -> String? {
    let location = entry["location"] as? Int ?? 1
    switch location {
    case 5, 10: return nil
    case 4, 8: return "unpacked"
    case 7, 9: return "policy"
    case 1, 6: return entry["from_webstore"] as? Bool == true ? "webStore" : "sideloaded"
    default: return "sideloaded"
    }
  }

  static let userAction = 1

  static func enabled(_ entry: [String: Any]) -> Bool {
    if let mask = entry["disable_reasons"] as? Int { return mask & userAction == 0 }
    if let reasons = entry["disable_reasons"] as? [Int] { return !reasons.contains(userAction) }
    return entry["state"] as? Int != 0
  }

  static func disabledByBrowser(_ entry: [String: Any]) -> Bool {
    if let mask = entry["disable_reasons"] as? Int { return mask & ~userAction != 0 }
    if let reasons = entry["disable_reasons"] as? [Int] { return reasons.contains { $0 != userAction } }
    return false
  }

  static func isExtensionId(_ id: String) -> Bool {
    id.count == 32 && id.allSatisfy { ("a"..."p").contains($0) }
  }

  static func name(id: String, entry: [String: Any], profile: URL) -> String? {
    var manifest = entry["manifest"] as? [String: Any]
    var dir: URL?
    if let path = entry["path"] as? String, !path.hasPrefix("/"), !path.contains("..") {
      let folder = profile.appendingPathComponent("Extensions").appendingPathComponent(path, isDirectory: true)
      dir = folder
      if manifest == nil, let data = try? Data(contentsOf: folder.appendingPathComponent("manifest.json")) {
        manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      }
    }
    guard let raw = (manifest?["name"] as? String)?.trimmingCharacters(in: .whitespaces), !raw.isEmpty else { return nil }
    guard raw.hasPrefix("__MSG_"), raw.hasSuffix("__") else { return raw }
    let key = String(raw.dropFirst(6).dropLast(2)).lowercased()
    guard let dir, let locale = manifest?["default_locale"] as? String,
          let data = try? Data(contentsOf: dir.appendingPathComponent("_locales/\(locale)/messages.json")),
          let messages = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    let match = messages.first { $0.key.lowercased() == key }?.value as? [String: Any]
    return (match?["message"] as? String).flatMap { $0.isEmpty ? nil : $0 }
  }
}
