import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

final class FadeLabel: ExpoView {
  private enum FieldAnchor {
    case stretch
    case leading
    case trailing
  }

  private static let rightToLeftScalars: [ClosedRange<UInt32>] = [
    0x0590...0x08FF, 0xFB1D...0xFDFF, 0xFE70...0xFEFF, 0x10800...0x10FFF, 0x1E800...0x1EFFF,
  ]
  private static let bidiControlScalars: Set<UInt32> = [
    0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069,
  ]
  private static let crossfadeDuration: CFTimeInterval = 0.25
  private static let popResponse: CGFloat = 0.38
  private static let popDampingRatio: CGFloat = 0.62
  private static let popFromScale: CGFloat = 0.55
  private static let popFadeDuration: CFTimeInterval = 0.18

  private let field = NSTextField(labelWithString: "")
  private let label = FadeLabelText()
  private let fade = CAGradientLayer()
  private var fitting = NSSize.zero
  private var anchor = FieldAnchor.stretch
  private weak var measuredWindow: NSWindow?
  private var measuredScale: CGFloat = 0

  var text = "" {
    didSet {
      update()
      if text != oldValue {
        NSAccessibility.post(element: label, notification: .valueChanged)
      }
    }
  }
  var fontSize: Double = 13 { didSet { update() } }
  var weight = "regular" { didSet { update() } }
  var color: NSColor = .labelColor {
    didSet {
      if plainText {
        field.textColor = color
        label.needsDisplay = true
      } else {
        update()
      }
    }
  }
  var fadeWidth: Double = 24 { didSet { relayout() } }
  var letterSpacing: Double = 0 { didSet { if letterSpacing != oldValue { update() } } }
  var glyphs: [FadeLabelGlyph] = [] { didSet { if glyphs != oldValue { update() } } }
  var transitions = false

  private var committed: (text: String, images: [String])?
  private var poppingGlyphs: Set<Int> = []
  private var pops: [CALayer] = []
  private var popTurn = 0

  private var plainText: Bool { letterSpacing == 0 && glyphs.isEmpty }

