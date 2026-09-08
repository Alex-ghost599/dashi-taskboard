# 个人版本地部署与恢复

## 当前日常入口与恢复（2026-09-07）

若官方快捷窗口出现，不应对 `/hotkey-window` 注入。当前补丁在发现/frame/执行三个阶段排除它；此前无入口窗口的串行等待可能使主页面心跳过期。升级后重新打开 Taskboard，并检查可见卡片；旧错误遮罩不会仅因心跳恢复自动消失。不要用隐藏iframe内容替代可见验收。

在当前已提交个人 fork checkout 运行：

```sh
python3 scripts/personal-cdp-open.py
```

入口检查已安装个人 App，只支持默认 `~/.codex` 和默认 Electron 日常 profile。已有 9229 必须为同一个官方 Codex 进程家族、仅 127.0.0.1，启动参数限定 `--remote-debugging-address=127.0.0.1 --remote-debugging-port=9229`；自定义 home、隔离 profile 或其他未知参数会明确拒绝。无 Codex 时通过官方 App 正常启动并追加这两个参数；已有无 CDP Codex 时提示保存工作、确认空闲退出后重试，不自动结束实例。

个人 App 仍提供唯一 47823 服务/数据库。入口保持终端中的安装版 Node + personal-cdp.mjs 运行；Ctrl-C 只撤销该注入。再次运行时若已核实注入器 PID/完整命令，则提示复用并返回。注入器原有身份和 HMAC 验证保留，不进入 managed 模式。没有新增 PATH、shell、Skill、开机自启或用户隐私授权。

本轮后台注入器 PID 与私有日志位置记在 `.local-evidence/cdp-handoff-retry-20260907/MANIFEST.json`。停止后台注入器前核对 PID/启动时间/完整命令，只向该 wrapper 发 SIGTERM，等待锁和入口撤销。普通启动恢复：在确认空闲后退出官方 Codex，再正常 `open /Applications/ChatGPT.app`，不改官方包/profile/数据库。启动入口失败不会强杀已有实例，需按明确错误检查后普通启动。

2026-09-07 的受控日常重启已获用户单独授权；原 PID/参数/home 记录在该证据目录 `daily-before.json`。这次授权不表示今后可自动重启忙碌实例。切换 App 前先停止本次注入器、退出个人 App，使用既有安装器保留 App/数据快照，然后重新运行入口；保持正式数据原路径。

最终安装 provenance、签名、备份恢复、日常嵌入 UI/CLI/会话定位结果从同目录 MANIFEST/OUTCOME 和安装收据读回。远端 host IPC 未覆盖。以下内容保留为阶段历史；“未来 CDP”“尚未日常部署”等为旧时点描述，以本节和最新收据为准。

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

## CDP 生命周期与放行边界（2026-09-07 补充）
`--watch` 注入器是常驻进程，约每两秒检查服务/目标并发心跳，页面加载时重装桥接；非 watch 也会注册新文档脚本，不能视为只检查一次就永远安全。可信目标限定 `app://-` 主页面，脚本执行前及桥接安装时再检查；导航和上下文销毁撤销旧权限，外部网页即使标题为 Codex 也被拒绝。既有随机 token/capability、loopback CDP WebSocket 校验及看板 HTML HMAC 保留。若未来官方页面来源改变，应检查版本和实际 target 后调整允许项，禁止退回标题匹配。

本轮仅源码/模拟边界验证，尚未开启日常 Codex CDP、未安装常驻注入器。用户已明确授权后续先完成隔离开发验证，再由延迟启动的 `gpt-6-astra` / `medium` CLI 在确认无运行任务后重启日常 Codex并验收；这项具体授权替代上文“一律不能改造现有实例”的限制，其余官方包/内部数据库/共享环境限制保留。CLI 尚未派发；不能直接运行上游默认启动命令，它可能启动另一套服务/数据库。

AI 自动总结和外链图片按用户明确需求保留；总结可向配置的模型服务发送项目/任务元数据，图片请求可让图片站记录出口 IP 和 URL。它们与自动认领分别控制，不把 loopback 监听等同于没有出站请求。

