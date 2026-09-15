# 本地自动化候选

`shared/automation-candidates.mjs` 是纯函数候选检查，当前尚未接入服务、扫描器或模型。`candidate` 仅表示可继续检查，所有结果均为 `authorizesDispatch:false`。#16 仍需要接入扫描适配器及 #17 联合扫描验收；本模块不替代 #24 的派发授权。

输入为规范化快照：任务 ID、明确项目 ID、状态/归档、标题/描述/标签、执行 Agent、hold/禁止执行标记、依赖 ID、执行绑定及 `instructions`。原生任务的执行目标不从 Obsidian 来源 Agent 推断。适配器必须将所有用户指令和人类评论保留在 `instructions`，不能将原始评论整体当审计丢弃；系统回执和纯时间戳不属于判断输入。当前模块不接受原生 API 对象作为已经规范化的数据。

缺字段、重复任务 ID、重复指令 ID、超出输入预算均阻止候选。依赖检查覆盖可达依赖图，缺失、循环、未知项目、归档或未完成依赖均阻止候选。上限为 10,000 个任务、20,000 条可达依赖边、2,000,000 个语义文本字符；在摘要序列化前检查预算。

`semanticInputVersion` 基于语义字段及依赖状态；`judgmentKey` 再加入 `judgePolicyRev`。系统版本号、更新时间和系统回执不会使判断缓存失效。授权版本 `authRev` 仍由授权层管理；当前判断输入不包括权限。后续 Judge 如根据权限作判定，必须显式将权限版本纳入该判定缓存，不能直接复用本键。

绑定目前仅作完整字段形状校验与语义摘要；真实 host/project/cwd/thread 一致性、路径解析和有效权限由 #18/#24 后续门禁验证。候选函数没有租约写入、预算扣减、外部调用或任务状态修改。持久状态由下面的独立存储负责。

验证：`node --test test/automation-candidates.test.mjs`，覆盖确定性摘要、审计变化不失效、语义与判断策略变化失效、过滤、依赖图及累计输入预算。源模块测试不代表自动化已启用或真实业务验收。

## 持久判断状态

`server/automation-candidate-store.mjs` 提供协调器内部的 `CandidateStore`，使用显式绝对路径的独立 SQLite 文件，创建权限为 0600，校验所有者、文件类型和专用 application ID；不接受原任务数据库。当前没有默认生产路径、HTTP 写入口或自动启动逻辑。

调用顺序：本地资格检查 → `claim` → 在调用模型前 `start` → 根据确定的终态回执 `finish`。领取及状态变更使用 `BEGIN IMMEDIATE`，同一个 task ID 在所有项目及语义版本中最多一个 leased/unknown；项目迁移不能绕过未决判断。所有返回值仍不授权 Executor 派发。

- accepted/rejected 缓存按任务 ID 与 judgmentKey 保存，重开进程后仍有效。当前权限不进入 Judge 输入，所以 authRev 只留审计值，不导致重复判断。以后判断依赖权限时须显式升级缓存键。
- 未 start 的过期租约可以重新领取，仍计入该键的尝试上限；start 必须先于外部调用持久化。每键第一次记录的上限不能被后续 claim 放大。
- start 后超时或进程消失一律进入 unknown，即使卡片变化也禁止自动重放。调用方发现网络结果不明应立即 `markUnknown`。当前没有清除 unknown 的便捷入口；后续 #18 的真实回执核对流程必须先证明终态，不能直接删记录重试。
- retryable 只用于适配器明确确认的终态失败且没有仍在运行的请求，须提供回执 ID 及未来 retryAt；不能把超时归为 retryable。已用尽尝试次数会返回 exhausted。
- token 和 leaseUntil 防止旧 owner 写回；重复 start、迟到结果及重复 finish 均拒绝。时钟回退暂停状态变更，待系统时间恢复后继续，避免错判租约。

这是内部状态协议，调用方可信性由协调器集成保证。`start` 的返回不代表模型已经响应，accepted 也不代表 Executor 已启动；完整判断响应及执行绑定回执由后续适配器存储和核验。没有在此实现并发执行配额、预算扣减、策略暂停原子派发或正在执行任务的停止。

数据库历史不自动删除。备份应在关闭所有该库连接后复制到隔离路径，恢复打开时仍校验类型和权限；不要覆盖正式数据。测试使用自己的临时库和子进程：四进程争抢仅一份租约，杀死已 start 子进程后 unknown 跨重启/隔离恢复保留。

完整针对性检查：`node --test test/automation-candidates.test.mjs test/automation-candidate-store.test.mjs`。关闭 #16 仍需 #17 持续扫描与真实数据规范化适配器验收；这里没有模型调用，也未修改旧 scheduled。

存储初始化应由单一受管启动流程完成。首次创建空文件后进程若崩溃，或第二个进程在初始化完成前打开，可能报告 Unrecognized candidate store；必须保留文件诊断，不能自动删库重试。文件父目录也应由当前用户管理，当前校验仅覆盖文件本身，不能隔离恶意同用户替换。缓存 accepted 后的每一次实际派发仍须重新验证最新策略和绑定。

本阶段验证结果：17 项针对性测试、安装包 Node 下同组测试通过；全量 Node 464 通过/1 跳过，typecheck 与 10 项组件测试通过。独立 validation-only reviewer 对候选与存储的最终结论为 Critical 0 / Important 0；无模型调用、未修改正式运行环境。
