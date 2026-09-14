# 自动化模型与适配器能力（#23）

## 已实现：#23A 模型选择与只读报告

运行 `node scripts/automation-capabilities.mjs --help`。两个入口互斥：

```sh
node scripts/automation-capabilities.mjs --codex /absolute/trusted/codex --executor-effort light
node scripts/automation-capabilities.mjs --catalog saved-catalog.json --executor-effort medium
```

live 入口只调用 `codex debug models`，使用独立子进程、有时间/输出上限，不调用 thread/start、turn/start、scheduled 或业务 API。CLI 可能刷新或使用现有模型缓存，报告明确标识，不能据此断言本次远端请求或模型生成成功。离线入口读取同格式模型目录，不能代替账户能力证据。

模型选择固定为 Judge `gpt-5.3-codex-spark` 和 Executor `gpt-6-astra`。Judge请求low；不支持low时等待，不擅自使用目录默认high。Executor常规low/medium/high，light规范化为low。只有目录明确包含对应模型和effort才输出选择成功；模型缺失、隐藏、重复、枚举不支持时waiting，不换模型、不静默提高思考等级。

高于high的请求须由独立受信调用方提供精确匹配的 `trustedExecutorEffort`，CLI对应 `--trusted-executor-effort`。**这个参数本身不认证用户身份。** 后续只能从可信用户设置/受管策略取得，不能从卡片正文、导入字段或模型建议透传，也不能把CLI能运行当成获得业务权限。可信单卡覆盖仍需后续状态契约。

输出始终包含 `authorizesDispatch:false` 和 `readiness:waiting_for_adapter_validation`，并保留模型生成、Judge工具、绑定回执和账户额度的未验证标识。模型选择函数不收发任务、不改权限，不作为派发许可。

## 本机调查结论与证据范围

2026-09-14 对实际 CLI 0.153.3 与账户接口核验：

- 模型目录列出Spark和Astra；Astra枚举low/medium/high/xhigh/max/ultra，Spark为low/medium/high/xhigh。目录不是生成可用性保证。
- 账户接口返回命名为GPT-5.3-Codex-Spark的独立额度桶，与普通Codex桶分开。此为本次账户快照，不硬编码桶ID或承诺未来额度政策。
- 独立无凭据app-server进程经现有 `CodexAppServer` 客户端执行 `command/exec`：readOnly、networkAccess=false下合成文件可读、写入被拒绝；正常进程能连接的本机测试监听器在该沙箱命令中连接失败。没有启动模型turn，未复制登录凭据。
- 单独CLI `:read-only` 命令沙箱也完成对应负向检查。旧式sandbox参数探测因CLI要求permission-profile而失败，已按实际help与文档改为内置profile；该参数错误不算沙箱拦截证据。
- 上述结果覆盖命令执行沙箱，不覆盖模型所有工具通道。MCP/应用工具、权限提升、子Agent和自行派发的禁止仍待真正Judge适配器验证。不能把approval=never或只读提示词作为隔离证明。
- 当前桌面任务工具暴露的创建接口没有sandbox/权限配置参数；不能据此为已有full-access任务降权。底层app-server协议可作为候选，需要独立、明确的适配器，不能用协议文档代替桌面链实测。
- 现有远端自动化执行路径请求danger-full-access，且Judge使用同一个请求model；本阶段未更改或复用该路径，不宣称已经完成两模型分离。

详细本机路径、原始回执与账户窗口数值保留在私有台账，不能提交凭据或任务内容。

## #23B 后续验收门槛

1. 选定受限Judge适配器：隔离配置、关闭非必要工具/外部连接，提供有效权限和实际工具清单。先以合成输入验证禁止业务写入和自行派发；拒绝请求必须有回执，不能只观察“模型恰好没调用工具”。
2. 在专用无业务目录运行Spark结构化判断与Astra最小回应，记录实际返回model、effort、turn ID、完成状态及消耗。测试前固定输入、调用上限、可写位置和停止方式；不对历史todo试运行。此阶段尚未执行，没有模型生成验收结果。
3. 对目录/账号/权限证据定义时效与失效行为；模型不可用、工具限制无法落实、结果未知均等待，不fallback到full-access。
4. 与#18/#24/#25联合验证绑定目标、提交回执、预算预留、暂停竞态和旧scheduled停用；#23整项在这些指定能力缺口解决前保持开放。

## 官方依据

- [Codex模型与Light/Low说明](https://learn.chatgpt.com/docs/models)：采用最低能达到所需效果的effort，不能预先保证所有任务low足够。
- [App-server协议](https://learn.chatgpt.com/docs/app-server)：模型目录、thread/turn、命令执行与账户限额接口分别存在；启动turn与读目录是不同操作。
- [权限配置](https://learn.chatgpt.com/docs/permissions)及[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)：内置:read-only配置及命令网络限制；命令网络规则不覆盖web search、apps或MCP。
