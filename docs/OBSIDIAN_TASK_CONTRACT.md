# Obsidian 任务身份契约 v1

当前归一化实现只处理已解析 frontmatter 的身份，不读取 Markdown、导入任务或写回 vault。依据中央 Agent Ops 协议、模板及已配置写入者的指导文件盘点；新增字段尚未写入共享指南。此 v1 固定身份读取及受管字段编辑语义，不冻结尚未实现的双向写入协议。

## 兼容现有字段

| frontmatter | 归一化字段 | 规则 |
|---|---|---|
| task_id | taskId | AGT-YYYYMMDD-###，日期有效；稳定身份独立于笔记路径 |
| agent | sourceAgent | 来源；缺失不猜测。本阶段仅精确 codex |
| executor_agent | executorAgent | 缺省、null、空白字符串按现有协议继承来源；明确其他执行者排除 |
| status | sourceStatus | 保留 intake/planned/active/waiting/review/done/blocked/dropped，不直接转换为可执行 todo |
| workspace | workspaceHint | 可为路径、仓库、vault 区域、外部系统；仅保留提示，不生成 project/cwd 绑定 |
| source_session（可选新增） | sourceSession | 可空，保留来源引用，不赋予执行所有权 |
| execution_binding（可选新增） | executionBinding | 可空；非空要求 hostId/projectId/workspacePath/threadId 全部明确 |

仅 Codex 来源且实际执行者为 Codex 的记录通过当前筛选。Hermes 创建后交给 Codex、Codex 创建后交给其他 Agent 的记录均不在首次导入范围。命名别名、大小写或冲突字段不静默猜测，后续预览显示排除原因。

执行绑定通过结构检查后仍为 `bindingVerified:false`；项目解析始终留空，不能凭本地路径字符串或模型建议生成项目 ID。后续必须向可信桌面接口核实完整 host/project/cwd/thread 身份、目录真实性和忙碌状态。来源会话无论是否可打开，都不自动成为执行绑定。

## 存储与写回边界

Obsidian 受管任务以 Markdown 为内容权威，Taskboard 仅建立派生索引；原生任务继续使用原生数据库。准入策略、执行尝试、UNKNOWN 和可信回执使用独立持久控制存储，不能随索引重建丢失。

归一化结果是只读投影，不能作为整个 frontmatter 的替换内容。未识别属性、正文、人工编辑和格式必须保留，受管字段权限按下表固定，实际写回和冲突协议在 #29 实现。本阶段没有写回函数。YAML重复键、重复 task_id、项目歧义及文件移动由 #28 预览处理；实际并发编辑、删除冲突和写回由 #29 处理。预览的去重覆盖仅限所提供且可解析的文档。

`decision:valid` 只说明身份格式符合当前规则；`authorizesDispatch:false` 始终保持。来源状态不是任务完成验收证据，本文没有用普通 Markdown 文本替代执行回执。

## 状态、证据与字段所有权

- `status` 仅映射为 `sourceStatus`。例如源任务 `done` 表示笔记记录了完成状态；不会生成可信完成回执、释放 Executor 占用或满足下一张卡的执行条件。
- 现有 `evidence`、`blocked_reason`、正文验证清单和来源链接都属于源内容，随原始 Markdown 保留。身份归一化不裁剪或重写它们，不自动打开链接、不把其内容转为机器授权。缺失证据不伪造，链接存在不等于已验证。
- 可信执行证据来自单独控制存储中的 attempt 与匹配 request/host/thread/turn 的回执。源文档与控制库可互相引用，但普通 Markdown 修改不得直接生成此类回执。
- `task_id`、`agent`、`executor_agent`、`status`、`workspace` 继续遵循中央协议既有语义；`source_session`、`execution_binding` 是可选附加字段，历史缺失时保留空值。其他字段、格式和正文由来源保留，不因身份归一化丢失。
- `projectBinding` 是预览中由显式项目快照精确匹配得到的派生字段，不写回替换 `workspace`，也不证明运行时身份。`bindingVerified` 不能由 frontmatter 自我声明为真。

## 受管字段契约 v1

下表定义后续双向联动必须遵循的编辑语义。当前实现仍只读，没有因此启用任何写回；#29 须实现源版本检查、差异预览、原子写入、冲突拒绝及回读验证后，才能开放列明的编辑操作。Taskboard 与 Obsidian 修改的是同一份源内容，禁止用独立副本相互覆盖。

