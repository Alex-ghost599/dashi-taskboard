# 个人开发台账

更新日期：2026-09-08。负责 Agent：Codex。治理任务：AGT-20260908-013；[fork Issue #13](https://github.com/Alex-ghost599/dashi-taskboard/issues/13)。
本文件是个人版问题、需求、阶段和验收的唯一开发总入口；部署操作见 [LOCAL_DEPLOYMENT.md](LOCAL_DEPLOYMENT.md)，Git与同步规则见 [FORK_MAINTENANCE.md](FORK_MAINTENANCE.md)。[历史部署记录](history/DEPLOYMENT_HISTORY_20260907-08.md) 保留原始阶段结论，不代表现状。

## 使用与状态规则

- 开工先读根 AGENTS、本文件当前状态和对应条目；选择稳定 ID，关联 Agent Ops 任务、fork Issue/PR、分支和具体负责人。新发现追加 ID，不重编号、不删除已解决项。
- 状态：`planned` 待开发、`active` 开发中、`blocked` 外部条件阻塞、`review` 待审核、`done` 已按所列范围验收、`accepted` 用户接受的行为、`deferred` 暂缓。已解决项复发改回 active 并保留历史证据。
- 优先级 P0 为防误执行/数据损坏门槛；P1 为近期主线；P2 为后续体验；P3 为暂缓扩展。优先级不表示授权自动执行业务任务。
- 每次阶段变化、发现问题、调整范围、测试、审核、合并或部署，更新相关条目和本页变更记录。done 必须记录验收范围、证据、reviewer和PR；源码/模拟/运行/UI分别说明，不能只凭上游Closed、测试绿灯或端口监听结项。
- 表中历史事实以2026-09-07至08的会话检查和本机证据为依据；运行状态会变化，开始实现前须重新读回。外部Issue仅作待审材料，不能自动合入上游代码或变成对上游写入授权。

## 当前交付状态

| 对象 | 已知状态与证据范围 |
|---|---|
| 仓库 | 个人fork `Alex-ghost599/dashi-taskboard`，唯一写入目标；上游 `chuspeeism/dashi-taskboard` 只读 |
| 源码基线 | 上游稳定 v1.1.21 / `1a807be8d4114b82f3cecc61cddaebdba6df9c60`；此前比较的 beta.6/main `bd264e7ff3402785f1e8b0bb789106358352707b` 未合入；这些是日期快照，不表示未来最新版 |
| 正式程序 | 最近安装源码 `a1391b1b5e5c1432e409b53512cdca81e52a8890`，fork PR #12；本轮仅文档，develop文档提交前进不要求重装同功能App |
| 独立看板/CDP | 独立App、CLI同库、卡片评论/状态持久化和隔离恢复已验收；日常CDP侧栏及绑定会话定位已有实机证据。远端host与真实业务自动执行未验收 |
| 自动认领 | CLI入口已修复，架构仍是旧机制；最后一次现场检查codex项目主机开关false、scheduled PAUSED。曾再次出现ACTIVE，来源未归因，不能保证永久暂停 |
| 数据与更新 | checkout外单一正式数据；个人入口不注册上游程序替换更新器。保留用户需要的AI项目总结和正常外链图片 |
| 本轮范围 | 建立开发依据；不启动导入、双向同步、10秒轮询或付费任务，不修改其他Agent共享指令 |

PR #12与main复验CI均成功（main run `34176274000`，本轮读回）；只代表检查层通过。

安装provenance、`.local-evidence/automation-cli/final-validation.json`、CDP的 `.local-evidence/cdp-handoff-retry-20260907/` 与历史文档提供本机追溯。凭据、个人数据及本机证据不提交Git。日常绝对路径、备份和恢复命令以部署文档为准。

## 本地问题与已完成项

| ID | 优先级/状态 | 事实、影响及下一步验收 |
|---|---|---|
| FIX-01 | P1 done | fork治理、稳定基线、loopback源码App、同库CLI和回滚基础完成；fork #1/#2、#3/#4，foundation_review；初次UI/重启/隔离恢复证据见历史文档 |
| FIX-02 | P0 done | CDP曾接受标题Codex及导航期间旧上下文，可能错误下发令牌；已加真实来源、导航撤权和RPC校验，fork #5/#6、cdp_trust_review。后续原生兼容需保留这些负向测试；安全扫描覆盖有限，不承诺绝无后门 |
| FIX-03 | P1 done | 个人持久凭据、仅附着注入、原生preload合成回复兼容、日常启动入口；fork #7/#8/#9，personal_cdp_review等独立复审与实机侧栏/会话定位证据。不得修改官方包/数据库 |
| FIX-04 | P1 done | hotkey辅助窗口串行等待使心跳失效；fork PR #10排除辅助路由，10项定向回归及实机复验。此修复不能解释所有UI刷新 |
| FIX-05 | P1 done | scheduled原始CLI访问个人服务返回404；fork Issue #11 / PR #12切换个人凭据包装器，16项测试、automation_cli_review通过，安装a1391b1后查询成功。未改自动化流程 |
| BUG-01 | P0 planned | 暂停后曾再出现host enabled及scheduled ACTIVE，原因未归因；增加状态写入来源/时间/因果记录，重启与UI开关测试，暂停应阻止后续派发；已有运行须单独识别处理 |
| BUG-02 | P0 planned | todo中有hold、禁止执行或依赖未满足任务仍周期启动模型；已观测重复读卡/Skill/写记忆及空队列会话。没有证明这些会话执行了业务修改；需本地候选门禁和去重，参见AUTO-01/02 |
| BUG-03 | P1 planned | 空todo后主机关闭enabledByUser并停止timer；新todo不会恢复；用户希望持续待命。与显式暂停及额度等待区分，见AUTO-01 |
| BUG-04 | P0 planned | 历史threadId与完整执行绑定混用，list_threads前50条遗漏可能误判blocked；上游#369虽关闭，本地prompt仍存在相应逻辑。来源会话不能自动升级执行所有权；见AUTO-03、OBS-01 |
| BUG-05 | P1 planned | 用户观察静止UI重加载（DAS-7）；需记录可见现象、导航/iframe/心跳/进程事件时间线，区分项目刷新、注入恢复和外部CLI操作；尚未定位全部根因 |
| BUG-06 | P1 planned | graceful退出曾残留Node，初次5秒期限修复后安装升级仍需顺序清理自有服务；启动握手超时、强杀后孤儿恢复未完整验收。测试不得终止日常Codex |
| BUG-07 | P2 planned | checkout有未知`* 2.*`副本，会被迁移测试读取而重复列失败；来源未核实，保留原文件，用干净worktree验证；清理需先核实来源和备份 |
| BUG-08 | P2 planned | 项目空白/无卡片可能为项目筛选、路径归属或导入未执行；此前截图不足以证明数据丢失。对照项目ID、API卡片数、UI筛选，关联上游#188/#381 |
| LIMIT-01 | P2 deferred | 远端host IPC、跨机执行路由、Windows/Linux实机、签名公证、fork更新发布链未验收；不沿用上游关闭状态作为本机证明 |
| LIMIT-02 | P2 accepted | AI概览会向配置模型发送项目摘要；用户明确保留。外链图片请求暴露访问IP/时间/URL标记属已接受行为；不等于发送整库任务 |
| LIMIT-03 | P1 accepted | 继续禁上游自动替换、共享Skill/PATH/shell无必要写入、官方App/内部DB修改、无授权自启。当前个人CLI已可访问同一服务 |

## 自动化主线：用户目标与验收

当前链路：本机检查 → Codex scheduled按周期唤醒模型 → 查todo/评论 → 未绑定卡在该自动会话内执行，完整绑定卡转达旧会话。界面模型设置影响该自动会话的执行模型。普通本机HTTP轮询不消耗模型token；scheduled空跑仍消耗token。当前没有“只判断、不执行”的独立本地调度层。

期望链路：本地持久待命 → 约10秒扫描合格todo → 固定任务ID和版本 → Spark独立判断/转达 → 精确绑定或新建专用执行会话 → 执行模型处理 → 回写状态与证据。

| ID | 优先级/状态 | 范围与验收条件 |
|---|---|---|
| AUTO-01 | P1 planned | 本地无模型轮询，默认目标10秒；空队列持续待命，不创建会话、不发模型请求、不刷记忆。连续空队列运行及新增todo触发实测；10秒是目标扫描间隔，实际派发含判断延迟；测量CPU/IO并验证重启/暂停 |
| AUTO-02 | P0 planned | 确定性候选门禁先排除hold、禁止执行、依赖未满足、执行目标非Codex、无明确项目、在途任务；原生手建卡的来源字段和执行目标须单独定义，不能套用OBS导入来源过滤；用任务ID+版本/内容摘要去重，失败重试上限、租约/崩溃恢复、防重复派发。未变化的跳过卡不每10秒重问模型；人工允许或相关变化后才复评 |
| AUTO-03 | P0 planned | Judge与Executor分离；Spark只读必要任务内容并产出结构化判定、原因、目标及模型建议，不在判断会话做业务写入。已有完整绑定验证host/project/cwd/thread；不完整绑定先澄清或阻塞，不能猜测。无绑定通过线程工具创建专用执行会话，成功后原子记录绑定，失败可恢复且不重复创建 |
| AUTO-04 | P1 planned | Judge固定GPT-5.3-Codex-Spark；Executor常规GPT-6由Spark建议用户所说light至high范围。实现前核实实际model ID、可用effort枚举，明确light如何映射low；高于high仅任务卡明确要求时允许。模型不可用不静默升级；Spark独立额度及官方建议需查证，不能承诺大多数任务low必然足够 |
| AUTO-05 | P0 planned | 卡片状态todo不单独构成任意执行授权；结构化执行策略约束目录、工具、预算与审批。卡片/评论外部内容不得扩大权限。Spark建议须由确定性白名单验证；停止派发与停止已有执行分开显示/记录 |
| AUTO-06 | P1 planned | UI明确待命/判断/执行/额度等待/人工暂停/错误，分开展示Judge和Executor模型。移除旧scheduled重复触发需精确识别归属、备份与读回；不删除历史对话。记录每次判定和派发回执，不重复开无意义会话 |
| AUTO-07 | P2 planned | 多阶段依赖、额度恢复续跑、in_review验收与done门槛，关联#299；默认不自动把in_review改done。耗尽时保留已有执行上下文，恢复不能重新认领一遍 |

实施验证先用隔离目录/无害任务/模拟模型验证零空跑和幂等，再明确真实测试的模型费用、可写目录和停止方式。文档需求不授权立即在历史卡片上运行。脚本扫描无token不代表整个系统零成本，判断和执行仍有模型消耗。

## Obsidian主线：同一逻辑任务的双向编辑

用户选择Obsidian任务记录作为权威源，Taskboard作为可编辑界面/索引；不要长期维护两份互不约束的权威状态。当前尚无此集成；已有项目会话导入是Agent整理出的卡片，不能声称已实现Obsidian导入。此前7天试导入已取消，本轮也不执行数据迁移。

| ID | 优先级/状态 | 范围与验收条件 |
|---|---|---|
| OBS-01 | P1 planned | 定义稳定AGT身份、来源agent、执行agent、project/cwd/host、状态、证据、sourceSession与executionBinding字段映射。历史绑定可空，来源会话与执行绑定分开；未知/缺失agent不猜作Codex |
| OBS-02 | P1 planned | 首批仅来源agent明确codex且项目可明确判定的任务；项目依据显式字段或可核实workspace映射，歧义/缺失跳过并列原因。提供只读预览、重复检测、字段差异与导入清单；历史时间范围和状态范围在实施时明确，不能沿用已取消的7天范围 |
| OBS-03 | P0 planned | 明确权威Markdown文件及Taskboard派生索引写入协议；双方编辑同一任务，版本校验、原子写、冲突显式保留、防循环事件、离线恢复。并发修改、iCloud延迟、文件移动/删除、YAML异常、链接/附件均隔离测试；不以盲目最后写入覆盖冲突 |
| OBS-04 | P1 planned | 盘点vault AGENTS、Agent Operating Protocol、任务模板、Registry/Base及相关全局AGENTS/sys prompt的实际路径与所有者，加入未来执行绑定记录规范。先提交变更清单与兼容迁移方案，独立审核；本轮只登记，不批量改共享提示词 |
| OBS-05 | P0 planned | 只改Codex授权记录，保留其他Agent字段、历史证据/来源、原任务ID；验证双向字段回写、备份/隔离恢复、幂等重跑、不确定项目零导入。同步事件不直接构成任务执行指令 |
| OBS-06 | P3 deferred | 稳定后再评估跨Agent统一管理；暂不导入或派发Claude/Claw/Hermes等任务。来源归属与当前执行者口径需兼容Agent Ops，不能因移交抹掉来源 |

## 上游问题观察清单

2026-09-08重新读取15条开放Issue。以下内容是报告/需求，除本地台账明确注明外未在当前Mac复现；Closed不表示个人版已解决。只允许上游读取和比较。

| 上游 | 快照/关注点 | 本地处理 |
|---|---|---|
| [#365](https://github.com/chuspeeism/dashi-taskboard/issues/365) | Open；当前项目导入仅准备AI请求，缺确定性枚举/导入 | P1 planned；与OBS-02区分会话导入和Obsidian导入，需预览/去重/来源证据 |
| [#299](https://github.com/chuspeeism/dashi-taskboard/issues/299) | Open；无人值守多阶段、额度恢复续跑 | AUTO-07 |
| [#14](https://github.com/chuspeeism/dashi-taskboard/issues/14) | Open；一键立即执行，当前打开会话可能仅预填 | AUTO-03/06；明确派发成功和实际开始 |
| [#199](https://github.com/chuspeeism/dashi-taskboard/issues/199) | Open；手动Codex会话自动建进行中卡 | P2 planned；防误导入/重复，先做身份绑定 |
| [#364](https://github.com/chuspeeism/dashi-taskboard/issues/364) | Open；拆分任务Skill、模型分工 | P2 planned；在AUTO主线稳定后评估拆分粒度和上下文成本 |
| [#228](https://github.com/chuspeeism/dashi-taskboard/issues/228)、[#33](https://github.com/chuspeeism/dashi-taskboard/issues/33) | Open；多平台会话追溯、Agent协议抽象 | OBS-06 deferred |
| [#284](https://github.com/chuspeeism/dashi-taskboard/issues/284) | Open；嵌套项目、面包屑、多视图一致 | P2 planned；先保证OBS项目归属准确 |
| [#381](https://github.com/chuspeeism/dashi-taskboard/issues/381)、[#188](https://github.com/chuspeeism/dashi-taskboard/issues/188) | Open；Windows改名/切项目后看板不可见 | BUG-08；Windows报告不能推断当前Mac数据丢失 |
| [#322](https://github.com/chuspeeism/dashi-taskboard/issues/322)、[#88](https://github.com/chuspeeism/dashi-taskboard/issues/88) | Open；高DPI图标、可读性 | P2 planned；实际屏幕复现后排优先级 |
| [#134](https://github.com/chuspeeism/dashi-taskboard/issues/134) | Open；新建表单默认属性保留 | P2 planned；区别表单偏好与任务数据丢失 |
| [#187](https://github.com/chuspeeism/dashi-taskboard/issues/187) | Open；语音录入任务 | P3 deferred；草稿不得被todo扫描自动执行 |
| [#140](https://github.com/chuspeeism/dashi-taskboard/issues/140) | Open；trellis联动 | P3 deferred |
| [#369](https://github.com/chuspeeism/dashi-taskboard/issues/369) | Closed；legacy thread ID误阻塞 | BUG-04；本地仍有相关prompt路径，需按实际内容审核 |
| [#23](https://github.com/chuspeeism/dashi-taskboard/issues/23)、[#24](https://github.com/chuspeeism/dashi-taskboard/issues/24)、[PR #45](https://github.com/chuspeeism/dashi-taskboard/pull/45) | Closed/Merged；关闭后继续派发、重复会话、无todo暂停 | BUG-01/02/03；PR45实际含6文件及回归测试，涉及prompt暂停、策略状态和UI只读查询；不能只读PR描述。后来的`5f52f64`才加入主机hasTodo直接关闭，不能混为同一次修复 |
| [#256](https://github.com/chuspeeism/dashi-taskboard/issues/256)、[#295](https://github.com/chuspeeism/dashi-taskboard/issues/295) | Closed；远端执行机、项目/worktree切换超时 | LIMIT-01；上游称PR296/301/310修复，个人远端实机未验收 |
| [#184](https://github.com/chuspeeism/dashi-taskboard/issues/184) | Closed；陈旧绑定妨碍认领 | AUTO-03恢复/所有权验收 |
| [#111](https://github.com/chuspeeism/dashi-taskboard/issues/111)、[#106](https://github.com/chuspeeism/dashi-taskboard/issues/106) | Closed；CLI环境/端点发现 | FIX-05回归参考；原因不必与个人404一致 |
| [#209](https://github.com/chuspeeism/dashi-taskboard/issues/209) | Closed；重复/旧Skill冲突 | LIMIT-03；继续不覆盖未知共享Skill |
| [#100](https://github.com/chuspeeism/dashi-taskboard/issues/100)、[#99](https://github.com/chuspeeism/dashi-taskboard/issues/99) | Closed；恢复重启Codex、错误离线 | BUG-05/06；保持仅附着和实例所有权核验 |
| [#67](https://github.com/chuspeeism/dashi-taskboard/issues/67) | Closed；模型菜单自行关闭 | BUG-05区别菜单重绘与整页重载 |
| [#352](https://github.com/chuspeeism/dashi-taskboard/issues/352)、[#367](https://github.com/chuspeeism/dashi-taskboard/issues/367)、[#325](https://github.com/chuspeeism/dashi-taskboard/issues/325)、[#52](https://github.com/chuspeeism/dashi-taskboard/issues/52) | Closed；Windows重启循环/空终端、语言、自动认领或标签页异常 | P3 deferred；平台或版本回归观察 |
| [#130](https://github.com/chuspeeism/dashi-taskboard/issues/130)、[#132](https://github.com/chuspeeism/dashi-taskboard/issues/132)、[#136](https://github.com/chuspeeism/dashi-taskboard/issues/136) | Closed；任务入队、评论续跑、依赖 | AUTO-02/07回归用例 |
| [#11](https://github.com/chuspeeism/dashi-taskboard/issues/11)、[#5](https://github.com/chuspeeism/dashi-taskboard/issues/5)、[#54](https://github.com/chuspeeism/dashi-taskboard/issues/54) | Closed；项目删除、失败启动清理、token路径 | OBS-03/BUG-06/FIX-05回归用例；禁止直接删历史数据 |

## 建议实施顺序与交付门槛

1. P0止损：BUG-01/02/04、AUTO-02/05，明确暂停、授权、幂等和绑定；保留现有自动认领暂停。
2. 本地调度：AUTO-01，先证明空队列长期待命且零模型请求，再实现AUTO-03/04/06独立判断与执行；专用测试项目验收后才投入日常。
3. Obsidian契约：OBS-01/04盘点字段与指导文档；OBS-02只读导入预览，OBS-03/05隔离双向同步、冲突与恢复；日常迁移范围单独固定清单。
4. 主线稳定后评估AUTO-07、确定性会话导入、项目导航和UI体验；其他Agent/远端/平台扩展保持暂缓。

自动化与Obsidian接口可共享身份契约，但不能让未验收的同步触发真实执行。每项实施从最新develop短期分支开始，Issue/PR仅fork、base develop、独立validation-only审核；真实部署另做安装来源与UI验收。本轮完成只代表台账和规则已交付，不代表表中planned功能完成。

## 变更记录

- 2026-09-08 / AGT-20260908-013：整合历史故障、15项开放上游Issue及相关关闭项；登记自动化与Obsidian需求，保留历史快照；本轮无运行程序/自动化/导入行为变更。独立reviewer `roadmap_review` 初审发现旧健康检查和CDP历史措辞可能误导操作，已修正，复审Critical 0 / Important 0；29个ID唯一、历史原文保留及本地链接检查通过。fork Issue #13；合并记录由关联PR提供，避免文档嵌入自身提交SHA。
