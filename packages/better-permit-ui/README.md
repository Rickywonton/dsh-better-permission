# better-permit-ui

`better-permit` 的浏览器半区（Host 行为全在那边）：

- `client.js` — 两处界面：
  1. **审批弹窗详情**：命令文本、风险徽标（只读/写入/删除/系统层/对外发布…）、本档位为什么询问，
     以及两个快捷按钮：**「本对话总是允许这条命令」**（把签名记进本对话放行规则）与
     **「信任此文件夹并允许本次（仅本对话）」**。两者都会在写入成功后直接放行本次调用。
  2. **设置页「权限与信任」**：档位与自动放行范围表、风险分级图例、全局受信文件夹、单对话受信文件夹、
     本对话放行规则（逐条移除/清空）、各对话概览、配置里的信任清单、最近自动放行记录。
- `index.js` — 空壳 Host 半区，只为让本包在 Loader 里有一行处于激活状态，浏览器 bundle 才会被扫描并加载。

所有数据都通过主插件的 `/better-permit/approval/*` 端点读写；这里不保存任何状态。

## 为什么单独成包

`dsh-client-modules` 按「Loader 行名 + baseUrl」缓存每个包的 `dsh.client` 扫描结果，且没有失效路径
（没有重新扫描的代码）。主插件在安装时还没有 `dsh.client` 声明，于是那份 `null` 被永久缓存，
之后怎么重载都不会加载它的浏览器代码。浏览器半区独立成包、装上去就是首次扫描，所以立刻生效。

## 槽位

- `conversation.approval.detail`（single）：注册在 **priority -1**，遮蔽内置的命令预览组件
  （它占 priority 0，规则是「优先级最低的渲染」），因此这个组件自己画命令文本。
- `settings.section`（list）：`id: 'better-permit'`，`order: 50`，出现在设置页导航里，标题「权限与信任」。

## 注意事项（踩过的坑）

- **快照 hook 必须传选择器**：`props.useSessions` / `props.useSessionStatus` 是
  `useSnapshotSelector(selector)` 的形状，内部会执行 `selector(snapshot)`。当可选参数用（`props.useSessions()`）
  会抛 `TypeError: selector is not a function`；React 会吞掉整个区块 → 设置页看起来是空白，
  而且因为渲染从未提交，取数据的 `useEffect` 一次都不会跑。正确写法是传一个稳定的选择器：
  `const selectAll = (value) => value`（模块级常量），然后 `props.useSessions(selectAll)`。
- 注册 registration 时 `inject` 的返回值会并进 props（本页用 `inject: () => ({ pick })` 拿目录选择器）。

## 开发

```pwsh
node test/client.smoke.mjs   # 冒烟：模块可求值、两个槽位注册、面板各区块渲染、审批详情两个按钮真的发出请求
```

冒烟测试用一个小的 hooks 引擎真跑组件（含 `/panel`、`/detail` 的 fetch 桩），所以改完界面跑一遍
就能发现渲染期异常。

改完 `client.js` 后重载本包（`plugin_manager set_bundle` 关→开）并刷新页面——客户端 bundle 不会自动热更。
