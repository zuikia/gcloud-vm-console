# 贡献指南

[English](CONTRIBUTING.md) · 简体中文

感谢贡献。请先阅读 [安全政策](SECURITY.zh-CN.md)。

- 使用 Node.js 20 或更高版本，并运行 `npm --prefix ui ci`。
- 提交前运行 `npm --prefix ui run check`；如果改动界面，再运行布局和性能审计。
- 测试使用 mock gcloud runner、保留 IP 和假账号，不连接真实云资源。
- 新增云端写操作时，保持预览、指纹、确认、任务锁和失败关闭策略。
- 不要提交凭据、私钥、真实项目 ID、IP、节点链接、日志、截图或 `.gcp-vm-console/`。
- 用户可见行为和文档同步更新中英文版本。

Issue 和 pull request 请说明改动范围、验证命令，以及是否影响只读/写操作边界。安全问题不要公开提交，请按 [安全政策](SECURITY.zh-CN.md) 报告。
