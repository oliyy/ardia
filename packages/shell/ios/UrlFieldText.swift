import AppKit
import ArdiaCore
import ExpoModulesCore

public class UrlFieldTextModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaUrlFieldText")

    View(UrlFieldText.self) {
      Prop("text") { (view: UrlFieldText, value: String?) in
        view.text = value ?? ""
      }
      Prop("placeholder") { (view: UrlFieldText, value: String?) in
        view.placeholder = value
      }
      Prop("alignment") { (view: UrlFieldText, value: String?) in
        view.alignment = value == "trailing" ? .trailing : .leading
      }
      Prop("color") { (view: UrlFieldText, value: String?) in
        view.color = value.flatMap { RGBA(hex: $0)?.srgb } ?? .labelColor
      }
      Prop("hoverButtonsWidth") { (view: UrlFieldText, value: Double?) in
        view.hoverButtonsWidth = value.flatMap { $0.isFinite && $0 >= 0 ? CGFloat($0) : nil } ?? 0
      }
      OnViewDidUpdateProps { (view: UrlFieldText) in
        view.propsDidUpdate()
      }
    }
  }
}

final class UrlFieldText: ExpoView {
  var text = ""
  var placeholder: String?
  var alignment = UrlFieldTextContent.Alignment.leading
  var color: NSColor = .labelColor
  var hoverButtonsWidth: CGFloat = 0

  private let content = UrlFieldTextContent(frame: .zero)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    content.frame = bounds
    content.autoresizingMask = [.width, .height]
    addSubview(content)
  }

  override func hitTest(_ point: NSPoint) -> NSView? { nil }

  func propsDidUpdate() {
    content.commit(text: text, placeholder: placeholder, alignment: alignment, color: color, hoverButtonsWidth: hoverButtonsWidth)
  }
}

final class UrlFieldTextContent: NSView {
  enum Alignment {
    case leading
    case trailing
  }

  private static let loadedFont = NSFont.systemFont(ofSize: 13, weight: .regular)
  private static let placeholderFont: NSFont = {
    let base = NSFont.systemFont(ofSize: 13)
    guard let family = base.familyName else { return base }
    return NSFontManager.shared.font(withFamily: family, traits: [], weight: 7, size: base.pointSize) ?? base
  }()
  private static let wrapperTrailingInset: CGFloat = 5
  private static let fadeWidth: CGFloat = 20
  private static let fadeOffsetGap: CGFloat = 5
  private static let opaque = NSColor.white.cgColor
  private static let transparent = NSColor.white.withAlphaComponent(0).cgColor
  private static let maskAnimationKey = "hoverButtons"
  private static let textFadeKey = "textFade"
  private static let maskDuration: CFTimeInterval = 0.15

  private let wrapper = NSView(frame: .zero)
  private let field = NSTextField(frame: .zero)
  private let previousField = NSTextField(frame: .zero)
  private let gradient = CAGradientLayer()
  private var alignment = Alignment.leading
  private var hoverButtonsWidth: CGFloat = 0
  private var animatesNextMask = false
  private var maskGeneration = 0
  private var pendingTextFade: NSAttributedString?
  private var textGeneration = 0
  private var displayedText: String?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    clipsToBounds = true
    for label in [field, previousField] {
      label.maximumNumberOfLines = 1
      label.isEditable = false
      label.isSelectable = false
      label.isBordered = false
      label.backgroundColor = .clear
      label.drawsBackground = false
      label.lineBreakMode = .byClipping
      label.usesSingleLineMode = true
      label.focusRingType = .none
      label.refusesFirstResponder = true
      label.setAccessibilityElement(false)
      label.font = Self.loadedFont
    }
    previousField.isHidden = true
    addSubview(wrapper)
    wrapper.addSubview(field)
    wrapper.addSubview(previousField)