  private var showsOnScreen: Bool { window != nil && !isHiddenOrHasHiddenAncestor && !visibleRect.isEmpty }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    wantsLayer = true
    clipsToBounds = true
    field.lineBreakMode = .byClipping
    field.maximumNumberOfLines = 1
    field.cell?.truncatesLastVisibleLine = false
    field.isSelectable = false
    label.field = field
    label.translatesAutoresizingMaskIntoConstraints = false
    label.autoresizingMask = []
    label.wantsLayer = true
    label.layerContentsRedrawPolicy = .onSetNeedsDisplay
    addSubview(label)
    fade.colors = [NSColor.black.cgColor, NSColor.black.cgColor, NSColor.clear.cgColor]
    fade.startPoint = CGPoint(x: 0, y: 0.5)
    fade.endPoint = CGPoint(x: 1, y: 0.5)
    update()
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    relayout()
  }

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    refresh()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    refresh()
  }

  private func refresh() {
    if let window, window !== measuredWindow || window.backingScaleFactor != measuredScale {
      measure()
    } else {
      relayout()
    }
  }

  private func update() {
    let weights: [String: NSFont.Weight] = [
      "light": .light, "regular": .regular, "medium": .medium, "semibold": .semibold, "bold": .bold,
    ]
    let font = NSFont.monospacedDigitSystemFont(ofSize: fontSize, weight: weights[weight] ?? .regular)
    field.font = font
    if plainText {
      field.stringValue = text
      field.textColor = color
      label.spokenText = text
    } else {
      let (attributed, spoken) = content(font, textColor: color) { !self.poppingGlyphs.contains($0) }
      field.attributedStringValue = attributed
      label.spokenText = spoken
    }
    label.needsDisplay = true
    measure()
  }

  private func content(_ font: NSFont, textColor: NSColor, showsGlyph: (Int) -> Bool) -> (NSAttributedString, String) {
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: textColor, .kern: letterSpacing]
    let attributed = NSMutableAttributedString()
    var spoken = ""
    for (index, part) in text.components(separatedBy: FadeLabelGlyph.placeholder).enumerated() {
      if index > 0, index <= glyphs.count {
        let glyph = glyphs[index - 1]
        if let mark = glyph.attachment(centeredOn: font, tint: color, visible: showsGlyph(index - 1)) { attributed.append(mark) }
        spoken += glyph.label
      }
      attributed.append(NSAttributedString(string: part, attributes: attributes))
      spoken += part
    }
    return (attributed, spoken)
  }

  func propsDidUpdate() {
    let images = glyphs.map(\.image)
    defer { committed = (text, images) }
    guard let before = committed, before.text != text || before.images != images else { return }
    endPops()
    guard transitions, showsOnScreen else { return }
    let crossfade = CATransition()
    crossfade.type = .fade
    crossfade.duration = Self.crossfadeDuration
    crossfade.timingFunction = CAMediaTimingFunction(name: .easeOut)
    layer?.add(crossfade, forKey: "contentFade")
    let fresh = Set(glyphs.indices.filter { !before.images.contains(glyphs[$0].image) })
    if !fresh.isEmpty { pop(fresh) }
  }

  private func endPops() {
    popTurn += 1
    guard !pops.isEmpty || !poppingGlyphs.isEmpty else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    pops.forEach { $0.removeFromSuperlayer() }
    CATransaction.commit()
    pops = []
    guard !poppingGlyphs.isEmpty else { return }
    poppingGlyphs = []
    update()
    label.displayIfNeeded()
  }

  private func pop(_ fresh: Set<Int>) {
    guard let window, let host = label.layer, let cell = field.cell?.copy() as? NSCell, let font = field.font else { return }
    let scale = window.backingScaleFactor
    let layers: [CALayer] = fresh.sorted().compactMap { index in
      cell.attributedStringValue = content(font, textColor: .clear) { $0 == index }.0
      guard let (image, rect) = Self.render(cell, in: label, scale: scale) else { return nil }
      let pop = CALayer()
      pop.contents = image
      pop.contentsScale = scale
      pop.frame = host.isGeometryFlipped ? rect : CGRect(x: rect.minX, y: label.bounds.height - rect.maxY, width: rect.width, height: rect.height)
      return pop
    }
    guard !layers.isEmpty else { return }
    poppingGlyphs = fresh
    update()
    let stiffness = pow(2 * .pi / Self.popResponse, 2)
    let spring = CASpringAnimation(keyPath: "transform.scale")
    spring.mass = 1
    spring.stiffness = stiffness
    spring.damping = 2 * Self.popDampingRatio * sqrt(stiffness)
    spring.fromValue = Self.popFromScale
    spring.toValue = 1
    spring.duration = spring.settlingDuration
    let appear = CABasicAnimation(keyPath: "opacity")
    appear.fromValue = 0
    appear.toValue = 1
    appear.duration = Self.popFadeDuration
    appear.timingFunction = CAMediaTimingFunction(name: .easeOut)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for pop in layers {
      host.addSublayer(pop)
      pop.add(spring, forKey: "pop")
      pop.add(appear, forKey: "appear")
    }
    CATransaction.commit()
    pops = layers
    let turn = popTurn
    DispatchQueue.main.asyncAfter(deadline: .now() + spring.settlingDuration) { [weak self] in
      guard let self, self.popTurn == turn else { return }
      self.endPops()
    }
  }

  private static func render(_ cell: NSCell, in view: NSView, scale: CGFloat) -> (CGImage, CGRect)? {
    let bounds = view.bounds
    let width = Int((bounds.width * scale).rounded(.up))
    let height = Int((bounds.height * scale).rounded(.up))
    guard width > 0, height > 0,
      let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    context.translateBy(x: 0, y: CGFloat(height))
    context.scaleBy(x: scale, y: -scale)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
    cell.draw(withFrame: bounds, in: view)
    NSGraphicsContext.restoreGraphicsState()
    guard let image = context.makeImage(), let data = context.data else { return nil }
    let stride = context.bytesPerRow
    let pixels = data.bindMemory(to: UInt8.self, capacity: stride * height)
    var minX = width, minY = height, maxX = -1, maxY = -1
    for y in 0..<height {
      for x in 0..<width where pixels[y * stride + x * 4 + 3] > 0 {
        minX = min(minX, x)
        maxX = max(maxX, x)
        minY = min(minY, y)
        maxY = max(maxY, y)
      }
    }
    guard maxX >= minX else { return nil }
    let crop = CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
    guard let cropped = image.cropping(to: crop) else { return nil }
    return (cropped, CGRect(x: bounds.minX + crop.minX / scale, y: bounds.minY + crop.minY / scale, width: crop.width / scale, height: crop.height / scale))
  }

  private func measure() {
    let scale = window?.backingScaleFactor ?? 1
    let cellSize = field.cell?.cellSize ?? .zero
    fitting = NSSize(width: Self.pixelCeil(cellSize.width, scale), height: Self.pixelCeil(cellSize.height, scale))
    anchor = Self.anchor(for: text, alignment: field.alignment, direction: field.userInterfaceLayoutDirection)
    measuredWindow = window
    measuredScale = window?.backingScaleFactor ?? 0
    relayout()
  }

  private static func pixelCeil(_ value: CGFloat, _ scale: CGFloat) -> CGFloat {
    (value * scale - 0.001).rounded(.up) / scale
  }

  private static func anchor(for text: String, alignment: NSTextAlignment, direction: NSUserInterfaceLayoutDirection) -> FieldAnchor {
    guard alignment == .natural else { return .stretch }
    var rightToLeft = false
    var leftToRightLetter = false
    for scalar in text.unicodeScalars {
      if bidiControlScalars.contains(scalar.value) { return .stretch }
      if rightToLeftScalars.contains(where: { $0.contains(scalar.value) }) {
        rightToLeft = true
      } else if scalar.properties.isAlphabetic {
        leftToRightLetter = true
      }
    }
    let defaultDirection = NSParagraphStyle.defaultWritingDirection(forLanguage: nil)
    if !rightToLeft {
      return direction == .leftToRight && defaultDirection == .leftToRight ? .leading : .stretch
    }
    return !leftToRightLetter && direction == .rightToLeft && defaultDirection == .rightToLeft ? .trailing : .stretch
  }

  private func relayout() {
    var x: CGFloat = 0
    var width = max(bounds.width, fitting.width)
    if fitting.width <= bounds.width {
      let slack = bounds.width - fitting.width
      let scale = window?.backingScaleFactor ?? 0
      if anchor == .leading {
        width = fitting.width
      } else if anchor == .trailing, scale > 0, (slack * scale).rounded() == slack * scale {
        x = slack
        width = fitting.width
      }
    }
    let frame = NSRect(x: x, y: (bounds.height - fitting.height) / 2, width: width, height: fitting.height)
    if label.frame.size != frame.size {
      label.needsDisplay = true
    }
    label.frame = frame
    guard bounds.width > 0, fitting.width > bounds.width + 0.5 else {
      label.layer?.mask = nil
      return
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    fade.frame = CGRect(x: 0, y: 0, width: bounds.width, height: label.frame.height)
    let start = max(0, 1 - fadeWidth / bounds.width)
    fade.locations = [0, NSNumber(value: start), 1]
    label.layer?.mask = fade
    CATransaction.commit()
  }
}

