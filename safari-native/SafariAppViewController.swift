
import AuthenticationServices
import CryptoKit
import Security
import WebKit


import SafariServices

#if os(iOS)
import UIKit
typealias PlatformViewController = UIViewController
#else
import Cocoa
typealias PlatformViewController = NSViewController
#endif

#if os(iOS)
// Matches the light paper-and-copper palette in src/options.css.
private enum AppTheme {
    static let paper = UIColor(red: 242/255, green: 237/255, blue: 229/255, alpha: 1)
    static let sheet = UIColor(red: 255/255, green: 253/255, blue: 249/255, alpha: 1)
    static let ink = UIColor(red: 32/255, green: 39/255, blue: 45/255, alpha: 1)
    static let muted = UIColor(red: 112/255, green: 119/255, blue: 124/255, alpha: 1)
    static let copper = UIColor(red: 191/255, green: 105/255, blue: 59/255, alpha: 1)
    static let copperDark = UIColor(red: 145/255, green: 70/255, blue: 34/255, alpha: 1)
    static let line = UIColor(red: 221/255, green: 212/255, blue: 199/255, alpha: 1)
    static let success = UIColor(red: 100/255, green: 132/255, blue: 111/255, alpha: 1)
    static let danger = UIColor(red: 169/255, green: 80/255, blue: 72/255, alpha: 1)
}
#endif

private let extensionBundleIdentifier = "app.noveltracker.extension.Extension"
private let issuer = "https://auth.novel.bghimire.com/realms/novel-tracker"
private let apiBaseURL = "https://api.novel.bghimire.com"
private let apiVersion = "v1"
private let clientID = "novel-tracker-extension"
private let callbackURL = "noveltracker://oauth/callback"

/// Mirrors `AUTH_PROVIDERS` in src/lib/config.js. Both providers are brokered
/// by Keycloak, so one authorization-code + PKCE flow serves both and only
/// `kc_idp_hint` differs — the app and the extension sign in the same way.
///
/// Sign in with Apple is required by App Store guideline 4.8. Because it is
/// brokered rather than native, the same account also works from Chrome and
/// Firefox, where a native Apple flow would not exist.
struct SignInProvider {
    let id: String
    let label: String
    let idpHint: String
}

let signInProviders = [
    SignInProvider(id: "google", label: "Sign in with Google", idpHint: "google"),
    SignInProvider(id: "apple", label: "Sign in with Apple", idpHint: "apple")
]

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
    private let scrollView = UIScrollView()
    private let contentStack = UIStackView()
    private let iconContainer = UIView()
    private let iconImageView = UIImageView()
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let extensionCard = UIView()
    private let extensionIconView = UIImageView()
    private let extensionTitleLabel = UILabel()
    private let extensionDetailLabel = UILabel()
    private let extensionActionButton = UIButton(type: .system)
    private var enableStepBadge: UILabel?
    private let statusCard = UIView()
    private let statusIconView = UIImageView()
    private let statusTitleLabel = UILabel()
    private let statusDetailLabel = UILabel()
    private let setupTitleLabel = UILabel()
    private let setupStack = UIStackView()
    private let signInStack = UIStackView()
    private var signInButtons: [UIButton] = []
    private let signOutButton = UIButton(type: .system)
    private let deleteAccountButton = UIButton(type: .system)
#endif

    override func viewDidLoad() {
        super.viewDidLoad()
#if os(iOS)
        configureIOSView()
        refreshIOSView()
        refreshExtensionState()
        // Readers leave for Settings or Safari to switch the extension on;
        // show the result when they come back.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(refreshExtensionState),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
#else
        webView.navigationDelegate = self
        webView.configuration.userContentController.add(self, name: "controller")
        webView.loadFileURL(Bundle.main.url(forResource: "Main", withExtension: "html")!, allowingReadAccessTo: Bundle.main.resourceURL!)
#endif
    }

