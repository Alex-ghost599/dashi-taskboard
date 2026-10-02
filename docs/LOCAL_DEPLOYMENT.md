# 个人版本地部署与恢复

## CI 验收等待修正（2026-10-02）

生命周期测试按完整 personal-ready JSON 与有效端口等待，启动最多 20 秒；启动失败保留退出、spawn 原因及输出。原退出 3 秒和请求排空 6 秒验收不变。空项目测试分别验证 catalog 未就绪、就绪和刷新失败，等待实际入口出现。生产启动、认领和数据逻辑未变。

四项启动缺陷回归先红后绿，生命周期 9/9、整合组件 58/58、项目 typecheck 通过，独立审核 Critical 0 / Important 0。此前 CI 只有约 5 秒 stdout 为空的证据，实际启动原因未知；修正版 CI 及最终安装另行验收。


## 未触碰分支草稿修复（Issue #38，2026-10-02）

恢复草稿使用独立 developmentContextTouched 标记；未触碰分支的草稿可获得匹配扫描的默认值，用户明确清空或选择分支会保留。原值已为空时再次选择空值也更新即时草稿，工作区导航卸载无需经过取消按钮。旧版非空草稿保留原值，编辑现有卡不自动改分支。标记只进入本机草稿，不进入任务 API 或常用属性存储。

专项缺陷回归先失败后通过，整合 #22 后 58 组件及 typecheck 通过，build:web 通过；独立增量审核 Critical 0 / Important 0。隔离真实 Git 仓库/服务 UI 已确认 main 默认选中、明确清空关闭重开后仍选空、两张测试卡保存后的 API 值分别为 main 和 null；未触碰正式数据、调用模型或重启 Codex。异步等待竞态及未取消直接卸载由组件测试覆盖，未在真实 UI 人为延迟扫描复现。正式安装和有效路径的原生表单验收仍待；无路径测试项目的 null 不作为缺陷证据。

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

## 暂停意图修复（fork Issue #15，源码验收阶段）
已复现暂停RPC失败回滚enabled、旧请求列表等待后继续ACTIVE、被动项目身份更新触发ACTIVE，以及页面重载前暂停意图未保存的问题。修复保留关闭意图与pausePending，异常回执不算确认；旧请求失效、被动读取尊重scheduled暂停，未确认暂停重启后继续尝试，确认后停止重试。按钮区分暂停待确认和已暂停。

主机策略文件新增pausePending及policyChange（最近一次策略应用的时间/来源类别），后者不能证明原始点击时间或实际操作者。浏览器localStorage可用时发送前同步写入意图；存储失败提示错误且继续尝试主机暂停。通用server-backed存储是异步，不能以setItem调用证明其已落盘。主机磁盘不可写或CDP长期不可达时，不能保证远端scheduled已暂停；保留错误并重新读回，已有运行会话需另行处理。

本段仅说明源码变更；正式运行版本与真实部署验收以本机安装provenance及个人台账为准。不因此开启真实自动任务、不重启Codex、不改变空队列关闭策略或模型分工。

### 服务退出连接收尾（#20，开发中）
浏览器空TCP预连接可让HTTP server.close持续等待，停止监听后仍留下Node。退出时保留2秒连接收尾窗口，只销毁仍未收到HTTP请求或upgrade的空连接，保留已接收请求的正常处理与等待语义；不处理其他进程或实例。隔离真实TCP回归覆盖退出完成及同端口重新监听，server回归通过。仅覆盖网络连接退出路径，冷启动握手/其他子进程卡住仍需独立验证。

### 个人App启动与父进程退出（#20）
个人App使用独占loopback监听socket及自有子进程，15秒内等待精确结构化ready消息；静默、半行、错误消息或超长消息失败，退出路径仍只终止并回收该Child。Node通过App持有的stdin管道感知父进程退出/强杀，在初始化阶段也监听断开；独立手动Node不启用此管道机制。stdout握手后继续写原日志。
Node重复关闭请求共用同一drain Promise，避免SIGTERM与管道EOF交错提前退出。空预连接仍有2秒收尾；App正常退出最多5秒后kill/reap，父进程消失后的Node也最多5秒后强制退出。超过期限的请求可能中断，客户端结果未知需查询确认；不承诺任意长写入完成或外部副作用回滚。Node自身无响应时，已消失的父进程无法提供额外强杀保证，须按所有权人工诊断，禁止批量kill。
源码回归与真实App/UI验收分开记录，以本机交付台账及安装provenance为运行证据，不在此公开机器路径或私有数据。

