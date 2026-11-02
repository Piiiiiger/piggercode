# hstack（开发工具）

`hstack` 是上游 Happier 自带的本地开发工具：在本机起一组中继、网页端和守护进程（一个 stack），管理 git worktree，跑类型检查和测试。PiggerCode 主要用它的 `apps/stack/bin/hstack-exec` 跑测试，用法见根目录的 README。

- 默认目录是 `~/.piggercode-stack`，每个 stack 的数据在 `~/.piggercode/stacks/<名字>`。
- `hstack piggercode <参数>` 按当前 stack 的设置运行 CLI。
- 更多用法见 `apps/stack/docs/`。那里是上游的文档，讲到托管服务、安装脚本和手机应用的部分不适用于 PiggerCode。

测试：

```bash
yarn --cwd apps/stack test:unit
yarn --cwd apps/stack test:integration
```
