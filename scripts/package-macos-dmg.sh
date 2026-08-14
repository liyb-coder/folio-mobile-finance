#!/usr/bin/env bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Folio DMG packaging requires macOS." >&2
  exit 1
fi

for required_tool in npm node codesign hdiutil shasum; do
  if ! command -v "${required_tool}" >/dev/null 2>&1; then
    echo "Missing required tool: ${required_tool}" >&2
    exit 1
  fi
done

cargo_tool="${CARGO:-$(command -v cargo || true)}"
if [[ -z "${cargo_tool}" || ! -x "${cargo_tool}" ]]; then
  echo "Missing required tool: cargo" >&2
  exit 1
fi
export CARGO="${cargo_tool}"
export PATH="$(dirname "${cargo_tool}"):${PATH}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_dir}/.." && pwd)"
app_path="${project_root}/src-tauri/target/release/bundle/macos/Folio.app"
dmg_dir="${project_root}/src-tauri/target/release/bundle/dmg"
version="$(node -p "require('${project_root}/package.json').version")"
architecture="$(uname -m)"
output_path="${dmg_dir}/Folio_${version}_${architecture}.dmg"
staging_dir="$(mktemp -d /private/tmp/folio-dmg.XXXXXX)"

cleanup() {
  rm -rf -- "${staging_dir}"
}
trap cleanup EXIT

cd "${project_root}"
npm run tauri:build -- --bundles app

codesign \
  --force \
  --deep \
  --sign - \
  --entitlements "${project_root}/src-tauri/Entitlements.plist" \
  "${app_path}"
codesign --verify --deep --strict --verbose=2 "${app_path}"

mkdir -p "${dmg_dir}"
cp -R "${app_path}" "${staging_dir}/Folio.app"
ln -s /Applications "${staging_dir}/Applications"
rm -f -- "${output_path}"

hdiutil create \
  -volname Folio \
  -srcfolder "${staging_dir}" \
  -format UDZO \
  "${output_path}"
bash "${project_root}/scripts/verify-macos-dmg.sh" "${output_path}"

echo "Created ${output_path}"