## 可选源码工具：项目策略预检（#24A）
使用现有 Node 执行 `scripts/execution-policy.mjs --help`，控制库必须显式指定，部署与恢复见 [EXECUTION_POLICY.md](EXECUTION_POLICY.md)。此工具当前独立使用，无后台进程，无模型调用，不写正式任务库、不改共享 Skill/PATH；未接入旧 scheduled，pause 不替代旧自动化暂停。功能验收使用隔离合成控制库，无需替换正式 App。

## 可选源码工具：自动化能力报告（#23A）
现有Node执行 `scripts/automation-capabilities.mjs --help`；显式选择可信Codex可执行文件或离线目录文件。命令只读目录，live可能更新CLI自身模型缓存，不创建模型turn或修改业务数据。报告不授权派发，详见 [AUTOMATION_CAPABILITIES.md](AUTOMATION_CAPABILITIES.md)。本阶段不安装替换App、不启用真实自动化。

## 可选源码工具：Judge隔离探针（#23B）
运行 `scripts/judge-isolation-probe.mjs --help`，显式指定可信CLI 0.153.3。使用一次性临时目录和本机动态端口，结束自行清理；不使用登录凭据，不安装、不替换App。范围及失败含义见 [JUDGE_ISOLATION_PROBE.md](JUDGE_ISOLATION_PROBE.md)，成功也不允许生产派发。

### 读取与提问负向场景
同一探针入口增加临时外部合成Skill及符号链接、空库存检查和读取/提问拒绝回执；仅清理本次生成的临时目录。13次请求均为本机合成流量，正式App和配置不变。非空Skill库存会失败，不自动接受新增Skill。

## 候选模块开发状态
新增候选模块和私有判断状态存储为源码工具，未注册服务或修改运行数据库，没有部署操作与新增运行进程。隔离测试使用显式临时 SQLite 库，关闭连接后复制备份并在隔离路径验证恢复。测试命令与输入契约见 AUTOMATION_CANDIDATES.md；此阶段不能启用生产自动领取。

### 本地扫描协调器（开发中）
新增独立扫描CLI，使用显式原生任务数据库和独立私有控制库。仅本地筛选，不调用模型、不修改任务、不接旧scheduled；状态库schema2增量保存armed/pause和扫描报告。隔离真实10秒空队列→新Todo检测、暂停重启和合成负载验证通过，原生大型数据库负载及正式App/UI仍未验收，尚未正式部署。`status`会初始化或升级控制库，不能作为严格只读查询；`scan-started`不证明已取得扫描租约。

## 测试命令与副本
开发验收使用 `npm test` 或 `npm run test:node`；直接 `node --test` 仍采用 Node 默认发现，不排除数字副本。此变化不注册服务、不修改正式 App/数据库。未知副本保留，备份/恢复证据由个人台账记录；生产 Wrangler 命令未更改。详见 TEST_DISCOVERY.md。

### PR48 Windows 生命周期验收补充
Windows CI 在 SIGKILL 后 PID 已消失、立即重绑端口时出现 EADDRINUSE；日志不能确定是其他进程抢占还是系统释放延迟。测试现核对 personal-ready 的实际端口等于请求端口，保留独立 PID 退出断言，并对同一端口最多等待 3 秒；持续占用负向测试必须报错。未调整服务端口规则、进程退出逻辑或正式部署；Windows 修订后的 CI 仍待验证。

### Obsidian身份契约开发
新增已解析frontmatter的纯规范化契约，兼容空executor_agent继承来源，仅Codex来源与执行者；来源会话、执行绑定、workspace提示分别保留，所有输出不授权派发。详见OBSIDIAN_TASK_CONTRACT.md；未读取导入业务任务、未改共享指南或正式部署。解析重复键、项目解析及同步仍待后续，#27未完成。

### #24准入存储（开发中）
同策略库事务预留UTC日次数与并发，开始前再次核验策略/语义，未确认结果保持占用，已完成同语义返回已有回执。当前只做准入记账、不调用执行器，不能宣称token金额限制或运行期maxCalls已落实。schema2增量升级、跨进程竞争、暂停及强杀恢复9项独立验收通过，Critical/Important为0；使用说明见EXECUTION_ADMISSION.md。完整测试及PR尚待收尾，无正式部署变化。

