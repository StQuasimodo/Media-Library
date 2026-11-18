#!/usr/bin/env bash
# Test-fixture tooling only; never bundled with either application.
set -euo pipefail
if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -version | head -n 1
  exit 0
fi
root="$PWD/.harness/ci-tools"
archive="$root/ffmpeg.tar.xz"
checksum=cff00e567053ea67834d2a9b76fae43371fb1e872885649077f3764513f52818
url=https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-11-18-12-39/ffmpeg-N-129046-g3a78197c4c-linux64-gpl.tar.xz
mkdir -p "$root/ffmpeg"
trap 'rm -f "$archive"' EXIT
curl --fail --location --retry 2 --connect-timeout 15 --max-time 150 "$url" -o "$archive"
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status
tar -xJf "$archive" --strip-components=1 -C "$root/ffmpeg"
"$root/ffmpeg/bin/ffmpeg" -version | head -n 1
if [[ -n "${GITHUB_PATH:-}" ]]; then
  printf '%s\n' "$root/ffmpeg/bin" >> "$GITHUB_PATH"
fi
