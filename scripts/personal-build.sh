#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export RUSTUP_TOOLCHAIN=1.95
export CARGO_HTTP_MULTIPLEXING=false
npm run build:web
node scripts/prepare-tauri-app.mjs --target aarch64-apple-darwin
# Use the same endpoint as the desktop, without installing a global executable.
cp scripts/personal-taskctl src-tauri/resources/bin/taskctl
node -e 'const fs=require("fs"),cp=require("child_process");fs.writeFileSync("src-tauri/resources/build-provenance.json",JSON.stringify({fork:"Alex-ghost599/dashi-taskboard",upstreamTag:"v1.1.21",upstreamCommit:"1a807be8d4114b82f3cecc61cddaebdba6df9c60",commit:cp.execSync("git rev-parse HEAD").toString().trim(),dirty:cp.execSync("git status --porcelain").toString().trim()!=="",node:process.version,rust:cp.execSync("rustc --version").toString().trim(),builtAt:new Date().toISOString()},null,2))'
npm run tauri -- build --target aarch64-apple-darwin --bundles app --no-sign --config src-tauri/tauri.personal.conf.json
# Local ad-hoc signature only; no Developer ID, notarization, or publication.
xattr -cr 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Dashi Taskboard Personal.app'
codesign --force --deep --sign - 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Dashi Taskboard Personal.app'
codesign --verify --deep --strict 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Dashi Taskboard Personal.app'