private enum FadeLabelSystemStyle {
  static var generation = 0
  static let watched: Void = {
    let bump: (Notification) -> Void = { _ in generation += 1 }
    _ = NotificationCenter.default.addObserver(forName: NSColor.systemColorsDidChangeNotification, object: nil, queue: nil, using: bump)
    _ = NSWorkspace.shared.notificationCenter.addObserver(
      forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil, queue: nil, using: bump)
  }()
}

private struct FadeLabelDrawingTraits: Equatable {
  let appearance: NSAppearance.Name
  let scale: CGFloat
  let colorSpace: NSColorSpace?
  let system: Int

  init(_ view: NSView) {
    _ = FadeLabelSystemStyle.watched
    appearance = view.effectiveAppearance.name
    scale = view.window?.backingScaleFactor ?? 0
    colorSpace = view.window?.colorSpace
    system = FadeLabelSystemStyle.generation
  }
}

private final class FadeLabelText: NSView {
  weak var field: NSTextField?
  var spokenText = ""
  private var drawnTraits: FadeLabelDrawingTraits?
  private var shownVisibleRect: NSRect?
  private var shownPixelPhase = NSPoint.zero

  override var isFlipped: Bool { true }

  override var visibleRect: NSRect {
    let host = superview.map { convert($0.bounds, from: $0) } ?? bounds
    return bounds.union(host).intersection(super.visibleRect)
  }

