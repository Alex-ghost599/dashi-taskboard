# 本地候选扫描（源码工具）

此工具对应 #17 的独立候选扫描阶段。它读取原生 Taskboard SQLite 快照，把候选 ID/语义摘要或阻止原因写入独立控制库。没有模型客户端、对话创建、任务修改或自动记忆写入入口；候选报告不授权执行。后续模型派发仍需 #16/#20/#24/#25A 的联合验收。

## 显式运行

使用支持 `node:sqlite` 的项目 Node 运行时。在已提交的源码目录运行以下命令；示例中的路径和项目 ID 需由操作者替换。控制库父目录应由当前用户独占，不放在源码或同步目录中。任务数据库与控制库必须分开，工具不会迁移任务数据库。

```sh
node scripts/local-candidate-scan.mjs configure --state /absolute/private/scan.sqlite --project PROJECT_ID --if-revision 0 --armed true --interval-ms 10000 --judge-policy-rev 1
node scripts/local-candidate-scan.mjs run --state /absolute/private/scan.sqlite --database /absolute/data/taskboard.sqlite
node scripts/local-candidate-scan.mjs status --state /absolute/private/scan.sqlite
```

`configure` 使用 revision 比较后更新，首次为 0，之后采用 status 返回的 revision。修改暂停设置同样提供全部字段，并使用 `--armed false`。间隔允许 1000–60000 毫秒，默认建议显式设置 10000；10 秒是读取目标，不保证模型或业务完成时间。

`status` 会打开、初始化或升级控制库，不能作为严格只读查询。报告的 `scannedAt` 表示一次成功落库的扫描时间，`status:error` 表示当前快照读取失败，旧错误正文不会写入报告。`scan-started` 只表示循环启动，不证明获得协调器租约或读取成功。用户暂停会清除旧报告。

## 运行语义与停止

空 Todo 或全部 hold 持续保持 armed。原生任务必须明确分配给 `codex-agent`，创建者身份不参与该判断。评论进入语义摘要；内部扫描结果只写控制库，不写任务评论。未完成依赖、未知项目和已有未决 Judge 判断记录阻止候选；Executor 在途绑定门禁仍待后续集成。

协调器每秒检查本地配置，按项目间隔读取任务；同一进程不重叠扫描，共享控制库的进程通过 60 秒租约保护结果写入。休眠恢复从当前状态继续，不补跑历史 tick。崩溃后的接管最多等待旧租约到期。系统时间倒退会拒绝状态写入并报告错误，不能靠自动清库恢复。

前台进程用 Ctrl-C 停止；macOS/Linux 也可对确认为本工具的 PID 发送 SIGTERM。停止释放自己的租约，保留 armed，下一次手动启动继续。Windows 的进程终止可能无法运行信号清理，应按崩溃接管处理。没有开机自启，没有后台安装，没有修改既有 Codex 或旧 scheduled。

## 数据、备份与恢复

任务数据库以 SQLite read-only 和 query_only 打开；快照在事务内读取，不更新任务版本。读取规模有上限，超限返回错误，不能默默只扫部分任务。数据库文件被替换后需停止并重新打开读取器，避免继续读已脱离正式路径的旧连接。

控制库包含候选 ID、摘要、原因、配置及旧 Judge 尝试记录，不包含完整任务描述。schema 2 在 schema 1 基础上增加扫描表；旧 schema-1-only 二进制拒绝打开升级后的控制库。升级前如已有控制库，先停止持有该库的自建进程并复制整个 SQLite 文件作为备份。当前使用 rollback journal，运行中不要裸拷贝文件。恢复只在停止所有持有者后替换控制库；优先先在隔离路径验证。不得恢复一个旧副本后据此重放真实执行，未知结果仍需人工对账。

卸载只需停止本工具进程并移除操作者自行添加的启动命令；保留控制库及备份。项目没有自动删除数据命令。

## 验收范围

已覆盖空队列、全部 hold、暂停竞争、租约跨进程竞争、旧 owner 写入拒绝、schema 增量保留、任务数据库内容不变、错误内容脱敏、停止/重启竞争及独立 CLI 十秒计时。性能测试打印实测耗时、CPU 和 RSS；这些数字受机器及合成任务大小影响，不代表所有数据库都能在十秒内读完。

此文档描述源码工具；正式 App、可视化设置入口、模型判断/执行联动和部署验收仍由后续 Issue 推进。