### PR50进程清理验收修订
CI旧用例以子进程启动300ms后的文件判断存活，文件可能早于父处理错误写入。测试改为IPC ready握手后触发错误，5秒内核验记录PID不再运行，Linux已退出僵尸不视为执行中；保留存活正对照及自建子进程失败清理。生产进程清理代码未改变，本机runner23项通过，跨平台CI待验证。

## 新建表单默认值
新增偏好键taskboard.new-task-defaults.v1，复用当前taskboardStorage后端；不改变正式任务库schema。浏览器中按项目/当前用户保存priority和labels，升级回滚旧前端可忽略该键。隔离fixture验收不等于正式安装，详见TASK_EDITOR_DEFAULTS.md。测试Vite必须无正式API代理，结束只停止自建进程。

## 执行记录控制库
ExecutionAttemptStore 首次打开会把策略/准入库升级为 schema3；先停止自建持有者、备份，再隔离验收。旧在途保留占用，恢复旧快照必须对账，不能直接重派；同一运行服务只能使用一个控制库以保证全局单执行者。当前无安装/自动启动接线，不改变正式服务，详见 EXECUTION_ATTEMPTS.md。

### #18A异常退出补验
自建提交进程在possibly-submitted提交后SIGKILL，重开保留同一request ID并拒绝重派；9项attempt测试通过。没有真实发送或正式部署变化，桥接与桌面验收仍待。

## #18队列与worker存储
新增schema4待处理记录与同库worker epoch租约，领取与attempt原子提交；30项隔离回归通过，含4进程争抢和两个阶段SIGKILL恢复。未接CDP/真实模型/正式安装，接收端fencing与可信身份仍待。升级/兼容限制见EXECUTION_WORKER_QUEUE.md。

## OBS-02 预览工具（源码阶段）
`node scripts/obs-import-preview.mjs --manifest /absolute/preview.json` 仅读显式文件及项目快照，结果含笔记全文，保存到私有目录且不提交。没有默认 vault、后台进程、Skill/PATH 或数据库写入；无需安装或重启桌面版。输入格式、限制与退出行为见 OBSIDIAN_IMPORT_PREVIEW.md。已通过当前开发任务单笔记的真实只读预览；不表示全库去重、导入或同步已交付。

OBS-02 跨平台测试使用 fileURLToPath 定位脚本；负向用例必须确认脚本已进入目标路径。Mac 本地通过不代替 Windows CI，工具不随本次测试调整重新部署。

OBS-02 Windows ESM补验：普通CLI用例已通过，竞态测试的--import路径需转为file URL，已用pathToFileURL修正；精确拒绝断言保持；修正后CI34925657710代码检查及三平台全部通过，PR55已合并。

## OBS-01 契约阶段
OBSIDIAN_TASK_CONTRACT.md v1 固定后续受管字段编辑语义；当前实现仍只读，未启用双向写回、后台扫描、模型调用或真实执行绑定。无需重装或修改共享配置，不能将契约中的“允许编辑”理解为已部署功能。后续 #29/#30 须分别验收实现和共享指导变更。

## OBS-03 独立索引工具
源码 CLI ingest 仅写用户明确给定的独立私有 SQLite，list 只读；没有默认路径、服务、正式库或安装接线。共享有界读取器沿用预览清单，原始笔记不写回。schema1、权限、容量、冲突保留与停止/隔离备份恢复步骤见 OBSIDIAN_READONLY_INDEX.md。当前仅合成验证，不建立正式 vault 索引，不需要重启 App/Codex。

PR57 CI补充：中断测试fixture改为等待显式信号，避免800ms自动完成与慢CI竞争；只影响测试，无服务、应用、数据或部署变化。

## OBS-04 共享指导变更
本机仅更新vault中央协议与任务模板，加入两个可空会话字段及授权区分；未改共享Skill、PATH、shell、全局Agent入口或正式任务数据。私有台账记录当次备份与2/2应用回执，恢复时先比较后续修改，再按diff撤销，禁止盲目覆盖。实际模板合成解析与ID检查通过；不需要重装App/Codex，运行Agent加载及复杂属性UI未验收，见OBSIDIAN_AGENT_GUIDANCE.md。

## 暂停读回部署限制