  override func makeBackingLayer() -> CALayer {
    let layer = super.makeBackingLayer()
    FadeLabelVisibleRectRepaint.adopt(layer)
    return layer
  }

  func noteShownVisibleRect() {
    let rect = visibleRect
    shownVisibleRect = rect
    shownPixelPhase = rect.isEmpty ? .zero : pixelPhase()
  }

  func showsSameVisibleRect() -> Bool {
    let rect = visibleRect
    guard let shown = shownVisibleRect, NSEqualRects(rect, shown) else { return false }
    return rect.isEmpty || pixelPhase() == shownPixelPhase
  }

  private func pixelPhase() -> NSPoint {
    let scale = window?.backingScaleFactor ?? 1
    let origin = convert(NSPoint.zero, to: nil)
    return NSPoint(x: origin.x * scale - (origin.x * scale).rounded(.down), y: origin.y * scale - (origin.y * scale).rounded(.down))
  }

  override var allowsVibrancy: Bool { field?.allowsVibrancy ?? false }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  override func draw(_ dirtyRect: NSRect) {
    drawnTraits = FadeLabelDrawingTraits(self)
    guard let field, let cell = field.cell else { return }
    cell.draw(withFrame: bounds, in: self)
    cell.controlView = field
  }

  override func viewDidChangeEffectiveAppearance() {
    super.viewDidChangeEffectiveAppearance()
    redrawIfTraitsChanged()
  }

  override func viewDidChangeBackingProperties() {
    super.viewDidChangeBackingProperties()
    redrawIfTraitsChanged()
  }

  private func redrawIfTraitsChanged() {
    if window != nil, FadeLabelDrawingTraits(self) != drawnTraits {
      needsDisplay = true
    }
  }

  override func isAccessibilityElement() -> Bool { true }

  override func accessibilityRole() -> NSAccessibility.Role? { .staticText }

  override func accessibilityValue() -> Any? { spokenText }

  override func accessibilityFrame() -> NSRect {
    NSAccessibility.screenRect(fromView: self, rect: bounds.insetBy(dx: 1, dy: -1))
  }
}

private enum FadeLabelVisibleRectRepaint {
  private typealias LayerMethod = @convention(c) (CALayer, Selector) -> Void
  private typealias TransactionPhase = @convention(c) (AnyClass, Selector) -> Int32
  private typealias TransactionState = @convention(c) (AnyClass, Selector) -> UInt32
  private typealias TransactionActivate = @convention(c) (AnyClass, Selector) -> Void
  private typealias TransactionCommitHandler = @convention(c) (AnyClass, Selector, @escaping @convention(block) () -> Void, Int32) -> Bool

