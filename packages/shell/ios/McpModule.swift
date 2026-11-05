import ExpoModulesCore
import Foundation

public class McpModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ArdiaMcp")
    Events("onRequest", "onStatus")

    OnCreate {
      McpServer.shared.onRequest = { [weak self] id, body in self?.sendEvent("onRequest", ["id": id, "body": body]) }
      McpServer.shared.onStatus = { [weak self] status in self?.sendEvent("onStatus", ["status": status]) }
    }

    Constant("port") { () -> Int in Int(McpServer.shared.port) }

    AsyncFunction("start") { (promise: Promise) in
      McpServer.shared.start { promise.resolve($0) }
    }

    Function("stop") { McpServer.shared.stop() }

    Function("respond") { (id: String, status: Int, body: String) in
      McpServer.shared.respond(id, status: status, body: body)
    }
  }
}
