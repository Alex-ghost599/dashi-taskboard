# 个人服务与注入器的待处理记录

个人安装采用 external-service，服务与注入器独立，没有 startTaskboard 创建的父子 IPC。执行接线使用同一私有控制库交换待处理记录；本次仅实现存储接口，未注册 worker、连接 CDP、发送模型请求或启用业务执行。

## 领取流程

1. 可信协调器 reserve 后，以 enqueue 保存完整入参、绑定、task version；沿用预留的30秒有效期，重复入队不能续期。入队不生成执行 attempt。
2. 每个可信 worker 进程使用独立随机 owner ID，以 acquireWorker 获得全库唯一30秒租约及递增 epoch。renewWorker 只延长仍有效的相同 owner/epoch；过期后重新获取会生成新 epoch。
3. pendingIntents 最多返回100条待处理记录，仅供发现。读取后可能过期；调用方必须重新取得可信任务快照、身份及权限信息。
4. claimQueued 在同一写事务检查 owner/epoch/租约、全部入参与 task version、最新策略及预留，原子创建 possibly_submitted attempt 并更新队列。只有这次提交返回新 request ID；再次领取、读取或换 worker 都不产生新的发送机会。
5. queued 状态下崩溃可在预留有效期内重新校验领取；possibly_submitted 后崩溃继续占用执行名额，不能按租约超时重派。迟到可信回执继续使用 recordReceipt。

公开 prepare 保留未入队预留的基础兼容路径，不受 worker 租约约束；已入队的 token 拒绝直接 prepare。正式个人 worker 必须只接 claimQueued，不能从 prepare 绕过队列。所有结果仍标记 authorizesDispatch:false，完整字段和调用方提交的新快照不能证明桌面身份、任务确实新鲜或执行授权。

## 尚未接通的部分

当前没有正式协调器/worker 启动逻辑。控制库路径必须来自可信启动配置，并使用当前用户私有目录及同一文件；网页、任务描述和模型输出不能指定路径。当前文件检查不代替启动层的目录权限及单库验收。跨控制库没有全局单执行者保证。

SQLite 租约不能取消已离开事务的旧进程，也不能消除暂停到实际发送之间的竞态。真正发送前仍需验证接收端原子 busy 拒绝/排队、最终权限与 fencing、稳定 request ID 和可信晚回执路径；本次未解决这些问题。事务结果未知时不得凭数据库状态重新发送。不同顺序的入参 JSON 可能保守拒绝，不扩大授权。

## 验证与升级

ExecutionAttemptStore 将 schema3 增量升级为4，新增 execution_queue/execution_worker；旧在途 attempt、策略与回执保留。升级前停止自建控制库持有者并备份；旧代码不能打开版本4，回滚程序不能通过恢复旧快照来清除在途记录。尚无正式数据库升级或安装操作。

隔离测试覆盖重复入队、任务/绑定变化、暂停/有效期、旧epoch、续租、同owner新epoch、事务失败回滚、schema3在途升级、四进程争抢，以及 queued/possibly_submitted 两个位置 SIGKILL 后恢复。测试只生成临时库与自建子进程，不验证真实模型或桌面接收端。历史控制记录的归档策略和正式恢复流程须在接线前补齐。
