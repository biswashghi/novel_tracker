require "minitest/autorun"
require_relative "../safari-app/fastlane/installer_certificate"

class InstallerCertificateTest < Minitest::Test
  def setup
    @key = OpenSSL::PKey::RSA.new(2048)
    @now = Time.utc(2026, 8, 31)
  end

  def certificate(key: @key, team: "TESTTEAM", starts: @now - 60, expires: @now + 3600)
    cert = OpenSSL::X509::Certificate.new
    cert.version = 2
    cert.serial = 1
    cert.subject = OpenSSL::X509::Name.parse("/CN=Test Installer/OU=#{team}")
    cert.issuer = cert.subject
    cert.public_key = key.public_key
    cert.not_before = starts
    cert.not_after = expires
    cert.sign(key, OpenSSL::Digest::SHA256.new)
    cert
  end

  def match(certificates, key: @key)
    InstallerCertificate.match(key, certificates, team_id: "TESTTEAM", now: @now)
  end

  def test_matches_by_private_key_instead_of_display_name_or_list_order
    unrelated = certificate(key: OpenSSL::PKey::RSA.new(2048))
    expected = certificate
    assert_same expected, match([unrelated, expected])
  end

  def test_rejects_a_certificate_for_another_private_key
    assert_raises(ArgumentError) { match([certificate(key: OpenSSL::PKey::RSA.new(2048))]) }
  end

  def test_rejects_another_team_even_when_the_key_matches
    assert_raises(ArgumentError) { match([certificate(team: "OTHERTEAM")]) }
  end

  def test_rejects_expired_certificates
    assert_raises(ArgumentError) { match([certificate(expires: @now)]) }
  end

  def test_rejects_certificates_not_yet_valid
    assert_raises(ArgumentError) { match([certificate(starts: @now + 60)]) }
  end

  def test_reports_a_missing_certificate
    error = assert_raises(ArgumentError) { match([]) }
    assert_match "matches the installer P12's private key", error.message
  end

  def test_reports_a_missing_private_key
    error = assert_raises(ArgumentError) { match([certificate], key: nil) }
    assert_match "does not contain a private key", error.message
  end
end
