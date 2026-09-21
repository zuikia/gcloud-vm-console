const STORAGE_KEY = "gcloud-vm-console.locale";

// The application deliberately keeps stable cloud/API identifiers untouched.
// These phrases are presentation copy only; the language layer runs at the DOM
// boundary so existing safety contracts and serialized records remain unchanged.
const PHRASE_PAIRS = [
  ["主导航", "Main navigation"],
  ["全局操作", "Global actions"],
  ["账号 / 项目", "Account / project"],
  ["：", ": "],
  ["Gcloud · 本地", "Gcloud · Local"],
  ["总览", "Overview"],
  ["实例", "Instances"],
  ["部署", "Deploy"],
  ["任务", "Tasks"],
  ["账号", "Account"],
  ["项目", "Project"],
  ["目标", "Target"],
  ["规格", "Size"],
  ["；", "; "],
  ["云端状态", "cloud state"],
  ["执行风险", "execution risk"],
  ["最新预览指纹", "latest preview fingerprint"],
  ["空闲", "Idle"],
  ["从实例清单选择一台实例后显示下一步。", "Select an instance from the inventory to see the next step."],
  ["无需部署节点", "No node deployment needed"],
  ["未获取", "Not available"],
  ["等待只读探测", "Waiting for read-only probe"],
  ["端口策略", "Port policy"],
  ["读取监听端口后，可配置 SSH 双入口和实例级隔离", "After reading listener ports, you can configure dual SSH entry and instance-level isolation"],
  ["当前没有可用的本地危险操作", "No local dangerous actions are available"],
  ["暂无任务、验证或节点结果。", "No tasks, verification, or node results yet."],
  ["协议", "Protocol"],
  ["代理", "Proxy"],
  ["机房", "Colocation"],
  ["重新检测", "Check again"],
  ["重连并尝试换 IP", "Reconnect and try a new IP"],
  ["SSH 密钥入口，固定保留", "SSH key entry, always retained"],
  ["诊断摘要", "Diagnostic summary"],
  ["诊断", "Diagnostics"],
  ["未识别 · 尚未验证 · 智能诊断", "Unrecognized · Not verified · Smart diagnosis"],
  ["默认项目自动切换失败", "Default project auto-switch failed"],
  ["项目切换失败", "Project switch failed"],
  ["服务模式", "Service mode"],
  ["项目列表已按当前 gcloud 配置和账号同步。", "The project list is synced for the current gcloud configuration and account."],
  ["未选择实例。", "No instance selected."],
  ["当前为缓存清单，请先恢复实时连接。", "This is a cached inventory. Restore the live connection first."],
  ["实例身份、位置、系统和规格。", "Instance identity, location, system, and size."],
  ["墨西哥/克雷塔罗", "Mexico / Queretaro"],
  ["Always Free 区域；仍需注意公网 IPv4、磁盘和出站流量。", "Always Free region; public IPv4, disk, and egress still require attention."],
  ["当前 zone：", "Current zone: "],
  ["，可手动切换", "; manual selection available"],
  ["区域目录：", "Region catalog: "],
  ["执行时将校验或保留区域静态地址", "Execution will validate or retain the regional static address "],
  ["未挂载的静态 IPv4 仍可能计费。", "An unattached static IPv4 may still incur charges."],
  ["这里只显示目标、关键变更和执行风险。", "Only the target, key changes, and execution risk are shown here."],
  ["先选择账号与项目", "Choose an account and project first"],
  ["关键变更", "Key changes"],
  ["模式", "Mode"],
  ["Network：", "Network: "],
  ["静态 IPv4", "static IPv4"],
  ["静态地址：", "Static address: "],
  ["只开实例不会自动修改 sshd", "VM-only does not modify sshd automatically"],
  ["只开实例模式不会安装代理软件；生成预览只读取云端状态，不会创建或修改实例。", "VM-only mode installs no proxy software; preview generation only reads cloud state and does not create or modify instances."],
  ["执行云端变更前必须拥有最新预览指纹。", "Cloud changes require the latest preview fingerprint."],
  ["免费额度取决于区域、机器类型、磁盘、公网 IP 和出站流量。创建前仍需核对当前官方规则。", "Free-tier allowance depends on the region, machine type, disk, public IP, and egress traffic. Check the current official rules before creation."],
  ["从左侧清单选择一台实例。", "Select an instance from the list on the left."],
  ["未识别 · 尚未验证 · 建议先诊断", "Unrecognized · Not verified · Diagnose first"],
  ["暂无可信识别证据", "No trusted recognition evidence"],
  ["尚未验证", "Not verified"],
  ["运行只读探测后显示问题摘要", "Issues appear after running a read-only probe"],
  ["先执行只读探测，不修改云端实例", "Run a read-only probe first; no cloud instance changes"],
  ["仅在接管外部实例时作为本地确认依据。", "Used as local confirmation when adopting an external instance."],
  ["脱敏证据", "Redacted evidence"],
  ["选择实例后显示节点链接或面板信息。", "Select an instance to show node links or panel information."],
  ["节点相关防火墙规则会在这里显示。", "Node-related firewall rules appear here."],
  ["公网地址、Network Tier 和网卡类型在上方统一选择。", "Public address, Network Tier, and NIC type are selected together above."],
  ["IAP 保留救援通道；密钥路径只保存在本地记录中。", "IAP remains a rescue path; the key path is stored only in the local record."],
  ["用于识别防火墙目标和本地管理范围。", "Used to identify firewall targets and local management scope."],
  ["等待填写部署信息", "Waiting for deployment details"],
  ["自定义 startup script", "Custom startup script"],
  ["生成预览只读取云端状态，不会创建或修改实例。", "Preview generation only reads cloud state; it does not create or modify instances."],
  ["选择实例或任务后生成可复制摘要。", "Select an instance or task to generate a copyable summary."],
  ["只开实例模式不会生成节点链接。", "VM-only mode does not generate node links."],
  ["防火墙同步结果会在节点部署后显示。", "Firewall sync results appear after node deployment."],
  ["当前实例尚未读取实时 WARP 状态。", "The current instance has not read live WARP status."],
  ["受影响节点", "Affected nodes"],
  ["尚未识别使用 WARP 的节点。", "No WARP nodes have been recognized yet."],
  ["仅 WARP 节点预计中断 10–60 秒；直连节点、SSH 和节点链接不受影响。每次确认只执行一轮重连。", "Only WARP nodes are expected to be interrupted for 10–60 seconds; direct nodes, SSH, and node links are unaffected. Each confirmation runs one reconnect cycle."],
  ["选择实例后读取当前监听证据。", "Select an instance to read current listener evidence."],
  ["本地统一密码", "Local shared password"],
  ["可选公网入口，仍需密钥 + 密码", "Optional public entry; key + password still required"],
  ["预览会列出新增、保留、关闭端口和实例隔离优先级。", "The preview lists added, retained, and closed ports plus instance isolation priority."],
  ["生成端口预览", "Generate port preview"],
  ["非 Always Free 区域；按当前 GCP 价格计费。", "Non-Always-Free region; billed at current GCP prices."],
  ["进入实例页查看 SSH、BBR、防火墙和服务状态，需要时运行只读探测。", "Open Instances to review SSH, BBR, firewall, and service status; run a read-only probe when needed."],
  ["公网 IPv4 独立计费", "Public IPv4 billed separately"],
  ["公网 IPv4 需单独核对", "Verify public IPv4 separately"],
  ["当前配置没有可用账号。请先在本机完成 gcloud 登录。", "No usable account is available for the current configuration. Complete gcloud login locally first."],
  ["此账号未返回可访问项目，请检查账号权限或切换 gcloud 配置。", "This account returned no accessible projects. Check account permissions or switch gcloud configuration."],
  ["实时读取失败，已保留当前会话中的上次清单；云端写操作已锁定。", "Live read failed; the previous session inventory was kept; cloud writes are locked."],
  ["节点部署时配置并保留 22 救援", "configured during node deployment; port 22 is retained for rescue"],
  ["无变化", "No change"],
  ["SSH 实际连接未知", "SSH connection unknown"],
  ["当前实例没有可管理的 WARP 节点或服务证据。", "The current instance has no manageable WARP nodes or service evidence."],
  ["实例选择已变化，请重新打开 WARP 管理。", "The selected instance changed; reopen WARP management."],
  ["WARP 检测失败，已保留上次结果", "WARP detection failed; the previous result was kept"],
  ["WARP 状态已更新", "WARP status updated"],
  ["重连 WARP 出口", "Reconnect WARP egress"],
  ["变更预览、执行进度、节点结果和日志集中在同一任务上下文。", "Change preview, execution progress, node results, and logs are grouped in one Tasks context."],
  ["运行日志", "Running logs"],
  ["云端清单读取失败", "Cloud inventory read failed"],
  ["清单读取失败", "inventory read failed"],
  ["项目访问失败", "project access failed"],
  ["当前账号可能没有权限，或 Compute Engine API 未启用。请确认账号、项目和 API 状态后重试。", "The current account may lack permission, or the Compute Engine API may be disabled. Check the account, project, and API status, then retry."],
  ["当前Account可能没有权限，或 Compute Engine API 未启用。请确认Account、Project和 API Status后重试。", "The current account may lack permission, or the Compute Engine API may be disabled. Check the account, project, and API status, then retry."],
  ["Project切换Failed", "Project switch failed"],
  ["任务历史", "Task history"],
  ["本地保留最多 200 项或 30 天；运行日志仅保留当前会话。", "Local history keeps at most 200 items or 30 days; running logs are kept for the current session only."],
  ["保留最多", "keeps at most"],
  ["项或", "items or"],
  ["天；", " days; "],
  ["日志仅保留当前会话", "logs are kept for the current session only"],
  ["时间", "Time"],
  ["耗时", "Duration"],
  ["任务进度", "Task progress"],
  ["预览指纹失效后必须重新生成。", "Preview fingerprints must be regenerated after expiry."],
  ["等待预览", "Waiting for preview"],
  ["校验指纹", "Verify fingerprint"],
  ["执行变更", "Execute change"],
  ["等待确认", "Waiting for confirmation"],
  ["查看结果", "View result"],
  ["尚未执行", "Not executed"],
  ["只显示当前实例记录对应的最新预览。", "Only the latest preview for the current instance record is shown."],
  ["先在部署页生成预览。", "Generate a preview on the Deploy page first."],
  ["执行结果", "Execution result"],
  ["选中历史任务后显示摘要、错误和链接。", "Select a historical task to show its summary, errors, and links."],
  ["选中验证或部署任务后显示恢复建议。", "Select a verification or deployment task to show recovery recommendations."],
  ["诊断与证据", "Diagnostics and evidence"],
  ["暂无诊断上下文", "No diagnostic context yet"],
  ["节点与防火墙结果", "Node and firewall results"],
  ["尚未部署节点", "Node not deployed yet"],
  ["未选择任务。", "No task selected."],
  ["尚未选择任务。", "No task selected."],
  ["先在总览页应用一个账号与项目，再读取本地记录和云端实例。", "Apply an account and project from Overview before reading local records and cloud instances."],
  ["选择资源后显示详情和操作。", "Select a resource to show details and actions."],
  ["公网 IP --", "Public IP --"],
  ["尚未检查", "Not checked yet"],
  ["gcloud 配置", "gcloud configuration"],
  ["正在读取", "Reading "],
  ["正在读取项目...", "Reading projects..."],
  ["未选择实例", "No instance selected"],
  ["未选择账号与项目", "No account or project selected"],
  ["需要选择 gcloud 配置", "Select a gcloud configuration"],
  ["需要先在总览选择并切换账号与项目", "Select and apply an account and project from Overview"],
  ["操作进度", "Progress"],
  ["位置", "Location"],
  ["来源", "Source"],
  ["配置", "Configuration"],
  ["网络", "Network"],
  ["系统", "System"],
  ["身份", "Identity"],
  ["基础", "Basics"],
  ["状态", "Status"],
  ["运行中", "Running"],
  ["运行", "Running"],
  ["进行中", "In progress"],
  ["准备", "Prepare"],
  ["完成", "Complete"],
  ["成功", "Success"],
  ["失败", "Failed"],
  ["错误", "Error"],
  ["未知", "Unknown"],
  ["提示", "Notice"],
  ["风险", "Risk"],
  ["高风险", "High risk"],
  ["严重风险", "Critical risk"],
  ["状态异常", "Unhealthy"],
  ["状态未知", "Unknown state"],
  ["全部正常", "All clear"],
  ["待确认", "Needs confirmation"],
  ["待检查", "Needs checking"],
  ["待探测", "Not probed"],
  ["待检测", "Not checked"],
  ["待分析", "Pending analysis"],
  ["未选择", "Not selected"],
  ["尚未选择", "Not selected"],
  ["尚未选择实例", "No instance selected"],
  ["尚未选择账号与项目", "No account or project selected"],
  ["未识别", "Unrecognized"],
  ["未确认", "Unconfirmed"],
  ["未验证", "Not verified"],
  ["未探测", "Not probed"],
  ["未连接", "Not connected"],
  ["未开放", "Not open"],
  ["未发现", "Not found"],
  ["未部署", "Not deployed"],
  ["未就绪", "Not ready"],
  ["无", "None"],
  ["无证据", "No evidence"],
  ["无可信证据", "No trusted evidence"],
  ["暂无任务", "No tasks"],
  ["暂无任务。", "No tasks."],
  ["暂无节点结果", "No node result"],
  ["暂无证据", "No evidence yet"],
  ["暂无待处理问题", "No pending issues"],
  ["暂无恢复建议。", "No recovery recommendation."],
  ["暂无节点与防火墙结果", "No node or firewall result"],
  ["暂无运行任务", "No running task"],
  ["尚未生成预览", "Preview not generated"],
  ["尚无执行预览", "No executable preview"],
  ["无有效预览", "No valid preview"],
  ["预览", "Preview"],
  ["变更预览", "Change preview"],
  ["预览已生成", "Preview generated"],
  ["预览已过期", "Preview expired"],
  ["预览需重新生成", "Regenerate the preview"],
  ["预览暂不可应用", "Preview cannot be applied"],
  ["预览已准备执行", "Preview ready to execute"],
  ["预览仍有效，可在任务页执行", "Preview is still valid; execute it from Tasks."],
  ["刷新数据", "Refresh data"],
  ["刷新清单", "Refresh inventory"],
  ["刷新实例清单", "Refresh instance inventory"],
  ["重新读取", "Reload"],
  ["重新读取账号与项目", "Reload accounts and projects"],
  ["重新读取当前上下文和资源状态，不会修改云端资源。", "Reload the current context and resource state. No cloud resources are modified."],
  ["切换到此项目", "Use this project"],
  ["切换失败，已保留原项目", "Switch failed; the previous project was kept"],
  ["等待选择上下文", "Waiting for context"],
  ["尚未选择账号与项目", "No account or project selected"],
  ["当前账号、项目、资源和任务状态集中在这里。", "Account, project, resource, and task status are collected here."],
  ["运行上下文", "Runtime context"],
  ["运营状态", "Operations status"],
  ["选择本机 gcloud 配置和项目后，所有资源操作都会绑定到这个上下文。", "Choose a local gcloud configuration and project; all resource actions will use this context."],
  ["正在连接本地服务", "Connecting to local service"],
  ["本地服务正常", "Local service ready"],
  ["本地服务不可用", "Local service unavailable"],
  ["本地服务未连接", "Local service disconnected"],
  ["本地控制台服务未连接。", "The local console service is not connected."],
  ["账号与项目已重新读取", "Accounts and projects reloaded"],
  ["实例总数", "Total instances"],
  ["运行中", "Running"],
  ["只读预检", "Read-only preflight"],
  ["环境体检", "Environment check"],
  ["运行体检", "Run check"],
  ["选择账号和项目后可运行只读体检。", "Choose an account and project to run a read-only check."],
  ["当前实例", "Current instance"],
  ["尚未选择实例。", "No instance selected."],
  ["尚未选择管理对象", "No managed object selected"],
  ["进入实例清单后选择一行，这里会同步显示状态和公网 IP。", "Select a row in the instance inventory to show its status and public IP here."],
  ["打开实例清单", "Open instance inventory"],
  ["下一步", "Next step"],
  ["选择账号与项目", "Choose account and project"],
  ["先确定操作上下文，避免对错误的项目执行命令。", "Set the operation context first to avoid running commands in the wrong project."],
  ["账号项目", "Account / project"],
  ["选择实例", "Select instance"],
  ["预览执行", "Preview and execute"],
  ["最近任务", "Recent task"],
  ["仅显示本次本地控制台会话的最近结果。", "Only the latest results from this local console session are shown."],
  ["查看任务", "View tasks"],
  ["还没有执行预览或维护操作", "No preview or maintenance action has run"],
  ["费用与安全", "Cost and safety"],
  ["更新规则提示", "Update rule guidance"],
  ["尚未校对。", "Not checked yet."],
  ["来源：未校对", "Source: not checked"],
  ["时间：--", "Time: --"],
  ["本地记录与当前账号项目下的云端实例合并展示；点击行仅选择对象。", "Local records and cloud instances for the current account and project are shown together; clicking a row only selects it."],
  ["搜索名称、项目或 IP", "Search name, project, or IP"],
  ["搜索实例", "Search instances"],
  ["统一清单", "Unified inventory"],
  ["账号、项目、位置和来源始终随资源显示。", "Account, project, location, and source stay visible with each resource."],
  ["选择一台实例", "Select an instance"],
  ["选择后显示统一状态、建议操作和折叠详情。", "Select one to show unified status, recommended action, and folded details."],
  ["实例摘要", "Instance summary"],
  ["实例状态摘要", "Instance status summary"],
  ["防火墙", "Firewall"],
  ["服务", "Services"],
  ["建议操作", "Recommended action"],
  ["选择实例后显示下一步。", "Select an instance to see the next step."],
  ["查看节点结果", "View node result"],
  ["实例操作分组", "Instance action groups"],
  ["配置操作", "Configuration"],
  ["调整部署或复用配置", "Adjust or reuse a deployment"],
  ["设置部署", "Set deployment"],
  ["设置部署 / 修改部署", "Set / edit deployment"],
  ["基于此新建", "Create from this"],
  ["部署节点", "Deploy node"],
  ["智能诊断", "Smart diagnosis"],
  ["只读探测，不修改云端", "Read-only probe; no cloud changes"],
  ["运行只读探测", "Run read-only probe"],
  ["重新探测", "Probe again"],
  ["接管本地", "Adopt locally"],
  ["维护操作", "Maintenance"],
  ["执行前确认影响范围", "Confirm impact before execution"],
  ["重启实例", "Restart instance"],
  ["系统更新", "System update"],
  ["技术详情", "Technical details"],
  ["部署识别", "Deployment recognition"],
  ["验证问题", "Verification issues"],
  ["恢复建议", "Recovery recommendation"],
  ["更多属性", "More attributes"],
  ["机器、网络、身份与脱敏证据", "Machine, network, identity, and redacted evidence"],
  ["手动指定部署方式", "Manually specify deployment"],
  ["按识别结果", "Use recognition result"],
  ["只开实例", "VM only"],
  ["自定义脚本", "Custom script"],
  ["外部自定义", "External custom"],
  ["部署方式未确认", "Deployment method unconfirmed"],
  ["部署方式", "Deployment method"],
  ["节点结果", "Node result"],
  ["暂无节点结果", "No node result"],
  ["管理", "Manage"],
  ["管理 WARP 出口", "Manage WARP egress"],
  ["WARP 出口", "WARP egress"],
  ["待检测", "Not checked"],
  ["尚未读取实时出口", "Live egress not read"],
  ["显式检测后显示证据时间", "Evidence time appears after an explicit check"],
  ["危险操作", "Dangerous actions"],
  ["默认收起，需要二次确认", "Collapsed by default; second confirmation required"],
  ["移除本地记录", "Remove local record"],
  ["删除云端资源", "Delete cloud resource"],
  ["移除本地记录不会删除云端实例。云端删除当前未开放。", "Removing a local record does not delete the cloud instance. Cloud deletion is not available."],
  ["部署", "Deploy"],
  ["新建、编辑和基于已有实例新建共用同一套部署与预览流程。", "Create, edit, and clone workflows share the same deployment and preview flow."],
  ["实例部署", "Instance deployment"],
  ["字段会保存为本地记录；只有执行有效预览才会修改云端。", "Fields are saved locally; only executing a valid preview changes the cloud."],
  ["新建实例", "New instance"],
  ["名称", "Name"],
  ["区域", "Region"],
  ["正在读取区域目录。", "Reading region catalog."],
  ["自动选择 zone", "Auto-select zone"],
  ["读取区域后显示可用区。", "Zones appear after the region is read."],
  ["手动选择", "Manual selection"],
  ["手动选择可用区", "Select a zone manually"],
  ["机器类型", "Machine type"],
  ["系统镜像", "OS image"],
  ["磁盘 GB", "Disk GB"],
  ["区域目录尚未同步。", "Region catalog not synced."],
  ["网络配置", "Network configuration"],
  ["公网地址、Network Tier 和虚拟网卡会进入变更预览。", "Public address, Network Tier, and NIC type are included in the change preview."],
  ["公网 IPv4", "Public IPv4"],
  ["静态（推荐）", "Static (recommended)"],
  ["临时", "Ephemeral"],
  ["不分配", "None"],
  ["Premium（推荐）", "Premium (recommended)"],
  ["网卡类型", "NIC type"],
  ["静态地址资源名", "Static address resource name"],
  ["部署方式", "Deployment method"],
  ["部署方式需确认", "Deployment method needs confirmation"],
  ["只开实例不安装任何代理软件；其他模式在创建后运行对应流水线。", "VM-only mode installs no proxy software; other modes run their pipeline after creation."],
  ["不安装额外项目", "No extra software"],
  ["自动同步节点端口", "Sync node ports automatically"],
  ["安装固定版本面板", "Install a pinned panel version"],
  ["使用下方 startup script", "Use the startup script below"],
  ["高级设置", "Advanced settings"],
  ["网络、SSH、标签和启动脚本", "Network, SSH, labels, and startup script"],
  ["子网", "Subnet"],
  ["SSH 用户", "SSH user"],
  ["SSH 密钥路径", "SSH key path"],
  ["SSH 端口", "SSH port"],
  ["标签", "Labels"],
  ["网络标签", "Network tags"],
  ["留空自动使用实例名称", "Leave blank to use the instance name"],
  ["启动脚本", "Startup script"],
  ["输入需要在首次启动时执行的脚本", "Enter a script to run on first boot"],
  ["保存草稿", "Save draft"],
  ["保存并生成预览", "Save and generate preview"],
  ["生成预览", "Generate preview"],
  ["执行有效预览", "Execute valid preview"],
  ["执行摘要", "Execution summary"],
  ["任务日志", "Task log"],
  ["当前会话输出，切换页面不会清空。", "Current session output; changing pages does not clear it."],
  ["清空本地日志视图", "Clear local log view"],
  ["清空", "Clear"],
  ["等待操作", "Waiting for action"],
  ["排队中", "Queued"],
  ["操作正在执行。", "The operation is running."],
  ["任务状态会在这里持续显示。", "Task status stays visible here."],
  ["操作已结束，详情可在任务页或当前页面查看。", "The operation ended; details are available on Tasks or this page."],
  ["复制", "Copy"],
  ["复制链接", "Copy link"],
  ["复制摘要", "Copy summary"],
  ["复制诊断摘要", "Copy diagnostic summary"],
  ["已复制", "Copied"],
  ["复制失败，请展开内容后手动复制", "Copy failed; expand the content and copy it manually"],
  ["取消", "Cancel"],
  ["关闭", "Close"],
  ["确认操作", "Confirm action"],
  ["确认继续", "Confirm and continue"],
  ["确认应用", "Confirm apply"],
  ["确认移除", "Confirm removal"],
  ["确认框未初始化", "Confirmation dialog is not initialized"],
  ["输入", "Enter"],
  ["密码", "Password"],
  ["用户名", "Username"],
  ["至少 8 个字符", "At least 8 characters"],
  ["本地密码未配置", "Local password not configured"],
  ["本地密码已配置", "Local password configured"],
  ["只保存在本机受限文件中，不会回显。", "Stored only in a restricted local file; it is never echoed."],
  ["SSH 双入口", "Dual SSH entry"],
  ["密钥 + 密码", "Key + password"],
  ["仅密钥", "Key only"],
  ["IAP 救援入口", "IAP rescue entry"],
  ["公网主入口", "Public primary entry"],
  ["公网端口", "Public ports"],
  ["仅显示新鲜外部监听", "Only fresh external listeners are shown"],
  ["固定管理端口", "Fixed management ports"],
  ["未检测到可选择的节点监听端口。", "No selectable node listener was detected."],
  ["端口策略预览", "Port policy preview"],
  ["应用端口策略", "Apply port policy"],
  ["管理端口与 SSH", "Manage ports and SSH"],
  ["实例级端口隔离已验证", "Instance-level port isolation verified"],
  ["外部共享规则不会由控制台自动修改", "External shared rules are never changed automatically"],
  ["外部共享规则仍有项目级风险", "External shared rules still carry project-level risk"],
  ["只读", "Read-only"],
  ["云端", "Cloud"],
  ["本地", "Local"],
  ["本地记录", "Local record"],
  ["本地已管理", "Locally managed"],
  ["外部已接管", "Externally adopted"],
  ["外部可接管", "Externally adoptable"],
  ["网络与防火墙", "Network and firewall"],
  ["服务与配置", "Services and configuration"],
  ["证据", "Evidence"],
  ["近期证据", "Recent evidence"],
  ["历史证据", "Historical evidence"],
  ["证据时间线", "Evidence timeline"],
  ["高可信", "High confidence"],
  ["中可信", "Medium confidence"],
  ["低可信", "Low confidence"],
  ["未确认影响实例", "Affected instances unconfirmed"],
  ["部分开放", "Partially open"],
  ["过度开放", "Overexposed"],
  ["无需检查", "Check not required"],
  ["无需变更", "No change needed"],
  ["自有规则已匹配", "Owned rules match"],
  ["自有规则无需变更", "Owned rules need no change"],
  ["防火墙已同步", "Firewall synced"],
  ["防火墙同步失败", "Firewall sync failed"],
  ["节点", "Node"],
  ["条节点链接", "node links"],
  ["节点链接", "Node link"],
  ["节点链接可用", "Node links available"],
  ["节点链接缺失", "Node links missing"],
  ["节点链接已生成，但实例内目标端口没有全部监听。", "Node links were generated, but not all target ports are listening on the instance."],
  ["节点链接和关键运行状态已验证，可以复制链接使用。", "Node links and key runtime state are verified; the links can be copied."],
  ["面板", "Panel"],
  ["面板信息", "Panel information"],
  ["面板地址", "Panel address"],
  ["环境体检通过", "Environment check passed"],
  ["环境体检有项目需要注意。", "The environment check found items needing attention."],
  ["体检发现阻断项，先处理后再执行写操作。", "The check found blockers. Resolve them before cloud writes."],
  ["资源同步失败", "Resource sync failed"],
  ["资源摘要", "Resource summary"],
  ["当前项目还没有实例", "The current project has no instances"],
  ["当前状态不可用。", "The current state is unavailable."],
  ["当前状态无需额外处理", "The current state needs no additional action"],
  ["请选择账号和项目", "Select an account and project"],
  ["请先选择一台实例。", "Select an instance first."],
  ["需要填写实例名称。", "Enter an instance name."],
  ["请检查实例名称、端口和网络字段格式。", "Check the instance name, port, and network field formats."],
  ["请求失败", "Request failed"],
  ["操作失败", "Operation failed"],
  ["服务不可用", "Service unavailable"],
  ["正在处理", "Processing"],
  ["正在处理任务", "Processing task"],
  ["正在读取实例清单", "Reading instance inventory"],
  ["正在同步实例清单", "Syncing instance inventory"],
  ["正在同步资源", "Syncing resources"],
  ["正在读取本机 gcloud 配置", "Reading local gcloud configuration"],
  ["正在生成端口与 SSH 预览", "Generating port and SSH preview"],
  ["正在执行智能诊断", "Running smart diagnosis"],
  ["正在执行已验证预览", "Executing verified preview"],
  ["正在检测 WARP 出口", "Checking WARP egress"],
  ["已完成", "Completed"],
  ["已生成变更预览", "Change preview generated"],
  ["已验证", "Verified"],
  ["已匹配", "Matched"],
  ["已开启", "Enabled"],
  ["未开启", "Not enabled"],
  ["BBR", "BBR"],
  ["SSH", "SSH"],
  ["WARP", "WARP"],
  ["防火墙治理", "Firewall governance"],
  ["治理预览已过期", "Governance preview expired"],
  ["区域目录读取失败", "Failed to read region catalog"],
  ["内置备用", "Built-in fallback"],
  ["官方", "Official"],
  ["推荐", "recommended"],
  ["免费", "Free"],
  ["SSH：期望", "SSH: expected"],
  ["美国/俄勒冈", "US / Oregon"],
  ["美国/爱荷华", "US / Iowa"],
  ["美国/南卡罗来纳", "US / South Carolina"],
  ["美国/北弗吉尼亚", "US / Northern Virginia"],
  ["美国/哥伦布", "US / Columbus"],
  ["美国/达拉斯", "US / Dallas"],
  ["美国/洛杉矶", "US / Los Angeles"],
  ["美国/盐湖城", "US / Salt Lake City"],
  ["美国/拉斯维加斯", "US / Las Vegas"],
  ["中国台湾/彰化", "Taiwan / Changhua"],
  ["中国香港/香港", "Hong Kong"],
  ["日本/东京", "Japan / Tokyo"],
  ["日本/大阪", "Japan / Osaka"],
  ["韩国/首尔", "South Korea / Seoul"],
  ["新加坡/新加坡", "Singapore"],
  ["澳大利亚/悉尼", "Australia / Sydney"],
  ["澳大利亚/墨尔本", "Australia / Melbourne"],
  ["加拿大/蒙特利尔", "Canada / Montreal"],
  ["加拿大/多伦多", "Canada / Toronto"],
  ["英国/伦敦", "UK / London"],
  ["德国/法兰克福", "Germany / Frankfurt"],
  ["德国/柏林", "Germany / Berlin"],
  ["法国/巴黎", "France / Paris"],
  ["荷兰/埃姆斯哈文", "Netherlands / Eemshaven"],
  ["比利时/圣吉斯兰", "Belgium / St. Ghislain"],
  ["芬兰/哈米纳", "Finland / Hamina"],
  ["瑞典/斯德哥尔摩", "Sweden / Stockholm"],
  ["瑞士/苏黎世", "Switzerland / Zurich"],
  ["西班牙/马德里", "Spain / Madrid"],
  ["意大利/米兰", "Italy / Milan"],
  ["意大利/都灵", "Italy / Turin"],
  ["波兰/华沙", "Poland / Warsaw"],
  ["巴西/圣保罗", "Brazil / Sao Paulo"],
  ["智利/圣地亚哥", "Chile / Santiago"],
  ["南非/约翰内斯堡", "South Africa / Johannesburg"],
  ["卡塔尔/多哈", "Qatar / Doha"],
  ["沙特阿拉伯/达曼", "Saudi Arabia / Dammam"],
  ["以色列/特拉维夫", "Israel / Tel Aviv"],
  ["印度/孟买", "India / Mumbai"],
  ["印度/德里", "India / Delhi"],
  ["印度尼西亚/雅加达", "Indonesia / Jakarta"],
  ["马来西亚/吉隆坡", "Malaysia / Kuala Lumpur"]
];

