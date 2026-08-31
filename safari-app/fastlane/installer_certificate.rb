require "openssl"

# The caller supplies only MAC_INSTALLER_DISTRIBUTION certificates returned
# by Apple's API. A filename or Keychain label is not proof of a key match.
module InstallerCertificate
  def self.match(private_key, certificates, team_id:, now: Time.now)
    raise ArgumentError, "The installer P12 does not contain a private key." unless private_key

    certificate = certificates.find do |candidate|
      candidate.not_before <= now && candidate.not_after > now &&
        candidate.subject.to_a.any? { |name, value, _type| name == "OU" && value == team_id } &&
        candidate.check_private_key(private_key)
    end

    unless certificate
      raise ArgumentError,
            "No current Mac Installer Distribution certificate in this Apple team matches the installer P12's private key. " \
            "Export the matching installer identity, including its certificate, and update the installer P12 secret."
    end

    certificate
  end
end
