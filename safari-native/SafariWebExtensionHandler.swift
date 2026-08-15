import AuthenticationServices
import SafariServices

@available(macOS 11.0, iOS 15.0, *)
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling, ASWebAuthenticationPresentationContextProviding {
    private var authenticationSession: ASWebAuthenticationSession?

    func beginRequest(with context: NSExtensionContext) {
        guard
            let request = context.inputItems.first as? NSExtensionItem,
            let message = request.userInfo?[SFExtensionMessageKey] as? [String: Any],
            message["type"] as? String == "novel-tracker.oauth.authorize",
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

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        ASPresentationAnchor()
    }

    private func complete(_ context: NSExtensionContext, callbackURL: String? = nil, error: String? = nil) {
        let response = NSExtensionItem()
        var payload: [String: Any] = [:]
        if let callbackURL { payload["callbackUrl"] = callbackURL }
        if let error { payload["error"] = error }
        response.userInfo = [SFExtensionMessageKey: payload]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