const ZH_TO_EN = new Map(PHRASE_PAIRS);
const EN_TO_ZH = new Map(PHRASE_PAIRS.map(([zh, en]) => [en, zh]));
const SORTED_ZH = [...ZH_TO_EN.keys()].sort((a, b) => b.length - a.length);
const SORTED_EN = [...EN_TO_ZH.keys()].sort((a, b) => b.length - a.length);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replacePhrases(value, locale) {
  let text = String(value ?? "");
  const source = locale === "en-US" ? SORTED_ZH : SORTED_EN;
  const map = locale === "en-US" ? ZH_TO_EN : EN_TO_ZH;
  // Replace against the original text in one pass. Replacing in a loop lets
  // a translated value match a later, shorter key and cascade into mixed copy
  // (for example, `Always Free` becoming `Always 免费`).
  if (source.length) {
    const pattern = new RegExp(source.map(escapeRegExp).join("|"), "g");
    text = text.replace(pattern, (match) => map.get(match) ?? match);
  }
  if (locale === "en-US") {
    text = text
      .replace(/(\d+)\s*个问题/g, "$1 issues")
      .replace(/(\d+)\s*项属性/g, "$1 attributes")
      .replace(/(\d+)\s*条(?:脱敏证据|Redacted evidence)/g, "$1 redacted evidence")
      .replace(/(\d+)\s*个$/g, "$1")
      .replace(/(\d+)\s*项运行中/g, "$1 running")
      .replace(/(\d+)\s*项/g, "$1 items")
      .replace(/(\d+)\s*个可用区/g, "$1 zones")
      .replace(/(\d+)\s*个节点链接/g, "$1 node links")
      .replace(/(\d+)\s*条节点链接/g, "$1 node links")
      .replace(/(\d+)\s*分钟前/g, "$1 min ago")
      .replace(/(\d+)\s*小时前/g, "$1 hr ago")
      .replace(/(\d+)\s*天前/g, "$1 days ago")
      .replace(/从\s*/g, "from ")
      .replace(/回退/g, "fallback")
      .replace(/已开放/g, "open")
      .replace(/未开放/g, "not open")
      .replace(/已完成/g, "completed")
      .replace(/已失败/g, "failed");
  } else {
    text = text
      .replace(/(\d+)\s*issues?/gi, "$1 个问题")
      .replace(/(\d+)\s*items?/gi, "$1 项")
      .replace(/(\d+)\s*zones?/gi, "$1 个可用区")
      .replace(/(\d+)\s*node links?/gi, "$1 条节点链接")
      .replace(/(\d+)\s*min ago/gi, "$1 分钟前")
      .replace(/(\d+)\s*hr ago/gi, "$1 小时前")
      .replace(/(\d+)\s*days? ago/gi, "$1 天前");
  }
  return text;
}

