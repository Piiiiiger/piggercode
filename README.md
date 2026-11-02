<div align="center">
  <img src="apps/ui/sources/assets/images/logotype-dark@2x.png" alt="PiggerCode" width="360" />
  <p><b>在浏览器里管理自己服务器上的 Claude Code 和 Codex 会话</b></p>
</div>

PiggerCode 是一个自托管、自用的工具。Claude Code 和 Codex 跑在你自己的服务器上，网页端通过你自己的中继连上它们：看会话、发消息、审批权限、接着干活，在电脑和手机浏览器上都能用。会话内容端到端加密，中继只负责转发。

它基于开源项目 [Happier](https://github.com/happier-dev/happier)，去掉了官方云、使用统计、反馈渠道和用不到的代理，只留下自己需要的部分。

## 功能

- **文件夹视图**：侧栏像 VS Code 的资源管理器，按服务器上的文件夹列出会话，在哪个文件夹里开的会话就在哪里。可以在任意文件夹新建会话，右键新建、重命名、删除文件夹，也可以把某个文件夹设为顶层。
- **文件管理**：在「会话 | 文件」之间切换。文件视图里可以浏览服务器上的文件，预览文本（带语法高亮）和图片，复制路径、下载、重命名、删除。
- **只有 Claude Code 和 Codex**：新建会话、代理选择和设置里只列这两个。
- **账号密码登录**：在「设置 → 账户 → 用户名和密码」里设好之后，任何浏览器都能用用户名和密码登录，登录一次就会记住。密码只在浏览器里用来解开账户密钥，不会发给中继。设置之前需要先用密钥登录一次。
- **直连会话**：可以打开服务器上已有的 Codex 会话；发消息时直接在原会话里接管，删除时同步删掉服务器上的会话。
- **共享文件夹**：发送的附件按原文件名存到服务器上的一个文件夹（默认 `~/Downloads`），同名文件自动编号，不会覆盖。网页里可以上传下载，也能按设置里给出的命令用 SSHFS 挂载到自己的电脑。
- **干净**：没有使用统计、崩溃上报、应用评分、更新日志、反馈和原版文档链接，也不会从原版的服务器或仓库下载任何东西。

## 组成

| 目录 | 作用 |
| --- | --- |
| `apps/ui` | 网页端（Expo / React Native Web），也包含手机和桌面端的代码 |
| `apps/cli` | CLI 和守护进程：在服务器上启动、托管代理会话，处理文件传输 |
| `apps/server` | 中继服务器 |
| `apps/stack` | 本地开发和测试用的工具 |
| `packages/*` | 共享的协议、传输和工具代码 |

## 构建

需要 Node 22 和 Yarn 1.22。

```bash
yarn install --frozen-lockfile

# 网页端
cd apps/ui
APP_ENV=production PIGGERCODE_EMBEDDED_POLICY_ENV=production EXPO_UNSTABLE_WEB_MODAL=1 \
  yarn -s expo export --platform web --output-dir dist

# CLI
yarn workspace @piggercode/transfers build
yarn workspace @piggercode/cli build
```

测试和类型检查：

```bash
cd apps/ui  && ../../apps/stack/bin/hstack-exec -- node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts
cd apps/cli && ../../apps/stack/bin/hstack-exec -- node ../../node_modules/vitest/vitest.mjs run
yarn -s typecheck
```

## 配置

- 应用名、版本号、提供哪些代理和仓库链接都在 `apps/ui/appVariantConfig.cjs` 的 `APP_BRAND` 里。
- 中继的地址不写在代码里。网页端直接使用自己所在的网址；CLI 用 `setup --relay <中继地址>` 连接，或者在环境变量 `PIGGERCODE_BUILTIN_RELAY_URL` 里给出默认中继；手机端在构建时用 `EXPO_PUBLIC_PIGGERCODE_SERVER_URL` 指定。
- 生产构建默认关闭的功能列在 `.github/feature-policy/production.json`。

## 部署（概要）

1. 在服务器上用 systemd 用户服务运行中继和守护进程。
2. 把网页端的构建结果交给中继（`PIGGERCODE_SERVER_UI_DIR`）或前面的反向代理提供静态文件。
3. 用反向代理加上 HTTPS 对外访问；中继只需要监听本机。
4. 自己的账户建好以后，在中继的环境变量里设置 `AUTH_ANONYMOUS_SIGNUP_ENABLED=false`，别人就不能在你的中继上注册。

只维护 Linux 和 macOS。

## 许可

MIT，见 [LICENCE](LICENCE)。PiggerCode 基于 Happier，保留原项目的版权声明。
