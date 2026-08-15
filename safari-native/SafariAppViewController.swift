
import AuthenticationServices
import CryptoKit
import Security
import WebKit


#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#else
import Cocoa
import SafariServices
typealias PlatformViewController = NSViewController
#endif

#if os(iOS)
private let scrollView = UIScrollView()
private let contentStack = UIStackView()

private let iconContainer = UIView()
private let iconImageView = UIImageView()
private let titleLabel = UILabel()
private let subtitleLabel = UILabel()

private let statusCard = UIView()
private let statusIconView = UIImageView()
private let statusTitleLabel = UILabel()
private let statusDetailLabel = UILabel()

private let actionButton = UIButton(type: .system)
private let signOutButton = UIButton(type: .system)

private let setupTitleLabel = UILabel()
private let setupStack = UIStackView()
#endif

private let extensionBundleIdentifier = "app.noveltracker.extension.Extension"
private let issuer = "https://auth.novel.bghimire.com/realms/novel-tracker"
private let clientID = "novel-tracker-extension"
private let callbackURL = "noveltracker://oauth/callback"

private enum AppSessionStore {
    static let service = "app.noveltracker.auth"
    static let account = "keycloak-session"

    static func read() throws -> [String: Any]? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
        return try JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    static func write(_ session: [String: Any]) throws {
        let data = try JSONSerialization.data(withJSONObject: session)
        let query = baseQuery()
        let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            attributes.forEach { add[$0.key] = $0.value }
            let addStatus = SecItemAdd(add as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(addStatus)) }
        } else if status != errSecSuccess { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    static func clear() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }

    private static func baseQuery() -> [String: Any] {
        var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
        if let group = Bundle.main.object(forInfoDictionaryKey: "NovelTrackerKeychainAccessGroup") as? String, !group.isEmpty {
            query[kSecAttrAccessGroup as String] = group
        }
        return query
    }
}

class ViewController: PlatformViewController, WKNavigationDelegate, WKScriptMessageHandler, ASWebAuthenticationPresentationContextProviding {
    @IBOutlet var webView: WKWebView!
    private var authenticationSession: ASWebAuthenticationSession?
#if os(iOS)
    private let titleLabel = UILabel()
    private let detailLabel = UILabel()
    private let actionButton = UIButton(type: .system)
    private let signOutButton = UIButton(type: .system)
//    private var attemptedAutomaticSignIn = false
#endif

    override func viewDidLoad() {
        super.viewDidLoad()
#if os(iOS)
        configureIOSView()
        refreshIOSView()
#else
        webView.navigationDelegate = self
        webView.configuration.userContentController.add(self, name: "controller")
        webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
#endif
    }

#if os(iOS)
//    override func viewDidAppear(_ animated: Bool) {
//        super.viewDidAppear(animated)
//        guard !attemptedAutomaticSignIn, (try? AppSessionStore.read()) == nil else { return }
//        attemptedAutomaticSignIn = true
//        signIn()
//    }

