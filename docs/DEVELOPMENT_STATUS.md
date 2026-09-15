# 开发与部署状态

## 当前日常 CDP 验收（2026-09-07，AGT-20260907-014）

最终包复验额外发现 `/hotkey-window` 辅助窗口被纳入目标：每个无侧栏窗口串行等待约15秒，两个窗口可使主页面心跳超过8秒有效期并显示服务未就绪。新增修复在目标发现、frame校验和新文档执行阶段排除该路由及既有辅助窗口；定向10项测试通过。错误遮罩需重新打开面板，不能以隐藏iframe DOM判断可见成功。最终实机复验结果以最新manifest和截图为准。

用户最新空闲确认覆盖旧交接的全量官方运行态查询门槛。本轮独立 CLI 已优雅退出准确日常 PID，并用相同官方程序、默认日常 profile/home 和仅 loopback 的 9229 重启；未修改官方包或内部数据库。

安装版注入器真实显示 Taskboard 侧栏、202-1 的 In review 状态和两条既有评论；刷新后读回一致。点击 View conversation 返回该卡绑定的原有项目会话，没有发送任务执行请求。项目概览自动 AI 总结按用户要求保留，不能把这项行为描述为无模型调用；正常外链图片也保留。自动认领单独保持关闭。

日常入口 `python3 scripts/personal-cdp-open.py` 支持默认日常 home：无 Codex 时启动，已有无 CDP Codex 时拒绝并提示空闲退出，已有正确 CDP/注入器时复用。拒绝隔离 profile、自定义 home、未知启动参数、非 loopback 和其他监听者；不终止现有进程，不设置自启。

独立 reviewer 对入口发现的 home 丢失和隔离实例误接两项 Important 已修复并复审通过；七个无副作用场景测试通过，Check 中持续执行。最终发布、安装 commit、进程和备份以本机 `.local-evidence/cdp-handoff-retry-20260907/MANIFEST.json` 与 `OUTCOME.json`、安装 receipt 和 App build-provenance 交叉核对，不在文档内写入自身 commit。

远端 host IPC、真实任务自动认领、Windows/Linux 实机和签名公证仍未验收。以下为之前阶段记录，其中旧的“尚未部署日常”等描述仅代表当时状态。

2026-09-07，首次 Mac 个人源码安装验收已执行；最终 PR/发布晋级及重建结果以安装 provenance 与本地验收清单读回为准。

## 源码与工作项
- fork：Alex-ghost599/dashi-taskboard；初始 main 677b54451db707ae6132486b6593b7be11e4ee09。
- 稳定产品基线：v1.1.21 / 1a807be8d4114b82f3cecc61cddaebdba6df9c60。同期最新 Beta/main：v1.1.22-beta.6 / bd264e7ff3402785f1e8b0bb789106358352707b，没有纳入该 Beta。
- 基础 Issue #1、PR #2，squash a99cf4cc64649e2aae376ae06a65ce43f9540f05；foundation_review 独立审核 Pass。
- 安装 Issue #3、PR #4、chore--personal-desktop；最终合并状态从 fork PR 读取。PR base 仅 develop，main 只在验收后 fast-forward，保留所有任务分支。

## 实际验收
| 检查 | 结果/范围 |
|---|---|
| npm ci | 成功，395 packages，audit 0 vulnerabilities |
| 构建前基线 | typecheck、build:web 通过；Node 372 pass/1 skipped/0 fail，组件 9 pass |
| 变更后后端 | server.test.mjs 30/30 pass |
| 原生构建 | 现有 Rust 1.95、arm64 Tauri 构建成功，bundled Node 22.23.2；ad-hoc 签名和安装后验证通过 |
| 独立 UI | 真实创建项目“安装验收测试-20260907”、卡片 202-1，添加评论，todo→in_review，刷新后保留 |
| Finder/App | 从 Finder 打开安装版，真实显示同一卡片、评论、状态；退出重启后 CLI 数据一致 |
| 监听/清理 | 仅 127.0.0.1:47823；修正退出无界等待后自有 App/Node 均消失，无残留监听；原 Codex PID 82362 保持 |
| 数据恢复 | 隔离 47824 服务读取恢复副本，CLI 与正式卡片一致，SQLite integrity_check=ok，评论保留；隔离服务已停止 |
| 自动认领 | 浏览器和重启桌面均 Paused/off，控件不可用，无模型调用/真实任务执行 |
| 更新策略 | 个人入口不注册 updater，无上游替换路径；策略编译固定，重启后仍个人入口 |
| Codex | Codex In-app Browser 实际显示同一服务/卡片；无 CDP/sidebar 注入和会话定位验收 |
| 共享写入 | 无共享 Skill、PATH、shell、官方 App/数据库或开机自启修改；仅仓库启动动作改为个人 App |

