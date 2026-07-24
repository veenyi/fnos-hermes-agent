---
name: agency-orchestrator
description: 当用户想使用 Agency Orchestrator（一人公司 / 多智能体协作）的工作流模板、专家角色库或 DAG 编排时调用。涵盖工作流预设加载、输入变量填写、执行方式及角色来源说明。
---

# Agency Orchestrator 集成

> 来源：jnMetaCode/agency-orchestrator（Apache-2.0）
> 本技能包把 Agency Orchestrator 的 60+ 工作流预设和 267 个中文专家角色（agency-agents-zh）内置到 fnos-hermes-agent 中，无需额外安装 npm/uv 包。

## 能做什么

- **工作流预设**：在「扩展能力 → 专家团 → 专家团工作流」页面，从 60+ 模板中一键加载（一人公司、产品评审、内容创作、代码评审、投研、法律、学术等）。
- **专家角色库**：在「扩展能力 → 专家」页面搜索并使用 267 个 agency-agents-zh 中文角色。
- **DAG 编排**：每个工作流自动按依赖关系拓扑分层，同层并行、跨层顺序执行。
- **输入变量**：加载带 `inputs` 的工作流后，先填写输入变量，再发送消息执行。

## 与原版 OpenClaw 集成的区别

原仓库的 `integrations/openclaw` 需要：

```bash
git clone https://github.com/jnMetaCode/agency-agents-zh.git
npx superpowers-zh
```

在 fnos-hermes-agent 中这些已经被内嵌：

- 角色库 → `app/ui/js/personas_library.js`
- 工作流预设 → `app/ui/js/ao_workflow_presets.js`
- 运行引擎 → UI 内置的 DAG workflow runner（`extRunWorkflow`）

因此用户只需在 Web UI 选择预设并运行，不需要命令行。

## 使用方式

### UI 方式（推荐）

1. 进入「扩展能力 → 专家团 → 专家团工作流」。
2. 在「工作流预设案例库」里选择分类 / 模板，点击「加载预设」。
3. 如果模板要求输入变量（如 `topic`、`prd_content`），在输入区填写。
4. 点击「设为当前工作流并使用」。
5. 返回会话页面，发送一条消息（通常只需发送简要请求），系统会按 DAG 自动执行并输出完整结果。

### 自然语言方式

用户也可以直接描述协作需求，不加载模板：

```
用产品经理分析需求，然后让架构师评估技术方案、设计师评估用户体验，最后产品经理汇总。
PRD 内容：[你的 PRD]
```

此时应引导用户到「专家团」页面手动组队或 DAG 编排。

## 工作流预设索引

详见 `./references/workflows/index.md`（自动生成），包含每个模板的分类、名称、描述、步骤数、输入项。

主要分类：

- 一人公司（全员大会 / 做产品 / 做内容 / 做投研 / SaaS 发布决策）
- 通用（产品需求评审、内容创作流水线、短篇小说创作、投资标的分析、法律咨询意见书、简历优化与面试准备等）
- dev（PR 评审、技术方案评审、安全审计、API 文档生成、README 国际化、发布检查清单等）
- marketing（竞品分析、小红书内容、SEO 内容矩阵）
- design（需求转计划、UX 评审）
- data（数据管道评审、仪表盘设计）
- ops（事故复盘、SRE 健康检查、周报生成）
- strategy / hr / legal / department-collab

## 注意事项

- 工作流执行依赖已配置的 LLM provider 和模型，请先到「模型」页配置并保存。
- 带 `inputs` 的预设必须先填写变量，否则执行时模板里的 `{{变量}}` 会被替换为空字符串。
- 运行时可以点击工作流节点查看每步的中间产物。
- 如需自定义，可在加载预设后，在工作流编辑器里增删步骤、修改任务或依赖关系。
