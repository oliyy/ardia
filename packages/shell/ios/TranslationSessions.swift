import AppKit
import ExpoModulesCore
import NaturalLanguage
import SwiftUI
@_weakLinked import Translation

@available(macOS 26.0, *)
@MainActor
enum TranslationSessions {
  private static var sessions: [String: TranslationSession] = [:]
  private static var declinedFastPairs: Set<String> = []
  private static var fastPairs: [String: Bool] = [:]
  private static var tail: Task<Void, Never>?
  private static var uses = 0
  private static let idleSeconds = 60.0

  private struct PassageKey: Hashable {
    let source: String
    let target: String
    let pieces: [String]
  }

  private static var memo: [PassageKey: [String]] = [:]
  private static let memoLimit = 5000

  static func translations(source: String, target: String, _ requests: [TranslationSession.Request]) async throws -> [TranslationSession.Response] {
    try await run(source: source, target: target) { try await $0.translations(from: requests) }
  }

  static func status(source: String, target: String) async -> String {
    let from = Locale.Language(identifier: source), to = Locale.Language(identifier: target)
    let standard = await LanguageAvailability().status(from: from, to: to)
    if standard == .unsupported { return "unsupported" }
    if #available(macOS 26.4, *), !declinedFastPairs.contains(pairKey(source, target)),
      await LanguageAvailability(preferredStrategy: .lowLatency).status(from: from, to: to) == .supported
    {
      return "supported"
    }
    return standard == .installed ? "installed" : "supported"
  }

  static func prepare(source: String, target: String) async throws {
    let from = Locale.Language(identifier: source), to = Locale.Language(identifier: target)
    let pair = pairKey(source, target)
    if #available(macOS 26.4, *), !declinedFastPairs.contains(pair),
      await LanguageAvailability(preferredStrategy: .lowLatency).status(from: from, to: to) == .supported
    {
      try await DownloadPrompt.run(.init(source: from, target: to, preferredStrategy: .lowLatency))
      forget(pair)
      if await LanguageAvailability(preferredStrategy: .lowLatency).status(from: from, to: to) != .installed { declinedFastPairs.insert(pair) }
      return
    }
    try await DownloadPrompt.run(.init(source: from, target: to))
    forget(pair)
  }

  static func translate(source: String, target: String, _ texts: [String]) async throws -> [String?] {
    let requests = texts.enumerated().map { TranslationSession.Request(sourceText: $0.element, clientIdentifier: String($0.offset)) }
    var out: [String?] = texts.map { _ in nil }
    for response in try await translations(source: source, target: target, requests) {
      if let i = response.clientIdentifier.flatMap(Int.init), out.indices.contains(i) { out[i] = response.targetText }
    }
    return out
  }

  @available(macOS 26.4, *)
  static func translateBlocks(source: String, target: String, _ blocks: [[String]]) async -> [[String]?] {
    let keys = blocks.map { PassageKey(source: source, target: target, pieces: $0) }
    var found: [PassageKey: [String]] = [:]
    var pending: [(key: PassageKey, pieces: [String])] = []
    var asked = Set<PassageKey>()
    for (key, pieces) in zip(keys, blocks) where asked.insert(key).inserted {
      if let known = memo[key] { found[key] = known } else { pending.append((key, pieces)) }
    }
    await translatePassages(source: source, target: target, pending, into: &found)
    for (key, pieces) in pending {
      if let parts = found[key], !TranslateModule.isUnchanged(parts, from: pieces) { remember(key, parts) }
    }
    return keys.map { found[$0] }
  }

  @available(macOS 26.4, *)
  private static func translatePassages(source: String, target: String, _ passages: [(key: PassageKey, pieces: [String])], into found: inout [PassageKey: [String]]) async {
    let fast = await isFast(source, target)
    let plain = passages.filter { fast || $0.pieces.count == 1 }
    await translatePlain(source: source, target: target, plain, into: &found)
    for (key, pieces) in passages where !fast && pieces.count > 1 {
      let text = TranslateModule.linkedPieces(pieces)
      guard let translated = try? await run(source: source, target: target, { try await $0.translate(text).attributedTargetText }),
        let parts = TranslateModule.parts(of: translated, over: pieces)
      else { continue }
      found[key] = parts
    }
  }

