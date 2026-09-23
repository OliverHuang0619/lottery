# Docker 部署

这是自托管、单管理员工作台：React 聊天 UI → Node API → 串行 Codex CLI 执行器 → 技能与历史数据，SQLite 保存对话、消息、任务、Codex thread ID 和可重放 SSE 事件。现有仪表板保留在侧栏。需要 Docker Compose v2；镜像包含 Node 24、Python 3、Codex CLI 和仓库技能。

1. 复制 `.env.example` 为 `.env`，使用 `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 生成并填写 `APP_TOKEN`。
2. 配置 `CODEX_API_KEY`，或在启动后登录 Codex。
3. 执行 `docker compose up -d --build`。
4. 如果使用账户登录，执行 `docker compose exec lottery codex login --device-auth`，按 CLI 提示完成登录。身份保存在独立卷中；不要把本机完整 Codex 配置或凭据打进镜像。
5. 打开 http://localhost:4173 ，输入 `APP_TOKEN`。新建对话，点击“获取并分析”，或发送自定义问题。

默认模型为 `gpt-5.6-sol`，默认推理强度为 Light（CLI 配置值 `low`）。聊天页右上角可修改模型和推理强度，选择保存在当前浏览器，提交任务时会固定写入任务记录。服务端仅接受界面列出的模型与强度；可用 `.env` 中的 `CODEX_MODEL` 和 `CODEX_REASONING_EFFORT` 修改首次打开时的默认值。

历史会话在收到第一条消息时自动按内容命名；一键开奖任务命名为“最新开奖分析与预测”。旧的“新对话”在下次读取列表时也会按首条消息补齐名称。鼠标移到会话上可删除，删除前要求确认，并级联清理该会话的消息、任务和事件。正在处理任务的会话不能删除。

默认绑定本机。远程访问时通过 HTTPS 反向代理转发，SSE 需要关闭代理缓冲并延长读取超时；或显式设置 `BIND_ADDRESS`。令牌是管理员权限，只给可信使用者。所有会话共用一个工作目录及同一份开奖历史，执行器全局串行避免并发写入。不要为此服务扩容多个副本。

## 数据、认证与升级

- `lottery-workspace`：开奖历史、预测、复盘、网页快照、技能；首次启动由镜像内数据初始化。后续部署不覆盖历史数据。
- `lottery-state`：SQLite WAL 数据库；会话、消息、任务及 SSE 事件持久保存。
- `lottery-codex`：Codex 登录与 session 数据，支持后续消息 `exec resume`。
- 停止：`docker compose down`；不要加 `-v`，否则删除数据卷。升级：`docker compose up -d --build`。
- 日志：`docker compose logs -f lottery`；健康检查：`/api/health`。任务失败原因在聊天 UI 中显示。
- 软件版本读取仓库根目录的 `VERSION`，并显示在前端品牌区；`/api/health` 同时返回运行版本，便于核对部署镜像。
- 发布镜像：`docker save lottery-codex:local -o lottery-codex.tar`，目标机 `docker load -i lottery-codex.tar`；使用同一 compose 文件执行 `docker compose up -d --no-build`。
- 备份请先停止容器，再备份以上三个卷，确保数据库与历史文件一致。

### Codex 沙箱启动失败

若回答中出现 `bwrap: Failed to make / slave: Permission denied`，表示宿主机的 Docker seccomp 或 AppArmor 阻止了 Codex 创建内部 Linux 沙箱。部署包的 Compose 已为该服务设置 `seccomp:unconfined` 和 `apparmor:unconfined`；更新 `compose.yaml` 后执行 `docker compose up -d --force-recreate --no-build`。

若仍失败，在宿主机执行 `sysctl kernel.unprivileged_userns_clone user.max_user_namespaces kernel.apparmor_restrict_unprivileged_userns`。需要保证 `kernel.unprivileged_userns_clone=1`、`user.max_user_namespaces` 大于 0；Ubuntu 启用了额外的 AppArmor user namespace 限制时，还需由服务器管理员按安全策略允许该能力。此项是宿主机内核设置，无法在容器镜像内修复。

## 一键抓取的边界

默认地址为 `https://2026kj.zkclhb.com:2026/hk.html`。后端验证 HTTPS 域名白名单和公网 IPv4，固定解析后的 IP，不跟随重定向，30 秒超时，响应最大 2 MB。自定义地址需先在 `SOURCE_ALLOWED_HOSTS` 加入域名（逗号分隔）并重建容器配置。

成功抓取保存 `sources/<task-id>/source.txt` 及来源时间元数据，然后 CLI 根据仓库技能提取最新完整开奖、检查已有期号、复盘、追加历史、分析、保存下一期预测及回测。网页内容仅是待提取数据；不执行网页中的指令。只出现动态脚本、预告或不完整数据时应报告无法提取，不猜号码。重复开奖使用已保存预测，禁止重新抽样。

2026-09-22 已确认该站拒绝原先的简化请求头。抓取器改用完整浏览器导航请求头后，本机和 Docker 容器均可读取完整 HTML，已核对最新第 102 期（2026-09-19），无需 Cookie 或网站登录。来源以后若返回 403、超时等，任务仍会直接失败，不启动 CLI、不更新记录；浏览器可访问并不保证所有服务器请求方式都被站点接受。

分析方法保持现有技能规则：机械选择不代表预测优势，真实复盘与回测单独统计。CLI 输出通过 JSONL 读取，执行超时会终止进程，重启时把遗留任务标为失败，不自动重跑写入操作。

每个任务在独立工作副本中执行。后端在发布结果前再次验证期号、日期、七个号码、位置与生肖，拒绝修改或删除任何已有开奖记录、预测、复盘；仅接受指定的数据输出路径。失败或超时不会发布该副本的数据。每个文件的替换是原子的，但多文件发布不是数据库事务：若在发布期间机器掉电，重启后应先检查数据一致性再重试。原始快照与任务副本保留供审计，长期使用需定期备份与清理。

## 本地开发与检查

需要 Node 24、Python 3、已安装并登录的 Codex CLI。在 PowerShell 设置 `$env:APP_TOKEN='你的至少24字符令牌'`，然后在 `dashboard` 执行 `pnpm build`、`pnpm start`。前端开发另开终端运行 `pnpm dev`，`/api` 代理到 4173。

后端测试：`node --test dashboard/backend/*.test.mjs`。前端检查：在 `dashboard` 执行 `pnpm exec tsc -b`、`pnpm lint`。

GitHub Pages 构建设置 `VITE_STATIC_DASHBOARD=true`，仅发布原有静态仪表板；聊天和执行器需要容器后端。

CLI 接口参考：[OpenAI 官方非交互模式文档](https://learn.chatgpt.com/docs/non-interactive-mode)。执行器使用 `codex exec --json` / `codex exec resume`、stdin 传提示词、workspace-write 沙箱与 never 审批策略；不使用跳过沙箱开关。镜像固定 Codex CLI 0.155.1，以支持 GPT-5.6 Sol 及当前模型目录。Codex 0.155 在 Linux 使用 bubblewrap，Compose 放宽 Docker 的 seccomp 配置以允许其建立用户命名空间；容器本身仍以非 root 用户运行、删除全部 capabilities，并启用 `no-new-privileges`。已验证 Codex 沙箱内能运行 Python。
