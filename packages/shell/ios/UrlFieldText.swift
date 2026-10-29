import AppKit
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
        view.color = value.flatMap(NSColor.init(hex:)) ?? .labelColor
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

  private let wrapper = NSView(frame: .zero)
  private let field = NSTextField(frame: .zero)
  private let gradient = CAGradientLayer()
  private var alignment = Alignment.leading
  private var hoverButtonsWidth: CGFloat = 0
  private var displayedText: String?

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    clipsToBounds = true
    field.maximumNumberOfLines = 1
    field.isEditable = false
    field.isSelectable = false
    field.isBordered = false
    field.backgroundColor = .clear
    field.drawsBackground = false
    field.lineBreakMode = .byClipping
    field.usesSingleLineMode = true
    field.focusRingType = .none
    field.refusesFirstResponder = true
    field.setAccessibilityElement(false)
    field.font = Self.loadedFont
    addSubview(wrapper)
    wrapper.addSubview(field)

    gradient.startPoint = CGPoint(x: 0, y: 0.5)
    gradient.endPoint = CGPoint(x: 1, y: 0.5)
  }

  required init?(coder: NSCoder) { nil }

  func commit(text: String, placeholder: String?, alignment: Alignment, color: NSColor, hoverButtonsWidth: CGFloat) {
    field.attributedStringValue = NSAttributedString(string: text, attributes: [.font: Self.loadedFont, .foregroundColor: color])
    field.placeholderAttributedString = placeholder.map { NSAttributedString(string: $0, attributes: [.foregroundColor: color, .font: Self.placeholderFont]) }
    displayedText = text.isEmpty ? placeholder.flatMap { $0.isEmpty ? nil : $0 } : text
    self.alignment = alignment
    self.hoverButtonsWidth = hoverButtonsWidth.isFinite && hoverButtonsWidth >= 0 ? hoverButtonsWidth : 0
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
    applyMask()
  }

  private func layoutField() {
    let size = field.intrinsicContentSize
    let height = size.height.isFinite ? max(0, size.height) : 0
    let wrapperWidth = max(0, bounds.width - Self.wrapperTrailingInset)
    wrapper.frame = backingAlignedRect(NSRect(x: 0, y: (bounds.height - height) / 2, width: wrapperWidth, height: height), options: .alignAllEdgesNearest)
    let fieldWidth = max(wrapper.bounds.width, size.width.isFinite ? size.width : 0)
    let x = alignment == .trailing ? wrapper.bounds.width - fieldWidth : 0
    field.frame = wrapper.backingAlignedRect(field.frame(forAlignmentRect: NSRect(x: x, y: 0, width: fieldWidth, height: wrapper.bounds.height)), options: .alignAllEdgesNearest)
  }

  private func applyMask() {
    let width = bounds.width
    let wrapperWidth = wrapper.frame.width
    let intrinsicWidth = field.intrinsicContentSize.width
    let overflow = wrapperWidth > 0 && intrinsicWidth.isFinite && wrapperWidth < intrinsicWidth
    let showLeft = alignment == .trailing && overflow
    let showRight = hoverButtonsWidth > 0 || (alignment == .leading && overflow)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    guard showLeft || showRight, width.isFinite, width > 0 else {
      layer?.mask = nil
      return
    }
    var locations: [NSNumber] = [0]
    var colors: [CGColor] = [Self.opaque]
    if showLeft {
      locations.append(NSNumber(value: Double(Self.fadeWidth / width)))
      colors.insert(Self.transparent, at: 0)
    }
    let offset = hoverButtonsWidth + Self.fadeOffsetGap
    if showRight, offset < width {
      let end = 1 - offset / width
      locations.append(contentsOf: [NSNumber(value: Double(end - Self.fadeWidth / width)), NSNumber(value: Double(end))])
      colors.append(contentsOf: [Self.opaque, Self.transparent])
    }
    gradient.frame = bounds
    gradient.locations = locations
    gradient.colors = colors
    layer?.mask = gradient
  }
}
