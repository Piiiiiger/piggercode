<div align="center">
  <img src="apps/ui/sources/assets/images/logotype-dark@2x.png" alt="PiggerCode" width="360" />
  <p><b>在浏览器和手机上管理自己服务器上的 Codex / Claude Code 会话</b></p>
  <p>A personal fork of <a href="https://github.com/happier-dev/happier">Happier</a>, run on its own server.</p>
</div>

PiggerCode 是 [Happier](https://github.com/happier-dev/happier) 的个人分支。Codex 和 Claude Code 跑在自己的服务器上，网页端（和 Happier 官方手机 App）通过自建的中继连接它们，随时查看、发消息、审批和接着干活。会话内容端到端加密，中继只负责转发。

## 和上游 Happier 的区别

- **自己的中继**：内置服务器换成自建中继，不依赖 Happier 官方云，也没有官方云登录。
- **一个会话列表**：不再分 Happier / 直连两个标签；需要时可以从「浏览提供方会话」打开服务器上已有的 Codex 会话。
- **直接接管**：给直连会话发消息时直接在原会话里接管，只有需要停掉本地正在用的会话时才会问。
- **删除同步**：在网页端删除直连会话，会同时删除服务器上对应的 Codex 会话。
- **只有 Claude Code 和 Codex**：新建会话、设置里的服务商、欢迎页等只列这两个代理。其它代理的代码还在，在 `apps/ui/appVariantConfig.cjs` 的 `APP_BRAND.agentIds` 里加上就会出现。
- **没有原版残留**：设置的「关于」只有版本号和本仓库的 GitHub 链接；不收集使用统计和崩溃报告；没有反馈问题、更新日志、评分、原版文档链接和 Happier Voice 订阅；不会提示从 happier.dev 安装或更新原版 CLI，也不从原版仓库下载语音模型。
- **精简的仓库**：去掉了上游的文档站、官网、发布和 CI 自动化（GitHub 工作流、发布脚本、Docker 镜像）、赞助按钮和议题模板。
- **共享文件夹**：
  - 发送的附件按原文件名存到服务器上的一个文件夹（默认 `~/Downloads`），同名文件编号为 `名字 (1).扩展名`，不会覆盖；
  - 文件面板里的「共享文件夹」窗口：点文件下载，拖文件或文件夹进去上传；
  - 设置 → 附件 →「在电脑上打开」：按你的 SSH 地址生成 Linux / macOS 上用 SSHFS 挂载这个文件夹的命令。
- **命令和目录**：命令 `piggercode`（与 `happier` 等价），服务器上的主目录 `~/.piggercode`。
- **其它**：Codex 守护进程和空会话的修复、空闲会话不再显示接管横幅。

为了继续兼容官方手机 App 和上游更新，内部名称保持不变：npm 包 `@happier-dev/*`、环境变量 `HAPPIER_*`、链接协议 `happier://`、项目内的 `.happier/uploads` 等。

只维护 Linux 和 macOS。

## 组成

| 目录 | 作用 |
| --- | --- |
| `apps/ui` | 网页端（Expo / React Native Web），也是手机和桌面端的代码 |
| `apps/cli` | CLI 和守护进程：在服务器上启动、托管代理会话，处理文件传输 |
| `apps/server` | 中继服务器 |
| `packages/*` | 共享的协议、传输和工具代码 |

## 构建

需要 Node 22 和 Yarn 1.22。

```bash
yarn install --frozen-lockfile

# 网页端
cd apps/ui
APP_ENV=production HAPPIER_EMBEDDED_POLICY_ENV=production EXPO_UNSTABLE_WEB_MODAL=1 \
  yarn -s expo export --platform web --output-dir dist

# CLI
yarn workspace @happier-dev/transfers build
yarn workspace @happier-dev/cli build
```

测试和类型检查：

```bash
cd apps/ui  && ../../apps/stack/bin/hstack-exec -- node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts
cd apps/cli && ../../apps/stack/bin/hstack-exec -- node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts
yarn -s typecheck   # 分别在 apps/ui、apps/cli 里运行
```

## 部署（概要）

1. 在服务器上安装 Happier CLI 和自托管中继，用 systemd 用户服务运行守护进程和中继。
2. 把构建出的 CLI 文件覆盖到 CLI 的 `package-dist`，重启守护进程；正在运行的会话会自动重新接上。
3. 把网页端的构建结果交给中继（`HAPPIER_SERVER_UI_DIR`）或前面的反向代理提供静态文件。

## 分支

开发都在 `pigger` 分支上；`dev` 跟随上游。

## 许可

MIT，见 [LICENCE](LICENCE)。PiggerCode 基于 Happier，版权声明保留原样。
