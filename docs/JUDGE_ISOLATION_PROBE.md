# 判断器隔离负向探针（#23B）

## 已交付范围

`node scripts/judge-isolation-probe.mjs --codex /absolute/trusted/codex` 运行真实 Codex CLI 与本机合成 Responses 服务。当前只接受已经核验的 CLI 0.153.3；版本或完整工具 schema 变化时失败，需重新审核，不能自动放宽白名单。

此入口没有登录或外部 provider 参数，不调用账户模型，不派发业务任务。每次创建新的临时 HOME、CODEX_HOME、XDG 目录和工作目录，以白名单环境启动子进程；不继承 API key、Taskboard 令牌或用户 Codex 配置。共享 app-server 客户端新增可选 cwd，其他调用保持原默认行为。配置只指向探针自身的 127.0.0.1 动态端口，拒绝带 Authorization 的模型请求。结束关闭自己的子进程、监听和临时目录，不接触正式 App 或任务库。

## 验证路径与结果

入口 → 创建隔离配置/本机合成端点 → app-server thread/start 回读 Spark/low、readOnly、networkAccess=false、无指令来源 → turn/start → 捕获实际模型请求工具 schema → 合成服务逐次返回越权 function_call → CLI 回传 function_call_output → 核验5个执行调用、7个读取/提问调用的回执 → 完成并清理。

2026-09-14 当前 Mac 的 CLI 0.153.3 实测：

- 13 次本机合成请求，0 次真实模型调用。
- `exec_command`、`shell`、`apply_patch`、`spawn_agent`、`mcp__unconfigured__write_file` 均回传 `unsupported call: <name>`。这些是未提供工具的拒绝证据，不能推断工具已启用时仍有相同限制。
- 合成写入 canary 未产生，作为辅助证据。仅文件未出现或turn完成不足以通过；每个调用都必须有对应拒绝回执。
- 模型/effort、沙箱回执不符、工具 schema 增加或变化、回执缺失或成功都会失败。
- shell/apps/plugins/hooks/browser/computer/multi-agent等配置关闭后，仍观察到 `request_user_input`、`skills.list`、`skills.read`。尝试的通用 tools.*.enabled 配置没有移除它们，未把这些无效设置保留为安全措施。

新增两个authority的空Skill清单检查；4种绝对路径/目录穿越/file URL/符号链接package读取均返回 `skill package is not available`；Default模式提问返回明确不可用。临时外部合成SKILL.md及符号链接由测试进程先成功读取，证明目标可读；其随机内容标记若出现在provider请求中，探针失败。上述路径不是已注册package，不能据此宣称已注册Skill的通用路径沙箱已验证。

这些内置工具的完整 schema 已固定摘要，并保存不含账户或任务数据的测试夹具。摘要只检测漂移，不证明 Skill 读取安全。报告始终 `authorizesDispatch:false`，`emptySkillInventoryVerified:true`、`unavailablePackageRejectionsVerified:true`、`defaultModeInputRejected:true`；本合成探针不验证已注册Skill的通用隔离、账户生成或生产模型，相关字段仍为false。

## 尚未覆盖，不能据此启用生产判断器

1. 当前证据仅覆盖空清单下4种未注册package读取和Default提问拒绝。非空Skill清单会直接失败，不能把已注册package、Plan模式、不同版本或账户provider推定为相同结果。生产设计应保持零Skill库存；若未来允许Skill，需单独审核其读取能力。
2. 合成provider工具目录不能代替账户侧完整工具隔离。下述最小账户生成已完成，仍需生产适配器实际权限、绑定和派发门槛，禁止直接转入历史todo。
3. 没有证明模型服务以外的全部进程流量被操作系统封锁；本探针不提供通用外联防火墙或不可信 CLI 沙箱。可执行文件必须由操作者信任。机器级管理配置/系统集成仍可能影响行为。
4. 当前没有生产判断器适配器、可靠执行绑定、额度预留或旧 scheduled 迁移。#23 保持开放，后续与 #18/#24/#25 联合验收。

## 维护与测试

`node --test test/judge-isolation.test.mjs test/judge-isolation-probe.test.mjs test/judge-read-boundaries.test.mjs` 覆盖严格工具/回执验证、假CLI协议负向场景、环境/目录隔离、临时清理、超时、错误CLI版本、Authorization拒绝、非空Skill库存/读取内容泄漏/提问成功拒绝及共享客户端默认cwd兼容。假CLI测试覆盖验证器，实际CLI命令覆盖本机运行，证据层级分开记录。

失败输出只给 `probe_failed`，不打印原始provider内容或配置。没有自动重试、模型替换、权限升级和后台驻留。探针源码工具无需打包安装；停止使用不影响正式数据。

官方接口依据：[app-server](https://learn.chatgpt.com/docs/app-server)、[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。工具白名单来自上述版本的实测请求；不宣称所有版本都受相同配置控制。

## 独立的最小账户生成验收

2026-09-14 使用同版本CLI和隔离目录，复用禁工具配置，仅将provider改为官方内置openai。通过官方外部access-token模式接入现有账户，不传refresh token、不改原登录文件；仅内存核对账户身份。分别启动一次ephemeral Spark low和Astra low，以合成输入请求固定JSON，均completed且返回值符合要求。

- Spark：input 1748、output 64、total 1812 tokens，其中reasoning 45包含在output内。
- Astra：input 3590、output 17、total 3607 tokens。总计5419，以CLI用量通知为证据。
- 实际配置回读模型/low/readOnly/无网络命令权限及隔离cwd；未观察到工具活动。每次60秒限时，工具开始事件触发关闭自有client；关闭无法撤销瞬时已发生动作，因此不能当权限沙箱。
- 原认证文件前后哈希相同，临时目录与子进程已清理；无正式任务/配置/App变更。私有harness、turn ID及原始回执留在本机台账，不作为通用凭据管理实现提交。

此结果只证明指定账户下最小生成可用。与合成工具负向测试分开记录；未完成生产Judge、账户全工具库存、执行绑定或可靠派发。
