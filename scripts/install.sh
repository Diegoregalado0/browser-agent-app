#!/bin/sh
# Installs the `browser-agent` sandbox command and a "Browsby" app in ~/Applications that
# opens the test Chrome with the built extension (see README, "The sandbox").
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
APP="$HOME/Applications/Browsby.app"

[ -n "$NODE" ] || { echo "node not found on PATH. Install Node.js 22 or newer from https://nodejs.org"; exit 1; }
"$NODE" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' ||
  { echo "Browsby needs Node.js 22 or newer; this is $("$NODE" --version). Update it from https://nodejs.org"; exit 1; }

# Terminal command. npm link can fail where the global npm folder belongs to root (Node
# from the nodejs.org installer); the app below does not need it.
cd "$PROJECT_DIR"
# The launcher builds the extension with esbuild, a dev dependency.
npm install --no-audit --no-fund --silent
if npm link --silent; then
  echo "Installed command: $(command -v browser-agent)"
else
  echo "Skipped the browser-agent terminal command (npm link failed; run \`sudo npm link\` in $PROJECT_DIR to add it)."
fi

# App bundle. Apps launched from Finder don't get the shell PATH, so node is pinned here;
# rerun this script after moving the project or changing Node installs.
# The app was called "Browser Agent" before the rename; remove it so upgrades leave one app.
rm -rf "$HOME/Applications/Browser Agent.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cat > "$APP/Contents/MacOS/browser-agent" <<SCRIPT
#!/bin/sh
exec "$NODE" "$PROJECT_DIR/bin/browser-agent.js" open
SCRIPT
chmod +x "$APP/Contents/MacOS/browser-agent"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Browsby</string>
  <key>CFBundleDisplayName</key><string>Browsby</string>
  <key>CFBundleIdentifier</key><string>local.browser-agent</string>
  <key>CFBundleExecutable</key><string>browser-agent</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

if [ -f "$PROJECT_DIR/scripts/AppIcon.icns" ]; then
  cp "$PROJECT_DIR/scripts/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
fi
touch "$APP"
echo "Installed app: $APP (open it with Spotlight, or drag it to the Dock)"
