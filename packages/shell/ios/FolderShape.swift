import AppKit
import ExpoModulesCore
import React

enum FolderMark: Equatable {
  case dots
  case symbol(String)
  case image(String)
  case emoji(String)

  private static let maxEmojiLength = 32

  init?(_ value: [String: Any]) {
    switch value["kind"] as? String {
    case "dots":
      self = .dots
    case "symbol":
      guard let name = value["name"] as? String, !name.isEmpty else { return nil }
      self = .symbol(name)
    case "image":
      guard let uri = value["uri"] as? String, !uri.isEmpty else { return nil }
      self = .image(uri)
    case "emoji":
      guard let text = value["text"] as? String, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        text.utf16.count <= Self.maxEmojiLength
      else { return nil }
      self = .emoji(text)
    default:
      return nil
    }
  }
}

final class FolderShape: ExpoView {
  var frontColor: NSColor? { didSet { applyColors() } }
  var frontExtendedColor: NSColor? { didSet { applyColors() } }
  var backColor: NSColor? { didSet { applyColors() } }
  var strokeColor: NSColor? { didSet { applyColors() } }
  var isOpen = false {
    didSet {
      let animated = receivedOpen
      receivedOpen = true
      guard isOpen != oldValue else { return }
      applyState(animated: animated)
    }
  }
  var mark: FolderMark? {
    didSet {
      guard mark != oldValue else { return }
      resetMark()
      resolveMark()
    }
  }

  private static let side: CGFloat = 17
  private static let loopbackHosts: Set<String> = ["localhost", "127.0.0.1", "::1"]

