# Cross-Platform Electron Builds from macOS

## Overview

electron-builder 25.x can produce Windows portable app bundles (`dir` target) directly from macOS **without installing Wine**. It downloads its own bundled Wine binary for code-signing checks only.

## Requirements

- macOS (Apple Silicon or Intel)
- Rosetta 2 (for x64 Electron downloads): `softwareupdate --install-rosetta --agree-to-license`
- Node.js >= 18
- No Wine, no Windows VM, no CI needed

## How It Works

The `dir` target produces an unpacked app folder (not an installer). electron-builder:
1. Downloads the target platform's Electron binary from GitHub
2. Packages your app code into the folder structure
3. Downloads a minimal bundled Wine (wine-4.0.1-mac.7z) for PE signing checks
4. Produces a valid Windows executable

## Targets That Work Without Wine

| Target | Output | Wine needed? |
|--------|--------|--------------|
| `dir` | Unpacked folder with .exe | ❌ No (bundled wine handles signing) |
| `portable` | Single .exe | ❌ No |
| `nsis` | Installer .exe | ⚠️ Yes (system Wine) |
| `msi` | MSI package | ⚠️ Yes |

## Usage

```bash
# Windows x64 (most common)
npx electron-builder --win --dir --x64 --config electron-builder.yml

# Windows arm64
npx electron-builder --win --dir --arm64 --config electron-builder.yml

# macOS (both architectures)
npx electron-builder --mac --dir --arm64 --x64 --config electron-builder.yml

# All platforms at once
make package-all
```

## Output Directories

```
desktop/release/
├── mac-arm64/          # macOS arm64 .app
├── mac-x64/            # macOS x64 .app (Rosetta-compatible)
├── win-unpacked/       # Windows x64
└── win-arm64-unpacked/ # Windows arm64
```

## Applying to Another Project (e.g., Kite-Electron)

1. Ensure `electron-builder >= 25.x` in devDependencies
2. Add `dir` to your electron-builder config targets (or pass `--dir` flag)
3. Copy the Makefile pattern:

```makefile
package-win: build
	cd desktop && npx electron-builder --win --dir --x64 --config electron-builder.yml

package-mac: build
	cd desktop && npx electron-builder --mac --dir --arm64 --x64 --config electron-builder.yml
```

4. The first run downloads ~120MB Electron binary per platform (cached after that)
5. Encrypt + publish with the same `encrypt` / `publish` targets

## Caching

electron-builder caches downloaded binaries at:
```
~/Library/Caches/electron-builder/
```

After the first build, subsequent builds are fast (~10s packaging time).

## Limitations

- Cannot produce NSIS installers without system Wine
- Cannot code-sign Windows executables with a real certificate (needs Windows + signtool)
- Native Node modules with Windows-specific C++ code won't compile (use pure JS or pre-built binaries)
