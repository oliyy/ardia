import Foundation
import Network

final class McpConnection {
  private static let headerLimit = 16 * 1024
  private static let separator = Data("\r\n\r\n".utf8)
  private static let reasons: [Int: String] = [
    200: "OK", 202: "Accepted", 400: "Bad Request", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed",
    411: "Length Required", 413: "Content Too Large", 431: "Request Header Fields Too Large", 500: "Internal Server Error",
    501: "Not Implemented", 503: "Service Unavailable", 504: "Gateway Timeout",
  ]

  private let connection: NWConnection
  private unowned let server: McpServer
  private var buffer = Data()
  private var busy = false
  private var keepAlive = true
  private var finished = false

  init(_ connection: NWConnection, server: McpServer) {
    self.connection = connection
    self.server = server
  }

  func start() {
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled: self?.finish()
      default: break
      }
    }
    connection.start(queue: server.queue)
    receive()
  }

  func cancel() {
    finished = true
    connection.cancel()
  }

  func reply(status: Int, body: Data, extraHeaders: [String] = []) {
    guard !finished else { return }
    var head = ["HTTP/1.1 \(status) \(Self.reasons[status] ?? "Error")", "Content-Length: \(body.count)", "Cache-Control: no-store"]
    if !body.isEmpty { head.append("Content-Type: application/json") }
    head.append(contentsOf: extraHeaders)
    head.append(keepAlive ? "Connection: keep-alive" : "Connection: close")
    var data = Data((head.joined(separator: "\r\n") + "\r\n\r\n").utf8)
    data.append(body)
    let closeAfter = !keepAlive
    connection.send(content: data, completion: .contentProcessed { [weak self] _ in
      guard let self else { return }
      self.busy = false
      if closeAfter { self.cancel() } else { self.process() }
    })
  }

  private func receive() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, complete, error in
      guard let self, !self.finished else { return }
      if let data { self.buffer.append(data) }
      self.process()
      guard complete || error != nil else { return self.receive() }
      self.keepAlive = false
      if !self.busy { self.cancel() }
    }
  }

  private func finish() {
    finished = true
    server.closed(self)
  }

  private func refuse(_ status: Int, _ message: String, headers: [String] = []) {
    keepAlive = false
    busy = true
    buffer.removeAll()
    let body = (try? JSONSerialization.data(withJSONObject: ["error": message])) ?? Data()
    reply(status: status, body: body, extraHeaders: headers)
  }

  private func process() {
    guard !busy, !finished, !buffer.isEmpty else { return }
    guard let end = buffer.range(of: Self.separator) else {
      if buffer.count > Self.headerLimit { refuse(431, "Headers are too large") }
      return
    }
    guard end.lowerBound <= Self.headerLimit, let head = String(data: buffer[buffer.startIndex..<end.lowerBound], encoding: .utf8) else {
      return refuse(431, "Headers are too large")
    }
    var lines = head.components(separatedBy: "\r\n")
    let requestLine = lines.removeFirst().split(separator: " ", omittingEmptySubsequences: true)
    guard requestLine.count == 3 else { return refuse(400, "Bad request line") }
    var headers: [String: String] = [:]
    for line in lines {
      guard let colon = line.firstIndex(of: ":") else { return refuse(400, "Bad header") }
      let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
      headers[name] = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
    }
    let method = String(requestLine[0])
    let path = requestLine[1].split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
    keepAlive = requestLine[2] == "HTTP/1.1" ? headers["connection"]?.lowercased() != "close" : headers["connection"]?.lowercased() == "keep-alive"

    guard let host = headers["host"]?.lowercased(), server.allowedHosts.contains(host) else { return refuse(403, "Host not allowed") }
    if let origin = headers["origin"], !server.allowedOrigins.contains(origin.lowercased()) { return refuse(403, "Origin not allowed") }
    guard path == "/mcp" else { return refuse(404, "Not found") }
    guard method == "POST" else { return refuse(405, "Only POST is supported", headers: ["Allow: POST"]) }
    if headers["transfer-encoding"] != nil { return refuse(501, "Chunked bodies aren't supported") }
    guard let lengthText = headers["content-length"], let length = Int(lengthText), length >= 0 else { return refuse(411, "Content-Length is required") }
    guard length <= McpServer.bodyLimit else { return refuse(413, "The body is over 1 MB") }

    let bodyStart = end.upperBound
    guard buffer.count - (bodyStart - buffer.startIndex) >= length else { return }
    let bodyData = buffer[bodyStart..<(bodyStart + length)]
    buffer = Data(buffer[(bodyStart + length)...])
    guard let body = String(data: bodyData, encoding: .utf8) else { return refuse(400, "The body isn't UTF-8") }
    busy = true
    server.hand(body, from: self)
  }
}
