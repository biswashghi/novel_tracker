require "minitest/autorun"
require_relative "../safari-app/fastlane/app_store_release"

class AppStoreReleaseTest < Minitest::Test
  Version = Struct.new(:app_version_state, :locales) do
    def get_app_store_version_localizations
      locales.map { |locale| Struct.new(:locale).new(locale) }
    end
  end

  class FakeApp
    attr_reader :primary_locale, :queries

    def initialize(versions: [], latest: nil, primary_locale: "en-US")
      @versions = versions
      @latest = latest
      @primary_locale = primary_locale
      @queries = []
    end

    def get_app_store_versions(filter:)
      @queries << filter
      @versions
    end

    def get_latest_app_store_version(platform:)
      @queries << { latest: platform }
      @latest
    end
  end

  def test_a_version_in_review_or_later_counts_as_already_submitted
    %w[WAITING_FOR_REVIEW IN_REVIEW PENDING_DEVELOPER_RELEASE READY_FOR_DISTRIBUTION].each do |state|
      app = FakeApp.new(versions: [Version.new(state, [])])
      assert AppStoreRelease.submitted_version(app, "IOS", "1.2.0"), state
    end
  end

  def test_a_version_that_can_still_take_a_build_is_submitted_again
    %w[PREPARE_FOR_SUBMISSION REJECTED DEVELOPER_REJECTED METADATA_REJECTED INVALID_BINARY].each do |state|
      app = FakeApp.new(versions: [Version.new(state, [])])
      assert_nil AppStoreRelease.submitted_version(app, "MAC_OS", "1.2.0"), state
    end
    assert_nil AppStoreRelease.submitted_version(FakeApp.new, "IOS", "1.2.0"), "no such version yet"
  end

  def test_the_lookup_is_for_this_version_on_this_platform
    app = FakeApp.new
    AppStoreRelease.submitted_version(app, "MAC_OS", "1.2.0")
    assert_equal [{ versionString: "1.2.0", platform: "MAC_OS" }], app.queries
  end

  def test_notes_go_to_every_language_the_listing_has
    app = FakeApp.new(latest: Version.new("READY_FOR_DISTRIBUTION", %w[en-US ja en-US]))
    languages = AppStoreRelease.listing_languages(app, "IOS")
    assert_equal %w[en-US ja], languages
    assert_equal({ "en-US" => "Notes", "ja" => "Notes" }, AppStoreRelease.release_notes(languages, "Notes"))
    refute_includes AppStoreRelease.release_notes(languages, "Notes").keys, "default"
  end

  def test_a_listing_without_versions_falls_back_to_its_primary_language
    assert_equal ["en-GB"], AppStoreRelease.listing_languages(FakeApp.new(primary_locale: "en-GB"), "MAC_OS")
    empty = FakeApp.new(latest: Version.new("PREPARE_FOR_SUBMISSION", []), primary_locale: "en-US")
    assert_equal ["en-US"], AppStoreRelease.listing_languages(empty, "IOS")
  end
end
