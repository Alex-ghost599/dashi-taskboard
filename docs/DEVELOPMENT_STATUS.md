# 开发与部署状态

2026-09-07，首次 Mac 个人源码安装验收已执行；最终 PR/发布晋级及重建结果以安装 provenance 与本地验收清单读回为准。

## 源码与工作项
- fork：Alex-ghost599/dashi-taskboard；初始 main 677b54451db707ae6132486b6593b7be11e4ee09。
- 稳定产品基线：v1.1.21 / 1a807be8d4114b82f3cecc61cddaebdba6df9c60。同期最新 Beta/main：v1.1.22-beta.6 / bd264e7ff3402785f1e8b0bb789106358352707b，没有纳入该 Beta。
- 基础 Issue #1、PR #2，squash a99cf4cc64649e2aae376ae06a65ce43f9540f05；foundation_review 独立审核 Pass。
- 安装 Issue #3、PR #4、chore--personal-desktop；最终合并状态从 fork PR 读取。PR base 仅 develop，main 只在验收后 fast-forward，保留所有任务分支。

## 实际验收
| 检查 | 结果/范围 |
|---|---|
| npm ci | 成功，395 packages，audit 0 vulnerabilities |
| 构建前基线 | typecheck、build:web 通过；Node 372 pass/1 skipped/0 fail，组件 9 pass |
| 变更后后端 | server.test.mjs 30/30 pass |
| 原生构建 | 现有 Rust 1.95、arm64 Tauri 构建成功，bundled Node 22.23.2；ad-hoc 签名和安装后验证通过 |
| 独立 UI | 真实创建项目“安装验收测试-20260907”、卡片 202-1，添加评论，todo→in_review，刷新后保留 |
| Finder/App | 从 Finder 打开安装版，真实显示同一卡片、评论、状态；退出重启后 CLI 数据一致 |
| 监听/清理 | 仅 127.0.0.1:47823；修正退出无界等待后自有 App/Node 均消失，无残留监听；原 Codex PID 82362 保持 |
| 数据恢复 | 隔离 47824 服务读取恢复副本，CLI 与正式卡片一致，SQLite integrity_check=ok，评论保留；隔离服务已停止 |
| 自动认领 | 浏览器和重启桌面均 Paused/off，控件不可用，无模型调用/真实任务执行 |
| 更新策略 | 个人入口不注册 updater，无上游替换路径；策略编译固定，重启后仍个人入口 |
| Codex | Codex In-app Browser 实际显示同一服务/卡片；无 CDP/sidebar 注入和会话定位验收 |
| 共享写入 | 无共享 Skill、PATH、shell、官方 App/数据库或开机自启修改；仅仓库启动动作改为个人 App |

证据位于 checkout `.local-evidence/`：baseline-*.log、personal-server-test.log、native-*.png/ax.txt、native-restart-cli.json、shutdown-validation.json、restore-validation.json、install-*.json、codex-browser.png。精确构建源码和时间在安装 App `Contents/Resources/build-provenance.json`；安装收据在用户 Application Support 备份目录。

## 审核与已处理问题
- foundation_review 独立 reviewer：基础 c2f2f37 Pass。
- 部署首轮发现 personal 默认 feature 对 Windows 不适用；已限定 Mac，并改为 personal-build.sh 显式启用，保留原平台 CI，添加 personal cargo check。e4270aa 增量静态审核 Pass，无 Critical/Important。
- 现场网络：Git OAuth 缺 workflow scope，复用已合法认证同账号的现有 SSH；没有增加 scope。Cargo HTTP/2 错误使用本次 HTTP/1 配置解决。
- 初次未签名和 Documents 的 FinderInfo 使签名失败，改为缓存区无元数据副本 ad-hoc 签名。一次构建中编辑运行脚本导致失败，随后使用固定提交完整重跑成功，失败产物不用于最终发布。
- 首次 Cmd+Q 后监听停止但 Node 残留，具体异步阻塞点未定位；owned Child 增加 5 秒退出期限后真实退出/重启通过。

## 保留限制
没有上游云部署、远端发布或 updater 链验收；GitHub 基础 PR 未产生 Check runs，不能声称 CI 通过。最终远端 Check 状态另行记录，Mac 本地构建/UI 是本次主要验收。上游未用 launcher 代码产生 dead-code warnings；网页大 chunk 提示仍保留。不把新会话/侧边栏注入、Windows/Linux 运行、签名公证或付费模型认领视为已完成。启动握手无超时、App 被强杀的孤儿恢复仍依赖文档人工诊断，后续出现实际问题再处理。

