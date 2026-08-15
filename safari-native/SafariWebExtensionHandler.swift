import AuthenticationServices
import SafariServices

@available(macOS 11.0, iOS 15.0, *)
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling, ASWebAuthenticationPresentationContextProviding {
    private var authenticationSession: ASWebAuthenticationSession?

    func beginRequest(with context: NSExtensionContext) {
        guard
            let request = context.inputItems.first as? NSExtensionItem,
            let message = request.userInfo?[SFExtensionMessageKey] as? [String: Any],
            let messageType = message["type"] as? String
        else {
            complete(context, error: "Unsupported native message")
            return
        }

        switch messageType {
        case "novel-tracker.oauth.authorize":
            authorize(message, context: context)
        case "novel-tracker.http.request":
            performHTTPRequest(message, context: context)
        default:
            complete(context, error: "Unsupported native message")
        }
    }

    private func authorize(_ message: [String: Any], context: NSExtensionContext) {
        guard
            let authorizationValue = message["authorizationUrl"] as? String,
            let authorizationURL = URL(string: authorizationValue),
            let callbackScheme = message["callbackScheme"] as? String
        else {
            complete(context, error: "Unsupported native message")
            return
        }

        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(
                url: authorizationURL,
                callbackURLScheme: callbackScheme
            ) { [weak self] callbackURL, error in
                guard let self else { return }
                if let callbackURL {
                    self.complete(context, callbackURL: callbackURL.absoluteString)
                } else {
                    self.complete(context, error: error?.localizedDescription ?? "Authentication was cancelled")
                }
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
    }

    private func performHTTPRequest(_ message: [String: Any], context: NSExtensionContext) {
        guard
            let urlValue = message["url"] as? String,
            let url = URL(string: urlValue),
            url.scheme == "https",
            ["auth.novel.bghimire.com", "api.novel.bghimire.com"].contains(url.host ?? ""),
            let method = message["method"] as? String,
            ["GET", "POST", "DELETE"].contains(method)
        else {
            complete(context, error: "Invalid native HTTP request")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        for (name, value) in message["headers"] as? [String: String] ?? [:] {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let body = message["body"] as? String, !body.isEmpty {
            request.httpBody = body.data(using: .utf8)
        }
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            if let error {
                self.complete(context, error: error.localizedDescription)
                return
            }
            guard let httpResponse = response as? HTTPURLResponse else {
                self.complete(context, error: "Server returned an invalid response")
                return
            }
            let body = String(data: data ?? Data(), encoding: .utf8) ?? ""
            self.complete(context, payload: ["status": httpResponse.statusCode, "body": body])
        }.resume()
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        ASPresentationAnchor()
    }

    private func complete(_ context: NSExtensionContext, callbackURL: String? = nil, error: String? = nil) {
        var payload: [String: Any] = [:]
        if let callbackURL { payload["callbackUrl"] = callbackURL }
        if let error { payload["error"] = error }
        complete(context, payload: payload)
    }

    private func complete(_ context: NSExtensionContext, payload: [String: Any]) {
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: payload]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
