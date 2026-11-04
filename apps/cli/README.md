# PiggerCode CLI

PiggerCode 的命令行和守护进程。它在你的服务器上启动并托管 Claude Code 和 Codex 会话，再通过你自己的中继把会话交给网页端。

## 构建和安装

需要 Node 22 和 Yarn 1.22。在仓库根目录执行：

```bash
yarn install --frozen-lockfile
yarn workspace @piggercode/transfers build
yarn workspace @piggercode/cli build
```

命令入口是 `apps/cli/bin/piggercode.mjs`，把它链接到 `PATH` 里的目录即可：

```bash
ln -s "$PWD/apps/cli/bin/piggercode.mjs" ~/.local/bin/piggercode
```

## 连接中继

```bash
piggercode setup --relay https://<你的中继地址>
```

也可以在环境变量 `PIGGERCODE_BUILTIN_RELAY_URL` 里给出默认中继。中继地址不写在代码里。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `piggercode` | 在当前目录开一个 Claude Code 会话 |
| `piggercode codex` | 在当前目录开一个 Codex 会话 |
| `piggercode auth login` | 登录，把这台机器连到你的账户 |
| `piggercode service install` | 安装守护进程的 systemd 用户服务（macOS 上是 launchd） |
| `piggercode daemon status` | 查看守护进程 |
| `piggercode session list` | 列出会话 |
| `piggercode attach <会话 id>` | 在终端里接上正在运行的会话 |
| `piggercode resume <会话 id>` | 恢复已经停止的会话 |
| `piggercode doctor` | 诊断 |

`piggercode --help` 列出全部命令，每个子命令也都有 `--help`。

开会话时可以带权限参数：`--auto` 自动批准读文件和改文件，`--yolo` 跳过所有权限确认，`--permission-mode read_only` 只读。

## 目录和名字

- `~/.piggercode`：配置、凭据、日志和守护进程状态。用 `PIGGERCODE_HOME_DIR` 可以换位置。
- 守护进程的 systemd 用户服务叫 `piggercode-daemon.<实例>`，默认实例是 `default`；macOS 上的 launchd 标签是 `com.piggercode.cli.daemon.<实例>`。
- 远程执行命令：在网页的电脑详情页打开「远程命令」开关（或在那台电脑上运行 `piggercode machine remote-commands on`）后，同一账户下其他电脑上的 Claude Code 或 Codex 可以用 `machine_command_run` 工具在这台电脑上执行 shell 命令（类似 `ssh 主机 命令`），以运行 PiggerCode 的那个用户身份执行。默认关闭；网页开关或 `piggercode machine remote-commands off` 随时关掉，`status` 查看当前状态。网页开关只在那台电脑在线时可用。
- 共享文件夹：在网页的电脑详情页「共享文件夹」里选一个文件夹，共享给同一账户下的另一台电脑（服务器）。它会出现在服务器的 `~/local/<电脑名>/` 下，服务器上的 Claude Code 或 Codex 直接读写这些文件，编译、测试和 git 通过远程命令在这台电脑上执行。这台电脑目前要是 Linux，并装有 OpenSSH 和 bubblewrap；服务器要装 sshfs，并在服务器上运行一次 `piggercode machine shared-folders address <主机[:端口]>`，告诉它其他电脑通过什么 SSH 地址连到它。`piggercode machine shared-folders status` 查看接受了哪些电脑、挂载了什么。
- 从改名前的版本升级时，`piggercode service install` 会停掉并删除同一个家目录里旧名字的同一个服务（`happier-daemon.<实例>`，macOS 上是 `com.happier.cli.daemon.<实例>`），`~/.happier` 链接到 `~/.piggercode` 的情况也算同一个家目录。别的家目录里的旧服务不动。
- 智能体看到的内置 MCP 服务叫 `piggercode`，工具名是 `mcp__piggercode__*`。旧会话里的 `mcp__happier__*` 工具调用照常显示。
- 网页端上传的附件默认存到服务器上的 `~/Downloads`，可以在设置里改。

## 测试

```bash
yarn --cwd apps/cli test:unit
yarn --cwd apps/cli test:integration
yarn --cwd apps/cli test:slow
yarn workspace @piggercode/cli typecheck
```

只维护 Linux 和 macOS。
