# 开发与部署状态

2026-09-07：治理阶段，桌面/浏览器/CLI/Codex 均未验收。

- 账号与 fork 已核实，Issues 启用，基础 Issue #1。
- 当前工作：chore--personal-foundation，稳定源码 v1.1.21；初始 fork main 仍保留。
- 已发现上游风险：server 默认 0.0.0.0；原生 launcher 存在 Codex 重启路径、共享 Skill 整理和上游 updater。需部署分支隔离，不能原样启动。
- 基线环境：默认 Rust 1.84 过旧，现有 1.95 可复用；Git HTTPS TLS 曾短暂失败，HTTP/1.1 push 已成功。
- 尚未执行 npm/源码测试/打包；无上游测试失败结论。
- 基础审核待完成；最终部署证据与 reviewer 待完成。Critical/Important 未解决不得发布。