#if os(iOS)
    private func configureIOSView() {
        webView?.isHidden = true
        overrideUserInterfaceStyle = .light
        view.backgroundColor = AppTheme.paper
        view.tintColor = AppTheme.copperDark

        // MARK: - Scroll container

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        contentStack.translatesAutoresizingMaskIntoConstraints = false

        contentStack.axis = .vertical
        contentStack.spacing = 20
        contentStack.alignment = .fill

        view.addSubview(scrollView)
        scrollView.addSubview(contentStack)
        let contentWidth = contentStack.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor, constant: -48)
        // Above the labels' default compression resistance (750) so multi-line text wraps
        // instead of widening the stack, below required so the 560pt cap wins on iPad.
        contentWidth.priority = UILayoutPriority(999)

        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            scrollView.contentLayoutGuide.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor),

            contentStack.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: 24),
            contentStack.centerXAnchor.constraint(equalTo: scrollView.frameLayoutGuide.centerXAnchor),
            contentStack.widthAnchor.constraint(lessThanOrEqualToConstant: 560),
            contentWidth,
            contentStack.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -24)
        ])

        // MARK: - Hero

        iconContainer.translatesAutoresizingMaskIntoConstraints = false
        iconContainer.backgroundColor = AppTheme.ink
        iconContainer.layer.cornerRadius = 14
        iconContainer.layer.cornerCurve = .continuous

        iconImageView.translatesAutoresizingMaskIntoConstraints = false
        iconImageView.image = UIImage(systemName: "bookmark.fill")
        iconImageView.tintColor = AppTheme.copper
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
        titleLabel.font = UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: UIFont(name: "Georgia-Bold", size: 30) ?? .preferredFont(forTextStyle: .largeTitle))
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.numberOfLines = 0
        titleLabel.textAlignment = .center
        titleLabel.textColor = AppTheme.ink

        subtitleLabel.text = "Remembers where you stopped reading on novel sites in Safari, and takes you back there."
        subtitleLabel.font = .preferredFont(forTextStyle: .body)
        subtitleLabel.textColor = AppTheme.muted
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

        // MARK: - Extension status

        // The reading features all live in the Safari extension, so whether
        // it is switched on is the first thing this screen answers.
        configureExtensionCard()
        contentStack.addArrangedSubview(extensionCard)

        // MARK: - Account status card

        statusCard.backgroundColor = AppTheme.sheet
        statusCard.layer.cornerRadius = 14
        statusCard.layer.borderWidth = 1
        statusCard.layer.borderColor = AppTheme.line.cgColor
        statusCard.layer.cornerCurve = .continuous

        statusIconView.translatesAutoresizingMaskIntoConstraints = false
        statusIconView.contentMode = .scaleAspectFit
        statusIconView.tintColor = AppTheme.muted

        statusTitleLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        statusTitleLabel.textColor = AppTheme.ink
        statusTitleLabel.numberOfLines = 0

        statusDetailLabel.font = .preferredFont(forTextStyle: .subheadline)
        statusDetailLabel.textColor = AppTheme.muted
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


        // MARK: - Sign-in buttons

        signInStack.axis = .vertical
        signInStack.spacing = 12
        signInStack.alignment = .fill

        // One button per entry in `signInProviders`, so adding a provider means
        // adding a line there rather than another bespoke button here.
        signInButtons = signInProviders.enumerated().map { index, provider in
            let button = UIButton(type: .system)
            var config = UIButton.Configuration.filled()
            config.title = provider.label
            config.imagePadding = 10
            config.cornerStyle = .fixed
            config.background.cornerRadius = 9
            config.contentInsets = NSDirectionalEdgeInsets(
                top: 15,
                leading: 20,
                bottom: 15,
                trailing: 20
            )

            if provider.id == "apple" {
                // Apple requires its own mark and a black or white ground for
                // this button; the copper theme does not apply here.
                config.image = UIImage(systemName: "apple.logo")
                config.baseBackgroundColor = .black
                config.baseForegroundColor = .white
            } else {
                config.image = UIImage(systemName: "person.crop.circle.badge.checkmark")
                config.baseBackgroundColor = AppTheme.copperDark
                config.baseForegroundColor = .white
            }

            button.configuration = config
            button.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
            button.tag = index
            button.addTarget(self, action: #selector(signInTapped(_:)), for: .touchUpInside)
            return button
        }

        signInButtons.forEach(signInStack.addArrangedSubview)

        // Keep this guidance short enough for compact iPhone layouts. The
        // account-switch confirmation carries the fuller explanation only
        // when it becomes relevant.
        let providerNoteLabel = UILabel()
        providerNoteLabel.text = "Use the same sign-in on each device."
        providerNoteLabel.font = .preferredFont(forTextStyle: .footnote)
        providerNoteLabel.textColor = AppTheme.muted
        providerNoteLabel.textAlignment = .center
        providerNoteLabel.numberOfLines = 0
        signInStack.addArrangedSubview(providerNoteLabel)

        // MARK: - Safari setup

        setupTitleLabel.text = "Set up in Safari"
        setupTitleLabel.font = UIFontMetrics(forTextStyle: .title2).scaledFont(for: UIFont(name: "Georgia-Bold", size: 20) ?? .preferredFont(forTextStyle: .title2))
        setupTitleLabel.adjustsFontForContentSizeCategory = true
        setupTitleLabel.numberOfLines = 0
        setupTitleLabel.textColor = AppTheme.ink

        setupStack.axis = .vertical
        setupStack.spacing = 14

        // Novel Tracker's reading features live in the Safari extension, so a
        // reader who stops at this screen never reaches them. Each step names
        // what to tap, in the order Safari shows it. The Manage Extensions
        // route from the page menu is shorter than Settings and leads
        // straight into the permission prompt, and the last step reaches the
        // library, which App Review needed to find.
        let enableRow = makeSetupRow(
            number: "1",
            title: "Turn on Novel Tracker",
            detail: "In Safari, tap the page menu button in the address bar, choose Manage Extensions, and switch on Novel Tracker."
        )
        enableStepBadge = enableRow.badge
        setupStack.addArrangedSubview(enableRow.view)

        setupStack.addArrangedSubview(
            makeSetupRow(
                number: "2",
                title: "Always allow it on your reading sites",
                detail: "Tap Novel Tracker in that menu, then Always Allow, then Always Allow on Every Website. It only reads the novel sites it supports. \u{201C}Allow for One Day\u{201D} stops tracking tomorrow."
            ).view
        )

        setupStack.addArrangedSubview(
            makeSetupRow(
                number: "3",
                title: "Save your first chapter",
                detail: "On a chapter, open Novel Tracker from the page menu and tap Save bookmark. From then on it follows you from chapter to chapter by itself."
            ).view
        )

        setupStack.addArrangedSubview(
            makeSetupRow(
                number: "4",
                title: "Open your library",
                detail: "Tap the library button at the top of the Novel Tracker popup to see everything you\u{2019}re reading, search it, and export a backup."
            ).view
        )

        let setupHeader = UIStackView(arrangedSubviews: [setupTitleLabel])
        setupHeader.axis = .horizontal
        setupHeader.alignment = .center

        let setupContainer = UIStackView(arrangedSubviews: [
            setupHeader,
            setupStack
        ])
        setupContainer.axis = .vertical
        setupContainer.spacing = 16

        contentStack.addArrangedSubview(setupContainer)

        // MARK: - Optional sync

        let accountTitleLabel = UILabel()
        accountTitleLabel.text = "Sync across devices"
        accountTitleLabel.font = setupTitleLabel.font
        accountTitleLabel.adjustsFontForContentSizeCategory = true
        accountTitleLabel.numberOfLines = 0
        accountTitleLabel.textColor = AppTheme.ink

        let accountNoteLabel = UILabel()
        accountNoteLabel.text = "Optional. Your library works without an account; sign in to keep it in step on your other devices and browsers."
        accountNoteLabel.font = .preferredFont(forTextStyle: .subheadline)
        accountNoteLabel.adjustsFontForContentSizeCategory = true
        accountNoteLabel.textColor = AppTheme.muted
        accountNoteLabel.numberOfLines = 0

        let accountContainer = UIStackView(arrangedSubviews: [
            accountTitleLabel,
            accountNoteLabel,
            statusCard,
            signInStack
        ])
        accountContainer.axis = .vertical
        accountContainer.spacing = 12
        accountContainer.setCustomSpacing(16, after: accountNoteLabel)
        accountContainer.setCustomSpacing(16, after: statusCard)

        contentStack.addArrangedSubview(accountContainer)

        // MARK: - Sign out and account deletion

        signOutButton.setTitle("Sign Out", for: .normal)
        signOutButton.setTitleColor(AppTheme.muted, for: .normal)
        signOutButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .medium)
        signOutButton.addTarget(self, action: #selector(signOut), for: .touchUpInside)

        contentStack.addArrangedSubview(signOutButton)

        // Account creation happens in this app on iOS, so account deletion has
        // to be reachable here too (App Store guideline 5.1.1(v)).
        deleteAccountButton.setTitle("Delete Account", for: .normal)
        deleteAccountButton.setTitleColor(AppTheme.danger, for: .normal)
        deleteAccountButton.titleLabel?.font = .systemFont(ofSize: 16, weight: .semibold)
        deleteAccountButton.addTarget(self, action: #selector(confirmDeleteAccount), for: .touchUpInside)

        contentStack.addArrangedSubview(deleteAccountButton)
    }

    private func configureExtensionCard() {
        extensionCard.backgroundColor = AppTheme.sheet
        extensionCard.layer.cornerRadius = 14
        extensionCard.layer.borderWidth = 1
        extensionCard.layer.borderColor = AppTheme.line.cgColor
        extensionCard.layer.cornerCurve = .continuous

        extensionIconView.translatesAutoresizingMaskIntoConstraints = false
        extensionIconView.contentMode = .scaleAspectFit

        extensionTitleLabel.font = .systemFont(ofSize: 17, weight: .semibold)
        extensionTitleLabel.textColor = AppTheme.ink
        extensionTitleLabel.numberOfLines = 0

        extensionDetailLabel.font = .preferredFont(forTextStyle: .subheadline)
        extensionDetailLabel.adjustsFontForContentSizeCategory = true
        extensionDetailLabel.textColor = AppTheme.muted
        extensionDetailLabel.numberOfLines = 0

        var config = UIButton.Configuration.filled()
        config.title = "Turn On in Settings"
        config.image = UIImage(systemName: "gear")
        config.imagePadding = 8
        config.cornerStyle = .fixed
        config.background.cornerRadius = 9
        config.baseBackgroundColor = AppTheme.copperDark
        config.baseForegroundColor = .white
        config.contentInsets = NSDirectionalEdgeInsets(top: 13, leading: 18, bottom: 13, trailing: 18)
        extensionActionButton.configuration = config
        extensionActionButton.addTarget(self, action: #selector(openExtensionSettings), for: .touchUpInside)

        let textStack = UIStackView(arrangedSubviews: [extensionTitleLabel, extensionDetailLabel])
        textStack.axis = .vertical
        textStack.spacing = 4

        let row = UIStackView(arrangedSubviews: [extensionIconView, textStack])
        row.axis = .horizontal
        row.spacing = 14
        row.alignment = .center

        let stack = UIStackView(arrangedSubviews: [row, extensionActionButton])
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        extensionCard.addSubview(stack)

        NSLayoutConstraint.activate([
            extensionIconView.widthAnchor.constraint(equalToConstant: 32),
            extensionIconView.heightAnchor.constraint(equalToConstant: 32),
            stack.topAnchor.constraint(equalTo: extensionCard.topAnchor, constant: 18),
            stack.leadingAnchor.constraint(equalTo: extensionCard.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: extensionCard.trailingAnchor, constant: -18),
            stack.bottomAnchor.constraint(equalTo: extensionCard.bottomAnchor, constant: -18)
        ])

        applyExtensionState(nil)
    }

    /// iOS 26.2 lets the app ask Safari whether the extension is switched on,
    /// so the card can say so instead of always showing setup. Earlier
    /// versions can't tell; there the card points at the steps below.
    @objc private func refreshExtensionState() {
        guard #available(iOS 26.2, *) else { return applyExtensionState(nil) }
        SFSafariExtensionManager.getStateOfExtension(withIdentifier: extensionBundleIdentifier) { [weak self] state, error in
            DispatchQueue.main.async {
                self?.applyExtensionState(error == nil ? state?.isEnabled : nil)
            }
        }
    }

    /// `true`: on; `false`: installed but switched off; `nil`: unknown.
    private func applyExtensionState(_ enabled: Bool?) {
        switch enabled {
        case true?:
            extensionIconView.image = UIImage(systemName: "checkmark.circle.fill")
            extensionIconView.tintColor = AppTheme.success
            extensionTitleLabel.text = "Novel Tracker is on in Safari"
            extensionDetailLabel.text = "Open a chapter on a supported novel site, tap the page menu button in the address bar, then Novel Tracker."
            extensionActionButton.isHidden = true
        case false?:
            extensionIconView.image = UIImage(systemName: "exclamationmark.circle.fill")
            extensionIconView.tintColor = AppTheme.copper
            extensionTitleLabel.text = "Novel Tracker is off in Safari"
            extensionDetailLabel.text = "It\u{2019}s installed but switched off, so nothing is being tracked yet. Turn it on, then allow it on your reading sites."
            extensionActionButton.isHidden = false
        case nil:
            extensionIconView.image = UIImage(systemName: "safari")
            extensionIconView.tintColor = AppTheme.muted
            extensionTitleLabel.text = "Turn on Novel Tracker in Safari"
            extensionDetailLabel.text = "Follow the steps below once. Safari keeps it on after that."
            // Before iOS 26.2 the only settings link lands on the top of the
            // Settings app, which is a dead end; the steps give the Safari route.
            extensionActionButton.isHidden = true
        }

        let done = enabled == true
        enableStepBadge?.text = done ? "\u{2713}" : "1"
        enableStepBadge?.backgroundColor = done ? AppTheme.success : AppTheme.copperDark
        enableStepBadge?.accessibilityLabel = done ? "Done" : "Step 1"
    }

    /// Opens Novel Tracker's own page under Settings, Apps, Safari,
    /// Extensions (iOS 26.2+), where it can be switched on and allowed on
    /// every website in one place.
    @objc private func openExtensionSettings() {
        if #available(iOS 26.2, *) {
            SFSafariSettings.openExtensionsSettings(forIdentifiers: [extensionBundleIdentifier]) { [weak self] error in
                if error != nil { self?.openAppSettings() }
            }
        } else {
            openAppSettings()
        }
    }

    private func openAppSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    private func makeSetupRow(
        number: String,
        title: String,
        detail: String
    ) -> (view: UIView, badge: UILabel) {
        let numberLabel = UILabel()
        numberLabel.text = number
        numberLabel.textAlignment = .center
        numberLabel.font = .systemFont(ofSize: 14, weight: .bold)
        numberLabel.textColor = .white
        numberLabel.backgroundColor = AppTheme.copperDark
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
        titleLabel.textColor = AppTheme.ink
        titleLabel.numberOfLines = 0

        let detailLabel = UILabel()
        detailLabel.text = detail
        detailLabel.font = .preferredFont(forTextStyle: .subheadline)
        detailLabel.textColor = AppTheme.muted
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

        return (row, numberLabel)
    }

    private func refreshIOSView(message: String? = nil) {
        let session = try? AppSessionStore.read()
        let signedIn = session != nil

        let identity =
            (session?["name"] as? String)
                .flatMap { $0.isEmpty ? nil : $0 }
            ?? (session?["email"] as? String)
                .flatMap { $0.isEmpty ? nil : $0 }

        let providerLabel = (session?["provider"] as? String).flatMap { id in
            signInProviders.first { $0.id == id }?.label.replacingOccurrences(of: "Sign in with ", with: "")
        }

        if signedIn {
            statusIconView.image = UIImage(systemName: "checkmark.circle.fill")
            statusIconView.tintColor = AppTheme.success

            statusTitleLabel.text = "You're signed in"

            switch (identity, providerLabel) {
            case let (identity?, provider?):
                statusDetailLabel.text = "Signed in as \(identity) with \(provider)"
            case let (identity?, nil):
                statusDetailLabel.text = "Signed in as \(identity)"
            case let (nil, provider?):
                statusDetailLabel.text = "Signed in with \(provider)"
            default:
                statusDetailLabel.text = "Your Novel Tracker account is ready."
            }
        } else {
            statusIconView.image = UIImage(systemName: "icloud.slash")
            statusIconView.tintColor = AppTheme.muted

            statusTitleLabel.text = "Cloud sync is off"
            statusDetailLabel.text =
                "Sign in to sync your library with the Safari extension."
        }

        if let message {
            statusDetailLabel.text = message
        }

        signInStack.isHidden = signedIn
        signOutButton.isHidden = !signedIn
        deleteAccountButton.isHidden = !signedIn
    }

    private func setSignInEnabled(_ enabled: Bool) {
        signInButtons.forEach { $0.isEnabled = enabled }
    }

    @objc private func signInTapped(_ sender: UIButton) {
        guard signInProviders.indices.contains(sender.tag) else { return }
        signIn(provider: signInProviders[sender.tag])
    }

    private func signIn(provider: SignInProvider) {
        setSignInEnabled(false)
        let verifier = randomValue(byteCount: 48)
        let state = randomValue(byteCount: 24)
        let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URL
        var parts = URLComponents(string: "\(issuer)/protocol/openid-connect/auth")!
        parts.queryItems = [
            .init(name: "client_id", value: clientID), .init(name: "redirect_uri", value: callbackURL),
            .init(name: "response_type", value: "code"), .init(name: "scope", value: "openid profile email offline_access"),
            .init(name: "state", value: state), .init(name: "nonce", value: randomValue(byteCount: 24)),
            .init(name: "code_challenge", value: challenge), .init(name: "code_challenge_method", value: "S256"),
            .init(name: "kc_idp_hint", value: provider.idpHint)
        ]
        let session = ASWebAuthenticationSession(url: parts.url!, callbackURLScheme: "noveltracker") { [weak self] url, error in
            DispatchQueue.main.async { self?.setSignInEnabled(true) }
            guard let self else { return }
            if let error { return DispatchQueue.main.async { self.refreshIOSView(message: error.localizedDescription) } }
            guard let url, let values = URLComponents(url: url, resolvingAgainstBaseURL: false),
                  values.queryItems?.first(where: { $0.name == "state" })?.value == state,
                  let code = values.queryItems?.first(where: { $0.name == "code" })?.value else {
                return DispatchQueue.main.async { self.refreshIOSView(message: "The authorization response could not be verified. Please try again.") }
            }
            self.exchange(code: code, verifier: verifier, provider: provider)
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        authenticationSession = session
        if !session.start() {
            setSignInEnabled(true)
            refreshIOSView(message: "Could not open \(provider.label).")
        }
    }

    private func exchange(code: String, verifier: String, provider: SignInProvider) {
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
                    "name": claims["name"] as? String ?? claims["preferred_username"] as? String ?? "",
                    // Keycloak's `provider` claim when the mapper is present,
                    // otherwise the button that was tapped. The extension reads
                    // this out of the shared keychain session, and account
                    // deletion needs it to know whether to revoke an Apple grant.
                    "provider": claims["provider"] as? String ?? provider.id
                ])
                DispatchQueue.main.async { self.refreshIOSView() }
            } catch { DispatchQueue.main.async { self.refreshIOSView(message: "Sign-in failed: \(error.localizedDescription)") } }
        }.resume()
    }

    @objc private func signOut() { do { try AppSessionStore.clear(); refreshIOSView() } catch { refreshIOSView(message: error.localizedDescription) } }

    // MARK: - Account deletion

    /// Keycloak access tokens are short-lived (minutes), and the reader may have
    /// left this screen open far longer than that, so the stored token is
    /// refreshed before use rather than sent straight to a 401.
    private func withAccessToken(_ completion: @escaping (Result<String, Error>) -> Void) {
        guard let session = try? AppSessionStore.read(),
              let access = session["accessToken"] as? String,
              let refresh = session["refreshToken"] as? String else {
            return completion(.failure(OAuthError.notSignedIn))
        }

        let expiresAt = (session["expiresAt"] as? NSNumber)?.doubleValue ?? 0
        if Date().timeIntervalSince1970 * 1000 < expiresAt { return completion(.success(access)) }

        var request = URLRequest(url: URL(string: "\(issuer)/protocol/openid-connect/token")!)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        request.httpBody = formEncoded([
            "grant_type": "refresh_token", "client_id": clientID, "refresh_token": refresh
        ]).data(using: .utf8)

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error { return completion(.failure(error)) }
            guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode), let data,
                  let tokens = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let refreshed = tokens["access_token"] as? String else {
                return completion(.failure(OAuthError.tokenExchange))
            }

            var updated = session
            updated["accessToken"] = refreshed
            updated["refreshToken"] = tokens["refresh_token"] as? String ?? refresh
            let expires = (tokens["expires_in"] as? NSNumber)?.doubleValue ?? 300
            updated["expiresAt"] = Date().timeIntervalSince1970 * 1000 + max(0, expires - 30) * 1000
            try? AppSessionStore.write(updated)

            completion(.success(refreshed))
        }.resume()
    }

    @objc private func confirmDeleteAccount() {
        let alert = UIAlertController(
            title: "Delete Account?",
            message: "This permanently deletes your Novel Tracker account and everything synced to it. The library saved in Safari on this device is not removed. This cannot be undone.",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Delete Account", style: .destructive) { [weak self] _ in
            self?.deleteAccount()
        })
        present(alert, animated: true)
    }

    private func deleteAccount() {
        deleteAccountButton.isEnabled = false
        refreshIOSView(message: "Deleting your account…")

        withAccessToken { [weak self] result in
            guard let self else { return }

            func finish(_ message: String) {
                DispatchQueue.main.async {
                    self.deleteAccountButton.isEnabled = true
                    self.refreshIOSView(message: message)
                }
            }

            guard case let .success(token) = result else {
                return finish("Could not delete your account. Please sign in again and retry.")
            }

            var request = URLRequest(url: URL(string: "\(apiBaseURL)/\(apiVersion)/account")!)
            request.httpMethod = "DELETE"
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.setValue(String(apiVersion.dropFirst()), forHTTPHeaderField: "X-Novel-Tracker-API-Version")
            request.setValue(
                Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
                forHTTPHeaderField: "X-Novel-Tracker-Client-Version"
            )
            request.setValue("safari-ios-app", forHTTPHeaderField: "X-Novel-Tracker-Client-Platform")

            URLSession.shared.dataTask(with: request) { _, response, error in
                if let error { return finish("Could not delete your account: \(error.localizedDescription)") }
                guard let response = response as? HTTPURLResponse, (200..<300).contains(response.statusCode) else {
                    return finish("Could not delete your account. Please try again.")
                }
                // The account is gone server-side; the local session must go
                // too, or the app would keep showing a signed-in state for it.
                try? AppSessionStore.clear()
                DispatchQueue.main.async {
                    self.deleteAccountButton.isEnabled = true
                    self.refreshIOSView(message: "Your account has been deleted.")
                }
            }.resume()
        }
    }
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

private enum OAuthError: LocalizedError {
    case tokenExchange
    case notSignedIn

    var errorDescription: String? {
        switch self {
        case .tokenExchange: return "The authentication server rejected the token exchange."
        case .notSignedIn: return "You are not signed in."
        }
    }
}
private func randomValue(byteCount: Int) -> String { var bytes = [UInt8](repeating: 0, count: byteCount); _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes); return Data(bytes).base64URL }
private func formEncoded(_ values: [String: String]) -> String { var components = URLComponents(); components.queryItems = values.map(URLQueryItem.init); return components.percentEncodedQuery ?? "" }
private func decodeJWT(_ token: String) -> [String: Any] { let parts = token.split(separator: "."); guard parts.count > 1, let data = Data(base64URLEncoded: String(parts[1])), let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }; return value }
private extension Data {
    var base64URL: String { base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
    init?(base64URLEncoded value: String) { var input = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/"); input += String(repeating: "=", count: (4 - input.count % 4) % 4); self.init(base64Encoded: input) }
}
