#!/usr/bin/env python3
"""Reversible current-user install; never install a dirty-source artifact."""
from pathlib import Path
import datetime, json, os, plistlib, shutil, subprocess
from personal_backup import backup_personal_data, DATABASES
os.umask(0o077)
root = Path(__file__).resolve().parent.parent
source = Path((root / '.local-deploy/artifact-path').read_text().strip())
home = Path.home()
target = home / 'Applications/Dashi Taskboard Personal.app'
data = home / 'Library/Application Support/Dashi Taskboard Personal'
backup = home / 'Library/Application Support/Dashi Taskboard Personal Backups' / datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
provenance = json.loads((source / 'Contents/Resources/build-provenance.json').read_text())
head = subprocess.check_output(['git','rev-parse','HEAD'], cwd=root, text=True).strip()
if provenance['dirty'] or provenance['commit'] != head:
    raise SystemExit('Refusing installation: artifact is dirty or differs from HEAD')
processes = subprocess.check_output(['ps','-axo','pid=,comm='],text=True).splitlines()
executables = [parts[1] for line in processes if len(parts := line.strip().split(None, 1)) == 2]
if any(path.startswith(str(target / 'Contents/MacOS') + '/') for path in executables):
    raise SystemExit('Quit the installed personal App before replacing it')
if target.exists():
    info=plistlib.loads((target / 'Contents/Info.plist').read_bytes())
    if info.get('CFBundleIdentifier') != 'com.alexghost599.dashi-taskboard-personal':
        raise SystemExit('Same-name App belongs to another source; not replacing')
# A leftover standalone service must also be stopped before replacing the App.
database_paths = [str(data / name) for name in DATABASES if (data / name).exists()]
if database_paths:
    holders = subprocess.run(['lsof', '-t', '--', *database_paths], capture_output=True, text=True)
    if holders.returncode == 0 and holders.stdout.strip():
        raise SystemExit('Stop all holders of personal databases before installing')
    if holders.returncode not in (0, 1) or holders.stderr.strip():
        raise SystemExit('Cannot verify personal database holders; installation refused')
backup.mkdir(parents=True, mode=0o700, exist_ok=False)
database_manifest = backup_personal_data(data, backup / 'data') if data.exists() else []
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
receipt={'installed':str(target),'backup':str(backup),'source':provenance,'databases':database_manifest}
(backup / 'install-receipt.json').write_text(json.dumps(receipt,indent=2))
print(json.dumps(receipt,indent=2))
