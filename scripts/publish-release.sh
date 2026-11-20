#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Uso: $0 <version> [\"notas de la versión\"]"
  echo "Ejemplo: $0 1.3.0-beta.2 \"Mejoras de sincronización y audio\""
  exit 1
fi

RAW_VERSION="$1"
VERSION="${RAW_VERSION#v}"
VERSION="${VERSION#V}"
NOTES="${2:-Actualización CTHz v${VERSION}}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
GRADLE_FILE="$ROOT_DIR/android/app/build.gradle"
PACKAGE_JSON="$ROOT_DIR/package.json"
APK_OUT="$ROOT_DIR/CTHz-release.apk"

cd "$ROOT_DIR"

echo "==> [1/6] Actualizando versión a v${VERSION}..."
node -e '
const fs = require("fs");
const version = process.argv[1];
const pkgPath = process.argv[2];
const gradlePath = process.argv[3];

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
pkg.version = version;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

let gradle = fs.readFileSync(gradlePath, "utf8");
const codeMatch = gradle.match(/versionCode\s+(\d+)/);
if (!codeMatch) throw new Error("No se encontró versionCode en build.gradle");
const nextCode = parseInt(codeMatch[1], 10) + 1;
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${nextCode}`);
gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${version}"`);
fs.writeFileSync(gradlePath, gradle, "utf8");
console.log(`    versionCode -> ${nextCode}, versionName -> "${version}"`);
' "$VERSION" "$PACKAGE_JSON" "$GRADLE_FILE"

echo "==> [2/6] Compilando web bundle y sincronizando Capacitor..."
npm run typecheck
npm run build
npx cap sync android

echo "==> [3/6] Compilando APK Release firmado..."
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk}"
(cd "$ROOT_DIR/android" && ./gradlew assembleRelease --no-daemon)

BUILT_APK="$ROOT_DIR/android/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$BUILT_APK" ]; then
  echo "ERROR: No se encontró $BUILT_APK"
  exit 1
fi

cp -f "$BUILT_APK" "$APK_OUT"
echo "==> [4/6] APK listo:"
ls -lh "$APK_OUT"
sha256sum "$APK_OUT"

echo "==> [5/6] Guardando commit y subiendo a origin main..."
git add -A
if git diff --cached --name-only | grep -qE '(\.jks$|keystore\.properties$|\.apk$)'; then
  echo "ERROR DE SEGURIDAD: Se detectó un archivo sensible o binario en staging."
  git reset
  exit 1
fi

if ! git diff --cached --quiet; then
  git commit -m "release(v${VERSION}): ${NOTES}"
fi
git push origin main

echo "==> [6/6] Publicando GitHub Release v${VERSION} (OTA estable sin --prerelease)..."
gh release create "v${VERSION}" "$APK_OUT" \
  --title "CTHz v${VERSION}" \
  --notes "$NOTES"

echo "✅ Publicado CTHz v${VERSION}. Todos los teléfonos con la app recibirán la actualización OTA."
