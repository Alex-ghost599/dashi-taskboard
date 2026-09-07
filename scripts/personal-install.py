#!/usr/bin/env python3
"""Reversible current-user install; never install a dirty-source artifact."""
from pathlib import Path
import datetime, json, plistlib, shutil, sqlite3, subprocess
root = Path(__file__).resolve().parent.parent
source = root / 'src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Dashi Taskboard Personal.app'
home = Path.home()
target = home / 'Applications/Dashi Taskboard Personal.app'
data = home / 'Library/Application Support/Dashi Taskboard Personal'
backup = home / 'Library/Application Support/Dashi Taskboard Personal Backups' / datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
provenance = json.loads((source / 'Contents/Resources/build-provenance.json').read_text())
head = subprocess.check_output(['git','rev-parse','HEAD'], cwd=root, text=True).strip()
if provenance['dirty'] or provenance['commit'] != head:
    raise SystemExit('Refusing installation: artifact is dirty or differs from HEAD')
processes = subprocess.check_output(['ps','-axo','command'],text=True).splitlines()
if any(line.startswith(str(target / 'Contents/MacOS') + '/') for line in processes):
    raise SystemExit('Quit the installed personal App before replacing it')
if target.exists():
    info=plistlib.loads((target / 'Contents/Info.plist').read_bytes())
    if info.get('CFBundleIdentifier') != 'com.alexghost599.dashi-taskboard-personal':
        raise SystemExit('Same-name App belongs to another source; not replacing')
backup.mkdir(parents=True, exist_ok=False)
if data.exists():
    shutil.copytree(data, backup / 'data', ignore=shutil.ignore_patterns('*.sqlite*'))
    db=data / 'taskboard.sqlite'
    if db.exists():
        with sqlite3.connect(db) as src, sqlite3.connect(backup / 'data/taskboard.sqlite') as dest:
            src.backup(dest)
            assert dest.execute('pragma integrity_check').fetchone()[0] == 'ok'
target.parent.mkdir(parents=True, exist_ok=True)
# Copy to a unique sibling first; old App remains usable if the copy fails.
staged = target.parent / ('Dashi Taskboard Personal-staging-' + backup.name + '.app')
shutil.copytree(source, staged, symlinks=True)
try:
    if target.exists(): shutil.move(target, backup / target.name)
    staged.rename(target)
except BaseException:
    if not target.exists() and (backup / target.name).exists():
        shutil.move(backup / target.name, target)
    raise
receipt={'installed':str(target),'backup':str(backup),'source':provenance}
(backup / 'install-receipt.json').write_text(json.dumps(receipt,indent=2))
print(json.dumps(receipt,indent=2))
