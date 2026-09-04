import AuthenticationServices
import SafariServices
import Security

private enum SharedSessionStore {
    static let service = "app.noveltracker.auth"
    static let account = "keycloak-session"

    static func read() throws -> [String: Any]? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
        let value = try JSONSerialization.jsonObject(with: data)
        guard let session = value as? [String: Any] else { throw StoreError.invalidSession }
        return session
    }

    static func write(_ session: [String: Any]) throws {
        guard
            session["accessToken"] is String,
            session["refreshToken"] is String,
            session["expiresAt"] is NSNumber,
            session["subject"] is String
        else { throw StoreError.invalidSession }
        // `provider` records which identity provider minted the session. It has
        // to be listed here or every write of a session carrying it is rejected
        // as invalid, which breaks sign-in outright.
        let allowed = Set(["accessToken", "refreshToken", "idToken", "expiresAt", "subject", "email", "name", "provider"])
        guard Set(session.keys).isSubset(of: allowed) else { throw StoreError.invalidSession }
        let data = try JSONSerialization.data(withJSONObject: session)
        let query = baseQuery()
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            attributes.forEach { add[$0.key] = $0.value }
            let addStatus = SecItemAdd(add as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(addStatus)) }
        } else if status != errSecSuccess {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }

    static func clear() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
        }
    }

    private static func baseQuery() -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        if let group = Bundle.main.object(forInfoDictionaryKey: "NovelTrackerKeychainAccessGroup") as? String,
           !group.isEmpty {
            query[kSecAttrAccessGroup as String] = group
        }
        return query
    }

    enum StoreError: LocalizedError {
        case invalidSession
        var errorDescription: String? { "The shared authentication session is invalid" }
    }
}

@available(macOS 11.0, iOS 15.0, *)
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling, ASWebAuthenticationPresentationContextProviding {
    private var authenticationSession: ASWebAuthenticationSession?

    func beginRequest(with context: NSExtensionContext) {
        guard
            let request = context.inputItems.first as? NSExtensionItem,
            let message = request.userInfo?[SFExtensionMessageKey] as? [String: Any],
            let messageType = message["type"] as? String
        else { return complete(context, error: "Unsupported native message") }

        switch messageType {
        case "novel-tracker.oauth.authorize": authorize(message, context: context)
        case "novel-tracker.http.request": performHTTPRequest(message, context: context)
        case "novel-tracker.auth.get": readSession(context)
        case "novel-tracker.auth.store": storeSession(message, context: context)
        case "novel-tracker.auth.clear": clearSession(context)
        default: complete(context, error: "Unsupported native message")
        }
    }

    private func authorize(_ message: [String: Any], context: NSExtensionContext) {
#if os(iOS)
        complete(context, error: "Open the Novel Tracker app and sign in before using Safari sync.")
#else
        guard
            let value = message["authorizationUrl"] as? String,
            let url = URL(string: value), url.scheme == "https",
            url.host == "auth.novel.bghimire.com",
            message["callbackScheme"] as? String == "noveltracker"
        else { return complete(context, error: "Invalid authorization request") }
        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "noveltracker") { [weak self] callback, error in
                guard let self else { return }
                if let callback { self.complete(context, payload: ["callbackUrl": callback.absoluteString]) }
                else { self.complete(context, error: error?.localizedDescription ?? "Authentication was cancelled") }
                self.authenticationSession = nil
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.authenticationSession = session
            if !session.start() {
                self.complete(context, error: "Safari could not start authentication")
                self.authenticationSession = nil
            }
        }
#endif
    }

    private func readSession(_ context: NSExtensionContext) {
        do { complete(context, payload: ["session": try SharedSessionStore.read() ?? NSNull()]) }
        catch { complete(context, error: error.localizedDescription) }
    }

    private func storeSession(_ message: [String: Any], context: NSExtensionContext) {
        guard let session = message["session"] as? [String: Any] else { return complete(context, error: "Invalid authentication session") }
        do { try SharedSessionStore.write(session); complete(context, payload: ["stored": true]) }
        catch { complete(context, error: error.localizedDescription) }
    }

    private func clearSession(_ context: NSExtensionContext) {
        do { try SharedSessionStore.clear(); complete(context, payload: ["cleared": true]) }
        catch { complete(context, error: error.localizedDescription) }
    }

    private func performHTTPRequest(_ message: [String: Any], context: NSExtensionContext) {
        guard
            let value = message["url"] as? String, let url = URL(string: value), url.scheme == "https",
            ["auth.novel.bghimire.com", "api.novel.bghimire.com"].contains(url.host ?? ""),
            let method = message["method"] as? String, ["GET", "POST", "DELETE"].contains(method)
        else { return complete(context, error: "Invalid native HTTP request") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        for (name, value) in message["headers"] as? [String: String] ?? [:] { request.setValue(value, forHTTPHeaderField: name) }
        if let body = message["body"] as? String, !body.isEmpty { request.httpBody = body.data(using: .utf8) }
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            if let error { return self.complete(context, error: error.localizedDescription) }
            guard let response = response as? HTTPURLResponse else { return self.complete(context, error: "Server returned an invalid response") }
            self.complete(context, payload: ["status": response.statusCode, "body": String(data: data ?? Data(), encoding: .utf8) ?? ""])
        }.resume()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { ASPresentationAnchor() }

    private func complete(_ context: NSExtensionContext, error: String) { complete(context, payload: ["error": error]) }
    private func complete(_ context: NSExtensionContext, payload: [String: Any]) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: payload]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
