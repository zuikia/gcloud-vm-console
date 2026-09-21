# Design Register

[简体中文](DESIGN.zh-CN.md) · English

## Visual Direction

The console uses a restrained dark operations style: neutral dark background, compact panels, clear text hierarchy, cyan primary actions, green success, amber warning, and red danger. The interface should feel like a practical cloud console, not a marketing page.

IBM Plex Sans is bundled for Latin UI text. Chinese sans and serif rendering use the operating system's `PingFang/Hiragino/Microsoft YaHei` and `Songti/STSong/SimSun` stacks, avoiding multi-megabyte bundled CJK fonts. The main canvas is a stable solid surface rather than a fixed radial paint effect.

## Information Architecture

The sidebar has four routes:

- 总览
- 实例
- 部署
- 任务

Account and project selection lives inside the overview. There is no separate identity page and no global instance selector.

The default theme is dark. Semantic light-theme tokens are maintained in parallel so a later theme switch does not require component-level color rewrites.

## Layout Rules

- D2 density: 15-16px body text, compact headings, consistent field height.
- Wide screens should use the width through dashboard grids, table-first resource layouts, and compact execution summaries.
- 1024px and below gradually reduce columns.
- 390px is single column with no clipped buttons, vertical text, or horizontal overflow.
- Long project IDs, IPs, URLs, node links, and errors must wrap or scroll inside their own containers.
- One state commit may update each affected root region at most once. Search filtering updates only the inventory root and must not rerender Doctor, diagnostics, or task history.
- Avoid nested cards and repeated status blocks.
- Desktop instance inventory remains table-led; 900px and below changes to labeled grouped rows.
- Above 1080px, the selected-instance status summary is one four-column row and configuration/diagnosis/maintenance groups share one row.
- From 768px through 1080px, status is 2×2; configuration and diagnosis share the first row while maintenance spans the next row.
- Below 768px, status is one column and native action disclosures open only the recommended group. At 390px, visible controls and summaries are at least 44px high.
- Instance action buttons use a compact two-column grid above mobile widths; one visible action and the final action in a three-action group span the group width so uneven groups do not create excessive empty height.
- Technical details, node results, and danger operations use native disclosures. Long names, IDs, IPs, links, panel values, firewall rules, recovery evidence, and errors remain inside their owning containers.
- Technical details use one linear three-row overview: final deployment recognition, issue count plus highest-priority issue, and one non-clickable recovery recommendation. Expanded problem lists and recovery step lists are not part of the primary instance hierarchy.
- Machine, system, source, network, identity, manual deployment classification, and redacted recognition/verification evidence live in one secondary `更多属性` disclosure that closes when instance selection changes.
- On the deployment page, public IPv4 mode, Network Tier, and NIC type form one visible compact network-profile row. The conditional static-address name stays in the same section and may wrap below without creating a card. On the instance page these remain secondary attributes in `更多属性`; they must not become top-level status tiles or duplicate the public-IP summary.
- Subtle light is limited to selected and status states. There are no decorative orbs, heavy glass effects, or neon surfaces.

## Interaction Rules