本地旧scheduled暂停现在增加list读回；仍ACTIVE或无法读取时继续显示/持久化pausePending，不以update ACK宣称完成。正式安装前须核实当前桌面列表元数据和实时状态。此改动不停止已执行会话，不启用新worker；跨写入者CAS、完整迁移备份流程与单协调器门槛尚未交付。

## #25A 旧scheduled兼容约束
本地协调现在要求已记录ID精确存在、名称/cron/local/Codex项目元数据匹配且无重复；无法核验时报告归属错误，暂停仍保留disabled/pending。旧政策与scheduled文件本轮只读检查，没有更新、重建或删除；正式App未替换。当前桌面RPC响应形状和UI提示须部署前实测，不能用合成测试替代。迁移范围和剩余门槛见LEGACY_SCHEDULE_OWNERSHIP.md。

#25A暂停补充：停止计划沿用已读旧配置，不顺带迁移prompt/模型/周期。只读到的快照不证明外部并发配置未改变；正式迁移仍需版本/读回及隔离验收。

## 旧scheduled备份位置与恢复

本地injector暂停路径在严格归属检查之后、发送更新之前，将完整原始RPC快照写入运行数据目录的scheduled-pause-backups。文件名为内容SHA256，重复字节复用；单份上限1MiB，POSIX目录0700/文件0600，写入fsync并读回核对。路径冲突、权限不符、文件链接、已有文件损坏或备份失败均阻止更新，并保留暂停未确认意图；不自动清理历史备份。文件身份复核不构成对同用户恶意目录替换的完整隔离。Windows仅验证字节与文件类型，ACL及目录断电持久性未验收。

备份含私人prompt，不提交或输出日志。恢复前先对比当前真实计划与原快照；有后续修改时逐字段整合，不自动覆盖或重新激活。此路径未实施正式迁移或会话停止，远端分支不在范围内；完整单协调器门槛、真实桌面RPC和恢复后派发对账仍待，#25保持开放。

## 安装前进程与备份检查
使用PID/可执行文件路径识别个人App，不输出其他进程的完整参数或环境。安装器对 taskboard.sqlite 与 execution-control.sqlite 同时取得写锁后进行 SQLite 在线备份；不存在的已知数据库跳过，其他根目录数据库应先单独评估。只排除这两个库、其根目录 sidecar 和旧 database-backup-manifest.json，不排除附件目录中的 SQLite 文件。副本统一为 DELETE journal，独立 integrity_check 通过后才写入清单；备份目录 0700，数据库和清单 0600。正式服务持有数据库时拒绝替换；同名旧 App 和数据均先备份，替换失败恢复原 App。独立看板验收不要求重启Codex或启用自动认领。

## 双库备份独立修复候选

该修复从手动会话绑定候选中单独提取，不升级数据库 schema，不开启 CDP 或任务执行。合成 11 项测试及独立复核通过；实际单库安装与隔离恢复已通过；两个数据库同时存在的运行数据尚未验收。恢复时先退出自有个人 App，将清单实际列出的数据库及原有附件和私有服务配置恢复到同一数据目录，勿将 database-backup-manifest.json 当运行配置。隔离副本验证通过后再替换正式数据；保留原备份和旧 App。

## 父任务工作区候选验收（Issue #36）

该候选仅修改看板的任务显示范围与导航，无数据库迁移或运行目录调整。正式安装前，在隔离库建立根任务、子任务和孙任务，逐层验证 Board/List/Gantt/Dashboard、面包屑、刷新与浏览器返回；卡片 `projectId` 应保持不变。Project Docs 保留整个项目的资源范围。额外检查未知父 ID 不回退根视图、归档祖先不会提供写操作，以及嵌套建卡默认父关联和关系写入失败提示。纯模块测试不替代这些界面验收。隔离界面验收已完成，安装候选及正式验收见下段。

候选的归档父链使用静态任务列表及层级导航，关闭当前任务工作区的建卡、关系、拖拽、编辑与 AI 入口。全局项目管理不受这项只读展示策略限制；这不是服务端权限机制。Dashboard 卡片统计使用当前层，Codex 项目摘要仍为项目级。隔离 UI 与 CLI 已读到同一卡片、父关联和评论；同一隔离库重启后卡片、关联、归档及评论持久化已读回；正式安装的部分验收已完成，具体覆盖见下段。

