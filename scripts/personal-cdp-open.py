#!/usr/bin/env python3
"""Start or reuse daily Codex CDP. Never stop an existing application."""
import os
import json
from pathlib import Path
import socket
import re
import subprocess
import time

CODEX = '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT'
PORT = 9229


def listening():
    result = subprocess.run(['/usr/sbin/lsof', '-nP', f'-iTCP:{PORT}',
                             '-sTCP:LISTEN', '-Fpn'], capture_output=True, text=True)
    return result.returncode == 0


def verify_daily_port():
    result = subprocess.run(['/usr/sbin/lsof', '-nP', f'-iTCP:{PORT}',
                             '-sTCP:LISTEN', '-Fpn'], capture_output=True, text=True, check=True)
    fields = result.stdout.splitlines()
    addresses = [x[1:] for x in fields if x.startswith('n')]
    pids = {int(x[1:]) for x in fields if re.fullmatch(r'p[0-9]+', x)}
    if not addresses or any(x != f'127.0.0.1:{PORT}' for x in addresses):
        raise SystemExit('9229 必须只监听 127.0.0.1。')
    table = subprocess.check_output(['/bin/ps', '-axo', 'pid=,ppid=,comm='], text=True)
    processes = {}
    for line in table.splitlines():
        parts = line.strip().split(None, 2)
        if len(parts) == 3:
            processes[int(parts[0])] = (int(parts[1]), parts[2])
    owners = [pid for pid in pids if processes.get(pid, (None, None))[1] == CODEX]
    if len(owners) != 1:
        raise SystemExit('9229 未归属唯一官方日常 Codex。')
    owner = owners[0]
    for pid in pids:
        seen = set()
        while pid != owner and pid in processes and pid not in seen:
            seen.add(pid)
            pid = processes[pid][0]
        if pid != owner:
            raise SystemExit('9229 存在其他进程家族。')
    command = subprocess.check_output(['/bin/ps', '-p', str(owner), '-o', 'command='], text=True).strip()
    allowed = {'--remote-debugging-address=127.0.0.1', f'--remote-debugging-port={PORT}'}
    if not command.startswith(CODEX + ' ') or set(command[len(CODEX):].split()) != allowed:
        raise SystemExit('9229 Codex 参数含非日常配置或未知参数；请人工核对，不会附加。')
    # Inspect only the home value; never print the process environment.
    environment = subprocess.check_output(['/bin/ps', 'eww', '-p', str(owner), '-o', 'command='], text=True)
    match = re.search(r'(?:^| )CODEX_HOME=(.*?)(?= [A-Za-z_][A-Za-z_0-9]*=|$)', environment)
    if match and Path(match.group(1).strip()).expanduser() != Path.home() / '.codex':
        raise SystemExit('9229 使用自定义 CODEX_HOME；本入口仅支持默认日常 home。')


def main():
    if Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))).expanduser() != Path.home() / '.codex':
        raise SystemExit('本入口仅支持默认日常 CODEX_HOME；请从普通终端运行。')
    app = Path.home() / 'Applications/Dashi Taskboard Personal.app'
    node = app / 'Contents/MacOS/node'
    injector = app / 'Contents/Resources/app/scripts/personal-cdp.mjs'
    if not node.is_file() or not injector.is_file():
        raise SystemExit('请先安装 Dashi Taskboard Personal。')
    processes = subprocess.check_output(['/bin/ps', '-axo', 'comm='], text=True).splitlines()
    if not listening():
        if CODEX in (line.strip() for line in processes):
            raise SystemExit('日常 Codex 已运行，但 9229 CDP 未开启。请保存工作并确认空闲后退出 Codex，再运行本入口；不会自动终止现有实例。')
        # Reserve-check before launch; the injector verifies actual ownership later.
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', PORT))
        env = {k: v for k, v in os.environ.items()
               if not k.startswith(('CODEX_', 'ELECTRON_'))}
        subprocess.run(['/usr/bin/open', '-a', '/Applications/ChatGPT.app', '--args',
                        '--remote-debugging-address=127.0.0.1',
                        f'--remote-debugging-port={PORT}'], env=env, check=True)
        for _ in range(30):
            if listening():
                break
            time.sleep(1)
        else:
            raise SystemExit('Codex 的 CDP 未就绪；未终止任何进程。请检查 Codex，必要时退出后普通启动。')
    verify_daily_port()
    # This opens the one installed personal service. The wrapper verifies the
    # CDP process family and authenticates the service; no managed mode fallback.
    subprocess.run(['/usr/bin/open', str(app)], check=True)
    for _ in range(30):
        with socket.socket() as probe:
            if probe.connect_ex(('127.0.0.1', 47823)) == 0:
                break
        time.sleep(1)
    else:
        raise SystemExit('个人看板服务未就绪；请检查 App 日志。')
    lock = Path.home() / 'Library/Application Support/Dashi Taskboard Personal/personal-cdp-9229.lock'
    if lock.is_file() and not lock.is_symlink():
        try:
            record = json.loads(lock.read_text())
            pid = record.get('pid')
            if type(pid) is int and pid > 1 and record.get('port') == PORT:
                command = subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'command='],
                                         capture_output=True, text=True)
                if command.returncode == 0 and command.stdout.strip() == f'{node} {injector} --port {PORT}':
                    print(f'已复用日常 Codex 与注入器 PID {pid}；无需保持新的终端。')
                    return
        except (ValueError, OSError):
            pass  # The wrapper owns stale/invalid-lock recovery and refusal.
    print('连接日常 Codex；保持此终端运行，Ctrl-C 仅撤销注入。', flush=True)
    os.execv(str(node), [str(node), str(injector), '--port', str(PORT)])


if __name__ == '__main__':
    main()