## 个人 CDP 入口（Issue #7 候选，尚待实机验收）
新个人服务首次启动在数据目录生成 `personal-service.json`（当前用户所有、0600；token和HMAC secret），后续复用。CLI/注入器只读取；缺失、符号链接或权限不安全时失败，不替旧App生成不匹配凭据。备份和恢复必须连同该文件；不要公开或提交其内容。旧浏览URL仍可打开，精确GET根路径在loopback来源检查后无缓存跳转到令牌路径。原无挑战curl /health在此模式返回401；以CLI读取与注入器带挑战健康检查为准。

安装后CLI仍用 `scripts/personal-taskctl`，它调用App内包装器读取私有配置。已有官方Codex用loopback调试端口启动后，可使用App内Node运行 `Contents/Resources/app/scripts/personal-cdp.mjs --port 9229`；当前源码测试可用同名仓库脚本。它先用lsof/ps检查端口归属，使用同一47823服务；服务未就绪就报错，不启动第二套数据库。每端口私有lock记录wrapper PID；停止该PID会只停止注入子进程，移除本次入口及新文档脚本并恢复CSP，保持Codex/App进程。异常遗留锁仅在记录PID不存在时回收；不按名字批量kill。

不自动开启或重启Codex；日常参数切换留给已授权的延迟CLI，必须先有隔离真实UI和独立review证据、再可靠确认无运行任务。没有开机自启或共享Skill/PATH修改。后台日志应写用户日志目录私有文件，因为注入诊断可能包含带令牌的页面URL。外接模式不拥有Node子进程IPC，远端host桥接不算已验收；本地看板、CLI、已有会话定位分别验收。

### 个人 CDP 入口与回滚
安装包内 Node 执行 `Contents/Resources/app/scripts/personal-cdp.mjs --port <已开启的本机调试端口>`；先启动个人 App。入口校验端口仅 loopback、监听者属于同一官方 Codex 进程家族（允许继承调试 socket 的子进程），不自行启动/终止 Codex，不再另建服务。按 Ctrl-C 或只向已记录 watcher PID 发 SIGTERM 会撤销注入和注册脚本，并恢复 CSP。不要批量 kill Codex。重新启动 watcher 可再次注入；重复 watcher 会被锁拒绝。

隔离验证使用独立 Electron profile 和 CODEX_HOME，仅复制当前登录凭据到私有 0600 文件以验证相同账号；测试结束删除这份自建凭据副本，保留测试历史与 profile。正式数据和持久化个人服务凭据均在 checkout 外。清洁构建 worktree 复用现有依赖时，本仓库 `.git/info/exclude` 增补 `/node_modules` 和 `/src-tauri/target`，原内容备份在 `.local-evidence/git-info-exclude-before-cdp.txt`；只恢复本次增补行，不覆盖后来的配置。

2026-09-07 隔离验收已验证嵌入 UI 写入测试评论/状态并由安装 CLI 读回、停止 watcher 不影响 Codex/服务、刷新后无残留入口。日常实例部署须由独立 CLI 在本轮结束且核实无运行任务后执行，180 秒延时本身不构成空闲证明。日常常用启动入口和最终安装 commit 由该阶段验收后补录。

## 个人自动认领 CLI 修复（2026-09-08）
个人 CDP 启动器通过 `CODEX_TASKBOARD_PERSONAL_SERVICE=1` 选择 `scripts/personal-taskctl.mjs`，scheduled 命令只保存可执行路径，凭据在执行时从个人数据目录读取。默认上游 CLI/runtime-file 路径不变。已有 scheduled 需将原始 `cli/taskctl.mjs` 路径替换为个人包装器，保留其他字段和 PAUSED 状态；仅更新 App 不会重写已保存的 prompt。
本次 codex 项目由用户要求暂停：主机 enabledByUser=false、对应 scheduled=PAUSED；不得为验证恢复自动执行。使用 scheduled 中的 CLI 命令仅执行 issue list 验证。接口可用不等于业务执行验收。更新 App/注入器时只停止个人服务，保持官方 Codex 及会话运行。安装前备份 App、数据及 automation.toml，恢复时保持调度暂停。
