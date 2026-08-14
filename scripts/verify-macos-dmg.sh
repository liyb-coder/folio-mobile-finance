#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Folio DMG verification requires macOS." >&2
  exit 1
fi

for required_tool in awk codesign find grep hdiutil lipo node otool plutil readlink rg shasum spctl stat; do
  if ! command -v "${required_tool}" >/dev/null 2>&1; then
    echo "Missing required tool: ${required_tool}" >&2
    exit 1
  fi
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
version="$(node -p "require('${project_root}/package.json').version")"
expected_architecture="${FOLIO_EXPECTED_ARCH:-$(uname -m)}"
dmg_path="${1:-${project_root}/src-tauri/target/release/bundle/dmg/Folio_${version}_${expected_architecture}.dmg}"
require_notarized="${FOLIO_REQUIRE_NOTARIZED:-0}"

if [[ ! -f "${dmg_path}" ]]; then
  echo "Folio DMG does not exist: ${dmg_path}" >&2
  exit 1
fi

work_dir="$(mktemp -d /private/tmp/folio-dmg-verify.XXXXXX)"
mount_dir="${work_dir}/mounted"
mounted=0

cleanup() {
  if [[ "${mounted}" -eq 1 ]]; then
    hdiutil detach "${mount_dir}" -quiet || true
  fi
  rm -rf -- "${work_dir}"
}
trap cleanup EXIT

mkdir -p "${mount_dir}"
hdiutil verify "${dmg_path}" >/dev/null
hdiutil attach \
  -readonly \
  -nobrowse \
  -mountpoint "${mount_dir}" \
  "${dmg_path}" >/dev/null
mounted=1

app_path="${mount_dir}/Folio.app"
applications_link="${mount_dir}/Applications"
info_plist="${app_path}/Contents/Info.plist"

if [[ ! -d "${app_path}" ]]; then
  echo "Mounted image does not contain Folio.app." >&2
  exit 1
fi
if [[ ! -L "${applications_link}" || "$(readlink "${applications_link}")" != "/Applications" ]]; then
  echo "Mounted image does not contain the expected /Applications shortcut." >&2
  exit 1
fi

unexpected_root_entries="$(
  find "${mount_dir}" -mindepth 1 -maxdepth 1 \
    ! -name "Folio.app" \
    ! -name "Applications" \
    -print
)"
if [[ -n "${unexpected_root_entries}" ]]; then
  echo "Mounted image contains unexpected top-level entries:" >&2
  echo "${unexpected_root_entries}" >&2
  exit 1
fi

bundle_identifier="$(plutil -extract CFBundleIdentifier raw -o - "${info_plist}")"
bundle_version="$(plutil -extract CFBundleShortVersionString raw -o - "${info_plist}")"
executable_name="$(plutil -extract CFBundleExecutable raw -o - "${info_plist}")"
minimum_macos="$(plutil -extract LSMinimumSystemVersion raw -o - "${info_plist}")"
microphone_usage="$(plutil -extract NSMicrophoneUsageDescription raw -o - "${info_plist}")"
speech_usage="$(plutil -extract NSSpeechRecognitionUsageDescription raw -o - "${info_plist}")"
executable_path="${app_path}/Contents/MacOS/${executable_name}"

if [[ "${bundle_identifier}" != "com.beizi.folio" ]]; then
  echo "Unexpected bundle identifier: ${bundle_identifier}" >&2
  exit 1
fi
if [[ "${bundle_version}" != "${version}" ]]; then
  echo "Bundle version ${bundle_version} does not match package version ${version}." >&2
  exit 1
fi
if [[ "${minimum_macos}" != "10.15" ]]; then
  echo "Unexpected minimum macOS version: ${minimum_macos}" >&2
  exit 1
fi
if [[ -z "${microphone_usage}" || -z "${speech_usage}" ]]; then
  echo "Required microphone or speech-recognition privacy copy is missing." >&2
  exit 1
fi
if [[ ! -x "${executable_path}" ]]; then
  echo "Folio executable is missing or not executable." >&2
  exit 1
fi

architectures="$(lipo -archs "${executable_path}")"
case " ${architectures} " in
  *" ${expected_architecture} "*) ;;
  *)
    echo "Folio executable does not include ${expected_architecture}: ${architectures}" >&2
    exit 1
    ;;
esac

if otool -L "${executable_path}" | awk 'NR > 1' | rg -q "/Users/|/private/tmp/|/var/folders/"; then
  echo "Folio executable contains a development-only dynamic library path." >&2
  exit 1
fi

private_artifacts="$(
  find "${app_path}" -type f \( \
    -name ".env" -o \
    -name ".env.*" -o \
    -name "*.db" -o \
    -name "*.db-wal" -o \
    -name "*.db-shm" -o \
    -name "*.sqlite" -o \
    -name "*.sqlite3" -o \
    -name "*.folio-backup" -o \
    -name "*.folio-export*" -o \
    -name "*.csv" -o \
    -name "*.tsv" -o \
    -name "*.xls" -o \
    -name "*.xlsx" \
  \) -print
)"
if [[ -n "${private_artifacts}" ]]; then
  echo "Folio.app contains files that look like private runtime data:" >&2
  echo "${private_artifacts}" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "${app_path}"
entitlements_path="${work_dir}/entitlements.plist"
codesign -d --entitlements :- "${app_path}" >"${entitlements_path}" 2>/dev/null
if ! plutil -p "${entitlements_path}" \
  | rg -q '"com\.apple\.security\.device\.audio-input" => true'; then
  echo "Signed application is missing the audio-input entitlement." >&2
  exit 1
fi

signature_details="$(codesign -dv --verbose=4 "${app_path}" 2>&1)"
signature_kind="developer-id"
if grep -q "Signature=adhoc" <<<"${signature_details}"; then
  signature_kind="ad-hoc"
fi

gatekeeper_status="accepted"
gatekeeper_output=""
if ! gatekeeper_output="$(spctl --assess --type execute --verbose=4 "${app_path}" 2>&1)"; then
  gatekeeper_status="not-notarized"
  if [[ "${require_notarized}" == "1" ]]; then
    echo "Gatekeeper rejected the application while notarization is required:" >&2
    echo "${gatekeeper_output}" >&2
    exit 1
  fi
fi

sha256="$(shasum -a 256 "${dmg_path}" | awk '{print $1}')"
byte_count="$(stat -f "%z" "${dmg_path}")"

echo "Folio macOS MVP DMG verification passed."
echo "DMG: ${dmg_path}"
echo "Bytes: ${byte_count}"
echo "SHA-256: ${sha256}"
echo "Bundle: ${bundle_identifier} ${bundle_version}"
echo "Architecture: ${architectures}"
echo "Minimum macOS: ${minimum_macos}"
echo "Signature: ${signature_kind}"
echo "Gatekeeper: ${gatekeeper_status}"
