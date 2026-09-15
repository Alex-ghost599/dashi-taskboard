# 持久执行记录

`ExecutionAttemptStore` 在同一策略控制库中保存准入与执行尝试，属于 #18A 的基础实现。模块不发送请求、不调用模型；返回值始终为 `authorizesDispatch:false`。正式适配器仍须验证最新任务、实际目标身份、权限和接收端忙碌语义。

## 调用与状态

1. 先通过既有 `reserve` 获得准入预留。
2. `prepare` 接受该预留、原请求、完整本机绑定和任务版本。在一个 SQLite 写事务内重验策略版本、请求和预算，保存稳定随机 request ID、绑定快照及任务版本，将准入变为 started、attempt 变为 possibly_submitted。事务提交后才能进入未来的外部发送路径。
3. 同一控制库首次最多一个 started/unknown 执行者，跨项目和线程生效。reserved 尚未发送；其过期不会释放其他 started/unknown。任务在途唯一性沿用准入表。不同控制文件之间无全局互斥，因此运行服务必须唯一指定控制库，不能为每个项目创建独立执行库。
4. `markUnknown` 同时标记准入及 attempt。进程崩溃后保留 possibly_submitted 也必须按未知处理，不能调用 prepare 重发；打开数据库不会自动派发或清除记录。
5. 可信传输适配器通过 `recordReceipt` 登记 accepted/completed，精确匹配 request、host、thread 和已知 turn。accepted 仅证明接收，不能释放名额；UNKNOWN 收到迟到 accepted 仍保留 UNKNOWN。可信 completed 释放并发并保留已完成语义去重和每日次数。暂停后仍保存迟到回执，返回值不授权下一步。相同 receipt ID/内容幂等，冲突拒绝。

当前绑定仅支持本机完整五字段。Codex project ID 与 Taskboard project ID 属于不同空间；此处只保存前者，不猜测两者对应关系。字段完整、host/cwd 与请求一致均不能证明实际桌面对话身份；真实映射、任务版本新鲜度必须由后续可信读取路径核验。来源会话不能作为执行授权。远端自动派发暂不接入本模块。

## 存储与恢复

控制库从 schema 2 增量升级到 3；策略历史和旧准入不改写。旧 started/unknown 即使没有 attempt 仍占全局名额，不生成虚构 request ID。新版通用准入的直接 start/finish 在 schema 3 下拒绝，必须走 attempt 路径。旧 schema-2-only 程序会拒绝打开新版数据库。

沿用 `EXECUTION_ADMISSION.md` 的停机备份和隔离恢复流程，升级前备份完整控制库。恢复旧快照后不能直接派发，必须对账快照之后的外部执行。当前无人工解锁、丢弃记录、失败自动重试或历史清理接口。数据库对当前用户全权限代码可写，不是隔离恶意同用户代码的安全机制。回执函数属于服务内可信接口，禁止直接暴露为任务正文、模型输出或未认证 API 的写入入口。

## 验证与未接入部分

隔离回归覆盖持久重开、提交进程 SIGKILL 后请求 ID 保留与防重放、暂停、错误目标、迟到回执、去重、插入故障回滚、四进程跨项目争夺唯一执行名额及旧 schema 2 在途升级。基础准入测试同时保留。

尚未贯通 CodexHostAppServer/IPC/CDP 请求 ID 和回执。桥接超时后丢弃迟到响应的现有问题仍存在；本模块单独不能修复端到端丢回执。桌面忙碌时原子拒绝、重启后精确查询 thread/turn、权限实效及真实 UI 仍待验收。未修改正式数据库、安装版、自动领取设置或旧 scheduled。