    gradient.startPoint = CGPoint(x: 0, y: 0.5)
    gradient.endPoint = CGPoint(x: 1, y: 0.5)
  }

  required init?(coder: NSCoder) { nil }

  func commit(text: String, placeholder: String?, alignment: Alignment, color: NSColor, hoverButtonsWidth: CGFloat) {
    let shown = pendingTextFade ?? field.attributedStringValue
    if shown.string == text {
      pendingTextFade = nil
    } else if window != nil, Self.fades(from: shown.string, to: text) {
      pendingTextFade = shown
      animatesNextMask = true
    } else {
      pendingTextFade = nil
      cancelTextFade()
    }
    field.attributedStringValue = NSAttributedString(string: text, attributes: [.font: Self.loadedFont, .foregroundColor: color])
    field.placeholderAttributedString = placeholder.map { NSAttributedString(string: $0, attributes: [.foregroundColor: color, .font: Self.placeholderFont]) }
    displayedText = text.isEmpty ? placeholder.flatMap { $0.isEmpty ? nil : $0 } : text
    self.alignment = alignment
    let buttonsWidth = hoverButtonsWidth.isFinite && hoverButtonsWidth >= 0 ? hoverButtonsWidth : 0
    if buttonsWidth != self.hoverButtonsWidth, window != nil { animatesNextMask = true }
    self.hoverButtonsWidth = buttonsWidth
    field.invalidateIntrinsicContentSize()
    needsLayout = true
  }

  override func isAccessibilityElement() -> Bool { displayedText != nil }

  override func accessibilityRole() -> NSAccessibility.Role? { .staticText }

  override func accessibilityLabel() -> String? { displayedText }

  override func accessibilityValue() -> Any? { displayedText }

  override func accessibilityChildren() -> [Any]? { [] }

  override func setFrameSize(_ newSize: NSSize) {
    super.setFrameSize(newSize)
    needsLayout = true
  }

  override func layout() {
    super.layout()
    layoutField()
    startTextFade()
    applyMask()
  }

  private static func fades(from shown: String, to text: String) -> Bool {
    !shown.isEmpty && !text.isEmpty && shown != text && (text.hasPrefix(shown) || shown.hasPrefix(text))
  }

  private func layoutField() {
    let size = field.intrinsicContentSize
    let height = size.height.isFinite ? max(0, size.height) : 0
    let wrapperWidth = max(0, bounds.width - Self.wrapperTrailingInset)
    wrapper.frame = backingAlignedRect(NSRect(x: 0, y: (bounds.height - height) / 2, width: wrapperWidth, height: height), options: .alignAllEdgesNearest)
    place(field)
    if !previousField.isHidden { place(previousField) }
  }

  private func place(_ label: NSTextField) {
    let width = label.intrinsicContentSize.width
    let labelWidth = max(wrapper.bounds.width, width.isFinite ? width : 0)
    let x = alignment == .trailing ? wrapper.bounds.width - labelWidth : 0
    label.frame = wrapper.backingAlignedRect(label.frame(forAlignmentRect: NSRect(x: x, y: 0, width: labelWidth, height: wrapper.bounds.height)), options: .alignAllEdgesNearest)
  }

  private func startTextFade() {
    guard let previous = pendingTextFade else { return }
    pendingTextFade = nil
    guard let fieldLayer = field.layer, let previousLayer = previousField.layer else { return }
    let text = field.attributedStringValue.string
    let reversing = !previousField.isHidden && previousField.attributedStringValue.string == text
    let fieldShown = CGFloat(fieldLayer.presentation()?.opacity ?? fieldLayer.opacity)
    let previousShown = previousField.isHidden ? 0 : CGFloat(previousLayer.presentation()?.opacity ?? previousLayer.opacity)
    previousField.isHidden = false
    previousField.attributedStringValue = previous
    place(previousField)
    previousField.displayIfNeeded()
    let aligned = previousField.frame.minX == field.frame.minX
    let grows = aligned && text.hasPrefix(previous.string)
    let shrinks = aligned && previous.string.hasPrefix(text)
    if (wrapper.subviews.first === previousField) != grows {
      wrapper.addSubview(previousField, positioned: grows ? .below : .above, relativeTo: field)
    }
    textGeneration += 1
    let generation = textGeneration
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    CATransaction.setCompletionBlock { [weak self] in
      guard let self, self.textGeneration == generation else { return }
      self.endTextFade()
    }
    fieldLayer.mask = grows ? suffixMask(of: field, after: previous) : nil
    previousLayer.mask = shrinks ? suffixMask(of: previousField, after: field.attributedStringValue) : nil
    fade(field, from: reversing ? previousShown : shrinks ? 1 : 0, to: 1)
    fade(previousField, from: fieldShown, to: grows ? fieldShown : 0)
    CATransaction.commit()
  }

  private func suffixMask(of label: NSTextField, after prefix: NSAttributedString) -> CALayer {
    let start = (label.cell?.titleRect(forBounds: label.bounds).minX ?? 0) + prefix.size().width
    let mask = CALayer()
    mask.backgroundColor = Self.opaque
    mask.frame = CGRect(x: start, y: -label.bounds.height, width: max(0, label.bounds.width - start) + label.bounds.height, height: 3 * label.bounds.height)
    return mask
  }

  private func endTextFade() {
    previousField.isHidden = true
    field.layer?.mask = nil
    previousField.layer?.mask = nil
  }

  private func cancelTextFade() {
    textGeneration += 1
    endTextFade()
    for label in [field, previousField] { label.layer?.removeAnimation(forKey: Self.textFadeKey) }
    field.alphaValue = 1
  }

  private func fade(_ label: NSTextField, from: CGFloat, to: CGFloat) {
    label.alphaValue = to
    guard from != to else {
      label.layer?.removeAnimation(forKey: Self.textFadeKey)
      return
    }
    let animation = CABasicAnimation(keyPath: "opacity")
    animation.fromValue = from
    animation.toValue = to
    animation.duration = Self.maskDuration
    animation.timingFunction = CAMediaTimingFunction(name: .easeOut)
    label.layer?.add(animation, forKey: Self.textFadeKey)
  }

  private func applyMask() {
    let width = bounds.width
    let wrapperWidth = wrapper.frame.width
    let intrinsicWidth = field.intrinsicContentSize.width
    let overflow = wrapperWidth > 0 && intrinsicWidth.isFinite && wrapperWidth < intrinsicWidth
    let showLeft = alignment == .trailing && overflow
    let showRight = hoverButtonsWidth > 0 || (alignment == .leading && overflow)
    let animated = animatesNextMask
    animatesNextMask = false
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    let animating = layer?.mask === gradient && gradient.animation(forKey: Self.maskAnimationKey) != nil
    guard width.isFinite, width > 0, showLeft || showRight || animated || animating else {
      layer?.mask = nil
      return
    }
    let fade = Self.fadeWidth / width
    let end = max(0, 1 - (hoverButtonsWidth + Self.fadeOffsetGap) / width)
    let leftInner = min(fade, end)
    let locations = [0, leftInner, max(leftInner, end - fade), end].map { NSNumber(value: Double($0)) }
    let colors = [showLeft ? Self.transparent : Self.opaque, Self.opaque, Self.opaque, showRight ? Self.transparent : Self.opaque]
    let attached = layer?.mask === gradient
    let shown = attached ? gradient.presentation() ?? gradient : nil
    let fromLocations = shown?.locations ?? locations
    let fromColors = (shown?.colors as? [CGColor]) ?? [Self.opaque, Self.opaque, Self.opaque, Self.opaque]
    gradient.frame = bounds
    gradient.locations = locations
    gradient.colors = colors
    layer?.mask = gradient
    guard animated, fromLocations.count == locations.count, fromColors.count == colors.count else { return }
    maskGeneration += 1
    let generation = maskGeneration
    let timing = CAMediaTimingFunction(name: .easeOut)
    let slide = CABasicAnimation(keyPath: "locations")
    slide.fromValue = fromLocations
    slide.toValue = locations
    let tint = CABasicAnimation(keyPath: "colors")
    tint.fromValue = fromColors
    tint.toValue = colors
    let group = CAAnimationGroup()
    group.animations = [slide, tint]
    group.duration = Self.maskDuration
    group.timingFunction = timing
    CATransaction.setCompletionBlock { [weak self] in
      guard let self, self.maskGeneration == generation else { return }
      self.needsLayout = true
    }
    gradient.add(group, forKey: Self.maskAnimationKey)
  }
}