  private static let outsideCommitPhase: Int32 = -1
  private static let preLayoutPhase: Int32 = 0
  private static let appKitLayoutPhase: Int32 = 4
  private static let openTransactionStates: UInt32 = 3
  private static let implicitTransactionState: UInt32 = 1
  private static let explicitTransactionState: UInt32 = 2
  private static let committingState: UInt32 = 8
  private static let recoveryDelay: CFAbsoluteTime = 0.1
  private static let parkedDelay: CFAbsoluteTime = 1e9
  private static let longestImplicitWait: CFTimeInterval = 1
  private static let longestSuspension: CFTimeInterval = 32

  private static let changeSelector = NSSelectorFromString("NS_viewVisibleRectDidChange")
  private static let displaySelector = #selector(CALayer.display)
  private static let currentPhase = transactionMethod("currentPhase", "i16@0:8", TransactionPhase.self)
  private static let currentState = transactionMethod("currentState", "I16@0:8", TransactionState.self)
  private static let activate = transactionMethod("activate", "v16@0:8", TransactionActivate.self)
  private static let addCommitHandler = transactionMethod("addCommitHandler:forPhase:", "B28@0:8@?16i24", TransactionCommitHandler.self)
  private static let supported = ProcessInfo.processInfo.isOperatingSystemAtLeast(OperatingSystemVersion(majorVersion: 27, minorVersion: 0, patchVersion: 0))
    && currentPhase != nil && currentState != nil && activate != nil && addCommitHandler != nil

  private static var base: AnyClass?
  private static var adopted: AnyClass?
  private static var subclassAttempted = false
  private static let pending = NSHashTable<CALayer>.weakObjects()
  private static var flushScheduled = false
  private static var disabled = false
  private static var recoveryTimer: CFRunLoopTimer?
  private static var scheduledAt: CFTimeInterval = 0
  private static var suspendedUntil: CFTimeInterval = 0
  private static var suspension: CFTimeInterval = 1

  static func adopt(_ layer: CALayer) {
    guard supported, let cls = object_getClass(layer), let adopted = subclass(of: cls) else { return }
    object_setClass(layer, adopted)
  }

  private static func transactionMethod<Function>(_ name: String, _ types: String, _ type: Function.Type) -> (call: Function, selector: Selector)? {
    let selector = NSSelectorFromString(name)
    guard let method = class_getClassMethod(CATransaction.self, selector), let encoding = method_getTypeEncoding(method),
          String(cString: encoding) == types
    else { return nil }
    return (unsafeBitCast(method_getImplementation(method), to: type), selector)
  }

  private static func subclass(of cls: AnyClass) -> AnyClass? {
    if subclassAttempted {
      guard let base, ObjectIdentifier(base) == ObjectIdentifier(cls) else { return nil }
      return adopted
    }
    subclassAttempted = true
    let takesNoArguments = { (method: Method?) in method.flatMap(method_getTypeEncoding).map { String(cString: $0) } == "v16@0:8" }
    guard takesNoArguments(class_getInstanceMethod(cls, changeSelector)), takesNoArguments(class_getInstanceMethod(cls, displaySelector)),
          let made = objc_allocateClassPair(cls, "ArdiaFadeLabelTextLayer", 0)
    else { return nil }
    let change: @convention(block) (CALayer) -> Void = { layer in visibleRectDidChange(layer) }
    let display: @convention(block) (CALayer) -> Void = { layer in
      callBase(layer, displaySelector)
      (layer.delegate as AnyObject? as? FadeLabelText)?.noteShownVisibleRect()
    }
    class_addMethod(made, changeSelector, imp_implementationWithBlock(change), "v@:")
    class_addMethod(made, displaySelector, imp_implementationWithBlock(display), "v@:")
    objc_registerClassPair(made)
    base = cls
    adopted = made
    return made
  }

  private static func callBase(_ layer: CALayer, _ selector: Selector) {
    guard let base, let imp = class_getMethodImplementation(base, selector) else { return }
    unsafeBitCast(imp, to: LayerMethod.self)(layer, selector)
  }