隔离验收退出时先关闭自建浏览器标签页，再对已记录且核实所有权的服务 PID 发送 SIGTERM，并确认监听与进程都消失。一次保持标签页连接的测试需要强制结束自有 Node，后一次先关页退出0；根因尚未确认。数据库备份在服务退出后执行，恢复副本的5卡/1评论与 integrity_check 通过，不覆盖正式数据。

## 工作区候选的实际安装与恢复

2026-10-02 安装候选 commit 为 `8a32e77d`，源码树与合入 develop 的 `c0d2d5d3` 一致；安装清单记录真实 SHA，不能把 squash SHA 当作候选构建 SHA。最终发布以验收记录合并后的固定提交重建，再读回安装 provenance。Node 22.22.0 用于构建，包内服务 Node 为 22.23.2；Rust 显式使用已有 1.95，全局默认未修改。一次版本探测触发仓库 1.88 工具链组件下载，后续操作使用显式 toolchain。

当前用户 App 已从 Finder 实际打开，服务只监听 127.0.0.1:47823。测试卡 202-5 为根、202-6 为直属子，使用 hold/do-not-execute 标签；子卡的评论、Done 状态和父关联在 App 重启后保留，CLI 读回相同数据。停止仅作用于已识别的个人 App，正式 Codex 不受操作。两个旧个人 Dock Node 经路径、父链和日志文件归属核实后精确 SIGTERM；父 shell 未被终止，没有扩展为杀所有 Node。

安装快照及回执在用户备份目录的时间戳子目录；当前清单仅列 taskboard.sqlite。隔离复制恢复验证 integrity_check 与原有 37 卡、5 评论，通过后保留备份，未覆盖正式数据。附件和私有配置由安装器一起备份，凭据不写入 Git 或日志。原有卡片评论不因验收被修改，新增测试卡保留。重启后自动认领关闭；上游替换更新器仍不注册。

## 空项目与归档提示修复（Issue #22）

切换项目清除旧活动/归档列表，加载失败有明确提示；同项目后台刷新保留有效卡片。已确认空项目与仅归档项目分别展示，不在错误或已有归档时提示导入。同名项目菜单显示目录和 ID，标题保留完整身份；已有筛选无匹配提示保留。父任务工作区的不可用/归档只读优先级保持。

整合回归：53 组件、33 项工作区/路由/项目相关 Node、全 Node 584 通过与 1 跳过，typecheck/build:web 通过；独立 validation-only reviewer Critical 0 / Important 0。隔离实际 UI 验证同名目录、项目切换、确认空项目、归档计数/卡片和 List 返回归档；未调用模型或修改正式数据。加载失败由合成测试覆盖，迟到回执完成静态检查；未在真实网络故障场景重做。正式安装尚未包含本修复。

### 会话来源预览候选

当前来源根为运行用户的 `CODEX_HOME/sessions`，未设置时使用 `~/.codex/sessions`；只读取JSONL首行元数据并按项目目录筛选，不接入Obsidian，不写会话文件或导入正式卡。隔离验收必须配置独立 `conversationSessionsRoot`、临时任务库及假Codex可执行程序，防止其他UI入口调用真实模型。候选UI/header在独立fixture通过，正式App尚未替换。归档、保存及动态取消/并发验收详见CONVERSATION_IMPORT_PREVIEW.md；本开发分支打开任务数据库时会创建 conversation_import_sources 来源证据表；完整回滚按匹配 App 与数据快照恢复。

#33归档范围：默认只读活动sessions，用户勾选并再次点击时才读同Codex home的archived_sessions；服务端可配置conversationArchivedSessionsRoot，客户端不能给路径。隔离fixture须同时指定两个合成根；缺归档目录不能解释为没有历史会话。预览接口不保存任务或修改会话文件；本开发分支的数据库初始化会新增来源证据表，正式安装和迁移尚未验收。

### Issue #33 正文与保存层开发中

内部选源读取器重新枚举并核对项目、ID、scope、相对路径和首行 hash，最多读取 2MiB 快照；纯文本提取仅保留标准 user input_text，覆盖不足明确标注，不推断任务完成状态。来源证据表 conversation_import_sources 在打开数据库时创建，保存方法将 Backlog 卡与独立来源证据原子提交；相同来源返回原卡，保留空执行绑定，带来源卡暂不支持跨项目移动。归档保留去重，永久删除后可重新导入。