function normalizeLocale(value) {
  return String(value || "").toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

function safeStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readInitialLocale() {
  const stored = safeStorage()?.getItem(STORAGE_KEY);
  if (stored) return normalizeLocale(stored);
  // Keep the existing Chinese-first experience for new users; an explicit
  // toggle choice is persisted locally and takes precedence on later visits.
  return "zh-CN";
}

function shouldSkipTextNode(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  return /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TEXTAREA|INPUT)$/i.test(parent.tagName)
    || parent.closest("[data-i18n-ignore]");
}

function translateDom(root, locale) {
  if (!root) return;
  const owner = root.nodeType === Node.DOCUMENT_NODE ? root.documentElement : root.ownerDocument?.documentElement;
  if (owner) owner.lang = locale;
  if (root.nodeType === Node.TEXT_NODE) {
    if (!shouldSkipTextNode(root) && root.nodeValue.trim()) {
      const source = root.__gcloudI18nSource ?? root.nodeValue;
      root.__gcloudI18nSource = source;
      const translated = replacePhrases(source, locale);
      if (translated !== root.nodeValue) root.nodeValue = translated;
    }
    return;
  }
  const walker = (root.ownerDocument || root).createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let current;
  while ((current = walker.nextNode())) nodes.push(current);
  for (const node of nodes) {
    if (shouldSkipTextNode(node) || !node.nodeValue.trim()) continue;
    const source = node.__gcloudI18nSource ?? node.nodeValue;
    node.__gcloudI18nSource = source;
    const translated = replacePhrases(source, locale);
    if (translated !== node.nodeValue) node.nodeValue = translated;
  }
  const elements = [];
  if (root.nodeType === Node.ELEMENT_NODE && (root.hasAttribute("aria-label") || root.hasAttribute("placeholder") || root.hasAttribute("title"))) elements.push(root);
  if (root.querySelectorAll) elements.push(...root.querySelectorAll("[aria-label], [placeholder], [title]"));
  for (const element of elements) {
    for (const attribute of ["aria-label", "placeholder", "title"]) {
      if (!element.hasAttribute(attribute)) continue;
      const sources = element.__gcloudI18nAttributes || (element.__gcloudI18nAttributes = {});
      const source = sources[attribute] ?? element.getAttribute(attribute);
      sources[attribute] = source;
      const translated = replacePhrases(source, locale);
      if (translated !== element.getAttribute(attribute)) element.setAttribute(attribute, translated);
    }
  }
}