  private let artwork = CALayer()
  private let back = CAShapeLayer()
  private let backShade = CAGradientLayer()
  private let backShadeMask = CAShapeLayer()
  private let front = CALayer()
  private let frontPath = CAShapeLayer()
  private let frontShade = CAGradientLayer()
  private let markLayer = CALayer()
  private let markMask = CALayer()
  private var receivedOpen = false
  private var markSource: NSImage?
  private var markGeneration = 0
  private var markLoading = false
  private var cancelMarkLoad: (() -> Void)?

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    artwork.addSublayer(back)
    backShade.colors = [NSColor.black.withAlphaComponent(0).cgColor, NSColor.black.withAlphaComponent(0.36).cgColor]
    backShade.locations = [0, 1]
    backShade.startPoint = .zero
    backShade.endPoint = CGPoint(x: 0.6, y: 1)
    backShade.opacity = 0
    backShade.mask = backShadeMask
    back.addSublayer(backShade)
    artwork.addSublayer(front)
    front.addSublayer(frontPath)
    frontShade.colors = [NSColor.black.withAlphaComponent(0).cgColor, NSColor.black.withAlphaComponent(0.15).cgColor]
    frontShade.locations = [0, 1]
    frontShade.startPoint = CGPoint(x: 0.1, y: 0)
    frontShade.endPoint = CGPoint(x: 0.9, y: 1)
    frontShade.opacity = 0
    frontShade.masksToBounds = true
    frontPath.addSublayer(frontShade)
    markLayer.mask = markMask
    markMask.contentsGravity = .resizeAspect
    applyState(animated: false)
    applyColors()
  }

  deinit {
    cancelMarkLoad?()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }
  override func isAccessibilityElement() -> Bool { false }
  override func accessibilityChildren() -> [Any]? { [] }

  override func layout() {
    super.layout()
    layoutArtwork()
  }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    layoutArtwork()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    layoutArtwork()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    if window == nil {
      cancelMarkRequest()
    } else {
      loadMarkImage()
    }
    layoutArtwork()
  }

  private func applyState(animated: Bool) {
    CATransaction.begin()
    CATransaction.setDisableActions(!animated)
    var base = CATransform3DIdentity
    base.m34 = -1.0 / 350.0
    let shift: CGFloat = isOpen ? 3 : 0
    let yaw: CGFloat = isOpen ? 32 : 0
    back.transform = Self.tilted(base, shift: shift, yaw: yaw, pitch: isOpen ? 28 : 0)
    front.transform = Self.tilted(base, shift: shift, yaw: yaw, pitch: isOpen ? -30 : 0)
    frontShade.opacity = isOpen ? 1 : 0
    backShade.opacity = isOpen ? 1 : 0.2
    markLayer.opacity = 1
    CATransaction.commit()
  }

  private func applyColors() {
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    let stroke = strokeColor?.cgColor
    back.strokeColor = stroke
    back.fillColor = backColor?.cgColor
    frontPath.strokeColor = stroke
    frontPath.fillColor = (frontExtendedColor ?? frontColor)?.cgColor
    backShadeMask.fillColor = NSColor.white.cgColor
    markLayer.backgroundColor = stroke
    CATransaction.commit()
  }

  private func layoutArtwork() {
    guard let layer else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    if artwork.superlayer !== layer { layer.addSublayer(artwork) }
    artwork.isGeometryFlipped = !isFlipped
    artwork.frame = CGRect(x: bounds.midX - Self.side / 2, y: bounds.midY - Self.side / 2, width: Self.side, height: Self.side)
    let scale = window?.backingScaleFactor ?? 1
    let area = artwork.bounds
    let radius = (area.width / 7).rounded()
    let stroke = (scale * 1.25).rounded() / scale
    back.frame = area
    back.anchorPoint = CGPoint(x: 0, y: 1)
    back.position = CGPoint(x: area.minX, y: area.maxY)
    back.lineWidth = stroke
    let tab = (scale * (area.height * 0.25).rounded()).rounded() / scale
    let rise = (tab / 1.5).rounded(.down)
    let tabEnd = (scale * area.width * 0.42).rounded() / scale
    let slopeEnd = (scale * area.width * 0.58).rounded() / scale
    back.path = Self.backPath(width: area.width, height: area.height, radius: radius, rise: rise, tabEnd: tabEnd, slopeEnd: slopeEnd)
    backShade.frame = back.bounds
    backShadeMask.frame = backShade.bounds
    backShadeMask.path = back.path
    let face = CGRect(x: area.minX, y: area.minY + tab, width: area.width, height: area.height - tab)
    front.frame = face
    front.anchorPoint = CGPoint(x: 0, y: 1)
    front.position = CGPoint(x: area.minX, y: area.maxY)
    frontPath.frame = front.bounds
    frontPath.lineWidth = stroke
    frontPath.path = Self.convertedPath(
      NSBezierPath(roundedRect: CGRect(x: 0, y: 0, width: face.width, height: face.height), xRadius: radius, yRadius: radius))
    frontShade.frame = frontPath.bounds
    frontShade.cornerRadius = radius
    let panel = frontPath.bounds
    let markSide = min(panel.width - 2.5, panel.height - 2.5)
    markLayer.frame = CGRect(x: panel.midX - markSide / 2, y: panel.midY - markSide / 2, width: markSide, height: markSide)
    markMask.frame = markLayer.bounds
    CATransaction.commit()
  }

  private func resetMark() {
    cancelMarkRequest()
    markSource = nil
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    markMask.contents = nil
    CATransaction.commit()
  }

  private func cancelMarkRequest() {
    cancelMarkLoad?()
    cancelMarkLoad = nil
    markGeneration += 1
    markLoading = false
  }

  private func resolveMark() {
    switch mark {
    case .dots:
      showMark(
        NSImage(systemSymbolName: "ellipsis", accessibilityDescription: nil)?
          .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: 11.5, weight: .bold)))
    case .symbol(let name):
      showMark(NSImage(systemSymbolName: name, accessibilityDescription: nil))
    case .image:
      loadMarkImage()
    case .emoji(let text):
      showMark(Self.emojiImage(text))
    case nil:
      break
    }
  }

  private static func emojiImage(_ text: String) -> NSImage {
    let side: CGFloat = 16
    let string = NSAttributedString(string: text, attributes: [.font: NSFont.systemFont(ofSize: side)])
    return NSImage(size: NSSize(width: side, height: side), flipped: false) { rect in
      let size = string.size()
      string.draw(at: NSPoint(x: (rect.width - size.width) / 2, y: (rect.height - size.height) / 2))
      return true
    }
  }

  private func showMark(_ image: NSImage?) {
    guard let image else { return }
    markSource = image
    var rect = CGRect(origin: .zero, size: image.size)
    let contents = image.cgImage(forProposedRect: &rect, context: nil, hints: nil)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    markMask.contents = contents
    CATransaction.commit()
    guard markLayer.superlayer !== frontPath else { return }
    frontPath.insertSublayer(markLayer, at: 0)
    applyState(animated: false)
    needsLayout = true
    needsDisplay = true
  }

  private func loadMarkImage() {
    guard window != nil, markSource == nil, !markLoading, case .image(let uri)? = mark, let url = Self.permittedMarkURL(uri),
      let loader = appContext?.reactBridge?.module(forName: "ImageLoader", lazilyLoadIfNecessary: true) as? RCTImageLoaderProtocol
    else { return }
    markLoading = true
    let token = markGeneration
    let requested = mark
    cancelMarkLoad = loader.loadImage(with: URLRequest(url: url)) { [weak self] _, image in
      DispatchQueue.main.async { self?.markLoaded(image, mark: requested, token: token) }
    }
  }

  private func markLoaded(_ image: NSImage?, mark requested: FolderMark?, token: Int) {
    guard token == markGeneration, requested == mark, window != nil else { return }
    cancelMarkLoad = nil
    markLoading = false
    showMark(image)
  }

  private static func tilted(_ base: CATransform3D, shift: CGFloat, yaw: CGFloat, pitch: CGFloat) -> CATransform3D {
    let moved = CATransform3DTranslate(base, shift, 0, 0)
    let turned = CATransform3DRotate(moved, yaw * .pi / 180, 0, 1, 0)
    return CATransform3DRotate(turned, pitch * .pi / 180, 1, 0, 0)
  }

  private static func backPath(width w: CGFloat, height h: CGFloat, radius r: CGFloat, rise: CGFloat, tabEnd: CGFloat, slopeEnd: CGFloat)
    -> CGPath
  {
    let bezier = NSBezierPath()
    bezier.move(to: NSPoint(x: r, y: 0))
    bezier.line(to: NSPoint(x: tabEnd, y: 0))
    bezier.line(to: NSPoint(x: slopeEnd, y: rise))
    bezier.line(to: NSPoint(x: w - r, y: rise))
    bezier.appendArc(withCenter: NSPoint(x: w - r, y: r + rise), radius: r, startAngle: 270, endAngle: 0, clockwise: false)
    bezier.line(to: NSPoint(x: w, y: h - r))
    bezier.appendArc(withCenter: NSPoint(x: w - r, y: h - r), radius: r, startAngle: 0, endAngle: 90, clockwise: false)
    bezier.line(to: NSPoint(x: r, y: h))
    bezier.appendArc(withCenter: NSPoint(x: r, y: h - r), radius: r, startAngle: 90, endAngle: 180, clockwise: false)
    bezier.line(to: NSPoint(x: 0, y: r))
    bezier.appendArc(withCenter: NSPoint(x: r, y: r), radius: r, startAngle: 180, endAngle: 270, clockwise: false)
    bezier.close()
    return convertedPath(bezier)
  }

  private static func convertedPath(_ bezier: NSBezierPath) -> CGPath {
    let path = CGMutablePath()
    var points = [NSPoint](repeating: .zero, count: 3)
    for index in 0..<bezier.elementCount {
      switch bezier.element(at: index, associatedPoints: &points) {
      case .moveTo: path.move(to: points[0])
      case .lineTo: path.addLine(to: points[0])
      case .cubicCurveTo: path.addCurve(to: points[2], control1: points[0], control2: points[1])
      case .quadraticCurveTo: path.addQuadCurve(to: points[1], control: points[0])
      case .closePath: path.closeSubpath()
      @unknown default: break
      }
    }
    return path
  }

  private static func permittedMarkURL(_ uri: String) -> URL? {
    guard let url = URL(string: uri), let scheme = url.scheme?.lowercased() else { return nil }
    if scheme == "file" {
      let bundle = Bundle.main.bundleURL.standardizedFileURL.resolvingSymlinksInPath().pathComponents
      let resolved = url.standardizedFileURL.resolvingSymlinksInPath()
      let components = resolved.pathComponents
      return components.count > bundle.count && Array(components.prefix(bundle.count)) == bundle ? resolved : nil
    }
    #if DEBUG
      if scheme == "http", let host = url.host?.lowercased(), loopbackHosts.contains(host) { return url }
    #endif
    return nil
  }
}