    private func configureIOSView() {
        webView?.isHidden = true
        view.backgroundColor = .systemGroupedBackground

        // MARK: - Scroll container

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        contentStack.translatesAutoresizingMaskIntoConstraints = false

        contentStack.axis = .vertical
        contentStack.spacing = 24
        contentStack.alignment = .fill

        view.addSubview(scrollView)
        scrollView.addSubview(contentStack)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            contentStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 36),
            contentStack.leadingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.leadingAnchor, constant: 24),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.frameLayoutGuide.trailingAnchor, constant: -24),
            contentStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -36)
        ])

        // MARK: - Hero

        iconContainer.translatesAutoresizingMaskIntoConstraints = false
        iconContainer.backgroundColor = .systemIndigo
        iconContainer.layer.cornerRadius = 22
        iconContainer.layer.cornerCurve = .continuous

        iconImageView.translatesAutoresizingMaskIntoConstraints = false
        iconImageView.image = UIImage(systemName: "books.vertical.fill")
        iconImageView.tintColor = .white
        iconImageView.contentMode = .scaleAspectFit

        iconContainer.addSubview(iconImageView)

        NSLayoutConstraint.activate([
            iconContainer.widthAnchor.constraint(equalToConstant: 76),
            iconContainer.heightAnchor.constraint(equalToConstant: 76),

            iconImageView.centerXAnchor.constraint(equalTo: iconContainer.centerXAnchor),
            iconImageView.centerYAnchor.constraint(equalTo: iconContainer.centerYAnchor),
            iconImageView.widthAnchor.constraint(equalToConstant: 38),
            iconImageView.heightAnchor.constraint(equalToConstant: 38)
        ])

        let iconWrapper = UIView()
        iconWrapper.addSubview(iconContainer)
        iconContainer.translatesAutoresizingMaskIntoConstraints = false

        NSLayoutConstraint.activate([
            iconContainer.centerXAnchor.constraint(equalTo: iconWrapper.centerXAnchor),
            iconContainer.topAnchor.constraint(equalTo: iconWrapper.topAnchor),
            iconContainer.bottomAnchor.constraint(equalTo: iconWrapper.bottomAnchor)
        ])

        titleLabel.text = "Novel Tracker"
        titleLabel.font = .systemFont(ofSize: 32, weight: .bold)
        titleLabel.textAlignment = .center
        titleLabel.textColor = .label

        subtitleLabel.text = "Keep your reading list synced between Safari and your Novel Tracker account."
        subtitleLabel.font = .preferredFont(forTextStyle: .body)
        subtitleLabel.textColor = .secondaryLabel
        subtitleLabel.textAlignment = .center
        subtitleLabel.numberOfLines = 0

        let heroStack = UIStackView(arrangedSubviews: [
            iconWrapper,
            titleLabel,
            subtitleLabel
        ])

        heroStack.axis = .vertical
        heroStack.spacing = 12
        heroStack.alignment = .fill

        contentStack.addArrangedSubview(heroStack)

        // MARK: - Account status card

        statusCard.backgroundColor = .secondarySystemGroupedBackground
        statusCard.layer.cornerRadius = 20
        statusCard.layer.cornerCurve = .continuous

        statusIconView.translatesAutoresizingMaskIntoConstraints = false
        statusIconView.contentMode = .scaleAspectFit
        statusIconView.tintColor = .secondaryLabel

        statusTitleLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        statusTitleLabel.textColor = .label

        statusDetailLabel.font = .preferredFont(forTextStyle: .subheadline)
        statusDetailLabel.textColor = .secondaryLabel
        statusDetailLabel.numberOfLines = 0

        let statusTextStack = UIStackView(arrangedSubviews: [
            statusTitleLabel,
            statusDetailLabel
        ])
        statusTextStack.axis = .vertical
        statusTextStack.spacing = 4

        let statusRow = UIStackView(arrangedSubviews: [
            statusIconView,
            statusTextStack
        ])
        statusRow.axis = .horizontal
        statusRow.spacing = 14
        statusRow.alignment = .center
        statusRow.translatesAutoresizingMaskIntoConstraints = false

        statusCard.addSubview(statusRow)

        NSLayoutConstraint.activate([
            statusIconView.widthAnchor.constraint(equalToConstant: 32),
            statusIconView.heightAnchor.constraint(equalToConstant: 32),

            statusRow.topAnchor.constraint(equalTo: statusCard.topAnchor, constant: 18),
            statusRow.leadingAnchor.constraint(equalTo: statusCard.leadingAnchor, constant: 18),
            statusRow.trailingAnchor.constraint(equalTo: statusCard.trailingAnchor, constant: -18),
            statusRow.bottomAnchor.constraint(equalTo: statusCard.bottomAnchor, constant: -18)
        ])

        contentStack.addArrangedSubview(statusCard)

        // MARK: - Sign-in button

        var buttonConfig = UIButton.Configuration.filled()
        buttonConfig.title = "Sign in with Google"
        buttonConfig.image = UIImage(systemName: "person.crop.circle.badge.checkmark")
        buttonConfig.imagePadding = 10
        buttonConfig.cornerStyle = .large
        buttonConfig.baseBackgroundColor = .systemIndigo
        buttonConfig.baseForegroundColor = .white
        buttonConfig.contentInsets = NSDirectionalEdgeInsets(
            top: 15,
            leading: 20,
            bottom: 15,
            trailing: 20
        )

        actionButton.configuration = buttonConfig
        actionButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        actionButton.addTarget(self, action: #selector(signIn), for: .touchUpInside)

        contentStack.addArrangedSubview(actionButton)

        // MARK: - Safari setup

        setupTitleLabel.text = "Finish setup in Safari"
        setupTitleLabel.font = .systemFont(ofSize: 20, weight: .bold)
        setupTitleLabel.textColor = .label

        setupStack.axis = .vertical
        setupStack.spacing = 14

        setupStack.addArrangedSubview(
            makeSetupRow(
                number: "1",
                title: "Enable the extension",
                detail: "Open Settings → Safari → Extensions."
            )
        )

        setupStack.addArrangedSubview(
            makeSetupRow(
                number: "2",
                title: "Turn on Novel Tracker",
                detail: "Allow the extension to run in Safari."
            )
        )

        setupStack.addArrangedSubview(
            makeSetupRow(
                number: "3",
                title: "Start browsing",
                detail: "Novel Tracker will use this account for cloud sync."
            )
        )

        let setupContainer = UIStackView(arrangedSubviews: [
            setupTitleLabel,
            setupStack
        ])
        setupContainer.axis = .vertical
        setupContainer.spacing = 16

        contentStack.addArrangedSubview(setupContainer)

        // MARK: - Sign out

        signOutButton.setTitle("Sign Out", for: .normal)
        signOutButton.setTitleColor(.systemRed, for: .normal)
        signOutButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .medium)
        signOutButton.addTarget(self, action: #selector(signOut), for: .touchUpInside)

        contentStack.addArrangedSubview(signOutButton)
    }

    private func makeSetupRow(
        number: String,
        title: String,
        detail: String
    ) -> UIView {
        let numberLabel = UILabel()
        numberLabel.text = number
        numberLabel.textAlignment = .center
        numberLabel.font = .systemFont(ofSize: 14, weight: .bold)
        numberLabel.textColor = .white
        numberLabel.backgroundColor = .systemIndigo
        numberLabel.layer.cornerRadius = 14
        numberLabel.layer.masksToBounds = true
        numberLabel.translatesAutoresizingMaskIntoConstraints = false

        NSLayoutConstraint.activate([
            numberLabel.widthAnchor.constraint(equalToConstant: 28),
            numberLabel.heightAnchor.constraint(equalToConstant: 28)
        ])

        let titleLabel = UILabel()
        titleLabel.text = title
        titleLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        titleLabel.textColor = .label

        let detailLabel = UILabel()
        detailLabel.text = detail
        detailLabel.font = .preferredFont(forTextStyle: .subheadline)
        detailLabel.textColor = .secondaryLabel
        detailLabel.numberOfLines = 0

        let textStack = UIStackView(arrangedSubviews: [
            titleLabel,
            detailLabel
        ])
        textStack.axis = .vertical
        textStack.spacing = 2

        let row = UIStackView(arrangedSubviews: [
            numberLabel,
            textStack
        ])
        row.axis = .horizontal
        row.spacing = 12
        row.alignment = .top

        return row
    }
    
    private func refreshIOSView(message: String? = nil) {
        let session = try? AppSessionStore.read()
        let signedIn = session != nil

        let identity =
            (session?["name"] as? String)
                .flatMap { $0.isEmpty ? nil : $0 }
            ?? (session?["email"] as? String)
                .flatMap { $0.isEmpty ? nil : $0 }

        if signedIn {
            statusIconView.image = UIImage(systemName: "checkmark.circle.fill")
            statusIconView.tintColor = .systemGreen

            statusTitleLabel.text = "You're signed in"

            if let identity {
                statusDetailLabel.text = "Signed in as \(identity)"
            } else {
                statusDetailLabel.text = "Your Novel Tracker account is ready."
            }
        } else {
            statusIconView.image = UIImage(systemName: "icloud.slash")
            statusIconView.tintColor = .secondaryLabel

            statusTitleLabel.text = "Cloud sync is off"
            statusDetailLabel.text =
                "Sign in to sync your library with the Safari extension."
        }

        if let message {
            statusDetailLabel.text = message
        }

        actionButton.isHidden = signedIn
        signOutButton.isHidden = !signedIn
    }
    @objc private func signIn() {
        actionButton.isEnabled = false
        let verifier = randomValue(byteCount: 48)
        let state = randomValue(byteCount: 24)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        var parts = URLComponents(string: "\(issuer)/protocol/openid-connect/auth")!
        parts.queryItems = [
            .init(name: "client_id", value: clientID), .init(name: "redirect_uri", value: callbackURL),
            .init(name: "response_type", value: "code"), .init(name: "scope", value: "openid profile email offline_access"),
            .init(name: "state", value: state), .init(name: "nonce", value: randomValue(byteCount: 24)),
            .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256"),
            .init(name: "kc_idp_hint", value: "google")
        ]
        let session = ASWebAuthenticationSession(url: parts.url!, callbackURLScheme: "noveltracker") { [weak self] url, error in
            DispatchQueue.main.async { self?.actionButton.isEnabled = true }
            guard let self else { return }
            if let error { return DispatchQueue.main.async { self.refreshIOSView(message: error.localizedDescription) } }
            guard let url, let values = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  values.queryItems?.first(where: { $0.name == "state" })?.value == state,
                  let code = values.queryItems?.first(where: { $0.name == "code" })?.value else {
                return DispatchQueue.main.async { self.refreshIOSView(message: "The authorization response could not be verified. Please try again.") }
            }
            self.exchange(code: code, verifier: verifier)
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authenticationSession = session
        if !session.start() { actionButton.isEnabled = true; refreshIOSView(message: "Could not open Google sign-in.") }
    }

    private func exchange(code: String, verifier: String) {
        var request = URLRequest(url: URL(string: "\(issuer)/protocol/openid-connect/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = formEncoded(["grant_type": "authorization_code", "client_id": clientID, "redirect_uri": callbackURL, "code": code, "code_verifier": verifier]).data(using: .utf8)
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            guard let self else { return }
            do {
                if let error { throw error }
                guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode), let data else { throw OAuthError.tokenExchange }
                guard let tokens = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let access = tokens["access_token"] as? String, let refresh = tokens["refresh_token"] as? String else { throw OAuthError.tokenExchange }
                let idToken = tokens["id_token"] as? String ?? ""
                let claims = decodeJWT(idToken.isEmpty ? access : idToken)
                let expires = (tokens["expires_in"] as? NSNumber)?.doubleValue ?? 300
                try AppSessionStore.write([
                    "accessToken": access, "refreshToken": refresh, "idToken": idToken,
                    "expiresAt": Date().timeIntervalSince1970 * 1000 + max(0, expires - 30) * 1000,
                    "subject": claims["sub"] as? String ?? "", "email": claims["email"] as? String ?? "",
                    "name": claims["name"] as? String ?? claims["preferred_username"] as? String ?? ""
                ])
                DispatchQueue.main.async { self.refreshIOSView() }
            } catch { DispatchQueue.main.async { self.refreshIOSView(message: "Sign-in failed: \(error.localizedDescription)") } }
        }.resume()
    }

    @objc private func signOut() { do { try AppSessionStore.clear(); refreshIOSView() } catch { refreshIOSView(message: error.localizedDescription) } }
#endif

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
#if os(iOS)
        return view.window ?? UIWindow()
#else
        return view.window ?? NSWindow()
#endif
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
#if os(macOS)
        webView.evaluateJavaScript("show('mac')")
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            guard let state, error == nil else { return }
            DispatchQueue.main.async { webView.evaluateJavaScript("show('mac', \(state.isEnabled), true)") }
        }
#endif
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
#if os(macOS)
        guard message.body as? String == "open-preferences" else { return }
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            if error == nil { DispatchQueue.main.async { NSApp.terminate(self) } }
        }
#endif
    }
}

private enum OAuthError: LocalizedError { case tokenExchange; var errorDescription: String? { "The authentication server rejected the token exchange." } }
private func randomValue(byteCount: Int) -> String { var bytes = [UInt8](repeating: 0, count: byteCount); _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes); return Data(bytes).base64URL }
private func formEncoded(_ values: [String: String]) -> String { var components = URLComponents(); components.queryItems = values.map(URLQueryItem.init); return components.percentEncodedQuery ?? "" }
private func decodeJWT(_ token: String) -> [String: Any] { let parts = token.split(separator: "."); guard parts.count > 1, let data = Data(base64URLEncoded: String(parts[1])), let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }; return value }
private extension Data {
    var base64URL: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    init?(base64URLEncoded value: String) { var input = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/"); input += String(repeating: "=", count: (4 - input.count % 4) % 4); self.init(base64Encoded: input) }
}