- Row click selects an instance only.
- The detail panel exposes one recommendation based on selected state. Its action remains owned by exactly one of configuration, diagnosis, or maintenance; `查看节点结果` is the only local disclosure action allowed in the recommendation row.
- The header shows instance name, runtime state, public IP, and checked time. Deployment method is owned by the technical recognition summary.
- SSH, BBR, firewall, and service status each appear once as canonical status tiles. Folded evidence may show ports, rules, service names, and errors but may not create another status strip.
- SSH copy distinguishes desired port, verified actual port, and fallback. A retained TCP 22 IAP rescue path is supporting evidence, not a second SSH status.
- The firewall tile owns overall effective risk. A matched console-owned rule cannot paint the tile healthy when a project-level external rule still exposes the selected instance; owned-rule coverage remains secondary context.
- Configuration owns `设置部署 / 修改部署`, `基于此新建`, and applicable node deployment. Diagnosis owns `运行只读探测 / 重新探测` and conditional `接管本地`. Maintenance owns only `重启实例` and `系统更新`.
- Network governance has one progressively disclosed owner, `管理端口与 SSH`, inside `更多属性`. Its compact dialog shows the two fixed SSH entries, fresh selectable listeners, local password configuration state, and one preview summary; only one primary step is visible at a time.
- WARP egress has one conditional owner inside `节点结果`: a single fact row plus a compact dialog. The dialog keeps IPv4 primary, reports IPv6/colo/protocol independently, and exposes only `重新检测` plus one dynamic confirmed action (`重连并尝试换 IP`, `恢复 WARP 连接`, or `再试一次`).
- `只开实例` does not show a node deployment action. Firewall status remains canonical read evidence; governance details live only in `更多属性`, where one repair action appears only for a fresh, executable console-owned plan.
- Recovery guidance names only the highest-priority existing action as text. It never creates a second clickable entry point or a multi-step primary list outside the three canonical action groups.
- When a fresh verification is partial only because of external shared firewall rules, the primary recommendation is manual review rather than another probe or redeploy. The task result does not label that condition retryable.
- Existing cloud instance deployment uses the same form as new instance creation.
- Save draft is local only.
- Save and preview reads live cloud state and creates a fingerprinted preview.
- Editing any core or advanced configuration field invalidates the executable preview.
- Changing public IPv4 mode, Network Tier, NIC type, or static address name invalidates the preview. A node deployment with no public IPv4 is blocked before local save/preview, and static address billing/retention risk is shown in both the execution summary and final confirmation.
- Execute is enabled only when a valid preview exists.
- Maintenance buttons show immediate busy feedback, update the persistent task bar, and write to task logs.
- Dangerous actions stay at the bottom in a folded section.
- Task logs are expanded and first on the task page but remain session-only. Persistent job history is read-only, and selected rows update progress, result, and node link panels.
- Above 1080px, task progress and preview form one compact left context column while the result owns the wider right column. Diagnostics/evidence and node/firewall artifacts are native disclosures closed by default; tablet and mobile stack the context and result in one column.
- Restart-recovered tasks use one amber `interrupted` terminal state and one compact explanation. They are never presented as running, failed, or directly retryable, and storage maintenance notices remain hidden unless recovery or quarantine needs attention.
- Every stage of a terminal task must also be terminal. Startup compatibility repair may normalize old persisted active stages without adding UI rows or changing the task's historical result.
- Freshness is conveyed through restrained tone and supporting copy, not an additional status tile. Historical successful values cannot retain a fresh-success presentation.
- `更多属性` owns evidence source, evidence time, freshness, and latest-attempt outcome alongside basic/network/identity attributes and redacted evidence.
- A verified dual-entry policy keeps SSH as one canonical tile: `45400 · 双入口` with compact supporting text for IAP 22 key-plus-password and public 45400 key authentication. Effective instance isolation keeps firewall as one canonical tile and reports external wide rules only as project-level context.
- Page load and route changes never trigger SSH, inventory, Guest Attributes, or firewall probes automatically.
- Selecting an instance or opening the WARP dialog is network-free. Only the two explicit dialog actions may call the WARP APIs, and reconnect cancellation leaves the dialog and remote instance unchanged.

## Component Language

- Primary buttons: cloud writes or the next main step.
- Secondary buttons: navigation, refresh, read-only checks, and non-primary actions.
- Danger buttons: local record removal or cloud resource deletion.
- Badges describe source and state, not marketing claims.
- Logs default to concise status lines in a fixed-height terminal area; raw errors and long links scroll inside their own containers.
- User-facing task stage details and node firewall actions use Chinese labels; stable protocol names, ports, rule names, and gcloud command names remain technical literals.
- Immediate feedback belongs to toasts, durable results belong to task history, and current-session detail belongs to the running log. These channels must not duplicate full result blocks.
- Cached inventory is shown as one low-density inline notice rather than a new panel. Disabled cloud actions explain that live inventory must recover; local-only actions retain their normal hierarchy.

## Verification Rules

- `npm --prefix ui run check` is the static and unit gate.
- `UI_AUDIT_SCREENSHOTS=1 npm --prefix ui run audit:layout` is the responsive layout gate across 1728, 1440, 1280, 1024, 768, and 390 widths.
- Layout audit must fail loudly rather than pretending success if the browser is blocked.
- Automated verification must not confirm cloud-changing dialogs or execute real GCP writes.
- The live acceptance CLI permits only instance describe/list, Guest Attributes reads, firewall list/describe, and the exact fixed SSH probe through native `ssh` plus `gcloud compute start-iap-tunnel`. `gcloud compute ssh` is rejected because it can provision project SSH metadata. The CLI compares record, job-history, and node-result hashes before and after execution.
- `npm --prefix ui run audit:performance:browser` must report at most four startup waves, no duplicate/non-read startup requests, and bounded DOM mutation counts.
- `npm --prefix ui run cleanup:local` is dry-run by default. Only `--apply` may remove the tested cache whitelist.