证据位于 checkout `.local-evidence/`：baseline-*.log、personal-server-test.log、native-*.png/ax.txt、native-restart-cli.json、shutdown-validation.json、restore-validation.json、install-*.json、codex-browser.png。精确构建源码和时间在安装 App `Contents/Resources/build-provenance.json`；安装收据在用户 Application Support 备份目录。

## 审核与已处理问题
- foundation_review 独立 reviewer：基础 c2f2f37 Pass。
- 部署首轮发现 personal 默认 feature 对 Windows 不适用；已限定 Mac，并改为 personal-build.sh 显式启用，保留原平台 CI，添加 personal cargo check。e4270aa 增量静态审核 Pass，无 Critical/Important。
- 现场网络：Git OAuth 缺 workflow scope，复用已合法认证同账号的现有 SSH；没有增加 scope。Cargo HTTP/2 错误使用本次 HTTP/1 配置解决。
- 初次未签名和 Documents 的 FinderInfo 使签名失败，改为缓存区无元数据副本 ad-hoc 签名。一次构建中编辑运行脚本导致失败，随后使用固定提交完整重跑成功，失败产物不用于最终发布。
- 首次 Cmd+Q 后监听停止但 Node 残留，具体异步阻塞点未定位；owned Child 增加 5 秒退出期限后真实退出/重启通过。

## 保留限制
没有上游云部署、远端发布或 updater 链验收；GitHub 基础 PR 未产生 Check runs，不能声称 CI 通过。最终远端 Check 状态另行记录，Mac 本地构建/UI 是本次主要验收。上游未用 launcher 代码产生 dead-code warnings；网页大 chunk 提示仍保留。不把新会话/侧边栏注入、Windows/Linux 运行、签名公证或付费模型认领视为已完成。启动握手无超时、App 被强杀的孤儿恢复仍依赖文档人工诊断，后续出现实际问题再处理。

最终独立 foundation_review（00e39c8 文档 / e4270aa 安装）：Pass，无 Critical/Important；实时检查签名、provenance、唯一 loopback、自有进程与原 Codex 保留，并查看真实截图。合并后仍必须重建最终 commit，不能以该 review 提前证明来源一致。完整 AX 补充为 codex-browser-full.ax.txt/native-current-full.ax.txt；增量 AX 需配截图，不单独作为完整UI证据。

## CDP 信任边界修复（2026-09-07，Issue #5）
- 用户保留项目概览自动 AI 总结：调用其配置的 Codex 模型是所需行为，自动认领仍关闭；保留正常 Markdown 外链图片/头像加载，接受其访问记录特性。安全审计不是“绝无后门”证明（47/244 核心文件完整覆盖）。
- `fix--cdp-target-trust` 移除标题 Codex 的目标回退，只接受 `app://-` 主页面；排除辅助窗口。新文档脚本、隔离桥接和后续 RPC 在写入凭证/参数前用原生 Location 再次验证页面；导航/上下文销毁撤销旧权限，失信主页面恢复 CSP 并断连。通知通道也验证同窗口/同源，复用已有随机凭证及 HMAC，不新增账号或认证服务。
- 修复前 injector 测试 12/12；修复后目标/桥接/CDP pipe/supervisor 定向测试 24/24。覆盖外部同标题页面、子 frame、实际执行来源与发现结果不一致、安装期间导航、旧上下文撤销及可信页面恢复。真实 Codex UI 与日常实例注入仍未验收，不能以模拟 CDP/VM 测试替代。
- 当前正式 App 仍为 `94e30bc64b13eb89e0f339d427e2b967aed6e0d9`，本轮不替换安装版，不晋级 main；修复需独立 review 与 fork PR CI 后合入 develop。现有未跟踪 `* 2.*` 副本未改动；原目录全量测试因迁移工具读取未知副本重复添加列而 27 fail；只含跟踪源码与本轮文件的临时快照复验 379 pass / 1 skipped / 0 fail（随后新增两个清理测试，包含在定向 24/24 中）。副本未删除，不作为上游失败或本轮代码回归。

- 独立 reviewer `cdp_trust_review` 初审发现页面全局 URL 可伪造、在途 RPC 导航泄露两项 Important，均修复并增量复审通过（源码/模拟层）；实际 Electron 消息来源兼容性和 UI 仍需隔离验收。

## 个人服务 CDP 接入（Issue #7，开发中）
个人入口准备启用持久 token/HMAC 私有文件，CLI 与 CDP 共用同一 App 服务；原 `GET /` 只允许 loopback 导航并跳转到令牌路径。`personal-cdp.mjs` 仅附着已开启的官方 Codex 调试端口，拒绝非 loopback/错误进程及重复实例；外接模式不启动服务或 Codex、不写通用 runtime，退出及失败注入撤销本次脚本/DOM/CSP。

