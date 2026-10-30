import AppKit
import ArdiaCore
import Carbon.HIToolbox
import ExpoModulesCore

struct FadeLabelGlyph: Equatable {
  static let placeholder = "\u{FFFC}"
  private static var images: [String: NSImage] = [:]

  let image: String
  let color: NSColor?
  let label: String

  init(_ record: [String: Any]) {
    image = record["image"] as? String ?? ""
    color = (record["color"] as? String).flatMap { RGBA(hex: $0)?.srgb }
    label = record["label"] as? String ?? ""
  }

  func attachment(centeredOn font: NSFont, tint fallback: NSColor, visible: Bool = true) -> NSAttributedString? {
    guard let base = Self.load(image) else { return nil }
    let tint = color ?? fallback
    let size = base.size
    let tinted = NSImage(size: size, flipped: false) { rect in
      guard visible else { return true }
      base.draw(in: rect)
      tint.set()
      rect.fill(using: .sourceIn)
      return true
    }
    let attachment = NSTextAttachment()
    attachment.image = tinted
    attachment.bounds = NSRect(x: 0, y: (font.capHeight - size.height).rounded() / 2, width: size.width, height: size.height)
    return NSAttributedString(attachment: attachment)
  }

  private static func load(_ uri: String) -> NSImage? {
    if let image = images[uri] { return image }
    guard let url = URL(string: uri), let image = NSImage(contentsOf: url) else { return nil }
    images[uri] = image
    return image
  }
}
