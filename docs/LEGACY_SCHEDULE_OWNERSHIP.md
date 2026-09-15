# 旧 scheduled 归属检查（#25A）

旧的本地 scheduled 协调入口为 `applyTaskboardAutomationPolicy → reconcileTaskboardAutomation → list-automations → automation-update/create`。此前同名第一条会被选中；已记录 ID 缺失时仍可能退回同名项或新建，且旧 Codex 项目可以被当前请求覆盖。这会妨碍精确迁移并造成重复计划。

## 当前修正

- 已记录 automationId 必须在实际列表中精确存在且唯一；不存在时返回 AUTOMATION_ID_NOT_FOUND，不回退、不新建替代计划。
- 没有记录 ID 时，仅当同名项唯一、ID 合法且在完整列表中唯一，并具有匹配的 cron/local/Codex project 元数据，才允许沿用。没有同名项时保留原有首次创建路径；这不启用真实自动执行。
- 同名多项或重复选中 ID 返回 AUTOMATION_OWNERSHIP_AMBIGUOUS；不批量暂停、选择第一条、改名或删除。
- 名称、kind、executionEnvironment 或 projectId 不符时返回 AUTOMATION_OWNERSHIP_MISMATCH。projectId 与 target.projectId 同时存在时必须一致，字段缺失不能据名称补造。
- list 使用相同归属检查；未确认归属时不把另一个计划的状态显示为当前计划状态。形状检查不证明真实主机/目录或防御同用户恶意伪造。
- 本地协调函数拒绝 remote 请求，projectId:null 不能证明远端 host/cwd。现有远端策略执行有独立分支，本补丁未将它迁入新协调器，也未完成其所有权验收。

暂停只改变状态，沿用读到的旧prompt、模型、周期和可选通知/环境配置；已PAUSED不再重写。快照缺字段时拒绝用当前设置填补。此处未解决列表读取后其他写入者修改的竞态，不提供跨写入者CAS保证。

暂停遇到上述错误时，已有暂停意图持久化规则继续生效：enabledByUser=false、pausePending=true，UI/恢复逻辑继续报告未确认，不能声称计划已暂停。真实计划和已运行会话保持原状，未知归属需后续明确对账。

## 验证与限制

37 项协调与暂停回归通过：记录 ID 消失、同名不同项目、同名重复、缺失/重复 ID、矛盾项目别名、元数据缺失、远端拒绝均无写调用；项目名称更新仍兼容，项目身份改变拒绝重定向；暂停失败保留 disabled/pending。新增误选及无 ID 缺陷均先观察到回归失败，再修复。

暂停 fixture 补齐真实所需的身份元数据，保留原传输失败、重启、并发失效、状态确认断言；原“项目 ID 自动变化仍可沿用”的期望改为明确拒绝，同时保留同一项目改名兼容。

这是源码及合成 RPC 验收。当前机器的既有政策文件已只读检查为关闭，已知旧计划文件为 PAUSED，但这些不验证当前桌面 list-automations 的完整响应形状；升级前仍须对真实返回字段和错误提示做独立验收。未更新真实 scheduled、正式 App 或现有会话。

#25A 尚需备份、精确迁移读回及单协调器启用门槛；#25B 生命周期/UNKNOWN UI 未交付。不得因本补丁合并关闭整个 Issue。新派发仍须前述迁移门槛和执行授权，旧列表匹配不构成新执行许可。