最终独立 foundation_review（00e39c8 文档 / e4270aa 安装）：Pass，无 Critical/Important；实时检查签名、provenance、唯一 loopback、自有进程与原 Codex 保留，并查看真实截图。合并后仍必须重建最终 commit，不能以该 review 提前证明来源一致。完整 AX 补充为 codex-browser-full.ax.txt/native-current-full.ax.txt；增量 AX 需配截图，不单独作为完整UI证据。

## CDP 信任边界修复（2026-09-07，Issue #5）
- 用户保留项目概览自动 AI 总结：调用其配置的 Codex 模型是所需行为，自动认领仍关闭；保留正常 Markdown 外链图片/头像加载，接受其访问记录特性。安全审计不是“绝无后门”证明（47/244 核心文件完整覆盖）。
- `fix--cdp-target-trust` 移除标题 Codex 的目标回退，只接受 `app://-` 主页面；排除辅助窗口。新文档脚本、隔离桥接和后续 RPC 在写入凭证/参数前用原生 Location 再次验证页面；导航/上下文销毁撤销旧权限，失信主页面恢复 CSP 并断连。通知通道也验证同窗口/同源，复用已有随机凭证及 HMAC，不新增账号或认证服务。
- 修复前 injector 测试 12/12；修复后目标/桥接/CDP pipe/supervisor 定向测试 24/24。覆盖外部同标题页面、子 frame、实际执行来源与发现结果不一致、安装期间导航、旧上下文撤销及可信页面恢复。真实 Codex UI 与日常实例注入仍未验收，不能以模拟 CDP/VM 测试替代。
- 当前正式 App 仍为 `94e30bc64b13eb89e0f339d427e2b967aed6e0d9`，本轮不替换安装版，不晋级 main；修复需独立 review 与 fork PR CI 后合入 develop。现有未跟踪 `* 2.*` 副本未改动；原目录全量测试因迁移工具读取未知副本重复添加列而 27 fail；只含跟踪源码与本轮文件的临时快照复验 379 pass / 1 skipped / 0 fail（随后新增两个清理测试，包含在定向 24/24 中）。副本未删除，不作为上游失败或本轮代码回归。

- 独立 reviewer `cdp_trust_review` 初审发现页面全局 URL 可伪造、在途 RPC 导航泄露两项 Important，均修复并增量复审通过（源码/模拟层）；实际 Electron 消息来源兼容性和 UI 仍需隔离验收。

## 个人服务 CDP 接入（Issue #7，开发中）
个人入口准备启用持久 token/HMAC 私有文件，CLI 与 CDP 共用同一 App 服务；原 `GET /` 只允许 loopback 导航并跳转到令牌路径。`personal-cdp.mjs` 仅附着已开启的官方 Codex 调试端口，拒绝非 loopback/错误进程及重复实例；外接模式不启动服务或 Codex、不写通用 runtime，退出及失败注入撤销本次脚本/DOM/CSP。

定向测试 55/55（凭据重用/权限/链接拒绝、根入口负向测试、注入失败撤销、已有信任边界/服务测试）。独立 review 初审的版本不匹配、失败注入残留已修复，候选构建和真实UI待执行。正式版本仍94e30bc；后续安装回执与验收记录才代表真实切换。远端host IPC不因外接模式自动成立，不在本轮已验证能力之内；本轮目标是本地同库看板与会话定位。

### CDP 隔离真实 UI 验收（2026-09-07，Issue #7）
个人入口已复用安装 App 的同一服务与数据库。真实 Electron 测试发现原生 preload 的 `mcp-response` / `fetch-response` 是 `source=null, origin=""` 的合成事件；此前把它们按网页 postMessage 筛选会导致账号读取超时。修复仅对原生回复/通知采用该通道，RPC 添加随机请求 ID；页面间请求仍要求同窗口、同源和 capability，目标/导航守卫保留。

隔离 Codex 实际显示侧边栏、嵌入卡片 202-1；通过嵌入 UI 添加明确测试评论，状态 In review → Done，安装版 CLI 读回同评论和状态。停止自己的 watcher 后入口、iframe、capability 清除，刷新后不恢复；日常 Codex、隔离 Codex、正式看板服务均仍存活。重复启动 watcher 被拒绝。证据保存在本机 `.local-evidence/cdp-isolated/`，截图 `card-ui-pass.png`。这不代表日常实例已部署；最终包复验、日常重启/注入、已有会话定位与最终发布仍待 CLI 接力。
