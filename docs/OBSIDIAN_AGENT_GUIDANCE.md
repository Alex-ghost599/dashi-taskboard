# Obsidian Agent 指导与兼容迁移（#30）

依赖 OBSIDIAN_TASK_CONTRACT.md v1。此次范围为写入者盘点及必要指导落地，没有启用 Taskboard 同步、历史任务迁移或跨 Agent 执行。

## 来源盘点与最小修改

已检查 vault AGENTS、中央 Agent Operating Protocol、任务模板、Registry/Base 和 ID 校验入口，以及已配置的 Codex、OpenClaw、Hermes 指导来源。23 份配置指导文件的引用和哈希记录保存在本机私有台账。OpenClaw 当前配置有 8 个 Agent 工作目录；Hermes 检查 7 个 profile，其中部分明确禁止建卡，不能统一视作任务写入者。

已配置入口引用中央协议，字段规则在中央维护。本轮实际修改仅两份文件：

| vault 相对路径 | 修改 |
| --- | --- |
| `10-Agent-Ops/Agent Operating Protocol.md` | 增加可选 source_session / execution_binding 属性与来源、执行绑定、运行复核的区分 |
| `70-Templates/Agent Task Template.md` | 新增两个空字段及填写说明 |

vault AGENTS、各全局/profile 指导、Registry 和历史任务均未修改。未发现某些工具的全局文件、插件处于 enabled 或配置引用存在，都不能证明它们运行时不会写任务；此次未穷举任意插件、脚本、hook 或验证每个 Agent 的实际加载行为。

## 兼容语义

历史没有会话信息时留空；source_session 不自动升级为执行绑定。execution_binding 为 hostId/projectId/workspacePath/threadId 四字段对象，只由明确绑定/解绑维护，实际执行前仍须可信接口验证真实目标、目录、在途状态及授权。保留 agent 来源和 executor_agent 交接语义，不从任务状态或评论推导执行许可。

模板新增字段是可选属性，不改变旧任务所需属性、状态枚举、ID 分配和 Registry 查询。复杂对象的 Obsidian 属性 UI 尚未验收，当前由 YAML 和受控绑定流程表达，不能声称 UI 已可编辑。

## 应用、备份与恢复

先核对两份实际源文件与审核快照哈希，再保存当前备份；写入前再次核对源版本，逐文件应用、读回确认目标与提案一致。本机绝对路径、哈希和备份位置保存在私有应用回执，不提交个人路径及原始指导全文。

需要恢复时，先检查实际文件是否仍等于本次应用版本。若有后续修改，按 diff 仅撤销本次字段说明并保留新内容；不得直接覆盖。使用当次备份在隔离位置核对字节后，再执行明确的恢复操作。此次核实备份完整性，未对共享文件进行恢复覆盖试验。

## 验证与限制

独立 validation-only reviewer 确认实际目标 2/2 匹配已审提案、备份 2/2 匹配原始版本，Critical 0 / Important 0。实际新模板抽取 YAML、填入合成任务后通过契约预览，intake、来源会话及执行绑定为空，无导入/派发授权；vault ID 检查成功。没有批量回填历史任务、重启 Agent 或触发真实模型调用。

指导文件落地与运行时加载分别验收：本阶段完成共享文件兼容更新，后续各 Agent 新任务遵循原入口读取中央协议；尚未进行每个 Agent 的模型遵循性或 UI 验收。#29 继续承担双向源写回及冲突处理实现。