  private static func translatePlain(source: String, target: String, _ passages: [(key: PassageKey, pieces: [String])], into found: inout [PassageKey: [String]]) async {
    let sentences = passages.enumerated().flatMap { (i, passage) in
      passage.pieces.count == 1
        ? [(passage: i, sentence: TranslateModule.Sentence(text: passage.pieces[0], fragments: [(0, passage.pieces[0])]))]
        : TranslateModule.sentences(of: passage.pieces, language: source).map { (passage: i, sentence: $0) }
    }
    guard !sentences.isEmpty else { return }
    let requests = sentences.enumerated().map { TranslationSession.Request(sourceText: $0.element.sentence.text, clientIdentifier: String($0.offset)) }
    var translated: [String?] = sentences.map { _ in nil }
    for response in (try? await translations(source: source, target: target, requests)) ?? [] {
      if let i = response.clientIdentifier.flatMap(Int.init), translated.indices.contains(i) { translated[i] = response.targetText }
    }
    let separator = TranslateModule.separatesSentences(target) ? " " : ""
    var parts = passages.map { Array(repeating: "", count: $0.pieces.count) }
    var complete = passages.map { _ in true }
    for (k, entry) in sentences.enumerated() {
      guard let text = translated[k] else {
        complete[entry.passage] = false
        continue
      }
      let fragments = entry.sentence.fragments
      if passages[entry.passage].pieces.count == 1 {
        parts[entry.passage][0] = text
        continue
      }
      let last = k == sentences.count - 1 || sentences[k + 1].passage != entry.passage
      let sentence = text.trimmingCharacters(in: .whitespacesAndNewlines) + (last ? "" : separator)
      let cut = fragments.count == 1 ? [sentence] : TranslateModule.distribute(sentence, over: fragments.map(\.text))
      for (fragment, words) in zip(fragments, cut) { parts[entry.passage][fragment.piece] += words }
    }
    for (i, passage) in passages.enumerated() where complete[i] { found[passage.key] = parts[i] }
  }

  private static func isFast(_ source: String, _ target: String) async -> Bool {
    let pair = pairKey(source, target)
    if let known = fastPairs[pair] { return known }
    var fast = false
    if #available(macOS 26.4, *) {
      fast = await LanguageAvailability(preferredStrategy: .lowLatency).status(from: Locale.Language(identifier: source), to: Locale.Language(identifier: target)) == .installed
    }
    fastPairs[pair] = fast
    return fast
  }

  private static func pairKey(_ source: String, _ target: String) -> String { "\(source)>\(target)" }

  private static func remember(_ key: PassageKey, _ parts: [String]) {
    if memo.count >= memoLimit { memo.removeAll() }
    memo[key] = parts
  }

  private static func run<T: Sendable>(source: String, target: String, _ work: @escaping @MainActor (TranslationSession) async throws -> T) async throws -> T {
    let previous = tail
    let task = Task { @MainActor () async throws -> T in
      await previous?.value
      let key = pairKey(source, target)
      let session: TranslationSession
      if let cached = sessions[key] {
        session = cached
      } else {
        session = await make(source: source, target: target)
        sessions[key] = session
      }
      do {
        return try await work(session)
      } catch {
        sessions[key] = nil
        throw error
      }
    }
    tail = Task { _ = try? await task.value }
    defer { forgetWhenIdle() }
    return try await task.value
  }

  private static func forgetWhenIdle() {
    uses += 1
    let use = uses
    Task { @MainActor in
      try? await Task.sleep(for: .seconds(idleSeconds))
      if uses == use {
        sessions.removeAll()
        fastPairs.removeAll()
      }
    }
  }

  private static func forget(_ pair: String) {
    sessions[pair] = nil
    fastPairs[pair] = nil
  }

  private static func make(source: String, target: String) async -> TranslationSession {
    let from = Locale.Language(identifier: source), to = Locale.Language(identifier: target)
    if #available(macOS 26.4, *), await isFast(source, target) {
      return TranslationSession(installedSource: from, target: to, preferredStrategy: .lowLatency)
    }
    return TranslationSession(installedSource: from, target: to)
  }
}
