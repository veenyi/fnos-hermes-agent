# Agency Orchestrator 工作流预设索引

> 来源：jnMetaCode/agency-orchestrator（Apache-2.0）
> 自动生成，仅保留非英文工作流及部分英文模板。

| 分类 | 名称 | 描述 | 步骤数 | 输入项 |
|------|------|------|--------|--------|
|  | 学术论文选题与大纲 | 选题评估 + 研究方法设计 + 文献综述框架 + 完整大纲 | 4 | research_topic, paper_type, discipline |
|  | AI 爆款深度文章 | 多角色协作写一篇有深度、引人入胜的 AI 观点文章 — 调研、构思、写作、审校 | 5 | topic, style, platform |
|  | AI 一人公司：SaaS 产品发布决策 | CEO 一句话启动，5 个 AI 部门并行工作，30 秒出完整发布方案 | 6 | product_idea |
|  | Codex + Claude Code 协作编程(闭环版) |  | 4 | requirement |
|  | Codex + Claude Code 协作编程(极简版) |  | 3 | requirement |
|  | 内容创作流水线 | 从主题到成稿的完整内容创作流程 — 研究、写作、品牌审核 | 4 | topic, target_audience, platform |
| data | 数据仪表盘设计 | 定义指标 → 设计布局 → 出视觉方案 | 3 | business_goal, data_sources |
| data | 数据管道审查 | 数据工程师分析 → 数据库优化师检查 → 数据分析师验证输出质量 | 3 | pipeline_description, data_schema |
| department-collab | CEO 组织架构协作 | CEO 分析需求 → 自动路由到对应部门（工程/市场/产品/HR）→ 部门内专业 Agent 并行执行 → CEO 汇总决策 | 6 | request, context |
| department-collab | 代码评审流程 | 架构/安全/性能并行评审 → 汇总 → 不通过则打回重审（最多 2 轮） | 5 | code, context |
| department-collab | 内容发布流程 | 选题策划 → 文案撰写 → 品牌审核（不通过打回修改，最多 3 轮）→ 法务合规 → 发布清单 | 6 | topic, platform |
| department-collab | 招聘评估流程 | HR 筛选简历 → 按岗位类型分流技术/业务评估 → 薪酬方案 → 最终审批 | 5 | resume, job_title |
| department-collab | 故障响应流程 | 故障分类 → 按类型分流给对应团队分析 → 复盘汇总 | 5 | incident_report |
| department-collab | 营销活动策划 | 市场调研 → 创意策划 → 预算审批 → 投放方案 → 效果分析 | 5 | product, budget, goal |
| design | 需求到计划 | 产品经理分析需求 → 架构师设计方案 → 项目经理拆任务 | 3 | requirement, constraints |
| design | UX 体验审查 | UX 研究员评估 + 无障碍审核 → UX 架构师汇总 | 3 | product_description, screenshots_or_flow |
| dev | API 文档生成 | 分析代码生成 API 文档 → 验证完整性 → 输出最终文档 | 3 | api_code, api_context |
| dev | PR 代码审查 | 三维度并行审查：代码质量、安全性、性能 → 汇总结论 | 4 | pr_diff, pr_description |
| dev | README 国际化 | 翻译 README → 审查技术术语 → 润色输出最终版 | 3 | readme_content, target_language |
| dev | 发布检查清单 | SRE + 性能 + 安全三方检查 → Go/No-Go 决策 | 4 | release_notes, version |
| dev | 安全审计 | 安全工程师 + 威胁检测并行审计 → 汇总安全报告 | 3 | code_or_system, threat_model |
| dev | 技术债务审计 | 架构评估 + 代码扫描 + 测试分析 → 优先级排序 | 4 | codebase_description, focus_area |
| dev | 技术方案评审 | 架构师出方案 → 后端架构师 + 安全工程师并行评审 → 代码审查员整合意见，输出评审结论 | 4 | requirement, tech_stack |
|  | 抖音口播脚本创作 | 一句话选题 → 爆款选题分析 + 逐秒脚本 + 标题钩子 + 拍摄建议 | 4 | topic, duration, style |
| English | Business Plan | Market research → financial forecast + product roadmap → executive summary — generates a complete business plan | 4 | idea, stage, market |
| English | Code Architecture Review | Architecture design → backend deep-dive → code review for a feature or system. | 3 | feature |
| English | Competitor Analysis Report | Trend research → data analysis + SEO scan → executive summary — a report ready to present | 4 | product, competitors, focus |
| English | Content Creation Pipeline | Topic to finished draft — research, write, brand review, final edit | 4 | topic, target_audience, platform |
| English | Investment Analysis | Research → fundamentals → financial modeling: a structured analysis of a target. | 3 | target |
| English | OKR Decomposition | Annual goal → quarterly KRs → a concrete Q1 action plan. | 3 | annual_goal |
| English | PR Code Review | Three-dimensional parallel review: code quality, security, performance → unified verdict | 4 | pr_diff, pr_description |
| English | Product Requirements Review | Multi-role PRD review — PM analyzes requirements, architect assesses tech, UX researcher assesses experience, then synthesis | 4 | prd_content |
| English | Solo Founder All-Hands | One sentence in, 8 AI 'departments' collaborate, full launch plan out in 2 minutes — your one-person company | 9 | idea |
| English | Tech Blog | Research → outline → draft → polish: a deep, credible technical blog post. | 4 | topic |
| hr | 面试题设计 | 招聘专家定义考察维度 → 心理学家设计行为面试题 + 技术专家设计技术题 → 招聘专家整合评分表 | 4 | position, level, focus |
|  | 投资标的分析（股票/基金/行业） | 基本面研究 + 财务分析 + 风险识别 + CFO 综合建议 | 4 | target, investor_profile, capital_size |
| legal | 合同审查 | 合同审查专家逐条分析 → 法务合规员补充合规风险 → 整合输出审查意见和修改建议 | 3 | contract, party, concern |
|  | 法律咨询意见书 | 事实梳理 + 合同/文书审查 + 风险识别 + 法律意见书 | 4 | case_description, document_content, jurisdiction |
| marketing | 竞品分析报告 | 趋势研究 → 数据分析 + SEO 竞品扫描 → 高管摘要，输出一份可直接汇报的竞品报告 | 4 | product, competitors, focus |
| marketing | SEO 内容矩阵 | SEO 关键词研究 → 内容策略 + 批量内容生成 → SEO 优化审核，一次性生成一组 SEO 友好的文章 | 4 | domain, target_keywords, article_count |
| marketing | 小红书种草笔记 | 小红书专家选题策划 → 内容创作 + 视觉方案 → 小红书运营优化，批量生成高质量种草内容 | 4 | product, category, count |
|  | 会议纪要整理 | 输入原始会议记录，自动整理为结构化纪要：决策、TODO、争议点 三视角并行 → 完整纪要 | 5 | raw_notes, meeting_type |
|  | OKR 拆解 | 输入年度目标，自动完成现状分析 → 4 个季度 KR 拆解 → 首季度行动方案 → 完整 OKR 文档 | 4 | annual_goal, team_context |
| ops | 事故复盘 | 故障指挥官梳理时间线 → SRE 分析根因 → 项目经理输出改进计划 | 3 | incident_description, timeline |
| ops | SRE 健康检查 | 可靠性 + 性能 + 基础设施三方检查 → SRE 汇总 | 4 | system_description, current_metrics |
| ops | 周报/月报生成 | 数据整理 → 亮点提炼 → 高管摘要，从原始信息快速生成结构化周报 | 3 | raw_notes, team, period |
|  | 创业 Pitch Deck 大纲 | 输入一句话项目，并行输出市场分析 / 商业模式 / 财务预估 → 整合 5 屏 deck 大纲（创始人评审用） | 5 | startup_idea, target_market, stage |
|  | 产品发布物料生成 | 输入新产品/功能简介，并行产出发布通稿 + 社交短文 + 客户邮件 → 整合发布物料包 | 5 | product_name, product_summary, key_features, launch_audience |
|  | 产品需求评审 | 多角色协作评审 PRD 文档 — 产品经理分析需求，架构师评估技术，设计师评估体验，最后汇总结论 | 4 | prd_content |
|  | 简历优化与面试准备 | 简历诊断 → 简历重写 + 面试问题预测 + STAR 答题框架 | 4 | resume_content, target_role, job_description |
|  | 短篇小说创作 | 从创意到成稿：叙事学家设计结构 → 心理学家塑造人物 + 叙事设计师构建冲突 → 内容创作者执笔成稿 | 4 | premise, style, length |
| strategy | 商业计划书 | 趋势研究 → 财务预测 + 产品规划 → 高管摘要，生成一份完整的商业计划书 | 4 | idea, stage, market |
|  | 技术博客创作 | 输入一句话主题，自动完成趋势调研 → 大纲 → 正文 → 润色，输出可直接发布的技术博客 | 4 | topic, audience |
|  | 小红书爆款笔记创作 | 一句话主题 → 策略分析 + 文案撰写 + SEO 标题 + 整合成稿 | 4 | topic, target_audience |
| 一人公司 | 一人公司·做产品 | 你出想法，AI 团队出货：产品经理写 PRD、架构师定方案、工程师排计划，老板（你）拿到能直接开工的启动包 | 5 | idea |
| 一人公司 | 一人公司·做内容 | 一个人做账号不孤军奋战：用户研究员找痛点、策划出选题、编导写脚本、运营排日历——你只管出镜 | 5 | direction |
| 一人公司 | 一人公司·做投研 | 像券商研究所一样做功课：宏观→行业→标的→风控四道工序，重大结论须你签字放行。仅供研究参考，不构成投资建议 | 6 | target, horizon |
| 一人公司 | AI 一人公司：全员大会 | 你说一句话，9 个 AI 部门自动协作，2 分钟出完整商业方案——这就是一人公司 | 9 | idea |
|  | 省钱混用示例：便宜模型干轻活，强模型干重活 | 演示 per-step 模型覆写（step.llm）——把简单步骤放到便宜/快的档位，把需要深度推理的步骤留给强模型，整体更省钱且不掉关键质量。抄这个模板即可。 | 3 | topic |
|  | 软件开发标准流程 | 一句话需求 → 澄清 → 架构 → TDD 实现 → 代码审查 → 现实验收。标准化的多智能体软件开发流水线，配合 --materialize 把代码写成真实文件。 | 5 | requirement |
|  | 需求转项目脚手架 | 一句话需求 → 澄清 → 计划 → 生成可落盘的项目脚手架。配合 ao run ... --materialize <目录> 把代码写成真实文件。 | 4 | idea |
