# 开发与部署状态

2026-09-07：治理阶段，桌面/浏览器/CLI/Codex 均未验收。

- 账号与 fork 已核实，Issues 启用，基础 Issue #1。
- 当前工作：chore--personal-foundation，稳定源码 v1.1.21；初始 fork main 仍保留。
- 已发现上游风险：server 默认 0.0.0.0；原生 launcher 存在 Codex 重启路径、共享 Skill 整理和上游 updater。需部署分支隔离，不能原样启动。
- 基线环境：默认 Rust 1.84 过旧，现有 1.95 可复用；Git HTTPS TLS 曾短暂失败，HTTP/1.1 push 已成功。
- 尚未执行 npm/源码测试/打包；无上游测试失败结论。
- 基础审核待完成；最终部署证据与 reviewer 待完成。Critical/Important 未解决不得发布。

## 部署分支进展
基础 PR #2 已 squash 合入 develop（a99cf4cc64649e2aae376ae06a65ce43f9540f05），独立 foundation_review Pass；GitHub 未生成 Check runs，不能视作 CI 通过。Issue #1 因 base 非 default main 暂仍开放。
新增 personal Tauri 入口：只启动自有 loopback 服务及 WebView，不执行上游 main 的 updater/Skill/Codex/autostart；默认 feature personal。安装前需真实构建与复核。

基线验证：typecheck/build:web 通过，Node 372 pass/1 skipped/0 fail，组件 9 pass；个人 server 30 pass。独立网页通过 202-1 卡片、评论、todo→in_review、刷新与 CLI 一致。自动认领 Paused/disabled。原生 arm64 构建成功，初次 --no-sign 验证发现 bundle 签名不完整，改为本地 ad-hoc 签名后再验收，不申请 Developer ID。Reviewer 的 Windows cfg Important 已修正为 Mac 专用。
