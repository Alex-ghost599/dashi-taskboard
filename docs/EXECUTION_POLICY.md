# 项目执行策略：本地管理与预检

本页描述 #24A 的已实现范围：操作员通过本地 CLI 保存、读取和暂停持久项目策略，并对结构化请求做范围预检。策略保存在独立控制 SQLite 中，不进入任务卡数据库、不使用 taskctl 凭据，也没有 HTTP 写入口。任务、评论和模型建议不能经卡片 API 修改该策略。

**当前未接入新旧自动派发。** `eligible_for_admission` 仅说明这次范围预检通过，所有结果都带 `authorizesDispatch: false`。旧 scheduled 不读取此策略；CLI 的 pause 不会暂停旧 scheduled 或停止在途会话。#24 整项仍开放，须结合 #23/#18/#25 完成实际适配器权限、派发前重验和停止 UI 后验收。

## 操作路径

本机操作员 → `scripts/execution-policy.mjs` → 独立控制 SQLite / 确定性预检 → JSON 结果。命令不会启动模型、创建线程、修改 scheduled 或业务数据。未指定控制库路径时拒绝写入；没有默认正式库或默认授权。

使用现有 Node（项目要求 Node >=22.5）：

```sh
node scripts/execution-policy.mjs --help
node scripts/execution-policy.mjs get --store /absolute/private/control.sqlite --project demo
node scripts/execution-policy.mjs replace --store /absolute/private/control.sqlite --project demo --expected-revision 0 --file policy.json
node scripts/execution-policy.mjs preview --store /absolute/private/control.sqlite --project demo --expected-revision 1 --file request.json
node scripts/execution-policy.mjs pause --store /absolute/private/control.sqlite --project demo --expected-revision 1
```

将 `/absolute/private` 换成已存在的操作员私有目录，远离源码和执行工作目录。新控制库以 0600 创建；已有 Unix 文件必须归当前用户且无组/其他用户权限，符号链接及未知数据库拒绝使用。Windows 文件 ACL 尚未实现同等验证，本机交付以 macOS 为准。

`get` 对不存在的库返回 `{"policy":null}`，不建库。`replace` 要求精确的期望版本：首次为 0，后续先 get；每次成功 replace/pause 都增加版本，保留历史。并发修改由 SQLite 事务串行；旧版本失败后应重新读取、核对变化，不能盲目重试覆盖。pause 即使工作目录已被移走也可以保存，并明确返回 `runningTasksStopped:false`。

## 策略和输入

以下均为合成示例，不能直接用于真实项目启用。保存 enabled=true 仅设置此控制库中的策略字段，当前不会开启任何调度器。

```json
{
  "schemaVersion": 1,
  "projectId": "demo",
  "hostId": "local",
  "workspacePath": "/absolute/test-project",
  "enabled": false,
  "taskCategories": ["docs"],
  "allowedTools": ["read_file"],
  "maxCallsPerRun": 2,
  "maxConcurrent": 1,
  "maxDispatchesPerDay": 5,
  "expiresAt": "2099-01-01T00:00:00.000Z"
}
```

对应请求：

```json
{
  "projectId": "demo",
  "hostId": "local",
  "workspacePath": "/absolute/test-project",
  "taskCategory": "docs",
  "tools": ["read_file"],
  "maxCalls": 1
}
```

未知字段和错误类型被拒绝。只支持 local host；工作目录必须存在并与保存的规范化目录完全相同，不采用字符串前缀、不自动扩大到子目录或另一个 worktree。工具名为策略中的精确标识符，适配器映射待 #23 验证，示例中的 read_file 不承诺是当前 Codex 的实际工具名。

范围内任务类别或工具请求可变化，策略版本无需随每张卡/每条评论更新。策略版本与未来任务语义版本、判定版本、派发 attempt 分开。原始 Markdown 和模型文本不得直接转为策略配置。

## 必须保留的执行限制

- 本模块没有预算余额、并发占用或派发租约。maxCallsPerRun 只检查请求的声明值；其余限额作为后续协调器的约束返回。它们目前均不限制实际模型调用，不构成硬金额上限。
- 预检输出不是能力凭据。#18 派发前须重新读策略、任务和暂停状态，在控制事务中预留调用/并发配额并固定版本，记录外发意图；未知结果不得盲目重派。
- 执行适配器须实际限制文件、工具和网络权限。允许一个 shell 工具本身不能限制该工具写哪里。现有 full-access 会话不能靠 prompt 降权；判定器需要 #23 的负向权限探针。
- 本机同一用户的 full-access 进程仍能修改控制库或调用操作员 CLI。0600 和独立库能减少误用，无法隔离同用户恶意执行者；不得宣称卡片内容绝不可能通过其他执行通道扩权。
- 暂停未来派发与停止已运行任务必须分别记录和显示。当前 CLI 仅改策略 enabled，不发停止信号，也不变更旧 scheduled。后续迁移需 #25A 的准确归属、备份与停用读回。
- 文件路径检查不提供 OS 沙箱或对任意非协作写者的竞态隔离。目录内容/符号链接变化需执行适配器再次核验。

## 备份与恢复

控制库与任务数据库独立。没有写入者时可复制备份；并发使用时通过 SQLite backup API 保存一致快照。恢复前停止未来协调器的策略写入，另存当前库，核对备份来源及最后版本。不得把回退版本当作继续执行许可；恢复后先暂停并处理在途记录。当前没有运行协调器，无需停止 Codex。

删除 CLI 源码不会删除控制库；停用时将项目策略 pause，保留库、历史及备份。正式程序、旧 scheduled、任务数据不会随本阶段回退而改变。
