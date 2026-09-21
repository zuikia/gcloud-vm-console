# Documentation language sync

## English

Public-facing maintainer and user documentation is published in synchronized
English and Simplified Chinese pairs:

| English | 简体中文 |
| --- | --- |
| `README.md` | `README.zh-CN.md` |
| `SECURITY.md` | `SECURITY.zh-CN.md` |
| `CONTRIBUTING.md` | `CONTRIBUTING.zh-CN.md` |
| `THIRD_PARTY_NOTICES.md` | `THIRD_PARTY_NOTICES.zh-CN.md` |
| `RELEASE_CHECKLIST.md` | `RELEASE_CHECKLIST.zh-CN.md` |
| `PRODUCT.md` | `PRODUCT.zh-CN.md` |
| `DESIGN.md` | `DESIGN.zh-CN.md` |

The README preview images are language-paired mock renders from the same
responsive fixture. Keep the four assets in `docs/demo/` synchronized:
`workbench-en-US-1440.png`, `workbench-en-US-390.png`,
`workbench-zh-CN-1440.png`, and `workbench-zh-CN-390.png`. Update both README
files when the public shell or its language switch changes.

When changing user-visible behavior, safety boundaries, commands, paths, or
release claims, update both files in the same change. Keep shell commands,
URLs, API routes, package names, ports, enum values, status literals, and
filesystem modes verbatim. Stable UI labels such as `总览`, `实例`, `部署`,
`任务`, `更多属性`, and `管理端口与 SSH` have synchronized English
presentations; their underlying enum, API, and command literals remain stable.

`LICENSE` remains the exact legal license text and is intentionally not
duplicated as an unofficial translation. Engineering audit records under
`docs/` may retain English explanations and Chinese UI literals; they are not
user onboarding or legal policy documents.

The `public-documentation.test.mjs` test verifies the required pairs, language
links, preview assets, and high-risk literals. Run it through `npm --prefix ui run check`.

## 简体中文

面向用户和维护者的公开文档以英文与简体中文镜像形式同步发布，配对关系见上表。

当用户可见行为、安全边界、命令、路径或发布声明发生变化时，必须在同一次改动中更新两种语言。Shell 命令、URL、API 路由、包名、端口、枚举值、状态字面量和文件权限模式保持原样；`总览`、`实例`、`部署`、`任务`、`更多属性`、`管理端口与 SSH` 等稳定 UI 标签提供同步的英文呈现，其底层枚举、API 和命令字面量保持稳定。

`LICENSE` 保留准确的法律许可证正文，不复制未经授权的非正式翻译。`docs/` 下的工程审计记录可以保留英文解释和中文 UI 字面量；它们不是用户入门文档或法律政策文档。

`public-documentation.test.mjs` 会检查配对文件、互链、预览图片和高风险字面量。请通过 `npm --prefix ui run check` 运行。
