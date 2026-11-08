import AppKit
import ExpoModulesCore
import NaturalLanguage
import SwiftUI
@_weakLinked import Translation

public class TranslateModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaTranslate")

    Constant("available") { () -> Bool in
      if #available(macOS 26.0, *) { return true }
      return false
    }

    Function("userLanguages") { () -> [String] in Locale.preferredLanguages }

    Function("languageName") { (identifier: String) -> String in
      Locale(identifier: "en").localizedString(forIdentifier: identifier) ?? identifier
    }

    AsyncFunction("detect") { (text: String) -> String? in
      let recognizer = NLLanguageRecognizer()
      recognizer.processString(text)
      guard let (language, confidence) = recognizer.languageHypotheses(withMaximum: 1).first, confidence >= 0.5 else { return nil }
      return language.rawValue
    }

    AsyncFunction("status") { (source: String, target: String) async -> String in
      guard #available(macOS 26.0, *) else { return "unsupported" }
      return await TranslationSessions.status(source: source, target: target)
    }

    AsyncFunction("supportedLanguages") { () async -> [String] in
      guard #available(macOS 26.0, *) else { return [] }
      return await LanguageAvailability().supportedLanguages.map { $0.minimalIdentifier }
    }

    AsyncFunction("prepare") { (source: String, target: String) async throws in
      guard #available(macOS 26.0, *) else { throw TranslateError.unavailable }
      try await TranslationSessions.prepare(source: source, target: target)
    }

    AsyncFunction("translateBlocks") { (source: String, target: String, blocks: [[String]]) async -> [[String]?] in
      guard #available(macOS 26.4, *) else { return blocks.map { _ in nil } }
      return await TranslationSessions.translateBlocks(source: source, target: target, blocks)
    }

    AsyncFunction("translate") { (source: String, target: String, texts: [String]) async throws -> [String?] in
      guard #available(macOS 26.0, *) else { throw TranslateError.unavailable }
      return try await TranslationSessions.translate(source: source, target: target, texts)
    }
  }
}

extension TranslateModule {
  static func linkedPieces(_ pieces: [String]) -> AttributedString {
    var text = AttributedString()
    for (i, piece) in pieces.enumerated() {
      var run = AttributedString(piece)
      run.link = URL(string: "ac-piece:\(i)")
      text += run
    }
    return text
  }

  static func isUnchanged(_ parts: [String], from pieces: [String]) -> Bool {
    parts.joined().filter { !$0.isWhitespace } == pieces.joined().filter { !$0.isWhitespace }
  }

  static func parts(of translated: AttributedString, over pieces: [String]) -> [String]? {
    var parts = Array(repeating: "", count: pieces.count)
    var order: [Int] = []
    var last = 0
    for run in translated.runs {
      let words = String(translated[run.range].characters)
      if let link = run.link, link.scheme == "ac-piece", let i = Int(link.absoluteString.dropFirst("ac-piece:".count)), parts.indices.contains(i) {
        order.append(i)
        last = i
        parts[i] += words
      } else {
        parts[last] += words
      }
    }
    guard !order.isEmpty else { return nil }
    if zip(order, order.dropFirst()).contains(where: { $0 > $1 }) {
      return distribute(String(translated.characters), over: pieces)
    }
    return parts
  }
}

extension TranslateModule {
  struct Sentence {
    let text: String
    let fragments: [(piece: Int, text: String)]
  }

  static func sentences(of pieces: [String], language: String) -> [Sentence] {
    let whole = pieces.joined()
    let chars = Array(whole)
    let tokenizer = NLTokenizer(unit: .sentence)
    tokenizer.string = whole
    tokenizer.setLanguage(NLLanguage(rawValue: language))
    var starts = tokenizer.tokens(for: whole.startIndex..<whole.endIndex).map { whole.distance(from: whole.startIndex, to: $0.lowerBound) }
    if starts.first != 0 { starts.insert(0, at: 0) }
    var bounds: [(start: Int, end: Int)] = []
    var offset = 0
    for piece in pieces {
      let end = min(chars.count, offset + piece.count)
      bounds.append((offset, end))
      offset = end
    }
    return starts.enumerated().compactMap { (k, start) in
      let end = k + 1 < starts.count ? starts[k + 1] : chars.count
      guard start < end else { return nil }
      let fragments = bounds.enumerated().compactMap { (piece, range) -> (piece: Int, text: String)? in
        let lo = max(start, range.start), hi = min(end, range.end)
        return lo < hi ? (piece, String(chars[lo..<hi])) : nil
      }
      return fragments.isEmpty ? nil : Sentence(text: String(chars[start..<end]), fragments: fragments)
    }
  }

  static func separatesSentences(_ language: String) -> Bool {
    !["zh", "ja", "th", "lo", "km", "my"].contains(Locale.Language(identifier: language).languageCode?.identifier ?? "")
  }

  static func distribute(_ text: String, over pieces: [String]) -> [String] {
    let chars = Array(text)
    let total = max(1, pieces.reduce(0) { $0 + $1.count })
    var out: [String] = []
    var start = 0
    var seen = 0
    for (i, piece) in pieces.enumerated() {
      seen += piece.count
      var end = i == pieces.count - 1 ? chars.count : min(chars.count, Int((Double(seen) / Double(total) * Double(chars.count)).rounded()))
      if end < chars.count, end > start {
        let window = 12
        if let space = (0...window).lazy.flatMap({ [end + $0, end - $0] }).first(where: { $0 > start && $0 < chars.count && chars[$0] == " " }) {
          end = space + 1
        }
      }
      end = max(start, end)
      if end == start, start < chars.count {
        end = (start + 1..<min(chars.count, start + 24)).first { chars[$0] == " " }.map { $0 + 1 } ?? min(chars.count, start + 1)
      }
      out.append(String(chars[start..<end]))
      start = end
    }
    return out
  }
}