export function translateText(value, locale = "en-US") {
  return replacePhrases(value, normalizeLocale(locale));
}

export function getLocaleTag() {
  return globalThis.__gcloudVmConsoleLocale || "zh-CN";
}

export function installI18n({ root = document, toggleSelector = "#languageToggle" } = {}) {
  let locale = readInitialLocale();
  let translating = false;
  const toggle = root.querySelector(toggleSelector);

  const updateToggle = () => {
    if (!toggle) return;
    const nextLabel = locale === "en-US" ? "中文" : "English";
    toggle.textContent = nextLabel;
    toggle.setAttribute("aria-label", locale === "en-US" ? "切换到中文" : "Switch to English");
    toggle.setAttribute("title", locale === "en-US" ? "切换到中文" : "Switch to English");
    toggle.dataset.locale = locale;
  };

  const apply = (nextLocale = locale) => {
    locale = normalizeLocale(nextLocale);
    globalThis.__gcloudVmConsoleLocale = locale;
    safeStorage()?.setItem(STORAGE_KEY, locale);
    translating = true;
    translateDom(root, locale);
    updateToggle();
    translating = false;
    root.dispatchEvent(new CustomEvent("localechange", { detail: { locale } }));
  };

  if (toggle) {
    toggle.addEventListener("click", () => apply(locale === "en-US" ? "zh-CN" : "en-US"));
  }
  const observer = typeof MutationObserver === "function" ? new MutationObserver((mutations) => {
    if (translating || locale !== "en-US") return;
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        const node = mutation.target;
        const source = node.__gcloudI18nSource;
        if (!source || replacePhrases(source, locale) !== node.nodeValue) node.__gcloudI18nSource = node.nodeValue;
        translateDom(node, locale);
      }
      if (mutation.type === "attributes") {
        const element = mutation.target;
        const attribute = mutation.attributeName;
        if (attribute && ["aria-label", "placeholder", "title"].includes(attribute)) {
          const sources = element.__gcloudI18nAttributes || (element.__gcloudI18nAttributes = {});
          const current = element.getAttribute(attribute) || "";
          if (!sources[attribute] || replacePhrases(sources[attribute], locale) !== current) sources[attribute] = current;
        }
        translateDom(element, locale);
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) translateDom(node, locale);
      }
    }
  }) : null;
  observer?.observe(root.body || root, { attributes: true, characterData: true, childList: true, subtree: true });
  apply(locale);
  return { getLocale: () => locale, setLocale: apply, translate: (value) => replacePhrases(value, locale) };
}
