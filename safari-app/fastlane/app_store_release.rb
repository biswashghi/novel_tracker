# Decisions the Fastfile makes against App Store Connect before submitting a
# version, kept apart from the lanes so they can be tested without Apple
# (tests/app-store-release.test.rb). Objects are Spaceship::ConnectAPI models,
# or anything answering the same methods.
module AppStoreRelease
  # App Store version states that can still take a build. Anything else
  # (waiting for or in review, approved, live) means the version already went
  # through on an earlier run of its release.
  EDITABLE_STATES = %w[
    PREPARE_FOR_SUBMISSION
    DEVELOPER_REJECTED
    REJECTED
    METADATA_REJECTED
    INVALID_BINARY
  ].freeze

  module_function

  # The app's App Store version for `version_string` on `platform` if it is
  # past the point of taking a new build, else nil.
  def submitted_version(app, platform, version_string)
    version = app.get_app_store_versions(filter: { versionString: version_string, platform: platform }).first
    return nil if version.nil? || EDITABLE_STATES.include?(version.app_version_state)

    version
  end

  # The languages the listing has, from its most recent version (a new
  # version starts with the same ones). Every one of them needs "What's New".
  # deliver's "default" language only expands to languages it finds locally,
  # and there are none in a release, so notes passed under "default" were
  # silently dropped and App Review refused 1.2.0's first submission.
  def listing_languages(app, platform)
    version = app.get_latest_app_store_version(platform: platform)
    languages = version ? version.get_app_store_version_localizations.map(&:locale) : []
    languages.empty? ? [app.primary_locale] : languages.uniq
  end

  def release_notes(languages, notes)
    languages.to_h { |language| [language, notes] }
  end
end