| 字段 | Taskboard 编辑规则 | Obsidian 侧变化与同步规则 |
|---|---|---|
| `task_id` | 已有任务不可改；新建受管任务由统一ID分配流程产生 | 改ID视为身份冲突，不自动视为同任务重命名；文件移动不改ID |
| `agent` | 来源身份只读，不因当前执行工具覆盖 | 来源变化需人工确认身份纠正；离开Codex范围冻结索引编辑及自动执行候选 |
| `executor_agent` | 不通过普通属性编辑隐式handoff；由显式交接流程更新 | 按来源继承空值，明确非Codex执行者退出首次受管范围；不自动改回Codex |
| `status` | 允许编辑中央协议枚举；受管卡展示/编辑源状态，不静默转原生Todo | 同步源状态；done不生成可信回执，planned不授权执行；并发不同修改报冲突 |
| `workspace` | 允许通过明确的项目选择操作改变，需唯一host/project/cwd核实；已有执行绑定时先解决绑定冲突，禁止暗中重绑 | 仍可保存非路径提示；无法唯一解析时冻结可执行关联，不猜项目 |
| `source_session` | 可通过明确的来源链接编辑操作修改/清空，不赋予执行所有权 | 保留来源引用；不升级为执行绑定 |
| `execution_binding` | 只通过专用绑定/解绑操作修改，须可信桌面核实host/project/cwd/thread并检查在途attempt；未知在途结果不得自动替换 | 任何源编辑均仅得到未验证绑定；无论是否完整，均不得绕过可信身份和准入复核 |
| `evidence`、`blocked_reason` | 允许编辑源链接/说明，保留原值类型和非目标内容；blocked/waiting仍遵循中央协议的说明要求 | 同步内容，不自动打开链接或转换成可信完成证据 |
| `title`、`objective`、正文 | 允许编辑相应明确内容区；不改其他frontmatter字段，不整篇重生成 | 保留人工排版及非编辑区域；并发重叠修改拒绝覆盖 |
| `priority` | 允许P0/P1/P2/P3枚举编辑 | 原生看板优先级只可作为显示映射，不回写另套枚举 |
| `tags` | 允许明确新增/移除所选标签，保留其他标签 | 同步源列表；未知类型保留并报不支持，不强制转换 |
| 其他既有或未知字段 | v1不提供Taskboard写入口；原样保留，后续按契约升级支持 | 外部修改照常保留，不因索引重建丢失 |
| `projectBinding`、`bindingVerified`、索引路径/版本 | 派生或验证状态，禁止作为普通源属性编辑 | 不从同名frontmatter声明取得信任，不回写替代workspace或源会话 |
| 准入授权、attempt、UNKNOWN、可信回执 | 独立控制存储，仅通过已验证控制流程改变 | 不从Markdown同名字段导入，不随索引重建清除 |

本表不允许双向同步扩大任务执行授权。显式内容编辑、身份交接、可信执行绑定与实际派发是不同操作；任务文本或模型建议不能代替所需授权。受管卡的原生显示映射不得改变这份源字段契约。

## 写入者兼容范围

已检查中央协议/模板/Registry、Codex 全局入口、Hermes 主入口与本机 profile 指导，以及 OpenClaw 当前配置的各 workspace 指导；已配置 OpenClaw 入口引用同一中央协议。不同 profile 有不建卡、仅返回结果或按 brief 工作的限制，不能把所有 Agent 视作统一自动写入者。

配置文件、规则文件与运行时加载分开记录。Claude 的入口缺失、插件启用或临时 brief 不用于推断写入行为；未知写入者生成的未知属性仍原样保留，来源不明仍不猜测为 Codex。本契约不要求穷尽任意外部脚本后才允许只读预览，也不据此承诺任意写入者能安全双向同步。共享指导的必要更新、文件范围和备份由 #30B 逐项处理。

## 验证与未完成项

合成回归覆盖空执行者兼容、非Codex来源/执行者排除、笔记移动身份不变、来源会话隔离、非法日期/状态/绑定拒绝及完整绑定仍未验证。已通过 #28 的解析、项目匹配、字段保留与真实单任务笔记预览联合核对，其 PR #55 已合入 develop。未导入历史任务，未修改模板/Registry/全局指南，未进行真实桌面绑定验收；这些属于后续写回、共享指导与执行集成的交付范围。
