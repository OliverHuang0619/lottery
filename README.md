# 彩票分析同步目录

## 聊天工作台与 Docker

已增加聊天前端、鉴权 API、SQLite 会话/任务存储、Codex CLI 执行器与 SSE 进度推送。侧栏可切换原有数据仪表板，“获取并分析”默认读取指定开奖网站，再调用仓库技能完成复盘与预测。

历史会话支持首条消息自动命名和确认后删除；运行中任务所在会话受保护。

部署方法和配置见 [DEPLOY.md](DEPLOY.md)。复制 `.env.example` 到 `.env`，设置访问令牌与 Codex 身份后执行 `docker compose up -d --build`，访问 `http://localhost:4173`。

此目录是技能与历史记录的云端同步源，建议保存到私有 Git 仓库。

## 目录职责

- `skill/analyze-lottery-history/`：可安装的完整技能源文件。
- `data/current/`：当前最新开奖记录与分析结果；后续预测只使用这里的数据。
- `data/archive/`：旧版数据快照，只用于追溯。
- `predictions/`：开奖前保存的预测；每期新建文件，禁止覆盖旧文件。
- `reviews/`：开奖后的复盘记录；每期新建文件。
- `scripts/install-skill.ps1`：将仓库内的技能安装到当前 Windows 用户的 Codex 目录。
- `scripts/install-skill.sh`：将仓库内的技能安装到当前 macOS / Linux 用户的 Codex 目录。

## 每期更新顺序

1. 保存新开奖结果并更新 `data/current/records.json`。
2. 把新的走势分析写入 `data/current/analysis.json`。
3. 在 `reviews/` 新建对应期号的复盘文件。
4. 在 `predictions/` 新建下一期预测文件。
5. 提交并推送：

```bash
git add skill data predictions reviews
git commit -m "Review issue 088 and predict issue 089"
git push
```

## 换电脑恢复技能

### Windows

在此目录打开 PowerShell 后运行：

```powershell
.\scripts\install-skill.ps1
```

### macOS / Linux

在此目录打开终端后运行：

```bash
chmod +x scripts/install-skill.sh   # 首次需要
./scripts/install-skill.sh
```

脚本会复制到 `$HOME/.codex/skills/analyze-lottery-history`。如果目标技能已存在，脚本会先在本目录的 `backups/` 中创建时间戳备份，再覆盖安装。可通过环境变量 `CODEX_HOME` 覆盖默认的 `~/.codex` 路径。

## 云端安全

- 仓库设置为 Private。
- 不提交密码、令牌、私钥或 `.env`。
- 不修改已经开奖期次对应的历史预测文件；需要纠错时新建更正文件并说明原因。

## GitHub Pages 部署

仓库包含 `.github/workflows/deploy-pages.yml`。推送 `dashboard/`、`data/`、`predictions/` 或 `reviews/` 的变更到 `master` 后，GitHub Actions 会：

1. 根据仓库中的最新记录、预测和复盘生成 `dashboard.json`；
2. 构建 React/Vite 前端；
3. 把 `dashboard/dist` 发布到 GitHub Pages。

首次使用时，在 GitHub 仓库的 **Settings → Pages → Build and deployment** 中将 Source 设置为 **GitHub Actions**。之后每次数据提交都会自动更新站点。

本地 `pnpm start` 仍会动态提供 `/dashboard.json`；GitHub Pages 则读取构建时生成的静态快照。

## 版本管理

软件版本由仓库根目录的 `VERSION` 统一管理，并遵循语义化版本 `主版本.次版本.修订版本`。发布时同时更新 `VERSION` 与 `dashboard/package.json`；`pnpm build` 会检查两处版本一致，避免发布错误版本。前端品牌区、登录页、`/api/config` 和 `/api/health` 都会显示或返回当前版本。
