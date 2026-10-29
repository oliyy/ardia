import XCTest
@testable import ArdiaImportCore

final class ExtensionsTests: XCTestCase {
  func testListsWebStoreExtensionsWithNames() {
    let list = ChromiumExtensions.list(profile: Fixtures.url("extensions/Default"))
    XCTAssertEqual(list.map(\.name), ["cccccccccccccccccccccccccccccccc", "Localized Blocker", "Older Chrome Keeps Manifests", "Plain Name"])
    XCTAssertEqual(list.map { "\($0.id) \($0.source) enabled=\($0.enabled) needsApproval=\($0.needsApproval)" }, [
      "cccccccccccccccccccccccccccccccc unpacked enabled=true needsApproval=false",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa webStore enabled=true needsApproval=false",
      "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee webStore enabled=true needsApproval=true",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb webStore enabled=true needsApproval=false",
    ])
    XCTAssertEqual(list.first { $0.source == "webStore" }?.webStoreUrl, "https://chromewebstore.google.com/detail/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
  }

  func testHeliumListsStoreInstallsButNotItsBuiltInUBlock() {
    let list = ChromiumExtensions.list(profile: Fixtures.url("extensions/Helium"))
    XCTAssertEqual(list.map(\.id), ["eimadpbcbfnmbkopoojfekhnkhdbieeh"])
    XCTAssertEqual(list.map(\.name), ["Dark Reader"])
  }

  func testLeavesOutUBlockOriginAndItsLiteVersion() {
    XCTAssertEqual(ChromiumExtensions.list(profile: Fixtures.url("extensions/UBlockOnly")), [])
  }

  func testMissingProfileListsNothing() {
    XCTAssertEqual(ChromiumExtensions.list(profile: Fixtures.url("extensions/Nope")), [])
  }
}
