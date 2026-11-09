# dsh-session-mode-indicator

Left-sidebar indicator for the mode (agent preset) each Session runs under.

[English](README.md) | **简体中文**

![左侧栏模式胶囊](docs/mode-badge-preview.png)

每个会话开启后模式固定、不能切换。插件给左侧栏的会话行加一条元数据：带彩色圆点和模式名的小胶囊，圆点颜色就是模式。

![模式圆点设置页](docs/settings-preview.png)

## 安装方法

前置条件：已安装带插件管理器的 DeepSeek Harness（桌面版或 Web profile）。
`plugin_manager` 工具随「标准」「创造」预设提供；安装作用于整个 profile，
该 profile 下的所有会话都会加载这个插件。
已在 DeepSeek Harness Desktop `0.2.2-rc.1`（Windows）上验证。

1. 获取代码，并把文件夹留在原地——本地 bundle 是链接安装的，装完不要删除目录：

   ```bash
   git clone https://github.com/bailishta/dsh-sidebar-mode-indicator.git
   ```

   （直接下载 ZIP 解压也可以。）

2. 在任意 DSH 会话里让 agent 安装。不要手动改 profile 的 `package.json` 或
   `cordis.patch.yml`——安装包、选择 bundle、更新补丁都由插件管理器完成：

   > 用 `plugin_manager` 的 `install_bundle`，target 填
   > `C:\path\to\dsh-sidebar-mode-indicator`（这个文件夹的绝对路径）。

   安装需要会话处于 `danger-full-access` 权限模式，或对该次调用单独批准。
   也可以直接让 agent 从仓库地址安装（`install_bundle` 接受 GitHub/git 源）。

3. 返回结果里应看到 `application: applied`、`enabled: true`。有 HMR 时无需重启；
   没有 HMR 的 profile 需要重启 DSH 才会出现侧栏标记和设置页。

4. 验证：左侧栏每个会话行出现模式胶囊，设置里出现 **模式圆点** 页面。

没有构建步骤：插件是纯 ESM JavaScript，不需要 `pnpm install` 或编译。

**升级** — 在目录里 `git pull`，然后在 DSH 里先 `plugin_manager` `remove_bundle`
再 `install_bundle` 同一个路径：替换已安装的包需要新的客户端模块；没有 HMR 的
profile 还需要重启。

**卸载** — 用 `plugin_manager` `remove_bundle`，target 填
`dsh-session-mode-indicator`；或在侧栏「插件」页把该 bundle 关掉。

## 模式不是写死的

- 4 个内置模式（标准、PTC、创造、极简）使用本地化名称和默认颜色。
- 其余预设一律视为自定义模式。只有当它仍是当前 profile 里的声明，或被**未归档且非空白**的会话使用时，才会计入列表和配色；已弃用的预设、已归档或空白会话里的测试模式不再显示，它们占用的自动配色也会被释放。
- 新模式第一次出现时自动上色：用模式 id 做 FNV-1a 哈希在鲜艳色板里取起点，向后探测已占用的颜色，尽量做到一色一模式；结果会固化保存在浏览器里，重启后颜色不变。
- 自定义模式优先显示预设声明的名称；没有名称时显示「自定义」（靠颜色区分）。

出现新模式不需要改这个插件的任何代码。

## 设置

设置 → **模式圆点**（在 Agent 预设下面）包含：

- **显示模式圆点**：控制侧栏胶囊里的圆点是否显示。
- **内置模式 / 自定义模式**：每个模式一行，带当前色预览、10 个预设色、系统取色器；自定义模式还会显示完整 id。
- **刷新**：重新读取当前 profile 的预设列表，新装的预设不用重启就能出现。
- **恢复默认颜色**：清除手动色并重新推导自动色。

偏好保存在当前 Web 客户端的 `localStorage`（`dsh.session-mode-indicator.settings.v1`，结构版本 2；旧的 v1 `colors` 结构会在读取时迁移）。

## 给后续模式留的接口

插件提供 Client 服务 `sessionModeIndicator`。知道某个模式显示名、或想给它预留颜色时，可以在使用前注册：

```js
export const inject = ['sessionModeIndicator']

export function apply(ctx) {
  ctx.effect(() =>
    ctx.sessionModeIndicator.registerMode({
      id: 'my-mode',        // 必填，与预设 id 一致
      name: 'My mode',      // 可选，显示名（不填则显示为「自定义」）
      color: '#4f8cff',     // 可选，预留 #rrggbb 颜色
    }),
  )
}
```

`registerMode` 返回 disposer（在 `ctx.effect` 里注册会自动随插件卸载释放）。服务还提供 `getModes()`（当前 `{ id, name, color, builtin, contributed }` 列表）和 `subscribe(fn)`。贡献只在提供方插件加载期间生效；没有贡献时自动配色照常工作。

## 文件

- `client.js` — 全部界面逻辑：侧栏胶囊、设置分区页、配色模型、对外服务。
- `index.js` / `cordis.patch.yml` — Host 插件行与 bundle 补丁。
- `locale/*.json` — 插件管理器里的标题与描述。
- `docs/mode-badge-preview.png` — 侧栏预览。
- `docs/settings-preview.png` — 设置页预览。
