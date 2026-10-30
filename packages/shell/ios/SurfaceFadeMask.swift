import AppKit
import Carbon.HIToolbox
import ExpoModulesCore

struct SurfaceFadeMask {
  let edgeInset: CGFloat
  let edgeShare: CGFloat
  let rampShare: CGFloat
  let baseInset: CGFloat
  let times: [Double]
  let offsetShares: [CGFloat]
  let fades: [CGFloat]

  init?(_ record: [String: Any]) {
    func number(_ key: String) -> CGFloat? { (record[key] as? NSNumber).map { CGFloat($0.doubleValue) }.flatMap { $0.isFinite ? $0 : nil } }
    func list(_ key: String) -> [CGFloat]? {
      guard let values = record[key] as? [NSNumber] else { return nil }
      let numbers = values.map { CGFloat($0.doubleValue) }
      return numbers.allSatisfy(\.isFinite) ? numbers : nil
    }
    guard let edgeInset = number("edgeInset"), let edgeShare = number("edgeShare"), let rampShare = number("rampShare"), rampShare > 0,
          let baseInset = number("baseInset"), let times = list("times"), let offsetShares = list("offsetShares"), let fades = list("fades"),
          !times.isEmpty, times.count == offsetShares.count, times.count == fades.count, times.first == 0,
          zip(times, times.dropFirst()).allSatisfy({ $0 <= $1 })
    else { return nil }
    self.edgeInset = edgeInset
    self.edgeShare = edgeShare
    self.rampShare = rampShare
    self.baseInset = baseInset
    self.times = times.map { Double($0) / 1000 }
    self.offsetShares = offsetShares
    self.fades = fades.map { min(max($0, 0), 1) }
  }
}
