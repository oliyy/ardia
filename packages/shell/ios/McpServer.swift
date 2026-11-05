import ArdiaCore
import Foundation
import Network

final class McpServer {
  static let shared = McpServer()
  static let defaultPort: UInt16 = 53815
  static let bodyLimit = 1 << 20
  static let replyTimeout: TimeInterval = 30

  let queue = DispatchQueue(label: "dev.ardia.mcp")
  let port: UInt16 = LaunchConfig.shared.instance("mcpPort").flatMap { UInt16($0) } ?? McpServer.defaultPort

  var onRequest: ((String, String) -> Void)?
  var onStatus: ((String) -> Void)?

  private var listener: NWListener?
  private var starting: [(String) -> Void] = []
  private var connections: [ObjectIdentifier: McpConnection] = [:]
  private var waiting: [String: (connection: McpConnection, timeout: DispatchWorkItem)] = [:]
  private var lastRequest = 0

  var allowedHosts: Set<String> { ["127.0.0.1:\(port)", "localhost:\(port)"] }
  var allowedOrigins: Set<String> { Set(allowedHosts.map { "http://\($0)" }) }

  func start(done: @escaping (String) -> Void) {
    queue.async {
      if self.listener?.state == .ready { return done("listening") }
      self.starting.append(done)
      if self.listener != nil { return }
      guard let port = NWEndpoint.Port(rawValue: self.port) else { return self.settle("failed") }
      let parameters = NWParameters.tcp
      parameters.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: port)
      parameters.requiredInterfaceType = .loopback
      let listener: NWListener
      do {
        listener = try NWListener(using: parameters)
      } catch {
        return self.settle(Self.status(of: error))
      }
      self.listener = listener
      listener.stateUpdateHandler = { [weak listener] state in
        guard let listener, self.listener === listener else { return }
        switch state {
        case .ready: self.settle("listening")
        case .failed(let error), .waiting(let error):
          listener.cancel()
          self.listener = nil
          self.dropConnections()
          self.settle(Self.status(of: error))
        default: break
        }
      }
      listener.newConnectionHandler = { connection in self.accept(connection) }
      listener.start(queue: self.queue)
    }
  }

  func stop() {
    queue.async {
      self.listener?.cancel()
      self.listener = nil
      self.dropConnections()
      self.settle("off")
    }
  }

  func respond(_ id: String, status: Int, body: String) {
    queue.async {
      guard let entry = self.waiting.removeValue(forKey: id) else { return }
      entry.timeout.cancel()
      entry.connection.reply(status: status, body: Data(body.utf8))
    }
  }

  func hand(_ body: String, from connection: McpConnection) {
    lastRequest += 1
    let id = "r\(lastRequest)"
    let timeout = DispatchWorkItem { [weak self] in
      guard let self, self.waiting.removeValue(forKey: id) != nil else { return }
      connection.reply(status: 504, body: Data(#"{"error":"Ardia didn't answer in time"}"#.utf8))
    }
    waiting[id] = (connection, timeout)
    queue.asyncAfter(deadline: .now() + Self.replyTimeout, execute: timeout)
    guard let onRequest else {
      waiting.removeValue(forKey: id)?.timeout.cancel()
      return connection.reply(status: 503, body: Data(#"{"error":"Ardia isn't ready"}"#.utf8))
    }
    onRequest(id, body)
  }

  func closed(_ connection: McpConnection) {
    connections.removeValue(forKey: ObjectIdentifier(connection))
    for (id, entry) in waiting where entry.connection === connection {
      entry.timeout.cancel()
      waiting.removeValue(forKey: id)
    }
  }

  private func accept(_ connection: NWConnection) {
    let wrapped = McpConnection(connection, server: self)
    connections[ObjectIdentifier(wrapped)] = wrapped
    wrapped.start()
  }

  private func dropConnections() {
    let open = Array(connections.values)
    connections.removeAll()
    for (_, entry) in waiting { entry.timeout.cancel() }
    waiting.removeAll()
    for connection in open { connection.cancel() }
  }

  private func settle(_ status: String) {
    let callbacks = starting
    starting.removeAll()
    if callbacks.isEmpty { onStatus?(status) }
    for callback in callbacks { callback(status) }
  }

  private static func status(of error: Error) -> String {
    if case .posix(let code) = error as? NWError, code == .EADDRINUSE { return "inUse" }
    return "failed"
  }
}
