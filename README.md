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
- **账号密码登录**：在「设置 → 账户 → 用户名和密码」里设好之后，任何浏览器都能用用户名和密码登录，登录一次就会记住。密码只在浏览器里用来解开账户密钥，不会发给中继。在一台已经登录的设备上设置一次即可；忘了密码时，用任何一台还登录着的设备重新设置。应用不再显示账户密钥，也不再提醒备份。
- **直连会话**：可以打开服务器上已有的 Codex 会话；发消息时直接在原会话里接管，删除时同步删掉服务器上的会话。
- **共享文件夹**：发送的附件按原文件名存到服务器上的一个文件夹（默认 `~/Downloads`），同名文件自动编号，不会覆盖。网页里可以上传下载，也能按设置里给出的命令用 SSHFS 挂载到自己的电脑。
- **桌面版**：macOS、Windows、Linux 安装包在本仓库的 Releases 里。第一次打开时填一次中继地址并登录，在应用里就能把这台电脑接入（它会装好后台服务，菜单栏或托盘里有图标）。这样接入的电脑不运行 Claude Code 和 Codex，它们只在服务器上跑；电脑只给服务器共享文件夹、执行远程命令。macOS 和 Linux（AppImage）有新版本时会在应用里提示，点一下就能更新。
- **远程命令**：在电脑详情页打开「远程命令」开关后，同一账户下其他电脑上的 Claude Code 或 Codex 可以在这台电脑上执行 shell 命令，类似 `ssh 主机 命令`。默认关闭，打开前会确认。
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

发布（GitHub Releases）：

- CLI：`node scripts/pipeline/release/build-cli-binaries.mjs --version <版本> --targets linux-x64,darwin-arm64,darwin-x64,windows-x64` 在 `dist/release-assets/cli` 里生成各平台的压缩包和 `checksums-happier-v<版本>.txt`。用发布密钥给校验和文件签名（`minisign -S`，或者构建时设 `MINISIGN_SECRET_KEY`），再把它们传到 `cli-stable` 发布里。CLI 的自动更新和桌面版的「接入这台电脑」都从这里下载，并用 `packages/release-runtime/src/minisign.ts` 里的公钥校验签名。
- 桌面版：在 Actions 里手动运行 `Desktop app`（`.github/workflows/desktop.yml`），填上发布的 tag，就会构建 macOS（Apple 芯片、Intel）、Windows、Linux 安装包并上传。安装包没有付费签名：macOS 第一次打开要在「隐私与安全性」里点「仍要打开」，Windows 会提示一次 SmartScreen。应用内更新读取这个发布里的 `latest.json`：构建完成后，用发布密钥给 Linux 的 AppImage 和 macOS 的 `.app.tar.gz` 签名（minisign 签名再做 base64），把签名和下载地址写进 `latest.json` 再上传。公钥就是 `tauri.conf.json` 里的 `updater.pubkey`。
- 安卓版：在 Actions 里手动运行 `Android app`（`.github/workflows/android.yml`），`release_tag` 填 `ui-android-stable`，就会构建用发布密钥签名的 arm64 APK；模拟器冒烟测试通过后才把 APK 上传到这个发布，接着写入 `latest.json`（版本号、下载地址、大小）。装好的应用在启动时、回到前台时（距上次检查满一天）和「设置 › 关于 › 检查更新」时读取它，有新版就把 APK 下载到应用缓存，再交给安卓的安装界面原地更新（同一个包名和签名、更高的 versionCode，数据保留）。安卓不允许商店以外的应用静默安装：要在安装界面点一下确认，第一次还要允许 PiggerCode「安装未知应用」。

测试和类型检查：

```bash
cd apps/ui  && ../../apps/stack/bin/hstack-exec -- node ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts
cd apps/cli && ../../apps/stack/bin/hstack-exec -- node ../../node_modules/vitest/vitest.mjs run
yarn -s typecheck
```

## 配置

- 应用名、版本号、提供哪些代理和仓库链接都在 `apps/ui/appVariantConfig.cjs` 的 `APP_BRAND` 里。
- 中继的地址不写在代码里。网页端直接使用自己所在的网址；CLI 用 `setup --relay <中继地址>` 连接，或者在环境变量 `PIGGERCODE_BUILTIN_RELAY_URL` 里给出默认中继；手机端和桌面端可以在构建时用 `EXPO_PUBLIC_PIGGERCODE_SERVER_URL` 指定，没有指定时第一次打开会请你填中继地址（Releases 里的桌面版就是这样）。
- 生产构建默认关闭的功能列在 `.github/feature-policy/production.json`。

## 部署（概要）

1. 在服务器上用 systemd 用户服务运行中继和守护进程。
2. 把网页端的构建结果交给中继（`PIGGERCODE_SERVER_UI_DIR`）或前面的反向代理提供静态文件。
3. 用反向代理加上 HTTPS 对外访问；中继只需要监听本机。
4. 自己的账户建好以后，在中继的环境变量里设置 `AUTH_ANONYMOUS_SIGNUP_ENABLED=false`，别人就不能在你的中继上注册。

只维护 Linux 和 macOS。

## 许可

MIT，见 [LICENCE](LICENCE)。PiggerCode 基于 Happier，保留原项目的版权声明。
