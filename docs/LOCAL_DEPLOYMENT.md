# 个人版本地部署与恢复

## 适用范围与源码
仅本机 macOS arm64。源码 checkout 使用个人 fork；首次产品基线为 v1.1.21 / 1a807be8d4114b82f3cecc61cddaebdba6df9c60，加个人桌面/安装补丁，不能简称“未修改稳定版”。正式安装的精确 commit 从 App 的 `Contents/Resources/build-provenance.json` 读取；构建脚本写入 commit、dirty、工具链和时间。安装器拒绝 dirty 或与 HEAD 不同的构建。

## 路径
以下为本机操作说明中的实际路径，不是需要提交的个人运行配置。

| 对象 | 位置 |
|---|---|
| 源码 | `/Users/alex/Documents/ChatGPT/dashi-taskboard` |
| App | `/Users/alex/Applications/Dashi Taskboard Personal.app` |
| 数据库 | `/Users/alex/Library/Application Support/Dashi Taskboard Personal/taskboard.sqlite` |
| 附件/客户端设置 | 同一数据目录的 `attachments/`、`client-storage.json` |
| 日志 | `/Users/alex/Library/Logs/Dashi Taskboard Personal/server.log` |
| 备份 | `/Users/alex/Library/Application Support/Dashi Taskboard Personal Backups/<时间戳>/` |
| 构建/验收日志 | checkout 的 `.local-evidence/`，不提交 |
| 已签名构建 | `/Users/alex/Library/Caches/dashi-personal-build.XXXXXX/Dashi Taskboard Personal.app`；本次产物指针在 `.local-deploy/artifact-path` |
| WebView 自身状态 | macOS 按 bundle id `com.alexghost599.dashi-taskboard-personal` 管理，非业务数据库 |

切换分支和重新构建不移动/重建正式数据。不要在另一个 checkout 运行默认 npm start 建立第二个正式库。

## 构建与安装
已验证 macOS 15.7.1 arm64、CLT、Node 22.22.0/npm 10.9.4、Rust 1.95.0。复用现有 1.95，不改默认 Rust 1.84。bundled Node 为上游校验 SHA256 的 22.23.2 universal runtime；主程序是 arm64。

```sh
cd /Users/alex/Documents/ChatGPT/dashi-taskboard
npm ci
sh scripts/personal-build.sh
# 在个人 App 中 Cmd+Q，确认自己的 App/Node 已退出，再安装
python3 scripts/personal-install.py
```

必须使用 personal-build.sh，它显式启用 `personal` feature 与 personal Tauri 配置。上游 app:build/app:dev/codex/build/check 保留供比较或 CI；本机不要使用，可能调用上游 launcher/refresh。纯 Web 检查使用 typecheck、build:web、npm test。

构建先复制 metadata-free App 到 Library/Caches，再 ad-hoc 签名并验证，避免 Documents 中观察到的 FinderInfo 干扰。仅本机自用，未做 Developer ID 公证或发行。安装器先检查来源、目标是否运行、同名 bundle id，再备份 SQLite/附件/配置、复制唯一 staging、保存旧 App 并替换；不覆盖未知同名应用。写收据位于替换之后，若失败需检查实际 App/备份，不能推断没有替换。安装后再次 codesign 验证及读取 provenance。

## 日常运行
```sh
open '/Users/alex/Applications/Dashi Taskboard Personal.app'
# 或在 Finder 双击；关闭窗口/在该 App 内 Cmd+Q 会停止其自有服务
curl --fail http://127.0.0.1:47823/health
'/Users/alex/Documents/ChatGPT/dashi-taskboard/scripts/personal-taskctl' issue list --json
tail -f '/Users/alex/Library/Logs/Dashi Taskboard Personal/server.log'
```

浏览器打开 http://127.0.0.1:47823/。CLI wrapper 使用 App 内 Node/CLI 和固定同一 URL，无 npm link、PATH 或 shell 配置修改。打包 CLI 位于 App `Contents/Resources/bin/taskctl`。包内保留上游 Skill 资料，但未安装到共享 skills 目录；不要直接使用其上游默认分支/发布规则。

App 预占 127.0.0.1:47823 并把 socket FD 传给 Node；端口被占用则启动失败，不复用未知服务，也不关闭占用者。关闭先向拥有的 Child 发 TERM，最多等待 5 秒，再 kill/wait 同一 Child。实际第一次无界退出残留已修复；不按进程名批量终止。若 App 被强制崩溃或启动等待异常，先用 `lsof -nP -iTCP:47823 -sTCP:LISTEN` 和 `ps -p <PID> -o pid,ppid,command` 核对 App 内 Node 路径及本次归属，再处理，不杀其他 Codex/Node。

## 备份、恢复与卸载
每次安装收据及快照在时间戳备份目录；SQLite 使用 backup API，文件快照在停止 App 后取，便于一致性。单独备份：先 Cmd+Q，再将整个数据目录复制到一个新的备份目录，保留已有快照，不复用名称。

恢复：先退出个人 App，核实无其服务；把当前 App/数据分别移动到新的救援目录；将选定快照 `data/` 复制回上述正式数据路径，将备份的同名 `.app` 复制回用户 Applications（该快照有旧 App 时）。验证 SQLite `PRAGMA integrity_check`、签名、provenance、UI/CLI。不可把旧程序直接配合未知新 schema，优先恢复匹配 App+数据对。实际恢复测试只在 `.local-evidence/restore-check` 和 loopback 47824 运行，未覆盖正式数据。

卸载：退出个人 App，将它移入一个保留目录或 Finder 废纸篓；不删除正式数据库、附件或历史备份。不需修改 PATH、shell、LaunchAgents 或共享 Skill。保留数据库即可后续重装。

## 更新、自动认领与 Codex
个人入口不注册 updater/autostart/Skill 安装插件，不进入上游 main，不检查、下载或安装上游更新；personal 配置 updater endpoints 为空。策略是编译入口约束，不依赖容易重置的 UI 开关，重启后仍相同。fork 自动更新链未验收，保持关闭。

自动认领首次为 Paused/off，测试项目没有设备工作区，控件不可用；未注册任何真实认领 automation、未发模型请求。不要导入 Obsidian/驾驶舱任务或以安装授权执行任务。

独立 App 不依赖 Codex。可在 Codex 原生浏览面板打开同一 loopback URL（本任务已真实读取卡片/评论）；无需 CDP、注入守护进程或重启 Codex。`open_in_codex` 曾仅回 queued，不能凭该回执验收；本次通过 CUA 的实际 Codex In-app Browser 页面读回。当前没有 sidebar 注入与会话定位验收；未运行上游 injector，未开调试端口。入口失效时先启动个人 App，再重载原生浏览页。未来若需要 CDP，必须独立 profile/端口/进程归属和新的具体验收，不能对现有 Codex 做启动参数改造。