定向测试 55/55（凭据重用/权限/链接拒绝、根入口负向测试、注入失败撤销、已有信任边界/服务测试）。独立 review 初审的版本不匹配、失败注入残留已修复，候选构建和真实UI待执行。正式版本仍94e30bc；后续安装回执与验收记录才代表真实切换。远端host IPC不因外接模式自动成立，不在本轮已验证能力之内；本轮目标是本地同库看板与会话定位。

### CDP 隔离真实 UI 验收（2026-09-07，Issue #7）
个人入口已复用安装 App 的同一服务与数据库。真实 Electron 测试发现原生 preload 的 `mcp-response` / `fetch-response` 是 `source=null, origin=""` 的合成事件；此前把它们按网页 postMessage 筛选会导致账号读取超时。修复仅对原生回复/通知采用该通道，RPC 添加随机请求 ID；页面间请求仍要求同窗口、同源和 capability，目标/导航守卫保留。

隔离 Codex 实际显示侧边栏、嵌入卡片 202-1；通过嵌入 UI 添加明确测试评论，状态 In review → Done，安装版 CLI 读回同评论和状态。停止自己的 watcher 后入口、iframe、capability 清除，刷新后不恢复；日常 Codex、隔离 Codex、正式看板服务均仍存活。重复启动 watcher 被拒绝。证据保存在本机 `.local-evidence/cdp-isolated/`，截图 `card-ui-pass.png`。这不代表日常实例已部署；最终包复验、日常重启/注入、已有会话定位与最终发布仍待 CLI 接力。

## 2026-09-08 自动认领 CLI 入口修复（Issue #11）
- 基线故障：scheduled 直接调用原始 CLI 返回 NOT_FOUND/Route not found；个人 CLI 查询同项目成功。
- 修复：个人启动器显式选择凭据包装器；凭据不进入自动化 prompt。16 项针对性测试通过；独立审核无 Critical/Important。清洁构建产物生成的命令已真实查询同一服务（1 条 todo），prompt 无凭据。正式安装收据与双层暂停复验记录在本机任务 AGT-20260908-010。
- 用户要求 codex 项目停止自动认领，双层暂停已读回。仅验证查询；不执行 COD-22 等历史卡片，不改变空队列策略。

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

## #24A 项目策略前置能力
新增本地 execution-policy CLI、独立控制库及严格范围预检，详见 [EXECUTION_POLICY.md](EXECUTION_POLICY.md)。不接入新旧调度器，不触发模型/业务任务；预检不授权派发。#24 保持开放，实际权限、预算占用、派发前原子核验及停止运行 UI 依赖后续适配器/协调器工作。当前正式 App 未因本阶段替换。

## #23A 模型与能力报告
固定Spark/GPT6模型选择、effort白名单及只读能力CLI已实现，见 [AUTOMATION_CAPABILITIES.md](AUTOMATION_CAPABILITIES.md)。本机无模型命令沙箱负向测试与账户独立Spark额度有证据；实际Judge工具权限、模型生成及桌面绑定回执未验收。报告不授权派发，#23保持开放，正式App和旧scheduled未变。

## #23B 隔离负向探针
新增真实CLI/本机合成provider探针，验证5类未提供工具调用的明确拒绝及配置/schema漂移失败，见 [JUDGE_ISOLATION_PROBE.md](JUDGE_ISOLATION_PROBE.md)。真实模型调用为0；残留skills.read读取范围、账户模型及生产Judge仍未验收，#23保持开放。正式App/旧scheduled未变。

## #23B 读取与提问边界补充
隔离探针扩展为13次合成请求：确认两个来源Skill库存为空，4种未注册package/路径读取明确拒绝、Default提问明确拒绝。非空库存或内容标记泄漏立即失败，另补超时/版本/Auth头回归。工具负向结果仅覆盖当前合成provider组合；另以隔离账户进程完成Spark low/Astra low各1次最小生成，共5419 tokens。已注册Skill通用隔离、账户全工具库存及生产适配器/绑定仍未验收，#23继续开放。

## 2026-09-15 候选过滤开发中
#16 新增纯函数候选检查及语义摘要，尚未接入扫描器。所有结果不授权派发；持久判断缓存、租约与崩溃负向恢复已加入独立存储；扫描适配器和 #17 联合验收待完成。候选回归覆盖本地过滤、依赖图、摘要失效与资源预算，详见 AUTOMATION_CANDIDATES.md。正式安装不变。

