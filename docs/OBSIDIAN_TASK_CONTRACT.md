# Obsidian 任务身份契约（开发中）

本阶段只约束已解析 frontmatter 的身份归一化，不读取 Markdown、导入任务或写回 vault。依据中央 Agent Ops 协议及模板盘点；其他写入者尚未穷尽，新增字段尚未写入共享指南。

## 兼容现有字段

| frontmatter | 归一化字段 | 规则 |
|---|---|---|
| task_id | taskId | AGT-YYYYMMDD-###，日期有效；稳定身份独立于笔记路径 |
| agent | sourceAgent | 来源；缺失不猜测。本阶段仅精确 codex |
| executor_agent | executorAgent | 缺省、null、空白字符串按现有协议继承来源；明确其他执行者排除 |
| status | sourceStatus | 保留 intake/planned/active/waiting/review/done/blocked/dropped，不直接转换为可执行 todo |
| workspace | workspaceHint | 可为路径、仓库、vault 区域、外部系统；仅保留提示，不生成 project/cwd 绑定 |
| source_session（拟新增） | sourceSession | 可空，保留来源引用，不赋予执行所有权 |
| execution_binding（拟新增） | executionBinding | 可空；非空要求 hostId/projectId/workspacePath/threadId 全部明确 |

仅 Codex 来源且实际执行者为 Codex 的记录通过当前筛选。Hermes 创建后交给 Codex、Codex 创建后交给其他 Agent 的记录均不在首次导入范围。命名别名、大小写或冲突字段不静默猜测，后续预览显示排除原因。

执行绑定通过结构检查后仍为 `bindingVerified:false`；项目解析始终留空，不能凭本地路径字符串或模型建议生成项目 ID。后续必须向可信桌面接口核实完整 host/project/cwd/thread 身份、目录真实性和忙碌状态。来源会话无论是否可打开，都不自动成为执行绑定。

## 存储与写回边界

Obsidian 受管任务以 Markdown 为内容权威，Taskboard 仅建立派生索引；原生任务继续使用原生数据库。准入策略、执行尝试、UNKNOWN 和可信回执使用独立持久控制存储，不能随索引重建丢失。

归一化结果是只读投影，不能作为整个 frontmatter 的替换内容。未识别属性、正文、人工编辑和格式必须保留，具体受管字段写回及冲突协议在 #29 实现。本阶段没有写回函数。YAML重复键须由后续解析层拒绝；重复 task_id、无法明确项目、源文件移动、并发编辑及删除冲突应在 #28/#29 的预览与同步层处理。

`decision:valid` 只说明身份格式符合当前规则；`authorizesDispatch:false` 始终保持。来源状态不是任务完成验收证据，本文没有用普通 Markdown 文本替代执行回执。

## 验证与未完成项

合成回归覆盖空执行者兼容、非Codex来源/执行者排除、笔记移动身份不变、来源会话隔离、非法日期/状态/绑定拒绝及完整绑定仍未验证。未导入历史任务，未修改模板/Registry/全局指南，未进行真实桌面绑定验收。#27 保持开放，待剩余写入者盘点及契约联合验证。
