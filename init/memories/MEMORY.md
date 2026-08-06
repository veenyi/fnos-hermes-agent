# 长期记忆（MEMORY.md）

> Hermes Agent 的经验与规则，每次对话自动注入。

## 用户是谁

用户 **veenyi（紫寒，广东江门）**，飞牛 NAS 第三方应用 **fnos-hermes-agent** 的维护者，开源仓库 veenyi/fnos-hermes-agent，当前版本 v0.21.84。

千问办公 hermes-webui 仓库在 `/root/hermes-webui`，与 fnos-hermes-agent 是两个不同项目。

## 运行环境

- 平台：飞牛 NAS fnOS（Debian 深度定制，行为与标准 Debian 有大量差异，以实际表现为准）
- 应用用户：`hermes-agent`
- 双机：
  - **102（192.168.3.102，@vol1）** — 用户自用，**只读，绝不动**
  - **249（192.168.3.249，@vol3）** — 测试机，可随意操作
- 当前环境：249 测试机，TRIM_PKGHOME=`/vol3/@apphome/hermes-agent`，PWD=`/tmp/...` 可能因任务变化
- 源码：`/root/fnos-hermes-agent`（app 分支 / hermes-ai 分支）
- FPK 构建：`/root/fnos-hermes-agent/build/out/fnos-hermes-agent.fpk`
- WebDAV 同步：`/root/fnos-hermes-agent/dist/fnos-hermes-agent`

## 双 NAS 验证铁律

1. 每次版本变更必须 **先 102 + 249 双机验证**，通过后才可发布
2. **发布 / GitHub push / Release 必须等你显式确认**，绝不擅自执行（v0.22.1 擅发被撤回是血泪教训）
3. FPK 构建后必须同步 **WebDAV + 分享直链**，通道不可混用（WebDAV 文件走 WebDAV 上传，分享链接文件走分享链接下载）

## fnOS 开发铁律

1. **凭证绝不进代码**（曾发生 alist 密码泄露事件，强烈建议你改密）
2. 后端接口先查 `custom_routes.js` 是否被拦截
3. UI 字段改动后**必须重启 Agent 进程**才生效
4. YAML 配置用专用函数写入，别手拼
5. 应用默认简体中文
6. 需求清晰时直接开工，不追问

## 开发/部署经验

- **持久化三查**：POST 落盘 → GET 读回 → 刷新重启保留（验证三件套）
- 文件写入后用 `stat` 验证（不是 `ls`，fnOS overlay 可能欺骗 ls）
- 应用升级：只覆盖 target/、cmd/、config/、manifest，venv 和数据在 PKGHOME 中保留
- 系统没有全局 python/pip，用 `uv`（已在 PATH）做所有 Python 操作
- fnOS 回收站：`/vol<N>/<uid>/.@#local/trash/`，无 `.trashinfo` 文件
- `file.rm` 的 `moveToTrashbin=True` 实测可能直接永久删除
- fnOS Docker 配置 `/etc/docker/daemon.json` 由系统管理，CLI 直接改会导致容器丢失
- 前端渲染能力：`[qr](url)` 渲染二维码按钮，`MEDIA:/path` 内联图片（.png/.jpg/.jpeg/.gif/.webp/.bmp ≤5MB），`/tmp/`、`/workspace/`、`/data/` 为 HTTP 路由

## 历史事件（血泪教训）

- **v0.22.1 擅发被撤回**：未在双机验证、用户未确认的情况下发布，教训深刻
- **alist 密码泄露**：凭证意外进入代码/发布物，强烈建议改密
- **kimi-k2-thinking-vision 模型 501 POST**：hermes 内部 HTTP 客户端不支持 streaming，`--stream` 会导致 501，须 `--no-stream`
- **501 POST 修复**：`monitor.js` 加 5 秒超时兜底，`custom_routes.js` 改 `POST /api/ws/healthz` 为 `GET`

## 待你确认的决策

- **版本线选择**：现有两个升级方案
  - **v0.22 方案**（基于 v0.20.0 内核 FPK 适配）：语音对话 P0，版本线跳 0.22.0
  - **v2 方案**（Octop 风格专家系统重构 + 唤醒词 + 全双工）：版本线沿 0.21.3x
  - 两个方案内容都已消化，版本线等你定
- ** alist / 各服务密码**：建议尽快改密

## skills 目录结构

- 已导入 **81 个扁平技能**到 `skills/` 顶层
- **16 个原有分类目录**保留不动（autonomous-ai-agents、creative、github、mlops 等）
- `productivity` 同名避让为 `imported-productivity`（仅含 knowledge-base 素材库）
- 扁平技能与分类技能并存，后续新增扁平技能一律放顶层，不新建分类目录
- 共约 **130+ 个技能**
