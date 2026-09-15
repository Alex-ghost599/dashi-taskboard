# Obsidian 只读派生索引（#29 第一阶段）

当前入口：显式 manifest → 有界文件读取 → 身份/范围预览 → 独立 SQLite 事务 → CLI 读取元数据。没有后台扫描、UI 接线、源文件写回、正式 Taskboard 导入、模型调用或执行派发。#29 的双向编辑目标继续保留，不能用本阶段代替完整验收。

## 使用与数据位置

使用支持 node:sqlite 的项目 Node 运行时。manifest 沿用 OBSIDIAN_IMPORT_PREVIEW.md：必须给 root、files、projects 和日期/状态 scope，没有默认 vault 或全库搜索。文件内容仅在本机处理。先创建当前用户专用目录（Unix 0700），库文件为 0600；不得放入仓库、同步目录或正式任务/控制库路径。

```sh
node scripts/obs-readonly-index.mjs ingest --database /absolute/private/obs-index.sqlite --manifest /absolute/private/manifest.json --operation observation-001 --expected-revision 0
node scripts/obs-readonly-index.mjs list --database /absolute/private/obs-index.sqlite --source-root /absolute/canonical/source-root
```

`ingest` 的写入对象仅为独立派生库。root 在首次建立后固定；list 使用 canonical root 精确比对，只读打开，文件不存在时不创建。stdout 为 JSON，stderr 为错误代码和可能的 Node SQLite 实验性提示；不输出笔记正文。需要旧版本正文的受控本机调用可使用 `readVersion(hash)`，不得把返回值当作执行指令。CLI 不注册 Skill、PATH、服务或自启动，操作完成即退出。

## 持久状态与保留规则

- 全局 revision 与 BEGIN IMMEDIATE 保证独立写入进程对同一索引的 CAS：旧 revision 返回 STALE_REVISION。它不锁定源文件或 iCloud，也不构成未来源写回的并发保证。
- operation ID 对完全相同的请求幂等，重试返回原 revision；同 ID 不同请求报 OPERATION_CONFLICT。新扫描使用新 ID 及当前 revision，不能盲重放旧提案。
- 候选 Codex 笔记保存精确 Markdown 内容版本；跳过/无效/其他 Agent 的当前正文不存入 versions，仅保留路径、哈希和原因等元数据。此前已接受的版本不会因后来跳过而删除。索引仍含私人任务内容，备份同样需要私有权限。
- 没出现在最新显式批次的路径标记 unobserved，不能解释为删除。历史内容重新出现标记 HISTORICAL_CONTENT_REAPPEARED；同路径换身份标记 SOURCE_ID_CHANGED。这两类冲突持续保留，重复扫描、重启或新内容均不自动解除。
- 所有已观测身份与路径关联持续保留。多个路径曾出现同一 ID 时，相关路径冻结为 conflict，conflictReason 为 DUPLICATE_TASK_ID_HISTORY；reason 继续保留该路径原有阻塞原因。移动文件也需要未来明确对账，不能凭路径消失猜测迁移。
- 当前无冲突解除、归档、剪枝或源修改接口。unsupported/invalid 内容可在后续合法观察中更新解析结果，但既有身份、历史回流、重复路径冲突继续保留。
- 所有结果固定 authorizesSourceWrite / authorizesImport / authorizesDispatch 为 false；Markdown 中的状态、来源会话、执行绑定不获得运行权限，bindingVerified 始终 false。

限制：每次显式最多 1000 文档、单篇 1 MiB、总输入 10 MiB；索引累计最多 1000 路径、10000 操作、100000 观察和 128 MiB 候选正文。超限整笔事务回滚，不自动删除历史腾空间。初建 schema1 使用独立 application_id；拒绝未知库、不同 root。私有目录/文件检查不提供同用户恶意进程或系统管理员隔离，Windows 未实现额外 ACL 加固，部署时须核实实际 ACL。

## 备份、恢复与故障

没有常驻持有者时，等待所有自建 ingest 命令退出，复制整个 SQLite 文件到另一个私有目录；不要在事务进行中只复制主文件。先在隔离副本只读 list 并比对 revision、路径和历史哈希，确认后才考虑采用副本。恢复索引不会恢复/启用派发，因为索引没有执行权限。正式源笔记始终保留，当前无自动恢复旧内容到源的行为。

异常退出由 SQLite 回滚未提交事务；首次建库若中断留下未初始化文件，后续拒绝为 UNRECOGNIZED_INDEX，保留文件供诊断，不自动覆盖。停用只需不再调用 CLI；不自动删除已有索引/备份/原始笔记。没有应用安装或用户共享配置可卸载。

## 验证范围

12 项索引回归覆盖精确版本、幂等/CAS、两个真实子进程竞争、重开/隔离复制、缺失路径、跨批身份重复、历史回流与身份替换持续冻结、其他 Agent 正文排除、容量整笔回滚，以及真实 CLI 合成 manifest/list 的源文件和数据库字节不变。另保留共享读取器的父目录替换与跨平台 CLI 回归。两个冲突缺陷均先观察到新增回归失败再修复。

这些是本地合成数据与进程验收；未建立正式 vault 索引，未验收真实 iCloud、写回、UI、源写入锁协调或异常断电持久性。后续受管写回必须保存 base/current/proposal，证明外部写入者协调并完成冲突与恢复验收后单独启用。