### 本地扫描协调器（开发中）
新增独立扫描CLI，使用显式原生任务数据库和独立私有控制库。仅本地筛选，不调用模型、不修改任务、不接旧scheduled；状态库schema2增量保存armed/pause和扫描报告。隔离真实10秒空队列→新Todo检测、暂停重启和合成负载验证通过，原生大型数据库负载及正式App/UI仍未验收，尚未正式部署。`status`会初始化或升级控制库，不能作为严格只读查询；`scan-started`不证明已取得扫描租约。

扫描阶段验证：478项Node通过/1跳过、10组件与typecheck通过；独立24项通过，Critical0/Important0。CLI真实约10秒检测新Todo，暂停后新进程保持暂停。1000合成hold候选筛选约56–121ms、CPU70–83ms；未据此声明原生大型数据库性能。尚无正式App/UI或模型派发验收，Issue17保持开放。

## 2026-09-15 测试发现修复
#21 标准 Node 测试入口与 Cloud 测试迁移发现排除明确数字副本；其他可疑源码命名失败而非漏测，嵌套测试支持。69 份未知原件保留并完成本机备份/隔离恢复，来源未归因。测试入口、覆盖范围及生产迁移限制见 TEST_DISCOVERY.md；PR/CI 验收完成后再结项。

### PR48 Windows 生命周期验收补充
Windows CI 在 SIGKILL 后 PID 已消失、立即重绑端口时出现 EADDRINUSE；日志不能确定是其他进程抢占还是系统释放延迟。测试现核对 personal-ready 的实际端口等于请求端口，保留独立 PID 退出断言，并对同一端口最多等待 3 秒；持续占用负向测试必须报错。未调整服务端口规则、进程退出逻辑或正式部署；Windows 修订后的 CI 仍待验证。

### Obsidian身份契约开发
新增已解析frontmatter的纯规范化契约，兼容空executor_agent继承来源，仅Codex来源与执行者；来源会话、执行绑定、workspace提示分别保留，所有输出不授权派发。详见OBSIDIAN_TASK_CONTRACT.md；未读取导入业务任务、未改共享指南或正式部署。解析重复键、项目解析及同步仍待后续，#27未完成。

### #24准入存储（开发中）
同策略库事务预留UTC日次数与并发，开始前再次核验策略/语义，未确认结果保持占用，已完成同语义返回已有回执。当前只做准入记账、不调用执行器，不能宣称token金额限制或运行期maxCalls已落实。schema2增量升级、跨进程竞争、暂停及强杀恢复9项独立验收通过，Critical/Important为0；使用说明见EXECUTION_ADMISSION.md。完整测试及PR尚待收尾，无正式部署变化。

### PR50进程清理验收修订
CI旧用例以子进程启动300ms后的文件判断存活，文件可能早于父处理错误写入。测试改为IPC ready握手后触发错误，5秒内核验记录PID不再运行，Linux已退出僵尸不视为执行中；保留存活正对照及自建子进程失败清理。生产进程清理代码未改变，本机runner23项通过，跨平台CI待验证。

## #38新建表单常用属性
按项目/用户记忆priority与labels，当前分支精确匹配、可见的当地today起止日期；草稿优先且不继承授权。项目切换旧扫描Important已修复。组件及隔离浏览器表单保存/刷新已验收，正式安装仍待；详见TASK_EDITOR_DEFAULTS.md。

## #18A 持久执行记录基础
新增原子提交意图、完整绑定快照、稳定请求ID及迟到回执记账，schema3全局单执行者，详见 EXECUTION_ATTEMPTS.md。隔离状态/并发/回滚回归已补；桥接端到端、桌面身份和busy能力未接入，#18仍开放，正式运行版本不变。

### #18A异常退出补验
自建提交进程在possibly-submitted提交后SIGKILL，重开保留同一request ID并拒绝重派；9项attempt测试通过。没有真实发送或正式部署变化，桥接与桌面验收仍待。

## #18队列与worker存储
新增schema4待处理记录与同库worker epoch租约，领取与attempt原子提交；30项隔离回归通过，含4进程争抢和两个阶段SIGKILL恢复。未接CDP/真实模型/正式安装，接收端fencing与可信身份仍待。升级/兼容限制见EXECUTION_WORKER_QUEUE.md。

## OBS-02 只读预览源码阶段（#28）
新增显式文件清单 CLI，按 task_id 日期及显式状态筛选，严格解析 frontmatter、校验 Codex 来源、冻结重复 AGT、精确匹配项目，并输出字段差异和原始 Markdown。只输出本机 stdout，不读默认 vault、不写数据库、不授权导入或执行。合成文件/CLI验收与真实任务导入分开；操作及限制见 OBSIDIAN_IMPORT_PREVIEW.md。已用当前开发任务的一份真实笔记进行显式范围只读预览，源哈希不变；合成用例覆盖跳过/冲突/差异。CLI 预览独立交付，导入、UI接入及双向联动未实现。
