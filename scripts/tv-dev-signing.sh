#!/usr/bin/env bash
set -euo pipefail
key_file="$HOME/.android/mycinema-tv-debug.keystore"
expected_file=android-tv/development-signing.sha256
if ! test -f "$key_file"; then
  if test -f "$expected_file"; then
    echo 'Cached development signing key is missing. Restore it; generating a replacement is refused.' >&2
    exit 1
  fi
  mkdir -p "$(dirname "$key_file")"
  keytool -genkeypair -keystore "$key_file" -storetype PKCS12 -alias androiddebugkey -storepass android -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=My Cinema TV Development,O=My Cinema,C=CN' >/dev/null 2>&1
  chmod 600 "$key_file"
fi
signer=$(keytool -exportcert -keystore "$key_file" -alias androiddebugkey -storepass android 2>/dev/null | sha256sum | cut -d ' ' -f 1)
if test -f "$expected_file"; then test "$signer" = "$(tr -d '\r\n' < "$expected_file")"; fi
if test -n "${TV_EXPECTED_SIGNER:-}"; then test "$signer" = "$TV_EXPECTED_SIGNER"; fi
echo "Development certificate SHA-256: $signer"
if test -n "${GITHUB_OUTPUT:-}"; then echo "sha256=$signer" >> "$GITHUB_OUTPUT"; fi