选源相关26项、纯提取19项、保存及移动10项合成回归与独立审核通过，重要取消/来源移动缺口已修。API/UI尚未接通这些内部方法，没有读取个人正文、保存正式卡或进行正式数据库迁移；本 Issue 保持开放。全 Node 曾读取另一 worker 的红阶段文件而失败，完整冻结后全量 Node 复验 641 项，640 通过、1 项既有条件跳过，0 失败；整合组件 62/62 与 typecheck 通过。

## 固定 develop 安装复验（2026-10-02）

PR #67 的四项 CI 成功并合入 `9265e1de53844943fe639d7a6e51e5657d4ab0ba`。从该提交的干净归档源码构建并安装；独立产物复核确认 335 个跟踪文件一致、provenance dirty=false，签名验证通过。构建脚本成功；外层收据导出曾使用错误路径，改读实际 provenance 后补齐收据，没有把该导出错误当作构建成功证据。

最终个人 App 从 Finder 打开、退出后监听消失、再由 Finder 重启。服务真实仅监听 127.0.0.1；父工作区显示既有子卡，其 Done 状态、父关联及评论与 CLI 一致。原有 39 卡、6 评论与本次备份、隔离恢复副本逐行一致，三处 integrity_check=ok。三个自动认领政策重启后均关闭，个人入口仍不注册上游替换更新器；未重启日常 Codex。

Issue #22 的空项目 UI 范围已验收；其后来补充的真实 host/project/cwd 派发身份门槛仍随自动化主线验证，Issue 保持开放。安装版空项目对应 CLI 的零卡片，显示明确空项目提示；菜单显示项目路径和 ID。相同名称、归档、失败刷新与层级优先级使用此前隔离真实 UI 和组件回归证据，未在正式数据中制造故障。Issue #38：有效设备目录下未触碰表单选中 main，明确清空后关闭重开保持空值；App 重启后的常用优先级、标签保持。表单草稿存于应用内存，重启初始化新草稿并重新选择当前分支；仅常用优先级和标签持久化。未保存表单不增加正式卡，执行授权与高推理特批不由这些默认值产生。保存 main/null 的路径由此前隔离 UI 与 API 对照覆盖。

此段记录安装源码 SHA；后续仅文档提交不改变该安装产物。正式数据当前只有 taskboard.sqlite，execution-control.sqlite 双库备份仍使用合成证据。日常 CDP 及绑定 RPC、会话导入完整保存均另行验收。

## 会话选源、可编辑提案及明确保存（Issue #33，2026-10-02）

服务端要求项目已保存有效的绝对 workspacePath，精确匹配来源目录；本机设备目录映射不自动代替这个配置。缺少目录时先明确配置项目，不能猜测路径。活动来源默认启用，归档需要勾选后再次点击预览。来源根由服务端确定，客户端只提交已预览的来源身份。

提案仅留有界用户文本和证据，最多八个待处理或已保存回执，五分钟有效；过期在后续操作时清理，不建立后台定时器。保存前重新核对项目、来源身份和全文摘要。断开、取消、清除或来源变化阻止后续写入；入口沿用本地来源与实例访问限制；提案按调用方声明的 actor type/id 分组，actor 标识不作为用户认证或凭据。部分覆盖或没有用户文本时禁止保存。单文件最多 2MiB，提取文本最多 32KiB，来源卡暂不支持跨项目移动；归档保留去重，永久删除后可重新导入。

四项 CI 全部通过后，已提交候选 9e50cec 从干净归档构建并可回滚安装；Finder 实际打开、退出监听消失、再次启动后入口保持。正式39卡6评论与安装前、备份及隔离恢复逐行一致，integrity_check=ok；新增 conversation_import_sources 表为空，三个自动认领策略仍关闭，个人入口不注册替换更新器，仅监听127.0.0.1。当前验收项目缺少服务端项目目录时安全拒绝来源扫描，设备路径不自动升级为导入目录。没有读取个人会话正文或导入正式卡；实际选源编辑保存使用前述合成来源与隔离库。完整回滚须配对恢复 App 与数据快照。最终独立回执审核、PR合并及发布来源对照完成前，Issue #33 保持开放。

合成重启与恢复验收及完整来源契约见 [CONVERSATION_IMPORT_PREVIEW.md](CONVERSATION_IMPORT_PREVIEW.md)；测试结果见 DEVELOPMENT_STATUS.md。