  private static func visibleRectDidChange(_ layer: CALayer) {
    if Thread.isMainThread, !disabled, inWindow(layer), CACurrentMediaTime() >= suspendedUntil,
       flushScheduled ? joinable() : deferrable() && scheduleFlush() {
      pending.add(layer)
    } else {
      callBase(layer, changeSelector)
    }
  }

  private static func inWindow(_ layer: CALayer) -> Bool {
    (layer.delegate as AnyObject? as? FadeLabelText)?.window != nil
  }

  private static func joinable() -> Bool {
    guard let currentPhase, let currentState else { return false }
    let phase = currentPhase.call(CATransaction.self, currentPhase.selector)
    if phase == preLayoutPhase || phase == appKitLayoutPhase { return true }
    return phase == outsideCommitPhase && currentState.call(CATransaction.self, currentState.selector) & committingState == 0
  }

  private static func deferrable() -> Bool {
    guard let currentPhase, let currentState, let activate else { return false }
    let phase = currentPhase.call(CATransaction.self, currentPhase.selector)
    if phase == appKitLayoutPhase { return true }
    let state = currentState.call(CATransaction.self, currentState.selector)
    guard phase == outsideCommitPhase, state & committingState == 0 else { return false }
    if state & openTransactionStates == 0 {
      activate.call(CATransaction.self, activate.selector)
    }
    return true
  }

  private static func scheduleFlush() -> Bool {
    guard let addCommitHandler else { return false }
    flushScheduled = addCommitHandler.call(CATransaction.self, addCommitHandler.selector, { flush() }, preLayoutPhase)
    if flushScheduled {
      scheduledAt = CACurrentMediaTime()
      setRecoveryTimer(after: recoveryDelay)
    }
    return flushScheduled
  }

  private static func setRecoveryTimer(after delay: CFAbsoluteTime) {
    if recoveryTimer == nil {
      let timer = CFRunLoopTimerCreateWithHandler(kCFAllocatorDefault, CFAbsoluteTimeGetCurrent() + parkedDelay, parkedDelay, 0, 0) { _ in
        recoverIfStillPending()
      }
      CFRunLoopAddTimer(CFRunLoopGetMain(), timer, .commonModes)
      recoveryTimer = timer
    }
    if let recoveryTimer {
      CFRunLoopTimerSetNextFireDate(recoveryTimer, CFAbsoluteTimeGetCurrent() + delay)
    }
  }

  private static func recoverIfStillPending() {
    guard flushScheduled, let currentState else { return }
    if ownerMayStillCommit(currentState.call(CATransaction.self, currentState.selector)) {
      setRecoveryTimer(after: recoveryDelay)
      return
    }
    suspendedUntil = CACurrentMediaTime() + suspension
    suspension = min(suspension * 2, longestSuspension)
    flushScheduled = false
    setRecoveryTimer(after: parkedDelay)
    let layers = pending.allObjects
    pending.removeAllObjects()
    for layer in layers {
      callBase(layer, changeSelector)
    }
  }

  private static func ownerMayStillCommit(_ state: UInt32) -> Bool {
    if state & (explicitTransactionState | committingState) != 0 { return true }
    return state & implicitTransactionState != 0 && CACurrentMediaTime() - scheduledAt < longestImplicitWait
  }

  private static func flush() {
    flushScheduled = false
    setRecoveryTimer(after: parkedDelay)
    if inPreLayoutPhase() {
      suspension = 1
    } else {
      disabled = true
    }
    let layers = pending.allObjects
    pending.removeAllObjects()
    for layer in layers where disabled || !inWindow(layer) || (layer.delegate as AnyObject? as? FadeLabelText)?.showsSameVisibleRect() != true {
      callBase(layer, changeSelector)
    }
  }

  private static func inPreLayoutPhase() -> Bool {
    guard let currentPhase, let currentState else { return false }
    return currentPhase.call(CATransaction.self, currentPhase.selector) == preLayoutPhase
      && currentState.call(CATransaction.self, currentState.selector) & committingState != 0
  }
}
