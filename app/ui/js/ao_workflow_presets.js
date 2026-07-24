// AUTO-GENERATED from agency-orchestrator workflows
window.AO_WORKFLOW_PRESETS = [
  {
    "key": "academic-paper-outline",
    "file": "academic-paper-outline.yaml",
    "name": "学术论文选题与大纲",
    "description": "选题评估 + 研究方法设计 + 文献综述框架 + 完整大纲",
    "category": "",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "research_topic",
        "description": "研究主题或初步方向（越具体越好）",
        "required": true
      },
      {
        "name": "paper_type",
        "description": "论文类型（如：本科毕业论文 / 硕士学位论文 / 期刊论文 / 会议论文）",
        "required": false
      },
      {
        "name": "discipline",
        "description": "学科（如：计算机科学 / 教育学 / 经济学）",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "topic_eval",
        "expert": "agency_academic_academic_study_planner",
        "task": "评估研究主题「{{research_topic}}」在 {{discipline}} 领域、作为 {{paper_type}} 的可行性。\n\n输出（400 字）:\n1. **选题评分**:\n   - 创新性: 0-10 分（是否已被研究透）\n   - 可行性: 0-10 分（数据/方法是否可得）\n   - 理论价值: 0-10 分\n   - 实践价值: 0-10 分\n   - 综合建议: 推荐/可做/建议调整/不推荐\n2. **精准化建议**: 原主题太宽？太窄？具体应该怎么调整（给 2-3 个更好的表述方案）\n3. **研究问题**: 从选题中提炼出 1 个核心研究问题 + 2-3 个子问题\n4. **预期贡献**: 做完这个研究能填补什么空白",
        "output": "topic_evaluation",
        "depends_on": []
      },
      {
        "id": "methodology",
        "expert": "agency_academic_academic_study_planner",
        "task": "为研究设计方法论。\n\n选题评估:\n{{topic_evaluation}}\n\n学科: {{discipline}}\n\n输出（400 字）:\n1. **研究范式**: 定量/定性/混合，并说明理由\n2. **具体方法**:\n   - 如果是定量: 抽样方法、样本量、问卷/实验设计、统计方法\n   - 如果是定性: 访谈/案例/民族志，编码方案\n   - 如果是计算机/工程类: 实验环境、数据集、基线模型、评估指标\n3. **数据来源**: 具体从哪里获取数据（公开数据集名称 / 需要采集的渠道）\n4. **可行性检查**: 上述方法在当前条件下是否可行，可能遇到的障碍\n5. **伦理考量**: 是否涉及人类受试者、数据隐私等，需要什么审批",
        "output": "methodology",
        "depends_on": [
          "topic_eval"
        ]
      },
      {
        "id": "literature",
        "expert": "agency_academic_academic_historian",
        "task": "为选题设计文献综述的骨架。\n\n选题:\n{{topic_evaluation}}\n\n学科: {{discipline}}\n\n输出（400 字）:\n1. **理论基础**: 本研究依托的 2-3 个核心理论/经典概念，每个 1 句话解释\n2. **关键学者/流派**: 这个领域必须引用的 5-8 位学者或代表作（作者-年份-代表性贡献）\n3. **研究脉络**:\n   - 早期研究关注什么\n   - 近 5-10 年研究热点\n   - 当前未解决的争议\n4. **检索建议**:\n   - 中文关键词: 3-5 个\n   - 英文关键词: 3-5 个\n   - 推荐数据库: CNKI / Web of Science / ACM / IEEE 等（按学科推荐）\n5. **文献综述写作思路**: 按\"议题\"而非\"时间\"组织，分 3-4 个主题块\n\n⚠️ 具体学者名和年份不确定时明确标「需核实」，不要编造。",
        "output": "literature_framework",
        "depends_on": [
          "topic_eval"
        ]
      },
      {
        "id": "outline",
        "expert": "agency_academic_academic_study_planner",
        "task": "整合生成完整论文大纲。\n\n选题: {{topic_evaluation}}\n方法: {{methodology}}\n文献: {{literature_framework}}\n\n论文类型: {{paper_type}}\n\n输出结构（按学位论文标准章节）:\n```\n# 【论文题目】\n<基于选题精准化建议确定的最终题目>\n\n# 【摘要要点】\n- 研究问题:\n- 方法:\n- 主要发现（预期）:\n- 贡献:\n\n# 【关键词】\n5-7 个\n\n# 第一章 绪论\n- 1.1 研究背景（写作要点）\n- 1.2 研究问题（引用选题评估中的核心问题）\n- 1.3 研究意义（理论+实践）\n- 1.4 研究方法简述\n- 1.5 论文结构\n\n# 第二章 文献综述\n<按文献框架的主题块组织>\n- 2.1 <主题块1>\n- 2.2 <主题块2>\n- 2.3 <主题块3>\n- 2.4 研究述评（指出空白）\n\n# 第三章 理论基础与研究设计\n<基于方法论>\n- 3.1 理论框架\n- 3.2 研究假设/研究问题细化\n- 3.3 研究方法\n- 3.4 数据来源与样本\n- 3.5 变量测量 / 实验设计\n\n# 第四章 数据分析与结果\n<占位，写作时填充>\n- 4.1 描述性分析\n- 4.2 主要发现\n- 4.3 稳健性检验 / 消融实验\n\n# 第五章 讨论与结论\n- 5.1 结果讨论（与文献对话）\n- 5.2 理论贡献\n- 5.3 实践启示\n- 5.4 研究局限\n- 5.5 未来研究方向\n\n# 【时间规划】\n<按 {{paper_type}} 给出 3-6 个月的分阶段时间表>\n\n# 【下一步行动】\n按优先级列 3 条最该立刻做的事\n```",
        "output": "paper_outline",
        "depends_on": [
          "methodology",
          "literature"
        ]
      }
    ]
  },
  {
    "key": "ai-opinion-article",
    "file": "ai-opinion-article.yaml",
    "name": "AI 爆款深度文章",
    "description": "多角色协作写一篇有深度、引人入胜的 AI 观点文章 — 调研、构思、写作、审校",
    "category": "",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "topic",
        "description": "文章主题",
        "required": true
      },
      {
        "name": "style",
        "description": "文章风格（如：深度思考、犀利观点、温情感悟）",
        "required": true
      },
      {
        "name": "platform",
        "description": "发布平台",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "trend_research",
        "expert": "agency_product_product_trend_researcher",
        "task": "针对以下主题，做深度趋势调研：\n主题：{{topic}}\n平台：{{platform}}\n\n请输出：\n1. 当前公众讨论的热点角度（至少5个）\n2. 大众最关心/焦虑/好奇的3个核心问题\n3. 常见观点中的盲区或误区（这是爆款切入点）\n4. 能引发共鸣的情感触发点\n5. 建议的爆款标题方向（至少5个，要有冲击力）",
        "output": "trend_report",
        "depends_on": []
      },
      {
        "id": "narrative_design",
        "expert": "agency_academic_academic_narratologist",
        "task": "基于趋势调研，设计文章的叙事结构：\n\n调研报告：\n{{trend_report}}\n\n主题：{{topic}}\n风格：{{style}}\n\n请设计：\n1. 开篇钩子（第一段就要抓住读者，用一个具体场景或反直觉观点）\n2. 文章主线（一条贯穿始终的核心论点）\n3. 3-4个递进的论述层次（每层要有转折或意外）\n4. 情感节奏图（哪里激烈、哪里沉思、哪里共鸣）\n5. 结尾设计（不要鸡汤，要留有回味的思考）\n6. 最终确定的标题（1个主标题 + 1个副标题）",
        "output": "narrative_structure",
        "depends_on": [
          "trend_research"
        ]
      },
      {
        "id": "depth_thinking",
        "expert": "agency_academic_academic_narratologist",
        "task": "作为一个深度思考者，针对这个主题提供独到的思考角度：\n\n主题：{{topic}}\n趋势调研：{{trend_report}}\n\n请提供：\n1. 3个大多数人没想到的深层观点（要有洞察力，不是陈词滥调）\n2. 2个有力的类比或隐喻（让抽象概念变得生动）\n3. 1个能引发争议但站得住脚的观点（爆款需要争议性）\n4. 2-3个真实或虚构的具体案例/场景（增加说服力）\n5. 对未来的一个大胆预判（有远见但不疯狂）",
        "output": "deep_insights",
        "depends_on": [
          "trend_research"
        ]
      },
      {
        "id": "write_article",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "你是一位顶级内容创作者。请基于以下素材，写一篇 {{platform}} 爆款文章。\n\n叙事结构：\n{{narrative_structure}}\n\n深度洞察：\n{{deep_insights}}\n\n风格要求：{{style}}\n\n写作要求：\n- 2000-3000字\n- 第一段就要抓人（场景化开头或反直觉观点）\n- 每200-300字要有一个吸引读者继续看的钩子\n- 用具体案例和场景替代抽象说教\n- 语言要有节奏感：长短句交替，偶尔用一句话单独成段\n- 观点要鲜明，不要两头讨好\n- 结尾要有力度，最好是一个让人想转发的金句\n- 适当用一些修辞手法（排比、反问、类比）但不要过度\n- 段落之间要有逻辑递进，不是并列堆砌\n\n请直接输出完整文章（包含标题）。",
        "output": "article_draft",
        "depends_on": [
          "narrative_design",
          "depth_thinking"
        ]
      },
      {
        "id": "polish",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "请对以下文章做最终打磨：\n\n{{article_draft}}\n\n打磨要点：\n1. 检查开头是否足够抓人（不行就重写开头）\n2. 删掉所有废话和套话（\"众所周知\"、\"不可否认\"这类全删）\n3. 强化金句密度（每500字至少一句值得划线的话）\n4. 检查节奏：是否有连续超过3段的长段落？拆开\n5. 结尾是否有力？最后一句是否值得截图转发？\n6. 按 {{platform}} 的习惯排好版（分段、加粗重点），但排版本身体现在正文里，不要单独写\"排版提示\"\n\n⚠️ 严格只输出最终文章本身：不要开场白或寒暄、不要\"我改了什么/修改说明/复盘\"、不要排版备注小节、不要向用户提问或请其拍板、不要建议 ao 命令或后续动作、不要\"要我继续吗\"之类收尾。从文章第一个字开始，到文章最后一个字结束。",
        "output": null,
        "depends_on": [
          "write_article"
        ]
      }
    ]
  },
  {
    "key": "ai-startup-launch",
    "file": "ai-startup-launch.yaml",
    "name": "AI 一人公司：SaaS 产品发布决策",
    "description": "CEO 一句话启动，5 个 AI 部门并行工作，30 秒出完整发布方案",
    "category": "",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "product_idea",
        "description": "",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "ceo_vision",
        "expert": "agency_strategy_nexus_strategy",
        "task": "作为 CEO，请基于以下产品创意制定一份简洁的产品愿景和战略方向：\n\n产品创意：{{product_idea}}\n\n输出 300 字以内，包含：产品定位（一句话）、目标用户、核心差异化、6个月目标。",
        "output": "vision",
        "depends_on": []
      },
      {
        "id": "product_plan",
        "expert": "agency_product_product_manager",
        "task": "基于 CEO 愿景：{{vision}}\n\n作为产品经理，输出 MVP 功能规划（500字以内）：核心功能 3 个、用户故事、优先级排序、第一版交付范围。",
        "output": "product_spec",
        "depends_on": [
          "ceo_vision"
        ]
      },
      {
        "id": "tech_plan",
        "expert": "agency_engineering_engineering_backend_architect",
        "task": "基于 CEO 愿景：{{vision}}\n\n作为技术架构师，输出技术方案（500字以内）：技术栈选型、系统架构、1人团队的开发路线图（4周冲刺计划）。",
        "output": "tech_spec",
        "depends_on": [
          "ceo_vision"
        ]
      },
      {
        "id": "marketing_plan",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "基于 CEO 愿景：{{vision}}\n\n作为市场负责人，输出 Go-to-Market 方案（500字以内）：发布文案（标题+副标题）、目标渠道 Top 3、首月增长策略、预算为 0 的冷启动方案。",
        "output": "marketing_spec",
        "depends_on": [
          "ceo_vision"
        ]
      },
      {
        "id": "finance_plan",
        "expert": "agency_finance_finance_financial_forecaster",
        "task": "基于 CEO 愿景：{{vision}}\n\n作为财务顾问，输出商业模型（500字以内）：定价策略、收入预测（3/6/12个月）、成本结构、盈亏平衡分析。",
        "output": "finance_spec",
        "depends_on": [
          "ceo_vision"
        ]
      },
      {
        "id": "launch_decision",
        "expert": "agency_strategy_nexus_strategy",
        "task": "作为 CEO，所有部门方案已提交：\n\n**产品方案**：{{product_spec}}\n**技术方案**：{{tech_spec}}\n**市场方案**：{{marketing_spec}}\n**财务方案**：{{finance_spec}}\n\n请做最终决策，输出一份 800 字以内的《产品发布执行计划》：\n1. Go/No-Go 决策及理由\n2. 各部门方案的采纳/调整要点\n3. 第一周具体行动清单（每个部门 3 件事）\n4. 风险预警和应对",
        "output": "launch_plan",
        "depends_on": [
          "product_plan",
          "tech_plan",
          "marketing_plan",
          "finance_plan"
        ]
      }
    ]
  },
  {
    "key": "codex-cc-loop",
    "file": "codex-cc-loop.yaml",
    "name": "Codex + Claude Code 协作编程(闭环版)",
    "description": "",
    "category": "",
    "featured": false,
    "concurrency": 1,
    "inputs": [
      {
        "name": "requirement",
        "description": "",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "plan",
        "expert": "agency_engineering_engineering_backend_architect",
        "task": "针对以下需求做技术规划,给出实现思路、模块拆分和验收标准:{{requirement}}",
        "output": "plan_doc",
        "depends_on": []
      },
      {
        "id": "implement",
        "expert": "agency_engineering_engineering_rapid_prototyper",
        "task": "严格按下面的规划与验收标准实现代码:{{plan_doc}}",
        "output": "code",
        "depends_on": [
          "plan"
        ]
      },
      {
        "id": "review",
        "expert": "agency_testing_testing_reality_checker",
        "task": "对照验收标准复核代码。通过则输出 APPROVED,否则列出具体问题。标准:{{plan_doc}}  代码:{{code}}",
        "output": "review_result",
        "depends_on": [
          "implement"
        ]
      },
      {
        "id": "fix",
        "expert": "agency_engineering_engineering_rapid_prototyper",
        "task": "根据复核意见修改代码(已通过则原样保留):{{review_result}}  原代码:{{code}}",
        "output": "code",
        "depends_on": [
          "review"
        ]
      }
    ]
  },
  {
    "key": "codex-cc-simple",
    "file": "codex-cc-simple.yaml",
    "name": "Codex + Claude Code 协作编程(极简版)",
    "description": "",
    "category": "",
    "featured": false,
    "concurrency": 1,
    "inputs": [
      {
        "name": "requirement",
        "description": "",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "plan",
        "expert": "agency_engineering_engineering_backend_architect",
        "task": "针对以下需求做技术规划,给出实现思路、模块拆分和验收标准:{{requirement}}",
        "output": "plan_doc",
        "depends_on": []
      },
      {
        "id": "implement",
        "expert": "agency_engineering_engineering_rapid_prototyper",
        "task": "严格按下面的规划与验收标准实现代码:{{plan_doc}}",
        "output": "code",
        "depends_on": [
          "plan"
        ]
      },
      {
        "id": "review",
        "expert": "agency_testing_testing_reality_checker",
        "task": "对照验收标准复核代码,指出问题或确认通过。标准:{{plan_doc}}  代码:{{code}}",
        "output": "review_result",
        "depends_on": [
          "implement"
        ]
      }
    ]
  },
  {
    "key": "content-pipeline",
    "file": "content-pipeline.yaml",
    "name": "内容创作流水线",
    "description": "从主题到成稿的完整内容创作流程 — 研究、写作、品牌审核",
    "category": "",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "topic",
        "description": "内容主题",
        "required": true
      },
      {
        "name": "target_audience",
        "description": "目标受众",
        "required": true
      },
      {
        "name": "platform",
        "description": "发布平台（如：公众号、知乎、小红书）",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "research",
        "expert": "agency_marketing_marketing_social_media_strategist",
        "task": "为以下主题做内容研究：\n主题：{{topic}}\n目标受众：{{target_audience}}\n平台：{{platform}}\n\n请输出：\n1. 关键信息点\n2. 受众关注的痛点\n3. 竞品内容分析\n4. 建议的内容角度",
        "output": "research_report",
        "depends_on": []
      },
      {
        "id": "draft",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "基于以下研究，撰写一篇适合 {{platform}} 的文章：\n\n研究报告：\n{{research_report}}\n\n要求：\n- 目标受众：{{target_audience}}\n- 风格适合 {{platform}}\n- 包含引人注目的标题\n- 结构清晰，易于阅读",
        "output": "draft_content",
        "depends_on": [
          "research"
        ]
      },
      {
        "id": "brand_review",
        "expert": "agency_marketing_marketing_growth_hacker",
        "task": "请审核以下内容的品牌一致性：\n\n{{draft_content}}\n\n评审要点：\n1. 品牌调性是否一致\n2. 信息准确性\n3. 是否有敏感内容\n4. 改进建议",
        "output": "review_feedback",
        "depends_on": [
          "draft"
        ]
      },
      {
        "id": "final_edit",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "根据品牌审核反馈，修改并定稿：\n\n原文：\n{{draft_content}}\n\n审核反馈：\n{{review_feedback}}\n\n请输出最终稿件。",
        "output": null,
        "depends_on": [
          "brand_review"
        ]
      }
    ]
  },
  {
    "key": "data\\dashboard-design",
    "file": "data\\dashboard-design.yaml",
    "name": "数据仪表盘设计",
    "description": "定义指标 → 设计布局 → 出视觉方案",
    "category": "data",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "business_goal",
        "description": "业务目标（仪表盘要解决什么问题、服务哪些用户）",
        "required": true
      },
      {
        "name": "data_sources",
        "description": "可用数据源及其字段说明",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "define_metrics",
        "expert": "agency_support_support_analytics_reporter",
        "task": "请根据业务目标和可用数据源，定义仪表盘的关键指标：\n\n业务目标：{{business_goal}}\n\n数据源：{{data_sources}}\n\n请输出：\n1. 核心指标（North Star Metric）及其定义\n2. 支撑指标（按维度分组，如增长、留存、营收等）\n3. 每个指标的计算口径和数据来源\n4. 建议的时间粒度（实时 / 小时 / 天 / 周）\n5. 指标之间的关联关系和下钻路径",
        "output": "metrics_definition",
        "depends_on": []
      },
      {
        "id": "design_layout",
        "expert": "agency_design_design_ux_researcher",
        "task": "请根据业务目标，设计仪表盘的信息架构和交互方案：\n\n业务目标：{{business_goal}}\n\n数据源：{{data_sources}}\n\n请输出：\n1. 用户角色分析（谁会看这个仪表盘、使用场景）\n2. 信息层级（概览 → 详情 → 明细的层次结构）\n3. 布局方案（各区域放什么内容、优先级排列）\n4. 交互设计（筛选器、时间选择、下钻、联动）\n5. 移动端适配建议",
        "output": "layout_design",
        "depends_on": []
      },
      {
        "id": "visual_design",
        "expert": "agency_design_design_ui_designer",
        "task": "请综合指标定义和布局方案，输出仪表盘的视觉设计方案：\n\n## 指标定义\n{{metrics_definition}}\n\n## 布局方案\n{{layout_design}}\n\n业务目标：{{business_goal}}\n\n请输出：\n1. 图表类型选择（每个指标适合用什么图表展示）\n2. 配色方案（主色、辅色、语义色如红涨绿跌）\n3. 数据可视化规范（字号、间距、图表尺寸）\n4. 状态与预警的视觉表达（正常 / 警告 / 异常）\n5. 完整的仪表盘视觉设计说明",
        "output": "visual_plan",
        "depends_on": [
          "define_metrics",
          "design_layout"
        ]
      }
    ]
  },
  {
    "key": "data\\data-pipeline-review",
    "file": "data\\data-pipeline-review.yaml",
    "name": "数据管道审查",
    "description": "数据工程师分析 → 数据库优化师检查 → 数据分析师验证输出质量",
    "category": "data",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "pipeline_description",
        "description": "数据管道的描述（架构、数据流、技术栈等）",
        "required": true
      },
      {
        "name": "data_schema",
        "description": "数据模型 / 表结构说明（可选）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "engineer_review",
        "expert": "agency_engineering_engineering_data_engineer",
        "task": "请分析以下数据管道的架构和数据流设计：\n\n管道描述：{{pipeline_description}}\n\n数据模型：{{data_schema}}\n\n请评估：\n1. 管道架构合理性（数据源、ETL/ELT 流程、目标存储）\n2. 数据流完整性（是否有数据丢失风险）\n3. 容错与重试机制\n4. 可扩展性（能否支撑数据量增长）\n5. 改进建议",
        "output": "engineer_report",
        "depends_on": []
      },
      {
        "id": "db_optimize",
        "expert": "agency_engineering_engineering_database_optimizer",
        "task": "请从数据库性能角度审查以下数据管道：\n\n管道描述：{{pipeline_description}}\n\n数据模型：{{data_schema}}\n\n请检查：\n1. 查询效率（是否存在全表扫描、慢查询风险）\n2. 索引策略（索引是否合理，是否有冗余或缺失）\n3. 分区与分表策略\n4. 写入性能（批量插入 vs 逐行插入）\n5. 具体优化建议及预期收益",
        "output": "db_report",
        "depends_on": []
      },
      {
        "id": "quality_check",
        "expert": "agency_support_support_analytics_reporter",
        "task": "请综合数据工程和数据库优化的评审结果，验证数据管道的输出质量：\n\n## 数据工程评审\n{{engineer_report}}\n\n## 数据库优化评审\n{{db_report}}\n\n原始管道描述：{{pipeline_description}}\n\n请验证：\n1. 输出数据的准确性和一致性\n2. 数据质量监控指标是否完善\n3. 异常数据的处理策略\n4. 数据时效性（延迟是否可接受）\n5. 综合改进建议和优先级排序",
        "output": "quality_report",
        "depends_on": [
          "engineer_review",
          "db_optimize"
        ]
      }
    ]
  },
  {
    "key": "department-collab\\ceo-org-delegation",
    "file": "department-collab\\ceo-org-delegation.yaml",
    "name": "CEO 组织架构协作",
    "description": "CEO 分析需求 → 自动路由到对应部门（工程/市场/产品/HR）→ 部门内专业 Agent 并行执行 → CEO 汇总决策",
    "category": "department-collab",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "request",
        "description": "CEO 收到的任务/需求/问题（如：我们要做一个新产品、竞对出了新功能怎么办、团队扩张计划…）",
        "required": true
      },
      {
        "name": "context",
        "description": "背景信息（公司阶段、团队规模、预算约束等）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "ceo_analyze",
        "expert": "agency_project-management_project_manager_senior",
        "task": "你是公司 CEO。请分析以下需求，决定需要调动哪些部门协作。\n\n需求：{{request}}\n公司背景：{{context}}\n\n你可以调动的部门：\n- **工程部**：负责技术方案、架构设计、开发排期、技术债务\n- **市场部**：负责市场调研、竞品分析、品牌策略、内容营销\n- **产品部**：负责需求分析、产品规划、用户研究、优先级排序\n- **HR 部**：负责招聘规划、团队组建、人才发展、组织架构\n\n请输出：\n1. **需求解读**：一句话总结这个需求的核心问题\n2. **需要参与的部门**（必须明确写出部门名称：工程部 / 市场部 / 产品部 / HR部）\n3. **每个部门的具体任务**（给每个部门的简要指令）\n4. **优先级和时间预期**\n5. **关键风险点**",
        "output": "ceo_decision",
        "depends_on": []
      },
      {
        "id": "engineering_dept",
        "expert": "agency_engineering_engineering_software_architect",
        "task": "你是工程部负责人。CEO 给了以下指示：\n\n{{ceo_decision}}\n\n原始需求：{{request}}\n\n请作为工程部负责人，输出：\n1. **技术可行性评估**（能不能做、难点在哪）\n2. **技术方案概要**（架构选型、技术栈建议）\n3. **人力评估**（需要几个人、什么角色）\n4. **排期估算**（里程碑拆分）\n5. **技术风险**（依赖、性能、安全方面的风险）\n6. **给 CEO 的建议**（你认为 CEO 应该知道的工程视角）",
        "output": "engineering_report",
        "depends_on": [
          "ceo_analyze"
        ]
      },
      {
        "id": "marketing_dept",
        "expert": "agency_marketing_marketing_social_media_strategist",
        "task": "你是市场部负责人。CEO 给了以下指示：\n\n{{ceo_decision}}\n\n原始需求：{{request}}\n\n请作为市场部负责人，输出：\n1. **市场机会分析**（市场规模、竞争格局、时间窗口）\n2. **竞品动态**（主要竞品在做什么、我们的差异化定位）\n3. **品牌/传播策略**（怎么讲故事、什么渠道、什么节奏）\n4. **获客方案**（目标用户从哪来、获客成本预估）\n5. **预算需求**（市场费用的大致拆分）\n6. **给 CEO 的建议**（你认为 CEO 应该知道的市场视角）",
        "output": "marketing_report",
        "depends_on": [
          "ceo_analyze"
        ]
      },
      {
        "id": "product_dept",
        "expert": "agency_product_product_manager",
        "task": "你是产品部负责人。CEO 给了以下指示：\n\n{{ceo_decision}}\n\n原始需求：{{request}}\n\n请作为产品部负责人，输出：\n1. **需求分析**（用户痛点、场景拆解、需求优先级）\n2. **产品方案**（核心功能定义、MVP 范围、用户旅程）\n3. **竞品产品分析**（功能对比、体验差异）\n4. **数据指标**（怎么衡量成功、关键北极星指标）\n5. **产品路线图**（P0/P1/P2 功能排序，3 个月规划）\n6. **给 CEO 的建议**（你认为 CEO 应该知道的产品视角）",
        "output": "product_report",
        "depends_on": [
          "ceo_analyze"
        ]
      },
      {
        "id": "hr_dept",
        "expert": "agency_hr_hr_recruiter",
        "task": "你是 HR 部负责人。CEO 给了以下指示：\n\n{{ceo_decision}}\n\n原始需求：{{request}}\n公司背景：{{context}}\n\n请作为 HR 部负责人，输出：\n1. **团队现状评估**（当前团队能力是否匹配需求）\n2. **招聘计划**（需要补充什么岗位、JD 要点、人数）\n3. **组织架构建议**（是否需要调整汇报关系或新建团队）\n4. **人才发展**（现有团队需要什么培训或成长路径）\n5. **招聘时间表和成本**（招聘周期、预算）\n6. **给 CEO 的建议**（你认为 CEO 应该知道的组织视角）",
        "output": "hr_report",
        "depends_on": [
          "ceo_analyze"
        ]
      },
      {
        "id": "ceo_decision_final",
        "expert": "agency_support_support_executive_summary_generator",
        "task": "你是 CEO。各部门已提交工作报告，请综合所有信息做最终决策。\n\n原始需求：{{request}}\n\nCEO 初步分析：\n{{ceo_decision}}\n\n各部门报告（仅包含被激活的部门）：\n\n工程部报告：\n{{engineering_report}}\n\n市场部报告：\n{{marketing_report}}\n\n产品部报告：\n{{product_report}}\n\nHR 部报告：\n{{hr_report}}\n\n请输出最终决策文档：\n\n# CEO 决策备忘录\n\n## 执行摘要\n[一段话总结决策和理由]\n\n## 决策要点\n1. [做什么 / 不做什么]\n2. [优先级排序]\n3. [资源分配]\n\n## 各部门行动项\n| 部门 | 行动项 | 负责人 | 截止日期 |\n|------|--------|--------|---------|\n[从各部门报告中提取具体可执行的行动]\n\n## 里程碑\n[关键节点和检查点]\n\n## 预算总览\n[汇总各部门的预算需求]\n\n## 风险与应对\n[综合各部门提出的风险，给出应对策略]\n\n## 下次复盘时间\n[建议的复盘节点]",
        "output": null,
        "depends_on": [
          "engineering_dept",
          "marketing_dept",
          "product_dept",
          "hr_dept"
        ]
      }
    ]
  },
  {
    "key": "department-collab\\code-review",
    "file": "department-collab\\code-review.yaml",
    "name": "代码评审流程",
    "description": "架构/安全/性能并行评审 → 汇总 → 不通过则打回重审（最多 2 轮）",
    "category": "department-collab",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "code",
        "description": "待评审的代码或 PR 描述",
        "required": true
      },
      {
        "name": "context",
        "description": "代码背景说明（功能目的、影响范围等）",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "arch_review",
        "expert": "agency_engineering_engineering_software_architect",
        "task": "请从架构角度评审以下代码：\n\n背景：{{context}}\n\n代码：\n{{code}}\n\n请评估：\n1. 架构合理性\n2. 设计模式使用\n3. 可维护性\n4. 改进建议",
        "output": "arch_report",
        "depends_on": []
      },
      {
        "id": "security_review",
        "expert": "agency_engineering_engineering_security_engineer",
        "task": "请从安全角度评审以下代码：\n\n背景：{{context}}\n\n代码：\n{{code}}\n\n请检查：\n1. OWASP Top 10 风险\n2. 输入验证\n3. 认证授权\n4. 数据保护",
        "output": "security_report",
        "depends_on": []
      },
      {
        "id": "perf_review",
        "expert": "agency_testing_testing_performance_benchmarker",
        "task": "请从性能角度评审以下代码：\n\n背景：{{context}}\n\n代码：\n{{code}}\n\n请评估：\n1. 时间复杂度\n2. 内存使用\n3. 并发安全性\n4. 性能瓶颈和优化建议",
        "output": "perf_report",
        "depends_on": []
      },
      {
        "id": "summary",
        "expert": "agency_engineering_engineering_code_reviewer",
        "task": "请综合以下三方面评审结果，给出最终评审结论：\n\n## 架构评审\n{{arch_report}}\n\n## 安全评审\n{{security_report}}\n\n## 性能评审\n{{perf_report}}\n\n请输出：\n1. 总体结论（通过 / 需修改 / 不通过）\n2. 必须修改的问题清单\n3. 建议改进项\n如所有评审都没有严重问题，回复「通过」。",
        "output": "review_feedback",
        "depends_on": [
          "arch_review",
          "security_review",
          "perf_review"
        ]
      },
      {
        "id": "revision_request",
        "expert": "agency_engineering_engineering_code_reviewer",
        "task": "第 {{_loop_iteration}} 轮评审反馈已出，请整理需要开发者修改的具体内容：\n\n评审结论：\n{{review_feedback}}\n\n请输出结构化的修改要求清单。",
        "output": "revision_list",
        "depends_on": [
          "summary"
        ]
      }
    ]
  },
  {
    "key": "department-collab\\content-publish",
    "file": "department-collab\\content-publish.yaml",
    "name": "内容发布流程",
    "description": "选题策划 → 文案撰写 → 品牌审核（不通过打回修改，最多 3 轮）→ 法务合规 → 发布清单",
    "category": "department-collab",
    "featured": false,
    "concurrency": 1,
    "inputs": [
      {
        "name": "topic",
        "description": "内容主题",
        "required": true
      },
      {
        "name": "platform",
        "description": "发布平台（公众号/小红书/抖音等）",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "plan",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "请为以下主题制定内容策划方案：\n\n主题：{{topic}}\n平台：{{platform}}\n\n请输出：\n1. 选题角度\n2. 目标受众\n3. 内容大纲\n4. 预期效果",
        "output": "content_plan",
        "depends_on": []
      },
      {
        "id": "write",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "根据以下策划方案撰写完整文案：\n\n{{content_plan}}\n\n平台：{{platform}}\n要求：符合平台调性，有吸引力",
        "output": "copy",
        "depends_on": [
          "plan"
        ]
      },
      {
        "id": "brand_review",
        "expert": "agency_design_design_brand_guardian",
        "task": "请审核以下文案是否符合品牌规范：\n\n{{copy}}\n\n审核要点：\n1. 品牌调性一致性\n2. 用语规范性\n3. 视觉建议\n如合格请回复「通过」，否则给出具体修改意见。",
        "output": "brand_feedback",
        "depends_on": [
          "write"
        ]
      },
      {
        "id": "revise",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "根据品牌审核反馈修改文案（第 {{_loop_iteration}} 轮修改）：\n\n原稿：\n{{copy}}\n\n审核意见：\n{{brand_feedback}}\n\n请输出修改后的完整文案。",
        "output": "copy",
        "depends_on": [
          "brand_review"
        ]
      },
      {
        "id": "legal_review",
        "expert": "agency_support_support_legal_compliance_checker",
        "task": "请对以下即将发布的内容进行法务合规审查：\n\n{{copy}}\n\n审查要点：\n1. 广告法合规性\n2. 知识产权风险\n3. 敏感词检查\n4. 免责声明建议",
        "output": "legal_report",
        "depends_on": [
          "revise"
        ]
      },
      {
        "id": "publish_checklist",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "综合以下信息，输出最终发布清单：\n\n最终文案：\n{{copy}}\n\n法务审查：\n{{legal_report}}\n\n平台：{{platform}}\n\n请输出：\n1. 发布时间建议\n2. 标签/话题建议\n3. 注意事项",
        "output": null,
        "depends_on": [
          "legal_review"
        ]
      }
    ]
  },
  {
    "key": "department-collab\\hiring-pipeline",
    "file": "department-collab\\hiring-pipeline.yaml",
    "name": "招聘评估流程",
    "description": "HR 筛选简历 → 按岗位类型分流技术/业务评估 → 薪酬方案 → 最终审批",
    "category": "department-collab",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "resume",
        "description": "候选人简历内容",
        "required": true
      },
      {
        "name": "job_title",
        "description": "应聘岗位名称",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "screen",
        "expert": "agency_hr_hr_recruiter",
        "task": "请筛选以下简历，评估候选人是否符合「{{job_title}}」岗位要求：\n\n1. 基本条件匹配度\n2. 工作经验相关性\n3. 技能匹配程度\n4. 判断岗位类型，只回答一个词：技术岗 或 非技术岗\n\n简历：\n{{resume}}",
        "output": "screen_result",
        "depends_on": []
      },
      {
        "id": "tech_eval",
        "expert": "agency_engineering_engineering_software_architect",
        "task": "请对以下候选人进行技术面评估：\n\n筛选报告：\n{{screen_result}}\n\n请评估：\n1. 技术深度和广度\n2. 系统设计能力\n3. 编码能力评估建议\n4. 技术成长潜力",
        "output": "eval_result",
        "depends_on": [
          "screen"
        ]
      },
      {
        "id": "biz_eval",
        "expert": "agency_product_product_manager",
        "task": "请对以下候选人进行业务面评估：\n\n筛选报告：\n{{screen_result}}\n\n请评估：\n1. 业务理解能力\n2. 沟通协作能力\n3. 项目管理经验\n4. 发展潜力",
        "output": "eval_result",
        "depends_on": [
          "screen"
        ]
      },
      {
        "id": "salary",
        "expert": "agency_hr_hr_recruiter",
        "task": "基于以下评估结果，制定薪酬方案建议：\n\n岗位：{{job_title}}\n评估报告：\n{{eval_result}}\n\n请输出：\n1. 建议薪资范围\n2. 福利方案\n3. 谈判策略建议",
        "output": null,
        "depends_on": [
          "tech_eval",
          "biz_eval"
        ]
      },
      {
        "id": "final_approval",
        "expert": "agency_product_product_manager",
        "task": "",
        "output": null,
        "depends_on": [
          "salary"
        ]
      }
    ]
  },
  {
    "key": "department-collab\\incident-response",
    "file": "department-collab\\incident-response.yaml",
    "name": "故障响应流程",
    "description": "故障分类 → 按类型分流给对应团队分析 → 复盘汇总",
    "category": "department-collab",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "incident_report",
        "description": "故障报告内容（告警信息、影响范围等）",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "classify",
        "expert": "agency_engineering_engineering_sre",
        "task": "请分析以下故障报告，判断故障类型并给出初步评估：\n\n{{incident_report}}\n\n请输出：\n1. 故障严重程度（P0/P1/P2/P3）\n2. 影响范围\n3. 故障类型（只回答一个：后端故障 / 前端故障 / 基础设施故障）\n4. 初步判断的根因方向",
        "output": "classification",
        "depends_on": []
      },
      {
        "id": "backend_analysis",
        "expert": "agency_engineering_engineering_backend_architect",
        "task": "请深入分析以下后端故障：\n\n故障分类报告：\n{{classification}}\n\n原始报告：\n{{incident_report}}\n\n请输出：\n1. 根因分析\n2. 修复方案\n3. 临时缓解措施\n4. 预计恢复时间",
        "output": "analysis_result",
        "depends_on": [
          "classify"
        ]
      },
      {
        "id": "frontend_analysis",
        "expert": "agency_engineering_engineering_frontend_developer",
        "task": "请深入分析以下前端故障：\n\n故障分类报告：\n{{classification}}\n\n原始报告：\n{{incident_report}}\n\n请输出：\n1. 根因分析\n2. 修复方案\n3. 回滚方案\n4. 用户影响评估",
        "output": "analysis_result",
        "depends_on": [
          "classify"
        ]
      },
      {
        "id": "infra_analysis",
        "expert": "agency_engineering_engineering_devops_automator",
        "task": "请深入分析以下基础设施故障：\n\n故障分类报告：\n{{classification}}\n\n原始报告：\n{{incident_report}}\n\n请输出：\n1. 根因分析\n2. 修复方案\n3. 容灾切换建议\n4. 基础设施加固建议",
        "output": "analysis_result",
        "depends_on": [
          "classify"
        ]
      },
      {
        "id": "postmortem",
        "expert": "agency_engineering_engineering_sre",
        "task": "请根据以下信息撰写故障复盘报告：\n\n故障分类：\n{{classification}}\n\n详细分析：\n{{analysis_result}}\n\n请输出完整复盘文档：\n1. 时间线\n2. 根因总结\n3. 修复措施\n4. 改进项（短期/长期）\n5. 经验教训",
        "output": null,
        "depends_on": [
          "backend_analysis",
          "frontend_analysis",
          "infra_analysis"
        ]
      }
    ]
  },
  {
    "key": "department-collab\\marketing-campaign",
    "file": "department-collab\\marketing-campaign.yaml",
    "name": "营销活动策划",
    "description": "市场调研 → 创意策划 → 预算审批 → 投放方案 → 效果分析",
    "category": "department-collab",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "product",
        "description": "产品/服务名称和简介",
        "required": true
      },
      {
        "name": "budget",
        "description": "预算范围",
        "required": true
      },
      {
        "name": "goal",
        "description": "营销目标（拉新/促活/品牌等）",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "research",
        "expert": "agency_product_product_trend_researcher",
        "task": "请为以下产品进行市场调研分析：\n\n产品：{{product}}\n营销目标：{{goal}}\n预算：{{budget}}\n\n请输出：\n1. 目标市场分析\n2. 竞品营销策略\n3. 目标受众画像\n4. 渠道建议",
        "output": "research_report",
        "depends_on": []
      },
      {
        "id": "creative",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "基于以下市场调研，制定创意策划方案：\n\n{{research_report}}\n\n营销目标：{{goal}}\n预算：{{budget}}\n\n请输出：\n1. 活动主题和创意概念\n2. 内容矩阵规划\n3. 关键传播节点\n4. 预期 KPI",
        "output": "creative_plan",
        "depends_on": [
          "research"
        ]
      },
      {
        "id": "budget_approval",
        "expert": "agency_product_product_manager",
        "task": "{{creative_plan}}",
        "output": "approval_result",
        "depends_on": [
          "creative"
        ]
      },
      {
        "id": "channel_plan",
        "expert": "agency_marketing_marketing_social_media_strategist",
        "task": "已批准的营销方案如下，请制定详细的多渠道投放计划：\n\n{{creative_plan}}\n\n预算：{{budget}}\n\n请输出：\n1. 各渠道预算分配\n2. 投放时间表\n3. 素材需求清单\n4. A/B 测试计划",
        "output": "channel_plan",
        "depends_on": [
          "budget_approval"
        ]
      },
      {
        "id": "analysis",
        "expert": "agency_product_product_feedback_synthesizer",
        "task": "请为以下营销活动设计效果评估框架：\n\n投放计划：\n{{channel_plan}}\n\n请输出：\n1. 核心监测指标\n2. 数据采集方案\n3. 归因模型建议\n4. 优化迭代机制",
        "output": null,
        "depends_on": [
          "channel_plan"
        ]
      }
    ]
  },
  {
    "key": "design\\requirement-to-plan",
    "file": "design\\requirement-to-plan.yaml",
    "name": "需求到计划",
    "description": "产品经理分析需求 → 架构师设计方案 → 项目经理拆任务",
    "category": "design",
    "featured": false,
    "concurrency": 1,
    "inputs": [
      {
        "name": "requirement",
        "description": "需求描述（用户故事、功能说明、业务背景等）",
        "required": true
      },
      {
        "name": "constraints",
        "description": "约束条件（时间、预算、技术栈限制等）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "analyze_req",
        "expert": "agency_product_product_manager",
        "task": "请分析以下需求，明确范围和优先级：\n\n需求描述：{{requirement}}\n\n约束条件：{{constraints}}\n\n请输出：\n1. 需求理解（用一段话概括核心诉求）\n2. 用户价值分析（解决了什么痛点、影响多少用户）\n3. 功能范围界定（MVP 包含什么、不包含什么）\n4. 优先级排序（P0/P1/P2，附理由）\n5. 验收标准（如何判定需求已完成）\n6. 风险点和待确认事项",
        "output": "req_analysis",
        "depends_on": []
      },
      {
        "id": "tech_design",
        "expert": "agency_engineering_engineering_software_architect",
        "task": "请根据产品需求分析，设计技术方案：\n\n## 需求分析\n{{req_analysis}}\n\n原始需求：{{requirement}}\n\n约束条件：{{constraints}}\n\n请输出：\n1. 技术方案概述（一句话说明整体思路）\n2. 系统架构设计（模块划分、接口设计、数据流）\n3. 技术选型及理由\n4. 数据模型设计\n5. 关键技术难点及解决思路\n6. 非功能性需求方案（性能、安全、可扩展性）\n7. 技术风险评估",
        "output": "tech_plan",
        "depends_on": [
          "analyze_req"
        ]
      },
      {
        "id": "task_breakdown",
        "expert": "agency_project-management_project_manager_senior",
        "task": "请根据需求分析和技术方案，拆解为可执行的任务：\n\n## 需求分析\n{{req_analysis}}\n\n## 技术方案\n{{tech_plan}}\n\n请输出：\n1. 任务清单（每个任务包含：ID、标题、描述、负责角色）\n2. 任务依赖关系（哪些可并行、哪些有先后）\n3. 工时估算（每个任务的预估人天）\n4. 里程碑规划（按阶段划分，含时间节点）\n5. 风险缓冲建议\n6. 总工期估算和关键路径",
        "output": "task_plan",
        "depends_on": [
          "tech_design"
        ]
      }
    ]
  },
  {
    "key": "design\\ux-review",
    "file": "design\\ux-review.yaml",
    "name": "UX 体验审查",
    "description": "UX 研究员评估 + 无障碍审核 → UX 架构师汇总",
    "category": "design",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "product_description",
        "description": "产品描述（功能说明、目标用户、核心流程）",
        "required": true
      },
      {
        "name": "screenshots_or_flow",
        "description": "界面截图描述或用户流程图（可选）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "ux_eval",
        "expert": "agency_design_design_ux_researcher",
        "task": "请对以下产品进行用户体验评估：\n\n产品描述：{{product_description}}\n\n界面/流程：{{screenshots_or_flow}}\n\n请从以下维度评估：\n1. 可用性启发式评估（基于 Nielsen 十大原则）\n2. 用户认知负荷分析\n3. 信息架构合理性\n4. 交互流程效率（关键任务步数、操作成本）\n5. 错误预防与恢复机制\n6. 体验优化建议（按优先级排序）",
        "output": "ux_report",
        "depends_on": []
      },
      {
        "id": "a11y_check",
        "expert": "agency_testing_testing_accessibility_auditor",
        "task": "请对以下产品进行无障碍合规检查：\n\n产品描述：{{product_description}}\n\n界面/流程：{{screenshots_or_flow}}\n\n请检查：\n1. WCAG 2.1 AA 级合规性评估\n2. 视觉无障碍（色彩对比度、字号、间距）\n3. 键盘可访问性（Tab 顺序、焦点管理）\n4. 屏幕阅读器兼容性（语义化标签、ARIA 属性）\n5. 动态内容的无障碍处理（动画、弹窗、实时更新）\n6. 不合规项清单及修复建议",
        "output": "a11y_report",
        "depends_on": []
      },
      {
        "id": "summary",
        "expert": "agency_design_design_ux_architect",
        "task": "请综合 UX 评估和无障碍审核结果，输出汇总审查报告：\n\n## UX 体验评估\n{{ux_report}}\n\n## 无障碍审核\n{{a11y_report}}\n\n产品描述：{{product_description}}\n\n请输出：\n1. 总体体验评分（满分 10 分，含各维度分项）\n2. 关键问题清单（严重程度：高/中/低）\n3. 改进路线图（短期速赢 → 中期优化 → 长期规划）\n4. 无障碍合规差距及修复优先级\n5. 最佳实践建议",
        "output": "review_summary",
        "depends_on": [
          "ux_eval",
          "a11y_check"
        ]
      }
    ]
  },
  {
    "key": "dev\\api-doc-gen",
    "file": "dev\\api-doc-gen.yaml",
    "name": "API 文档生成",
    "description": "分析代码生成 API 文档 → 验证完整性 → 输出最终文档",
    "category": "dev",
    "featured": false,
    "concurrency": 1,
    "inputs": [
      {
        "name": "api_code",
        "description": "API 源代码（路由定义、控制器、接口声明等）",
        "required": true
      },
      {
        "name": "api_context",
        "description": "API 上下文说明（项目背景、认证方式、基础 URL 等）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "analyze",
        "expert": "agency_engineering_engineering_technical_writer",
        "task": "请分析以下 API 代码，生成完整的 API 文档：\n\n## API 代码\n{{api_code}}\n\n## 上下文信息\n{{api_context}}\n\n请按以下结构生成文档：\n\n### 对每个 API 端点，请提供：\n1. **接口路径**：HTTP 方法 + URL\n2. **功能描述**：简洁说明接口用途\n3. **请求参数**：\n   - Path 参数（类型、是否必填、说明）\n   - Query 参数（类型、是否必填、默认值、说明）\n   - Body 参数（完整的 JSON Schema，含嵌套结构）\n4. **请求头**：需要的认证头和自定义头\n5. **响应格式**：\n   - 成功响应（状态码 + 示例 JSON）\n   - 错误响应（各错误状态码 + 示例）\n6. **调用示例**：cURL 命令示例\n\n文档风格要求：清晰、准确、面向开发者。",
        "output": "api_doc_draft",
        "depends_on": []
      },
      {
        "id": "validate",
        "expert": "agency_testing_testing_api_tester",
        "task": "请审查以下 API 文档的完整性和准确性：\n\n## API 文档草稿\n{{api_doc_draft}}\n\n## 原始 API 代码（供对照）\n{{api_code}}\n\n请检查以下方面：\n1. **完整性**：是否所有端点都已记录、是否有遗漏的参数或响应字段\n2. **准确性**：参数类型是否正确、必填/选填标注是否与代码一致\n3. **示例有效性**：请求和响应示例是否合法、是否能实际运行\n4. **错误处理**：是否记录了常见错误状态码和错误消息格式\n5. **一致性**：命名风格、描述格式是否全文一致\n\n请输出：\n- 发现的问题清单（按严重程度排序）\n- 每个问题的具体修改建议",
        "output": "validation_report",
        "depends_on": [
          "analyze"
        ]
      },
      {
        "id": "finalize",
        "expert": "agency_engineering_engineering_technical_writer",
        "task": "请根据审查反馈，修正并输出最终版 API 文档：\n\n## 文档草稿\n{{api_doc_draft}}\n\n## 审查反馈\n{{validation_report}}\n\n请：\n1. 逐条修复审查中指出的所有问题\n2. 确保文档格式统一、排版美观\n3. 在文档开头添加概览部分（API 列表、认证说明、通用错误码）\n4. 在文档末尾添加更新日志模板\n\n输出完整的、可直接使用的 API 文档。",
        "output": "final_api_doc",
        "depends_on": [
          "validate"
        ]
      }
    ]
  },
  {
    "key": "dev\\pr-review",
    "file": "dev\\pr-review.yaml",
    "name": "PR 代码审查",
    "description": "三维度并行审查：代码质量、安全性、性能 → 汇总结论",
    "category": "dev",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "pr_diff",
        "description": "PR 的 diff 内容（代码变更）",
        "required": true
      },
      {
        "name": "pr_description",
        "description": "PR 描述（功能说明、变更目的、影响范围）",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "code_quality",
        "expert": "agency_engineering_engineering_code_reviewer",
        "task": "请对以下 PR 进行代码质量审查：\n\n## PR 描述\n{{pr_description}}\n\n## 代码变更\n{{pr_diff}}\n\n请从以下维度进行详细审查：\n1. **代码规范**：命名是否清晰、风格是否一致、是否符合项目约定\n2. **逻辑正确性**：边界条件处理、错误处理是否完善、是否有逻辑漏洞\n3. **可维护性**：代码复杂度、函数拆分是否合理、是否有重复代码\n4. **可读性**：注释是否充分、代码意图是否清晰\n5. **测试覆盖**：关键路径是否有测试、边界情况是否覆盖\n\n请对每个维度给出评分（1-5）和具体问题列表。",
        "output": "quality_report",
        "depends_on": []
      },
      {
        "id": "security_check",
        "expert": "agency_engineering_engineering_security_engineer",
        "task": "请对以下 PR 进行安全审查：\n\n## PR 描述\n{{pr_description}}\n\n## 代码变更\n{{pr_diff}}\n\n请重点检查以下安全风险：\n1. **注入风险**：SQL 注入、XSS、命令注入等\n2. **认证授权**：权限检查是否充分、是否存在越权风险\n3. **数据安全**：敏感数据是否加密、日志是否泄露敏感信息\n4. **依赖安全**：新引入的依赖是否有已知漏洞\n5. **配置安全**：是否有硬编码密钥、不安全的默认配置\n\n请对每个问题标注严重等级（高/中/低），并给出修复建议。",
        "output": "security_report",
        "depends_on": []
      },
      {
        "id": "perf_check",
        "expert": "agency_testing_testing_performance_benchmarker",
        "task": "请对以下 PR 进行性能审查：\n\n## PR 描述\n{{pr_description}}\n\n## 代码变更\n{{pr_diff}}\n\n请重点评估以下方面：\n1. **算法效率**：时间复杂度和空间复杂度是否合理\n2. **资源使用**：内存分配、文件句柄、数据库连接是否正确管理\n3. **并发安全**：是否有竞态条件、死锁风险\n4. **I/O 性能**：网络请求、数据库查询是否有 N+1 问题或不必要的重复调用\n5. **缓存策略**：是否有适合缓存的场景未使用缓存\n\n请对每个性能问题给出影响评估和优化建议。",
        "output": "perf_report",
        "depends_on": []
      },
      {
        "id": "summary",
        "expert": "agency_engineering_engineering_code_reviewer",
        "task": "综合三维度审查结果，给出最终结论。\n\n## 代码质量\n{{quality_report}}\n\n## 安全审查\n{{security_report}}\n\n## 性能审查\n{{perf_report}}\n\n输出格式（markdown）：\n### 结论：[✅ 可合并 / ⚠️ 需修改 / ❌ 需重写]\n\n### 综合评分\n| 维度 | 评分(1-5) | 关键发现 |\n|------|----------|---------|\n| 代码质量 | | |\n| 安全性 | | |\n| 性能 | | |\n\n### 必须修改（Blocking）\n1. [严重/高] 问题 → 修复建议\n\n### 建议改进（Non-blocking）\n1. 问题 → 优化方向\n\n### 亮点\n- 值得肯定的实践",
        "output": "final_review",
        "depends_on": [
          "code_quality",
          "security_check",
          "perf_check"
        ]
      }
    ]
  },
  {
    "key": "dev\\readme-i18n",
    "file": "dev\\readme-i18n.yaml",
    "name": "README 国际化",
    "description": "翻译 README → 审查技术术语 → 润色输出最终版",
    "category": "dev",
    "featured": false,
    "concurrency": 1,
    "inputs": [
      {
        "name": "readme_content",
        "description": "原始 README 内容",
        "required": true
      },
      {
        "name": "target_language",
        "description": "目标语言",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "translate",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "请将以下 README 文档翻译为 {{target_language}}：\n\n{{readme_content}}\n\n翻译要求：\n1. 保持 Markdown 格式不变（标题、链接、代码块、表格等）\n2. 代码示例中的注释翻译，代码本身不翻译\n3. 技术术语保留英文（如 API、Docker、CI/CD 等）\n4. 品牌名和项目名保留原文\n5. 语言自然流畅，不要机翻味\n6. 保留所有链接和图片引用",
        "output": "translated_draft",
        "depends_on": []
      },
      {
        "id": "review_terms",
        "expert": "agency_engineering_engineering_technical_writer",
        "task": "请审查以下翻译后的 README 文档中的技术术语使用：\n\n## 翻译稿\n{{translated_draft}}\n\n## 原文（供对照）\n{{readme_content}}\n\n请检查：\n1. 术语一致性：同一术语在全文中翻译是否统一\n2. 术语准确性：技术概念翻译是否准确\n3. 保留原则：应保留英文的术语是否误翻了\n4. 格式完整性：Markdown 结构是否保持完好\n\n请输出需要修改的术语列表和修改建议。",
        "output": "term_review",
        "depends_on": [
          "translate"
        ]
      },
      {
        "id": "polish",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "请根据术语审查反馈，润色并输出最终版的翻译 README：\n\n## 翻译稿\n{{translated_draft}}\n\n## 术语审查反馈\n{{term_review}}\n\n请修正所有指出的术语问题，统一语言风格，输出完整最终版文档。",
        "output": "final_readme",
        "depends_on": [
          "review_terms"
        ]
      }
    ]
  },
  {
    "key": "dev\\release-checklist",
    "file": "dev\\release-checklist.yaml",
    "name": "发布检查清单",
    "description": "SRE + 性能 + 安全三方检查 → Go/No-Go 决策",
    "category": "dev",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "release_notes",
        "description": "发布说明（变更列表、新功能、修复的 bug）",
        "required": true
      },
      {
        "name": "version",
        "description": "版本号",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "infra_check",
        "expert": "agency_engineering_engineering_sre",
        "task": "请对以下版本发布进行基础设施就绪检查：\n\n版本：{{version}}\n\n发布说明：\n{{release_notes}}\n\n请检查以下方面并给出 ✅/❌ 评估：\n1. 部署流水线是否就绪（CI/CD 配置、构建脚本）\n2. 回滚方案是否准备（回滚脚本、数据库迁移可逆性）\n3. 监控告警是否配置（关键指标、告警阈值）\n4. 容量规划是否充分（预期流量、资源预留）\n5. 依赖服务状态（上下游服务兼容性）\n6. 灰度发布计划（发布比例、观察时间）",
        "output": "infra_report",
        "depends_on": []
      },
      {
        "id": "perf_check",
        "expert": "agency_testing_testing_performance_benchmarker",
        "task": "请对以下版本进行性能基准验证：\n\n版本：{{version}}\n\n发布说明：\n{{release_notes}}\n\n请评估：\n1. 变更是否可能引入性能回退\n2. 关键接口的预期延迟影响\n3. 数据库查询的性能影响\n4. 内存使用变化预估\n5. 并发处理能力影响\n6. 性能测试建议（需要额外测试的场景）",
        "output": "perf_report",
        "depends_on": []
      },
      {
        "id": "security_final",
        "expert": "agency_engineering_engineering_security_engineer",
        "task": "请对以下版本进行最终安全检查：\n\n版本：{{version}}\n\n发布说明：\n{{release_notes}}\n\n请检查：\n1. 新增代码是否引入安全漏洞\n2. 依赖更新是否有已知 CVE\n3. 配置变更是否影响安全策略\n4. 数据处理变更是否合规\n5. API 变更是否影响认证授权\n6. 敏感信息是否意外暴露",
        "output": "security_report",
        "depends_on": []
      },
      {
        "id": "go_no_go",
        "expert": "agency_project-management_project_manager_senior",
        "task": "请综合以下三方检查报告，做出发布决策：\n\n版本：{{version}}\n\n## 基础设施检查\n{{infra_report}}\n\n## 性能评估\n{{perf_report}}\n\n## 安全检查\n{{security_report}}\n\n请输出：\n1. **决策：🟢 Go / 🔴 No-Go / 🟡 有条件 Go**\n2. 决策依据（关键考量点）\n3. 如果是 No-Go，列出阻塞项和解决方案\n4. 如果是有条件 Go，列出必须在发布前/后完成的事项\n5. 发布后监控重点（前 24 小时关注什么）\n6. 回滚触发条件（什么情况下立即回滚）",
        "output": "release_decision",
        "depends_on": [
          "infra_check",
          "perf_check",
          "security_final"
        ]
      }
    ]
  },
  {
    "key": "dev\\security-audit",
    "file": "dev\\security-audit.yaml",
    "name": "安全审计",
    "description": "安全工程师 + 威胁检测并行审计 → 汇总安全报告",
    "category": "dev",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "code_or_system",
        "description": "待审计的代码或系统描述",
        "required": true
      },
      {
        "name": "threat_model",
        "description": "已知的威胁模型或关注的攻击面",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "vuln_scan",
        "expert": "agency_engineering_engineering_security_engineer",
        "task": "请对以下代码/系统进行安全漏洞扫描：\n\n## 审计对象\n{{code_or_system}}\n\n## 威胁模型\n{{threat_model}}\n\n请检查以下方面：\n1. OWASP Top 10 漏洞（注入、XSS、CSRF、SSRF 等）\n2. 认证与授权缺陷\n3. 敏感数据泄露风险（硬编码密钥、日志泄露等）\n4. 不安全的依赖（已知 CVE）\n5. 配置安全（CORS、CSP、安全头）\n6. 加密使用是否正确\n\n对每个发现，请标注：\n- 严重程度（Critical / High / Medium / Low）\n- 影响描述\n- 修复建议",
        "output": "vuln_report",
        "depends_on": []
      },
      {
        "id": "threat_detect",
        "expert": "agency_engineering_engineering_threat_detection_engineer",
        "task": "请对以下代码/系统进行威胁检测分析：\n\n## 审计对象\n{{code_or_system}}\n\n## 威胁模型\n{{threat_model}}\n\n请分析：\n1. 攻击面枚举（外部输入点、API 端点、文件上传等）\n2. 数据流中的信任边界\n3. 权限提升路径\n4. 侧信道攻击风险\n5. 供应链安全风险\n6. 运行时安全（内存安全、竞态条件）\n\n对每个威胁，请按 STRIDE 模型分类并评估利用难度。",
        "output": "threat_report",
        "depends_on": []
      },
      {
        "id": "report",
        "expert": "agency_engineering_engineering_security_engineer",
        "task": "请综合以下两份安全分析报告，输出最终安全审计报告：\n\n## 漏洞扫描报告\n{{vuln_report}}\n\n## 威胁检测报告\n{{threat_report}}\n\n请输出结构化的安全审计报告：\n1. 执行摘要（总体安全评级 A-F）\n2. 关键发现（按严重程度排序的 Top 10 问题）\n3. 详细发现清单（含修复建议和优先级）\n4. 修复路线图建议（短期/中期/长期）\n5. 安全改进建议（架构层面）",
        "output": "final_security_report",
        "depends_on": [
          "vuln_scan",
          "threat_detect"
        ]
      }
    ]
  },
  {
    "key": "dev\\tech-debt-audit",
    "file": "dev\\tech-debt-audit.yaml",
    "name": "技术债务审计",
    "description": "架构评估 + 代码扫描 + 测试分析 → 优先级排序",
    "category": "dev",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "codebase_description",
        "description": "代码库描述（技术栈、模块结构、核心功能）",
        "required": true
      },
      {
        "name": "focus_area",
        "description": "重点关注领域（如：数据库层、API 层、前端组件等）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "arch_review",
        "expert": "agency_engineering_engineering_software_architect",
        "task": "请对以下代码库进行架构合理性评估：\n\n## 代码库描述\n{{codebase_description}}\n\n## 重点关注\n{{focus_area}}\n\n请从以下维度分析架构债务：\n1. **分层合理性**：各层职责是否清晰、是否存在跨层依赖\n2. **模块耦合度**：模块间是否高内聚低耦合、循环依赖情况\n3. **扩展性**：架构是否能支撑未来业务增长、扩展点是否预留\n4. **一致性**：架构风格是否统一、是否存在多种模式混用\n5. **技术选型**：依赖的框架/库是否仍在活跃维护、是否有更优替代\n\n请为每项债务标注严重程度和修复成本（高/中/低）。",
        "output": "arch_report",
        "depends_on": []
      },
      {
        "id": "code_scan",
        "expert": "agency_engineering_engineering_code_reviewer",
        "task": "请对以下代码库进行代码质量扫描：\n\n## 代码库描述\n{{codebase_description}}\n\n## 重点关注\n{{focus_area}}\n\n请识别以下类型的技术债务：\n1. **代码重复**：是否存在大量复制粘贴代码、可提取的公共逻辑\n2. **复杂度过高**：圈复杂度过高的函数、过长的文件/类\n3. **命名混乱**：不一致的命名风格、含义不清的变量名\n4. **注释与文档**：缺失关键注释、过时的文档、TODO/HACK 标记\n5. **错误处理**：不完善的异常处理、吞掉的错误、缺失的日志\n6. **废弃代码**：未使用的函数、注释掉的代码块、死代码路径\n\n请为每个问题给出具体位置描述和建议的修复方案。",
        "output": "code_report",
        "depends_on": []
      },
      {
        "id": "test_analysis",
        "expert": "agency_testing_testing_test_results_analyzer",
        "task": "请对以下代码库的测试状况进行分析：\n\n## 代码库描述\n{{codebase_description}}\n\n## 重点关注\n{{focus_area}}\n\n请评估以下方面：\n1. **测试覆盖率**：哪些模块缺少测试、关键路径是否覆盖\n2. **测试质量**：测试是否只验证正常路径、边界条件是否覆盖\n3. **测试类型分布**：单元测试/集成测试/端到端测试的比例是否合理\n4. **测试可维护性**：测试代码是否有重复、测试数据管理是否规范\n5. **CI/CD 集成**：测试是否纳入自动化流水线、运行时间是否合理\n\n请为每个薄弱点给出优先级和改进建议。",
        "output": "test_report",
        "depends_on": []
      },
      {
        "id": "prioritize",
        "expert": "agency_product_product_sprint_prioritizer",
        "task": "请综合以下三份技术债务分析报告，进行优先级排序：\n\n## 架构评估\n{{arch_report}}\n\n## 代码质量扫描\n{{code_report}}\n\n## 测试分析\n{{test_report}}\n\n请输出结构化的技术债务清单，按优先级排序：\n1. **P0 - 紧急修复**：影响系统稳定性或安全性的债务，需本迭代解决\n2. **P1 - 高优先级**：影响开发效率或代码质量的债务，建议近 2-3 个迭代解决\n3. **P2 - 中优先级**：改善代码可维护性的债务，可安排在季度规划中\n4. **P3 - 低优先级**：锦上添花的改进，有空闲时处理\n\n对每项债务请说明：\n- 问题描述\n- 影响范围\n- 修复成本估算（人天）\n- 建议的修复方案",
        "output": "debt_priority_list",
        "depends_on": [
          "arch_review",
          "code_scan",
          "test_analysis"
        ]
      }
    ]
  },
  {
    "key": "dev\\tech-design-review",
    "file": "dev\\tech-design-review.yaml",
    "name": "技术方案评审",
    "description": "架构师出方案 → 后端架构师 + 安全工程师并行评审 → 代码审查员整合意见，输出评审结论",
    "category": "dev",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "requirement",
        "description": "需求描述（要做什么、背景、约束条件）",
        "required": true
      },
      {
        "name": "tech_stack",
        "description": "技术栈（如：Node.js + PostgreSQL + Redis）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "design",
        "expert": "agency_engineering_engineering_software_architect",
        "task": "请为以下需求设计技术方案：\n\n需求：{{requirement}}\n技术栈：{{tech_stack}}\n\n请输出完整的技术设计文档：\n1. **背景与目标**（问题是什么、成功标准）\n2. **方案概述**（一段话描述核心设计思路）\n3. **架构设计**（组件图、数据流、关键接口定义）\n4. **数据模型**（核心表/集合设计，字段说明）\n5. **关键技术决策**（为什么选 A 不选 B，tradeoff 分析）\n6. **API 设计**（核心接口的 URL、Method、请求/响应示例）\n7. **非功能需求**（性能目标、可用性、可扩展性）\n8. **里程碑与排期建议**",
        "output": "design_doc",
        "depends_on": []
      },
      {
        "id": "arch_review",
        "expert": "agency_engineering_engineering_backend_architect",
        "task": "请从后端架构角度评审以下技术方案：\n\n{{design_doc}}\n\n评审维度：\n1. **架构合理性**（分层是否清晰、职责是否单一、耦合度）\n2. **性能**（有无性能瓶颈、是否需要缓存/队列/分库分表）\n3. **可扩展性**（流量增长 10 倍时方案是否能撑住）\n4. **容错与高可用**（单点故障、降级策略、数据一致性）\n5. **数据模型**（索引设计、查询模式匹配度）\n6. **技术债务风险**（是否引入难以维护的复杂度）\n\n每条意见标注：✅ 合理 / ⚠️ 建议优化 / ❌ 需要重新设计\n给出具体的改进建议，不要只说\"需要优化\"。",
        "output": "arch_feedback",
        "depends_on": [
          "design"
        ]
      },
      {
        "id": "security_review",
        "expert": "agency_engineering_engineering_security_engineer",
        "task": "请从安全角度评审以下技术方案：\n\n{{design_doc}}\n\n评审维度：\n1. **认证与授权**（身份验证方案、权限模型、Token 管理）\n2. **数据安全**（敏感数据加密、传输加密、脱敏策略）\n3. **输入验证**（SQL 注入、XSS、SSRF 等 OWASP Top 10）\n4. **API 安全**（限流、防刷、签名验证）\n5. **依赖安全**（第三方库风险、供应链安全）\n6. **合规**（日志审计、数据留存、隐私保护）\n\n每条意见标注风险等级：🔴 高 / 🟡 中 / 🟢 低\n给出具体修复方案，不要只指出问题。",
        "output": "security_feedback",
        "depends_on": [
          "design"
        ]
      },
      {
        "id": "review_summary",
        "expert": "agency_engineering_engineering_code_reviewer",
        "task": "请整合以下评审意见，输出最终的技术评审结论：\n\n## 原始设计\n{{design_doc}}\n\n## 架构评审\n{{arch_feedback}}\n\n## 安全评审\n{{security_feedback}}\n\n输出格式：\n\n# 技术方案评审结论\n\n## 总体评价\n[通过 / 有条件通过 / 需要重新设计]\n[一段话总结方案质量和主要问题]\n\n## 必须修改（阻塞项）\n[列出所有 ❌ 和 🔴 级别的问题及修改方案]\n\n## 建议修改（非阻塞）\n[列出所有 ⚠️ 和 🟡 级别的问题及优化建议]\n\n## 确认合理的设计决策\n[列出所有 ✅ 的点，给设计者信心]\n\n## 修改后复审清单\n[列出需要在修改后重点检查的项目]",
        "output": null,
        "depends_on": [
          "arch_review",
          "security_review"
        ]
      }
    ]
  },
  {
    "key": "douyin-script",
    "file": "douyin-script.yaml",
    "name": "抖音口播脚本创作",
    "description": "一句话选题 → 爆款选题分析 + 逐秒脚本 + 标题钩子 + 拍摄建议",
    "category": "",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "topic",
        "description": "视频主题（如：程序员转行做自媒体 / 30 岁如何逆袭）",
        "required": true
      },
      {
        "name": "duration",
        "description": "视频时长（秒）",
        "required": false
      },
      {
        "name": "style",
        "description": "口播风格（如：情绪煽动 / 理性干货 / 犀利毒舌）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "angle",
        "expert": "agency_marketing_marketing_douyin_strategist",
        "task": "围绕主题「{{topic}}」分析爆款潜力，风格定位「{{style}}」。\n\n输出（300 字）:\n1. **用户痛点**: 观看者具体在焦虑什么 / 好奇什么\n2. **切入角度**: 3 个可能爆的角度（每个 1 句话说明钩子）\n3. **推荐角度**: 从 3 个里挑 1 个最可能破播放量的，说明理由\n4. **竞品参考**: 这类选题抖音里已有的典型视频模式（1-2 个）\n5. **差异化打法**: 怎么做才能不像\"又一个同质内容\"",
        "output": "angle",
        "depends_on": []
      },
      {
        "id": "script",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "根据选题写一个 {{duration}} 秒的口播脚本。\n\n选题方向:\n{{angle}}\n\n脚本要求（严格按格式）:\n```\n【0-3s 钩子】\n<开场 1-2 句，必须立刻引发好奇或共鸣，禁止\"大家好\"式寒暄>\n\n【3-10s 抛问题】\n<用一个反常识或痛点把观众黏住>\n\n【10-{{duration}}-10s 正文】\n<分 3-4 个要点讲清楚，每个要点 10-15 秒，口语化，不要书面语>\n要点1: ...\n要点2: ...\n要点3: ...\n\n【最后 10s 收尾】\n<给一个钩子让用户点赞/关注/评论，具体动作不要笼统说\"三连\">\n```\n\n注意:\n- 每句话 ≤ 15 字，短句为主，符合抖音语速\n- 避免专业术语，初中文化也能听懂\n- 可以用\"你\"直呼观众，增强代入",
        "output": "script",
        "depends_on": [
          "angle"
        ]
      },
      {
        "id": "titles",
        "expert": "agency_marketing_marketing_douyin_strategist",
        "task": "围绕选题和脚本，产出抖音视频的标题和话题。\n\n选题:\n{{angle}}\n\n5 个候选标题要求:\n- 每个 ≤ 20 字\n- 至少 2 个带情绪（震惊/反差/质疑）\n- 至少 1 个带数字\n- 必须能让人划到不敢划走\n\n推荐 1 个最可能爆的，说明为什么。\n\n然后给 5 个话题标签（#xxx 格式），按热度和相关度排序。\n\n最后给 **封面文案**（3-5 个字，放在视频首帧做视觉钩子）。",
        "output": "titles_and_tags",
        "depends_on": [
          "angle"
        ]
      },
      {
        "id": "final",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "整合成可以直接拿去拍的完整方案。\n\n脚本:\n{{script}}\n\n标题和话题:\n{{titles_and_tags}}\n\n输出结构:\n```\n【最终标题】: <选推荐标题>\n\n【封面文案】: <3-5 字>\n\n【完整口播稿】:\n<整合后的完整口播，按秒数标注>\n\n【拍摄建议】:\n- 镜头: <主镜头景别、是否需要换镜>\n- 口播状态: <情绪基调，看镜头还是看旁边>\n- 字幕: <建议字幕样式/是否关键词放大>\n- BGM: <节奏建议，不推荐具体歌名>\n\n【话题标签】: <5 个 #xxx>\n\n【发布建议】:\n- 推荐时段:\n- 评论区引导语:\n```\n\n⚠️ 只输出上面这份脚本方案本身：不要开场白/寒暄、不要\"我改了什么/复盘/修改说明\"、不要向用户提问或请其拍板、不要建议 ao 命令或后续动作、不要\"要我继续吗\"之类收尾。",
        "output": "final_video_plan",
        "depends_on": [
          "script",
          "titles"
        ]
      }
    ]
  },
  {
    "key": "en\\business-plan",
    "file": "en\\business-plan.yaml",
    "name": "Business Plan",
    "description": "Market research → financial forecast + product roadmap → executive summary — generates a complete business plan",
    "category": "English",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "idea",
        "description": "Business idea / project description (one paragraph)",
        "required": true
      },
      {
        "name": "stage",
        "description": "Project stage (e.g. seed round, Series A, internal greenfield)",
        "required": false
      },
      {
        "name": "market",
        "description": "Target market (e.g. US SMBs, SEA e-commerce, global developers)",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "market_research",
        "expert": "agency_product_product_trend_researcher",
        "task": "Conduct market research for the following business idea.\n\nIdea: {{idea}}\nTarget market: {{market}}\nStage: {{stage}}\n\nDeliver:\n1. **Market size** (TAM / SAM / SOM)\n2. **Industry trends** (3-5 growth drivers)\n3. **Competitive landscape** (incumbents, concentration, barriers)\n4. **Target customer persona** (early adopters, pain points, willingness to pay)\n5. **Regulatory / policy environment** (tailwinds and risks)",
        "output": "market_report",
        "depends_on": []
      },
      {
        "id": "financial_model",
        "expert": "agency_finance_finance_fpa_analyst",
        "task": "Based on the market research, build a financial forecast model.\n\n{{market_report}}\n\nBusiness idea: {{idea}}\nStage: {{stage}}\n\nDeliver:\n1. **Business model** (revenue streams, pricing, unit economics)\n2. **3-year forecast** (table: revenue, COGS, gross margin, net income, by quarter)\n3. **Key assumptions** (CAC, conversion, retention, ARPU)\n4. **Funding requirement** (how much, use of funds, runway)\n5. **Break-even analysis**",
        "output": "financial_plan",
        "depends_on": [
          "market_research"
        ]
      },
      {
        "id": "product_roadmap",
        "expert": "agency_product_product_manager",
        "task": "Based on the market research, design the product roadmap.\n\n{{market_report}}\n\nBusiness idea: {{idea}}\n\nDeliver:\n1. **Core value proposition** (one-sentence: for whom, solving what)\n2. **MVP definition** (what's in, what's explicitly out)\n3. **Roadmap** (3 phases: goals, features, milestones)\n4. **Defensibility** (tech / data / network effects / brand — what builds a moat)\n5. **Team needs** (what roles at each phase)",
        "output": "product_plan",
        "depends_on": [
          "market_research"
        ]
      },
      {
        "id": "executive_summary",
        "expert": "agency_support_support_executive_summary_generator",
        "task": "Synthesize the above into a complete business plan.\n\n## Market Research\n{{market_report}}\n\n## Financial Forecast\n{{financial_plan}}\n\n## Product Roadmap\n{{product_plan}}\n\nFormat (for investors / decision makers):\n\n# [Project Name] Business Plan\n\n## Executive Summary (1 page — most important)\n- One-line description\n- Market opportunity\n- Business model\n- Team strengths\n- Funding ask and use of funds\n\n## Market Analysis\n[Synthesize market research]\n\n## Product Strategy\n[Synthesize product roadmap]\n\n## Financial Plan\n[Synthesize financial forecast]\n\n## Milestones & Timeline\n[Extract from roadmap]\n\n## Risks & Mitigation\n[Pull risks from each section, provide mitigation strategy]\n\nStyle: professional, data-driven, suitable for investor / executive review.",
        "output": null,
        "depends_on": [
          "financial_model",
          "product_roadmap"
        ]
      }
    ]
  },
  {
    "key": "en\\code-architecture-review",
    "file": "en\\code-architecture-review.yaml",
    "name": "Code Architecture Review",
    "description": "Architecture design → backend deep-dive → code review for a feature or system.",
    "category": "English",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "feature",
        "description": "The feature / system to design and review",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "architecture",
        "expert": "agency_engineering_engineering_software_architect",
        "task": "Propose a clean architecture for: {{feature}}\nCover: components and their responsibilities, data flow, key trade-offs, and the\ntop failure modes with how the design handles them.",
        "output": "architecture",
        "depends_on": []
      },
      {
        "id": "backend",
        "expert": "agency_engineering_engineering_backend_architect",
        "task": "Detail the backend for this architecture: API surface, data model, auth/isolation,\nconcurrency and rate-limiting, and where state lives.\n\n{{architecture}}",
        "output": "backend",
        "depends_on": [
          "architecture"
        ]
      },
      {
        "id": "review",
        "expert": "agency_engineering_engineering_code_reviewer",
        "task": "Critically review the proposed design and backend plan: security, correctness under\nconcurrency, scalability, and operational risks. Give concrete, actionable findings.\n\nArchitecture: {{architecture}}\nBackend: {{backend}}",
        "output": "review",
        "depends_on": [
          "backend"
        ]
      }
    ]
  },
  {
    "key": "en\\competitor-analysis",
    "file": "en\\competitor-analysis.yaml",
    "name": "Competitor Analysis Report",
    "description": "Trend research → data analysis + SEO scan → executive summary — a report ready to present",
    "category": "English",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "product",
        "description": "Your product / service name and brief",
        "required": true
      },
      {
        "name": "competitors",
        "description": "Competitor names (comma-separated, e.g. Notion, Coda, ClickUp)",
        "required": true
      },
      {
        "name": "focus",
        "description": "Focus areas (e.g. pricing, growth, feature gaps)",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "trend_research",
        "expert": "agency_product_product_trend_researcher",
        "task": "Research market trends for the product and its competitors.\n\nOur product: {{product}}\nCompetitors: {{competitors}}\nFocus: {{focus}}\n\nOutput:\n1. Overall industry trends (3-5 key trends)\n2. Notable moves by each competitor in the past 6 months (launches, funding, partnerships)\n3. Market size and growth projection\n4. Technology trends and inflection points",
        "output": "trend_report",
        "depends_on": []
      },
      {
        "id": "data_analysis",
        "expert": "agency_support_support_analytics_reporter",
        "task": "Based on the trend research, perform a quantitative competitor comparison.\n\n{{trend_report}}\n\nCompetitors: {{competitors}}\nFocus: {{focus}}\n\nOutput:\n1. Feature comparison matrix (table: which has what, strong/weak)\n2. Pricing comparison (free / paid / enterprise tiers)\n3. User sentiment analysis (common praises and complaints)\n4. SWOT (us vs each competitor)",
        "output": "data_report",
        "depends_on": [
          "trend_research"
        ]
      },
      {
        "id": "seo_scan",
        "expert": "agency_marketing_marketing_seo_specialist",
        "task": "Analyze competitors from an SEO and content-marketing angle.\n\n{{trend_report}}\n\nCompetitors: {{competitors}}\n\nOutput:\n1. Content strategy per competitor (blog cadence, topics, keyword targeting)\n2. Search visibility comparison (who ranks for what)\n3. Social media share-of-voice comparison\n4. Content opportunities (valuable areas competitors are ignoring)",
        "output": "seo_report",
        "depends_on": [
          "trend_research"
        ]
      },
      {
        "id": "executive_summary",
        "expert": "agency_support_support_executive_summary_generator",
        "task": "Consolidate the analysis into an executive-ready summary.\n\n## Market Trends\n{{trend_report}}\n\n## Data Comparison\n{{data_report}}\n\n## SEO & Content\n{{seo_report}}\n\nFormat:\n1. **One-line verdict**: our competitive position\n2. **Key findings** (3-5 bullets, 1-2 sentences each)\n3. **Threats & opportunities** (3 each)\n4. **Recommended actions** (prioritized, each with owner suggestion and timeframe)\n5. **Full comparison table** (preserve the feature matrix)\n\nStyle: concise, data-driven, ready to present.",
        "output": null,
        "depends_on": [
          "data_analysis",
          "seo_scan"
        ]
      }
    ]
  },
  {
    "key": "en\\content-pipeline",
    "file": "en\\content-pipeline.yaml",
    "name": "Content Creation Pipeline",
    "description": "Topic to finished draft — research, write, brand review, final edit",
    "category": "English",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "topic",
        "description": "Content topic",
        "required": true
      },
      {
        "name": "target_audience",
        "description": "Target audience",
        "required": true
      },
      {
        "name": "platform",
        "description": "Publishing platform (e.g. Substack, LinkedIn, Medium, Twitter)",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "research",
        "expert": "agency_marketing_marketing_social_media_strategist",
        "task": "Research this topic for content.\nTopic: {{topic}}\nAudience: {{target_audience}}\nPlatform: {{platform}}\n\nOutput:\n1. Key information points\n2. Pain points the audience cares about\n3. Competitor / prior-art content analysis\n4. Suggested content angle",
        "output": "research_report",
        "depends_on": []
      },
      {
        "id": "draft",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "Based on this research, write an article suited for {{platform}}.\n\nResearch:\n{{research_report}}\n\nRequirements:\n- Audience: {{target_audience}}\n- Tone and structure suited to {{platform}}\n- Strong, attention-grabbing headline\n- Clear structure, easy to read",
        "output": "draft_content",
        "depends_on": [
          "research"
        ]
      },
      {
        "id": "brand_review",
        "expert": "agency_marketing_marketing_growth_hacker",
        "task": "Review the content for brand fit and effectiveness.\n\n{{draft_content}}\n\nReview criteria:\n1. Tone consistency\n2. Factual accuracy\n3. Any sensitive or risky content\n4. Concrete improvement suggestions",
        "output": "review_feedback",
        "depends_on": [
          "draft"
        ]
      },
      {
        "id": "final_edit",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "Apply the brand review feedback and produce the final draft.\n\nOriginal:\n{{draft_content}}\n\nFeedback:\n{{review_feedback}}\n\nOutput the finalized article.",
        "output": null,
        "depends_on": [
          "brand_review"
        ]
      }
    ]
  },
  {
    "key": "en\\investment-analysis",
    "file": "en\\investment-analysis.yaml",
    "name": "Investment Analysis",
    "description": "Research → fundamentals → financial modeling: a structured analysis of a target.",
    "category": "English",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "target",
        "description": "Stock / fund / sector to analyze",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "research",
        "expert": "agency_finance_finance_investment_researcher",
        "task": "Research the target and produce an objective brief: {{target}}\nCover: what it is, the bull case, the bear case, key drivers, and the main risks.\nBe balanced — surface counter-arguments, not just upside.",
        "output": "research",
        "depends_on": []
      },
      {
        "id": "fundamentals",
        "expert": "agency_finance_finance_financial_analyst",
        "task": "Analyze the fundamentals based on the research. Where exact figures aren't given,\nreason from public, well-known facts and clearly label assumptions.\n\n{{research}}",
        "output": "fundamentals",
        "depends_on": [
          "research"
        ]
      },
      {
        "id": "plan",
        "expert": "agency_finance_finance_fpa_analyst",
        "task": "Synthesize a clear, decision-ready summary for an individual investor:\nthesis in one paragraph, scenarios (base / bull / bear), key metrics to watch,\nand an explicit \"this is not financial advice\" note.\n\nResearch: {{research}}\nFundamentals: {{fundamentals}}",
        "output": "summary",
        "depends_on": [
          "fundamentals"
        ]
      }
    ]
  },
  {
    "key": "en\\okr-decomposition",
    "file": "en\\okr-decomposition.yaml",
    "name": "OKR Decomposition",
    "description": "Annual goal → quarterly KRs → a concrete Q1 action plan.",
    "category": "English",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "annual_goal",
        "description": "The annual objective",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "analyze",
        "expert": "agency_product_product_manager",
        "task": "Analyze the annual goal and the current situation it implies: {{annual_goal}}\nIdentify the few levers that actually move this number and the biggest risks to it.",
        "output": "analysis",
        "depends_on": []
      },
      {
        "id": "kr_design",
        "expert": "agency_project-management_project_manager_senior",
        "task": "From the analysis, design 3-4 quarterly Key Results that are measurable, ambitious but\nrealistic, and clearly ladder up to the annual goal.\n\n{{analysis}}",
        "output": "krs",
        "depends_on": [
          "analyze"
        ]
      },
      {
        "id": "q1_plan",
        "expert": "agency_project-management_project_management_project_shepherd",
        "task": "Turn the KRs into a concrete Q1 action plan: weekly milestones, owners (by role),\ndependencies, and how each week's progress is measured.\n\nAnnual goal: {{annual_goal}}\nKRs: {{krs}}",
        "output": "q1_plan",
        "depends_on": [
          "kr_design"
        ]
      }
    ]
  },
  {
    "key": "en\\pr-review",
    "file": "en\\pr-review.yaml",
    "name": "PR Code Review",
    "description": "Three-dimensional parallel review: code quality, security, performance → unified verdict",
    "category": "English",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "pr_diff",
        "description": "PR diff content (code changes)",
        "required": true
      },
      {
        "name": "pr_description",
        "description": "PR description (what changed, why, scope of impact)",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "code_quality",
        "expert": "agency_engineering_engineering_code_reviewer",
        "task": "Review the following PR for code quality.\n\n## PR Description\n{{pr_description}}\n\n## Code Changes\n{{pr_diff}}\n\nEvaluate across these dimensions:\n1. **Style & conventions**: naming clarity, consistency, adherence to project conventions\n2. **Logic correctness**: edge cases, error handling, logical flaws\n3. **Maintainability**: complexity, function decomposition, duplication\n4. **Readability**: comment quality, intent clarity\n5. **Test coverage**: critical paths, edge cases\n\nFor each dimension provide a score (1-5) and a concrete list of issues.",
        "output": "quality_report",
        "depends_on": []
      },
      {
        "id": "security_check",
        "expert": "agency_engineering_engineering_security_engineer",
        "task": "Review the following PR for security risks.\n\n## PR Description\n{{pr_description}}\n\n## Code Changes\n{{pr_diff}}\n\nFocus on:\n1. **Injection risks**: SQL injection, XSS, command injection, etc.\n2. **Authn/authz**: permission checks, privilege escalation paths\n3. **Data security**: sensitive data encryption, log leakage\n4. **Dependency safety**: newly introduced packages with known CVEs\n5. **Config safety**: hardcoded secrets, insecure defaults\n\nFor each issue mark severity (high/medium/low) and give a remediation suggestion.",
        "output": "security_report",
        "depends_on": []
      },
      {
        "id": "perf_check",
        "expert": "agency_testing_testing_performance_benchmarker",
        "task": "Review the following PR for performance impact.\n\n## PR Description\n{{pr_description}}\n\n## Code Changes\n{{pr_diff}}\n\nFocus on:\n1. **Algorithmic efficiency**: time/space complexity\n2. **Resource usage**: memory, file handles, DB connections\n3. **Concurrency safety**: race conditions, deadlock risk\n4. **I/O performance**: N+1 queries, redundant calls\n5. **Caching opportunities**: cacheable paths that aren't cached\n\nFor each finding, include an impact estimate and an optimization suggestion.",
        "output": "perf_report",
        "depends_on": []
      },
      {
        "id": "summary",
        "expert": "agency_engineering_engineering_code_reviewer",
        "task": "Synthesize the three reviews into a final verdict.\n\n## Code Quality\n{{quality_report}}\n\n## Security\n{{security_report}}\n\n## Performance\n{{perf_report}}\n\nOutput (markdown):\n\n### Verdict: [✅ Mergeable / ⚠️ Needs changes / ❌ Needs rewrite]\n\n### Scorecard\n| Dimension | Score (1-5) | Key findings |\n|-----------|-------------|--------------|\n| Code quality | | |\n| Security | | |\n| Performance | | |\n\n### Must fix (blocking)\n1. [severity] issue → fix suggestion\n\n### Nice to have (non-blocking)\n1. issue → suggestion\n\n### Highlights\n- Things worth calling out positively",
        "output": "final_review",
        "depends_on": [
          "code_quality",
          "security_check",
          "perf_check"
        ]
      }
    ]
  },
  {
    "key": "en\\product-review",
    "file": "en\\product-review.yaml",
    "name": "Product Requirements Review",
    "description": "Multi-role PRD review — PM analyzes requirements, architect assesses tech, UX researcher assesses experience, then synthesis",
    "category": "English",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "prd_content",
        "description": "PRD document content",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "analyze",
        "expert": "agency_product_product_manager",
        "task": "Analyze the following PRD and output a structured review.\n\nPRD:\n{{prd_content}}\n\nFormat (markdown):\n\n### Core Requirements (ranked P0/P1/P2)\n- P0: ...\n- P1: ...\n\n### Target User Persona\nUser type | Core pain point | Use case\n\n### Risks & Uncertainties\n- [high/medium/low] risk description → suggested validation\n\n### Key Success Metrics\n- Metric | Target | How measured",
        "output": "requirements",
        "depends_on": []
      },
      {
        "id": "tech_review",
        "expert": "agency_engineering_engineering_software_architect",
        "task": "Based on the requirements analysis, assess technical feasibility.\n\nRequirements:\n{{requirements}}\n\nFormat (markdown):\n\n### Feasibility Score: [high / medium / low]\n\n### Recommended Architecture\nCore components and interactions (3-5 sentences)\n\n### Build Complexity\n| Module | Complexity (1-5) | Est. person-days | Main challenges |\n\n### Technical Risks\n- [high/medium/low] risk → mitigation",
        "output": "tech_report",
        "depends_on": [
          "analyze"
        ]
      },
      {
        "id": "design_review",
        "expert": "agency_design_design_ux_researcher",
        "task": "Based on the requirements analysis, evaluate UX.\n\nRequirements:\n{{requirements}}\n\nFormat (markdown):\n\n### UX Risks\n- [high/medium/low] risk → scope of impact\n\n### Usability Issues\n- Issue → proposed solution\n\n### Top 3 Design Recommendations\n1. Recommendation → expected impact\n\n### Assumptions to Validate\n- Assumption → validation method (user interviews / A-B test / prototype)",
        "output": "design_report",
        "depends_on": [
          "analyze"
        ]
      },
      {
        "id": "final_summary",
        "expert": "agency_product_product_manager",
        "task": "Synthesize tech and design feedback into a final verdict.\n\n## Tech Review\n{{tech_report}}\n\n## Design Review\n{{design_report}}\n\nFormat (markdown):\n\n### Verdict: [✅ Approved / ⚠️ Needs changes / ❌ Rejected]\n\n### Must Resolve (before merge)\n1. [source: tech/design] issue → proposed fix\n\n### Suggested Improvements (later iteration)\n1. Issue → priority\n\n### Next Actions\n- [ ] Action item | Owner | Suggested timeline",
        "output": "final_report",
        "depends_on": [
          "tech_review",
          "design_review"
        ]
      }
    ]
  },
  {
    "key": "en\\solo-founder-plan",
    "file": "en\\solo-founder-plan.yaml",
    "name": "Solo Founder All-Hands",
    "description": "One sentence in, 8 AI 'departments' collaborate, full launch plan out in 2 minutes — your one-person company",
    "category": "English",
    "featured": false,
    "concurrency": 4,
    "inputs": [
      {
        "name": "idea",
        "description": "Your one-sentence idea (e.g. a tool that auto-generates invoices for freelancers)",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "ceo_kickoff",
        "expert": "agency_strategy_nexus_strategy",
        "task": "You are the CEO of this one-person company. Kick off the all-hands.\n\nFounder's idea: {{idea}}\n\nOutput:\n1. Product positioning in one sentence\n2. What pain point we're solving\n3. Who the target user is\n4. What success looks like in 6 months\n\nTone: like a CEO at a morning standup — concise, concrete, no corporate fluff.",
        "output": "vision",
        "depends_on": []
      },
      {
        "id": "market_research",
        "expert": "agency_product_product_trend_researcher",
        "task": "The CEO just set direction: {{vision}}\n\nAs the trend researcher, do rapid market research:\n1. Market size and growth rate for this category\n2. Top 3 competitors + their strengths/weaknesses\n3. Where the market gap is\n4. Trend forecast for the next 12 months\n\nEvery point must be concrete — real numbers, real reasoning, no generic filler.",
        "output": "market_insight",
        "depends_on": [
          "ceo_kickoff"
        ]
      },
      {
        "id": "user_research",
        "expert": "agency_design_design_ux_researcher",
        "task": "The CEO just set direction: {{vision}}\n\nAs the user researcher, deliver user insights:\n1. Core user personas (2 typical users, specific about age, profession, mindset)\n2. How they currently solve this problem (existing solutions and their flaws)\n3. Top 3 pain points (scene-specific, not abstract)\n4. Key trigger that makes them willing to pay",
        "output": "user_insight",
        "depends_on": [
          "ceo_kickoff"
        ]
      },
      {
        "id": "tech_feasibility",
        "expert": "agency_engineering_engineering_backend_architect",
        "task": "The CEO just set direction: {{vision}}\n\nAs the tech architect, assess feasibility:\n1. Recommended stack (something one person can own — explain why this not that)\n2. MVP architecture (clear module relationships, no over-engineering)\n3. 4-week build plan (week-by-week with deliverables)\n4. Real technical risks and mitigations (the ones you'll actually hit, not textbook lists)",
        "output": "tech_plan",
        "depends_on": [
          "ceo_kickoff"
        ]
      },
      {
        "id": "brand_design",
        "expert": "agency_design_design_brand_guardian",
        "task": "The CEO just set direction: {{vision}}\n\nAs the brand designer, deliver the brand foundation:\n1. Product name candidates (3 options + rationale; memorable and domain-available)\n2. Brand tone and keywords\n3. Slogan candidates (3 options; conversational and sticky)\n4. Visual direction (palette + typography with specific hex codes)",
        "output": "brand_plan",
        "depends_on": [
          "ceo_kickoff"
        ]
      },
      {
        "id": "product_plan",
        "expert": "agency_product_product_manager",
        "task": "Research is in:\n\n**Market**: {{market_insight}}\n**User**: {{user_insight}}\n\nAs the PM, output MVP plan:\n1. 3 core features (who uses each, what problem it solves)\n2. Top 5 user stories\n3. Priority + tradeoffs (explain what you're cutting and why)\n4. Launch criteria (concrete, measurable definition of \"usable\")",
        "output": "product_spec",
        "depends_on": [
          "market_research",
          "user_research"
        ]
      },
      {
        "id": "marketing_plan",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "Research is in:\n\n**Market**: {{market_insight}}\n**User**: {{user_insight}}\n**Brand**: {{brand_plan}}\n\nAs the marketing lead, output a cold-start plan:\n1. Launch copy (hooky headline, shareable body)\n2. Top 3 launch channels + tactics (specific, not generic)\n3. Zero-budget growth strategy (executable — no \"make great content\" fluff)\n4. Week-by-week goals and actions for month one",
        "output": "marketing_spec",
        "depends_on": [
          "market_research",
          "user_research",
          "brand_design"
        ]
      },
      {
        "id": "finance_plan",
        "expert": "agency_finance_finance_fpa_analyst",
        "task": "Research is in:\n\n**Market**: {{market_insight}}\n**Tech**: {{tech_plan}}\n\nAs the financial advisor, output the business model:\n1. Pricing strategy (free vs paid tiers, pricing logic)\n2. Cost structure (monthly fixed costs, line-by-line)\n3. Revenue forecast (3/6/12 months with key assumptions and math)\n4. Break-even analysis (how many users / how much revenue to survive)",
        "output": "finance_spec",
        "depends_on": [
          "market_research",
          "tech_feasibility"
        ]
      },
      {
        "id": "ceo_decision",
        "expert": "agency_strategy_nexus_strategy",
        "task": "All-hands reports are in:\n\n**Market**: {{market_insight}}\n**User**: {{user_insight}}\n**Tech**: {{tech_plan}}\n**Brand**: {{brand_plan}}\n**Product**: {{product_spec}}\n**Marketing**: {{marketing_spec}}\n**Finance**: {{finance_spec}}\n\nAs the CEO, make the final call. Output \"One-Person Company Launch Plan\":\n\n## Decision\nGo or No-Go? One-sentence reason.\n\n## Product Name\nPick one from brand options and explain why.\n\n## Week One Action List\nDay-by-day, concrete enough to execute.\n\n## Time Allocation\nHow to split your time (product / engineering / marketing %).\n\n## Risk Watch\nTop 3 risks + mitigation.\n\n## Note to Self\nAs a solo founder, what to hold on to and what to avoid.\n\nEvery section must have a clear decision and rationale. No hedging. Action items must be executable — no \"do great work\" filler.",
        "output": "launch_plan",
        "depends_on": [
          "product_plan",
          "marketing_plan",
          "finance_plan"
        ]
      }
    ]
  },
  {
    "key": "en\\tech-blog",
    "file": "en\\tech-blog.yaml",
    "name": "Tech Blog",
    "description": "Research → outline → draft → polish: a deep, credible technical blog post.",
    "category": "English",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "topic",
        "description": "The technical topic / angle",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "research",
        "expert": "agency_product_product_trend_researcher",
        "task": "Build a research brief for a technical blog post on: {{topic}}\nCover: who reads this and why, the core claim, prior art / common misconceptions,\nand the concrete examples or benchmarks the post should include.",
        "output": "research_brief",
        "depends_on": []
      },
      {
        "id": "outline",
        "expert": "agency_engineering_engineering_technical_writer",
        "task": "From the research brief, write a section-by-section outline with a strong hook and\na clear arc (problem → approach → results → caveats).\n\n{{research_brief}}",
        "output": "outline_doc",
        "depends_on": [
          "research"
        ]
      },
      {
        "id": "draft",
        "expert": "agency_engineering_engineering_senior_developer",
        "task": "Write the full draft from the outline. Be technically precise; include realistic code\nsnippets and numbers where relevant; call out trade-offs honestly.\n\nResearch: {{research_brief}}\nOutline: {{outline_doc}}",
        "output": "blog_draft",
        "depends_on": [
          "research",
          "outline"
        ]
      },
      {
        "id": "polish",
        "expert": "agency_engineering_engineering_technical_writer",
        "task": "Polish the draft into a final post: tighten prose, fix flow, ensure the hook and\nconclusion land, and verify every claim is supported by the body.\n\n{{blog_draft}}",
        "output": "final_blog",
        "depends_on": [
          "draft"
        ]
      }
    ]
  },
  {
    "key": "hr\\interview-questions",
    "file": "hr\\interview-questions.yaml",
    "name": "面试题设计",
    "description": "招聘专家定义考察维度 → 心理学家设计行为面试题 + 技术专家设计技术题 → 招聘专家整合评分表",
    "category": "hr",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "position",
        "description": "招聘岗位（如：高级后端工程师、产品经理、数据分析师）",
        "required": true
      },
      {
        "name": "level",
        "description": "级别（如：P6/P7、3-5年经验、应届）",
        "required": true
      },
      {
        "name": "focus",
        "description": "重点考察方向（如：系统设计能力、团队协作、数据敏感度）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "define_dimensions",
        "expert": "agency_hr_hr_recruiter",
        "task": "请为以下岗位定义面试考察维度：\n\n岗位：{{position}}\n级别：{{level}}\n重点考察：{{focus}}\n\n请输出：\n1. **岗位核心胜任力模型**（4-6 个维度，每个维度说明考察什么）\n2. **各维度权重分配**（百分比）\n3. **每个维度的达标标准**（什么表现算\"通过\"）\n4. **红线项**（出现即否决的行为/回答）",
        "output": "dimensions",
        "depends_on": []
      },
      {
        "id": "behavioral_questions",
        "expert": "agency_academic_academic_psychologist",
        "task": "基于以下考察维度，设计行为面试题（STAR 法则）：\n\n{{dimensions}}\n\n岗位：{{position}}\n级别：{{level}}\n\n每个考察维度设计 2 道题，每道题包含：\n1. **主问题**（开放式，引导候选人讲述真实经历）\n2. **追问清单**（3-4 个追问，深挖 Situation → Task → Action → Result）\n3. **优秀回答特征**（什么样的回答得高分）\n4. **警示信号**（什么样的回答是减分项）\n\n题目要自然不刻板，避免\"请举一个例子\"这种套话开头。",
        "output": "behavioral",
        "depends_on": [
          "define_dimensions"
        ]
      },
      {
        "id": "technical_questions",
        "expert": "agency_engineering_engineering_backend_architect",
        "task": "基于以下考察维度，设计技术面试题：\n\n{{dimensions}}\n\n岗位：{{position}}\n级别：{{level}}\n\n请设计 4-6 道技术题，难度递进，包含：\n1. **基础题**（1-2 道，验证基本功）\n2. **场景题**（2 道，给出实际业务场景，考察设计和解决问题能力）\n3. **开放题**（1-2 道，考察技术深度和视野）\n\n每道题包含：\n- 题目描述\n- 考察点\n- 参考答案要点\n- 评分标准（1-5 分各档标准）\n\n如果岗位非技术类，请改为专业能力测试题。",
        "output": "technical",
        "depends_on": [
          "define_dimensions"
        ]
      },
      {
        "id": "interview_guide",
        "expert": "agency_hr_hr_recruiter",
        "task": "请将以下面试题整合为一份完整的面试官指南：\n\n## 考察维度\n{{dimensions}}\n\n## 行为面试题\n{{behavioral}}\n\n## 技术/专业面试题\n{{technical}}\n\n输出格式：\n1. **面试流程安排**（时间分配建议，如开场5分钟、行为面20分钟等）\n2. **完整题目清单**（按面试顺序排列，标注考察维度和建议时间）\n3. **评分表模板**（表格形式，列出各维度的评分标准）\n4. **面试官注意事项**（提问技巧、避免的偏见等）\n\n风格：实用、可直接打印使用。",
        "output": null,
        "depends_on": [
          "behavioral_questions",
          "technical_questions"
        ]
      }
    ]
  },
  {
    "key": "investment-analysis",
    "file": "investment-analysis.yaml",
    "name": "投资标的分析（股票/基金/行业）",
    "description": "基本面研究 + 财务分析 + 风险识别 + CFO 综合建议",
    "category": "",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "target",
        "description": "分析标的（如：贵州茅台 / 纳指ETF / 新能源汽车行业）",
        "required": true
      },
      {
        "name": "investor_profile",
        "description": "投资者画像（可选，如：30 岁工薪，风险承受中等，持有期 3-5 年）",
        "required": false
      },
      {
        "name": "capital_size",
        "description": "可投资金（可选，如：10 万元）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "research",
        "expert": "agency_finance_finance_investment_researcher",
        "task": "针对标的「{{target}}」做基本面研究。\n\n输出结构（400-500 字）:\n1. **标的性质**: 是什么（个股/基金/行业）、所属板块、当前关键特征\n2. **核心驱动**: 这个标的价值/价格受哪些因素驱动（3-5 个）\n3. **近期催化**: 当前有哪些事件可能影响（政策/业绩/行业周期）\n4. **竞争格局**: 如果是个股/行业，对手是谁、优劣势对比\n5. **估值水位**: PE / PB / 或同类对比的相对位置（如果数据不足请明确说明\"需核实\"）\n\n⚠️ 不知道的数据必须明确标注「需核实」，不要瞎编数字。",
        "output": "research",
        "depends_on": []
      },
      {
        "id": "financial",
        "expert": "agency_finance_finance_financial_analyst",
        "task": "围绕「{{target}}」做财务维度分析。\n\n研究背景:\n{{research}}\n\n输出（300-400 字）:\n1. **盈利能力**: 营收增速、毛利率、净利率趋势（适用于个股/企业）\n2. **现金流健康度**: 经营性现金流情况，是否持续正向\n3. **负债与杠杆**: 资产负债率水平，是否健康\n4. **ROE / ROIC**: 股东回报率水平\n5. **同行对比**: 相比同类标的，财务质量排第几档\n\n对于基金/ETF，把上述项替换为：规模、费率、历史回报、夏普比率、跟踪误差。\n\n⚠️ 数据不确定处明确标注「需核实最新财报」。",
        "output": "financial",
        "depends_on": [
          "research"
        ]
      },
      {
        "id": "risk",
        "expert": "agency_finance_finance_fraud_detector",
        "task": "基于研究和财务分析，盘点投资「{{target}}」的主要风险。\n\n研究:\n{{research}}\n\n财务:\n{{financial}}\n\n输出（300 字）:\n1. **系统性风险**: 宏观/政策层面的风险（2-3 个）\n2. **行业风险**: 行业特有的周期或结构性风险\n3. **个体风险**: 标的本身的致命弱点（商业模式/财务隐雷/管理层问题）\n4. **黑天鹅场景**: 最坏情况可能的亏损幅度\n5. **止损线建议**: 建议的止损点位或触发条件\n\n每条风险明确标「发生概率」（高/中/低）。",
        "output": "risk",
        "depends_on": [
          "research",
          "financial"
        ]
      },
      {
        "id": "cfo_opinion",
        "expert": "agency_finance_finance_financial_forecaster",
        "task": "你是 CFO 顾问，把前面研究员、财务分析师、风控专家的工作整合成一份**完整、可直接交付给投资者的投资分析报告**——不要只给结论，要把上游的分析内容整合进报告里。\n\n研究: {{research}}\n财务: {{financial}}\n风险: {{risk}}\n\n投资者画像: {{investor_profile}}\n可用资金: {{capital_size}}\n\n输出一份完整 markdown 报告，**充实展开、不要压缩**，必须包含全部四部分：\n\n# {{target}} 投资分析报告\n\n## 一、标的概览与基本面\n整合研究员结论：标的性质、核心驱动、近期催化、竞争格局、估值水位。\n\n## 二、财务质量\n整合财务分析师发现：盈利能力、现金流、负债杠杆、回报率、同行对比。\n\n## 三、风险评估\n整合风控发现：系统性/行业/个体风险、黑天鹅场景、止损线，每条标概率（高/中/低）。\n\n## 四、投资建议（CFO 综合判断）\n- **结论**: 买入 / 观望 / 不建议（明确选一个）\n- **核心逻辑**: 3-5 句\n- **仓位建议**: 配比 % + 买入节奏（含触发条件，结合投资者画像与资金）\n- **持有期与退出条件**\n- **关键跟踪指标**: 3-5 个\n- **不适合的情况**\n\n> 免责声明: 本分析仅供参考，不构成投资建议。股市有风险，投资需谨慎。\n\n⚠️ 只输出这份报告本身（四部分齐全、内容充实）：不要开场白/寒暄、不要\"我改了什么/复盘\"、不要向用户提问、不要建议 ao 命令或后续动作、不要\"要我继续吗\"之类收尾。",
        "output": "final_advice",
        "depends_on": [
          "financial",
          "risk"
        ]
      }
    ]
  },
  {
    "key": "legal\\contract-review",
    "file": "legal\\contract-review.yaml",
    "name": "合同审查",
    "description": "合同审查专家逐条分析 → 法务合规员补充合规风险 → 整合输出审查意见和修改建议",
    "category": "legal",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "contract",
        "description": "合同全文或核心条款（粘贴文本）",
        "required": true
      },
      {
        "name": "party",
        "description": "我方身份（如：甲方/采购方/服务提供方/被投资方）",
        "required": true
      },
      {
        "name": "concern",
        "description": "特别关注的问题（如：付款条件、竞业限制、知识产权）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "clause_analysis",
        "expert": "agency_legal_legal_contract_reviewer",
        "task": "请对以下合同进行逐条审查：\n\n我方身份：{{party}}\n特别关注：{{concern}}\n\n合同内容：\n{{contract}}\n\n请逐条分析，每条输出：\n1. **条款摘要**（一句话）\n2. **风险等级**（🔴高风险 / 🟡中风险 / 🟢低风险）\n3. **风险分析**（该条款对我方的不利影响）\n4. **修改建议**（具体的替代条款文本）\n\n重点关注：\n- 付款条件和违约金\n- 知识产权归属\n- 保密条款范围\n- 竞业限制\n- 争议解决方式\n- 合同终止条件\n- 不可抗力条款",
        "output": "clause_review",
        "depends_on": []
      },
      {
        "id": "compliance_check",
        "expert": "agency_support_support_legal_compliance_checker",
        "task": "基于以下合同条款审查，补充合规风险分析：\n\n{{clause_review}}\n\n合同原文：\n{{contract}}\n\n请检查：\n1. **法律合规**（是否符合《民法典》合同编相关规定）\n2. **数据合规**（是否涉及个人信息处理，是否符合《个保法》《数安法》）\n3. **行业特殊合规**（是否有行业特定的合规要求）\n4. **格式条款问题**（是否有无效的格式条款）\n5. **缺失条款**（通常应有但合同中缺少的重要条款）",
        "output": "compliance_report",
        "depends_on": [
          "clause_analysis"
        ]
      },
      {
        "id": "final_opinion",
        "expert": "agency_legal_legal_contract_reviewer",
        "task": "请整合以下审查结果，输出一份完整的合同审查意见书：\n\n## 条款审查\n{{clause_review}}\n\n## 合规检查\n{{compliance_report}}\n\n输出格式：\n\n# 合同审查意见书\n\n## 总体评价\n[一段话总结合同整体风险水平和建议]\n\n## 高风险条款（必须修改）\n[列出所有红色风险条款及修改建议]\n\n## 中风险条款（建议修改）\n[列出所有黄色风险条款及修改建议]\n\n## 缺失条款（建议补充）\n[列出应当补充的条款]\n\n## 合规问题\n[列出合规风险及整改建议]\n\n## 谈判要点\n[按优先级列出谈判时应争取的条款修改]\n\n风格：专业严谨，结论明确，修改建议可直接用于谈判。",
        "output": null,
        "depends_on": [
          "compliance_check"
        ]
      }
    ]
  },
  {
    "key": "legal-consultation",
    "file": "legal-consultation.yaml",
    "name": "法律咨询意见书",
    "description": "事实梳理 + 合同/文书审查 + 风险识别 + 法律意见书",
    "category": "",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "case_description",
        "description": "案情或咨询事项描述（越详细越好）",
        "required": true
      },
      {
        "name": "document_content",
        "description": "相关合同/文书内容（可选，支持 @文件）",
        "required": false
      },
      {
        "name": "jurisdiction",
        "description": "适用法域（默认中国大陆）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "intake",
        "expert": "agency_specialized_legal_client_intake",
        "task": "梳理案情并提取关键事实。\n\n咨询事项:\n{{case_description}}\n\n相关文书:\n{{document_content}}\n\n适用法域: {{jurisdiction}}\n\n输出（300-400 字）:\n1. **当事人关系**: 涉及哪些主体，彼此什么法律关系\n2. **核心事实**: 按时间顺序梳理的事实链（不要添油加醋）\n3. **争议焦点**: 本案的法律争议点（1-3 个）\n4. **诉求识别**: 咨询人实际想解决什么问题（经济补偿/继续履约/解除关系/追责）\n5. **信息缺口**: 还需要当事人补充哪些关键信息才能给出完整意见",
        "output": "case_summary",
        "depends_on": []
      },
      {
        "id": "document_review",
        "expert": "agency_legal_legal_contract_reviewer",
        "task": "审查相关文书中的法律风险。\n\n案情梳理:\n{{case_summary}}\n\n文书内容:\n{{document_content}}\n\n如果没有提供文书，直接输出「未提供文书，跳过审查」。\n\n否则输出（300-400 字）:\n1. **文书性质**: 是什么类型的合同/文书，是否合法有效\n2. **条款风险 Top 3**: 最不利于咨询人的条款（引用原文片段）\n3. **缺失条款**: 应该有但没有的关键条款（违约责任/管辖/解除条件等）\n4. **模糊表述**: 可能引发歧义的措辞\n5. **整体评级**: 对咨询人是否有利（有利/中性/不利/极不利）",
        "output": "document_risks",
        "depends_on": [
          "intake"
        ]
      },
      {
        "id": "legal_risk",
        "expert": "agency_specialized_legal_document_review",
        "task": "分析案情走诉讼或其他法律救济的可行性与风险。\n\n案情:\n{{case_summary}}\n\n文书风险:\n{{document_risks}}\n\n适用法域: {{jurisdiction}}\n\n输出（400 字）:\n1. **法律依据**: 支持咨询人诉求的主要法条（具体条款号，不确定请标\"需核实\"）\n2. **胜诉概率预估**: 高/中/低，说明理由\n3. **证据评估**: 现有证据是否足够，还需补充什么\n4. **诉讼成本**: 时间（月）、金钱（诉讼费/律师费区间）、精力投入\n5. **替代方案**: 协商/调解/仲裁等非诉讼路径是否更优\n6. **时效提醒**: 诉讼时效或除斥期间是否紧迫\n\n⚠️ 所有法条引用不确定处必须明确标「需核实最新法规」。",
        "output": "risk_analysis",
        "depends_on": [
          "intake",
          "document_review"
        ]
      },
      {
        "id": "opinion",
        "expert": "agency_legal_legal_policy_writer",
        "task": "综合所有分析，出具正式法律意见书。\n\n案情: {{case_summary}}\n文书风险: {{document_risks}}\n诉讼分析: {{risk_analysis}}\n\n输出格式（严格按正式意见书结构）:\n```\n# 法律意见书\n\n## 一、咨询事项\n<简述>\n\n## 二、事实摘要\n<基于案情梳理的关键事实>\n\n## 三、法律分析\n<引用法条，结合事实分析，2-3 段>\n\n## 四、结论意见\n<明确的法律结论：是否有理/是否违约/是否可诉等>\n\n## 五、行动建议\n按优先级列出 3-5 条:\n1. <立即行动 - 如固定证据/发函/申请保全>\n2. <短期行动 - 如协商/起诉/申请仲裁>\n3. <备选方案>\n\n## 六、风险提示\n<2-3 条可能的不利结果>\n\n## 七、免责声明\n本意见书基于咨询人提供的信息作出，若事实有出入结论可能不同。本意见\n不能替代律师介入后的个案分析，重要决定请委托执业律师办理。\n```",
        "output": "legal_opinion",
        "depends_on": [
          "document_review",
          "legal_risk"
        ]
      }
    ]
  },
  {
    "key": "marketing\\competitor-analysis",
    "file": "marketing\\competitor-analysis.yaml",
    "name": "竞品分析报告",
    "description": "趋势研究 → 数据分析 + SEO 竞品扫描 → 高管摘要，输出一份可直接汇报的竞品报告",
    "category": "marketing",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "product",
        "description": "你的产品/服务名称和简介",
        "required": true
      },
      {
        "name": "competitors",
        "description": "竞品名称（逗号分隔，如：飞书,钉钉,企业微信）",
        "required": true
      },
      {
        "name": "focus",
        "description": "分析重点（如：定价策略、用户增长、功能差异）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "trend_research",
        "expert": "agency_product_product_trend_researcher",
        "task": "请对以下产品和竞品进行市场趋势研究：\n\n我方产品：{{product}}\n竞品：{{competitors}}\n重点关注：{{focus}}\n\n请输出：\n1. 行业整体趋势（3-5 个关键趋势）\n2. 各竞品最近 6 个月的重大动作（产品发布、融资、合作等）\n3. 市场规模和增长预测\n4. 技术趋势和风口判断",
        "output": "trend_report",
        "depends_on": []
      },
      {
        "id": "data_analysis",
        "expert": "agency_support_support_analytics_reporter",
        "task": "基于以下趋势研究，进行定量竞品对比分析：\n\n{{trend_report}}\n\n竞品列表：{{competitors}}\n分析重点：{{focus}}\n\n请输出：\n1. 功能对比矩阵（表格形式，列出各家核心功能的有/无/强/弱）\n2. 定价策略对比（免费版/付费版/企业版各档位）\n3. 用户评价分析（主要好评点和差评点）\n4. SWOT 分析（我方 vs 各竞品）",
        "output": "data_report",
        "depends_on": [
          "trend_research"
        ]
      },
      {
        "id": "seo_scan",
        "expert": "agency_marketing_marketing_seo_specialist",
        "task": "从 SEO 和内容营销角度分析以下竞品：\n\n{{trend_report}}\n\n竞品列表：{{competitors}}\n\n请输出：\n1. 各竞品内容策略分析（博客频率、主题方向、SEO 关键词布局）\n2. 搜索可见度对比（哪些关键词谁排名更好）\n3. 社交媒体声量对比\n4. 内容营销机会点（竞品忽略但有价值的领域）",
        "output": "seo_report",
        "depends_on": [
          "trend_research"
        ]
      },
      {
        "id": "executive_summary",
        "expert": "agency_support_support_executive_summary_generator",
        "task": "请将以下竞品分析整合成一份高管可读的摘要报告：\n\n## 市场趋势\n{{trend_report}}\n\n## 数据对比\n{{data_report}}\n\n## SEO 与内容分析\n{{seo_report}}\n\n输出格式：\n1. **一句话结论**：我方竞争地位\n2. **核心发现**（3-5 条，每条 1-2 句话）\n3. **威胁与机会**（各 3 条）\n4. **建议行动**（按优先级排序，每条包含负责人建议和时间框架）\n5. **完整对比表**（保留数据分析中的功能矩阵）\n\n风格：简洁、数据驱动、可直接用于汇报。",
        "output": null,
        "depends_on": [
          "data_analysis",
          "seo_scan"
        ]
      }
    ]
  },
  {
    "key": "marketing\\seo-content-matrix",
    "file": "marketing\\seo-content-matrix.yaml",
    "name": "SEO 内容矩阵",
    "description": "SEO 关键词研究 → 内容策略 + 批量内容生成 → SEO 优化审核，一次性生成一组 SEO 友好的文章",
    "category": "marketing",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "domain",
        "description": "业务领域/网站主题（如：SaaS 项目管理工具、跨境电商培训）",
        "required": true
      },
      {
        "name": "target_keywords",
        "description": "核心关键词（逗号分隔，如：项目管理软件,团队协作工具,敏捷开发）",
        "required": true
      },
      {
        "name": "article_count",
        "description": "生成文章数量",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "keyword_research",
        "expert": "agency_marketing_marketing_seo_specialist",
        "task": "请围绕以下核心关键词进行 SEO 关键词研究：\n\n业务领域：{{domain}}\n核心关键词：{{target_keywords}}\n目标文章数：{{article_count}}\n\n请输出：\n1. **关键词矩阵**（表格：关键词、搜索意图、预估难度、预估流量）\n2. **长尾词扩展**（每个核心词扩展 5-8 个长尾词）\n3. **内容缺口分析**（竞品有排名但我方缺失的主题）\n4. **推荐的 {{article_count}} 篇文章选题**（每篇的目标关键词、搜索意图、建议标题）",
        "output": "keyword_plan",
        "depends_on": []
      },
      {
        "id": "content_strategy",
        "expert": "agency_marketing_marketing_social_media_strategist",
        "task": "基于以下关键词研究，制定内容矩阵策略：\n\n{{keyword_plan}}\n\n业务领域：{{domain}}\n\n请输出：\n1. **内容金字塔**（支柱页 → 集群页 → 长尾页的关系图）\n2. **每篇文章的内容大纲**（H1/H2/H3 结构、字数建议、内链策略）\n3. **发布节奏**（建议的发布顺序和频率）\n4. **转化路径**（每篇文章的 CTA 设计和转化目标）",
        "output": "content_plan",
        "depends_on": [
          "keyword_research"
        ]
      },
      {
        "id": "write_articles",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "基于以下内容策略，撰写 {{article_count}} 篇 SEO 文章：\n\n{{content_plan}}\n\n每篇文章要求：\n- 按大纲的 H1/H2/H3 结构撰写\n- 自然融入目标关键词（密度 1-2%）\n- 开头直击用户痛点/搜索意图\n- 包含实用信息、数据或案例\n- 结尾有明确的 CTA\n- 每篇 800-1500 字\n\n用 --- 分隔每篇文章，每篇开头标注：\n- 目标关键词\n- Meta Title（60 字符内）\n- Meta Description（155 字符内）",
        "output": "articles",
        "depends_on": [
          "content_strategy"
        ]
      },
      {
        "id": "seo_review",
        "expert": "agency_marketing_marketing_seo_specialist",
        "task": "请对以下文章进行 SEO 优化审核：\n\n{{articles}}\n\n原始关键词计划：\n{{keyword_plan}}\n\n每篇文章检查并输出：\n1. **关键词优化**（标题/H2/首段/尾段是否包含目标词）\n2. **内链建议**（文章之间可以互链的锚文本位置）\n3. **Schema 标记建议**（FAQ、HowTo、Article 等结构化数据）\n4. **优化后的 Meta 信息**（如需修改）\n5. **可读性评分**（段落长度、句子复杂度、被动语态比例）\n6. **最终修改建议**（具体到哪一段哪一句需要改什么）",
        "output": null,
        "depends_on": [
          "write_articles"
        ]
      }
    ]
  },
  {
    "key": "marketing\\xiaohongshu-content",
    "file": "marketing\\xiaohongshu-content.yaml",
    "name": "小红书种草笔记",
    "description": "小红书专家选题策划 → 内容创作 + 视觉方案 → 小红书运营优化，批量生成高质量种草内容",
    "category": "marketing",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "product",
        "description": "产品/品牌名称和核心卖点",
        "required": true
      },
      {
        "name": "category",
        "description": "品类（如：护肤、数码、家居、美食、穿搭）",
        "required": true
      },
      {
        "name": "count",
        "description": "需要生成几篇笔记",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "topic_planning",
        "expert": "agency_marketing_marketing_xiaohongshu_specialist",
        "task": "请为以下产品策划 {{count}} 篇小红书种草笔记的选题：\n\n产品：{{product}}\n品类：{{category}}\n\n每个选题输出：\n1. **笔记标题**（符合小红书爆款标题公式，带 emoji）\n2. **内容角度**（测评/教程/好物分享/避雷/合集，选最适合的）\n3. **目标人群**（具体到场景，如\"25岁加班党的急救护肤\"）\n4. **关键词布局**（搜索词 + 长尾词，各 3-5 个）\n5. **封面方向**（什么样的封面图最吸引点击）\n\n要求：选题要差异化，覆盖不同搜索意图（种草/教程/对比）。",
        "output": "topics",
        "depends_on": []
      },
      {
        "id": "write_notes",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "基于以下选题，撰写 {{count}} 篇完整的小红书笔记正文：\n\n{{topics}}\n\n产品：{{product}}\n\n每篇笔记要求：\n- 开头用个人经历/痛点切入（不要广告感）\n- 正文结构：痛点共鸣 → 发现产品 → 使用体验 → 效果对比 → 总结推荐\n- 语气：真实分享感，像在跟闺蜜/朋友聊天\n- 适当使用 emoji 分段，增加可读性\n- 字数 300-500 字\n- 末尾带 3-5 个话题标签\n- 自然植入关键词，不要硬塞\n\n避免：过度营销感、虚假宣传、绝对化用语。",
        "output": "notes",
        "depends_on": [
          "topic_planning"
        ]
      },
      {
        "id": "visual_plan",
        "expert": "agency_design_design_visual_storyteller",
        "task": "基于以下笔记内容，设计配图方案：\n\n{{notes}}\n\n产品：{{product}}\n品类：{{category}}\n\n每篇笔记输出：\n1. **封面图方案**（构图、色调、文字排版、拍摄角度）\n2. **内页图片**（3-6 张图的内容和顺序安排）\n3. **拍摄/设计建议**（光线、道具、场景、滤镜风格）\n4. **文字覆盖建议**（图片上需要加的关键文字）\n\n风格参考：小红书当前热门的视觉趋势。",
        "output": "visual_plan",
        "depends_on": [
          "topic_planning",
          "write_notes"
        ]
      },
      {
        "id": "optimize",
        "expert": "agency_marketing_marketing_xiaohongshu_operator",
        "task": "请对以下小红书笔记做最终优化和发布建议：\n\n## 笔记正文\n{{notes}}\n\n## 视觉方案\n{{visual_plan}}\n\n请输出：\n1. **各笔记的最终优化版本**（修正标题、正文细节、标签）\n2. **发布时间建议**（最佳发布时段）\n3. **互动策略**（评论区预埋、回复话术）\n4. **数据监测指标**（关注哪些数据判断效果）\n5. **迭代建议**（如果某篇效果好/差，下一步怎么做）",
        "output": null,
        "depends_on": [
          "write_notes",
          "visual_plan"
        ]
      }
    ]
  },
  {
    "key": "meeting-notes",
    "file": "meeting-notes.yaml",
    "name": "会议纪要整理",
    "description": "输入原始会议记录，自动整理为结构化纪要：决策、TODO、争议点 三视角并行 → 完整纪要",
    "category": "",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "raw_notes",
        "description": "原始会议记录（口语/速记/录音转文字都可以）",
        "required": true
      },
      {
        "name": "meeting_type",
        "description": "会议类型，如：产品评审 / 周会 / 1on1 / 客户访谈",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "organize",
        "expert": "agency_specialized_specialized_meeting_assistant",
        "task": "把以下会议原始记录清理成结构化的\"按发言人分段\"版本。\n会议类型: {{meeting_type}}\n\n原始记录:\n{{raw_notes}}\n\n整理要求:\n- 删掉口语化的\"嗯/啊/那个/就是说\"等填充词\n- 修复明显的速记错别字（不要改原意）\n- 按发言人分段，每段加 [发言人] 前缀（如果原文没有人名，用 \"A\" / \"B\" 代号）\n- 不要总结，不要加你自己的判断，只做清理\n\n输出格式（markdown）:\n[发言人A] 整理后的发言内容\n[发言人B] 整理后的发言内容\n...",
        "output": "cleaned_notes",
        "depends_on": []
      },
      {
        "id": "extract_decisions",
        "expert": "agency_specialized_specialized_meeting_assistant",
        "task": "从以下整理后的会议记录中提取所有\"已经达成的决策\"。\n\n会议记录:\n{{cleaned_notes}}\n\n只提取真正的决策（\"我们决定 X\"、\"那就 Y 吧\"），不要把讨论过的选项当决策。\n\n输出格式（markdown）:\n### 决策清单\n| # | 决策内容 | 决策依据 | 影响范围 |\n|---|---------|---------|---------|\n| 1 | ... | ... | ... |\n\n如果没有明确决策，写 \"本次会议未达成决策\"。",
        "output": "decisions",
        "depends_on": [
          "organize"
        ]
      },
      {
        "id": "extract_todos",
        "expert": "agency_specialized_specialized_meeting_assistant",
        "task": "从以下会议记录中提取所有 TODO/行动项（谁要在什么时候做什么）。\n\n会议记录:\n{{cleaned_notes}}\n\n提取标准:\n- 含责任人（即使是模糊的\"@某某\"也保留）\n- 含动作（一个明确的动词）\n- 时间不明确就写 \"未定\"，不要编\n\n输出格式（markdown）:\n### 行动项清单\n| # | 负责人 | 行动 | 截止时间 | 验收标准 |\n|---|-------|-----|---------|---------|\n| 1 | ... | ... | ... | ... |\n\n如果没有明确行动项，写 \"本次会议未产生行动项\"。",
        "output": "todos",
        "depends_on": [
          "organize"
        ]
      },
      {
        "id": "extract_concerns",
        "expert": "agency_specialized_specialized_meeting_assistant",
        "task": "从以下会议记录中提取\"未解决的分歧/疑问/风险\"。\n\n会议记录:\n{{cleaned_notes}}\n\n提取标准:\n- 双方明确表达不同立场但没有结论的争议\n- 任何被提出但没人回答的关键问题\n- 提到的潜在风险（即使只是顺嘴一句）\n\n输出格式（markdown）:\n### 未解决的分歧/疑问/风险\n| # | 类型 [分歧/疑问/风险] | 内容 | 涉及方 | 建议处理方式 |\n|---|----------------------|------|-------|------------|\n| 1 | ... | ... | ... | 一句话建议 |\n\n如果都解决了，写 \"本次会议无遗留议题\"。",
        "output": "concerns",
        "depends_on": [
          "organize"
        ]
      },
      {
        "id": "final_notes",
        "expert": "agency_specialized_specialized_meeting_assistant",
        "task": "整合三个视角，输出最终会议纪要（可直接发邮件/群里）。\n\n会议类型: {{meeting_type}}\n\n整理后的发言:\n{{cleaned_notes}}\n\n决策清单:\n{{decisions}}\n\n行动项清单:\n{{todos}}\n\n未解决议题:\n{{concerns}}\n\n输出格式（markdown，可直接复制发送）:\n# {{meeting_type}}纪要\n\n## 一句话总结\n（30 字以内）\n\n## 关键决策\n（从决策清单中转录，不要改）\n\n## 行动项\n（从行动项清单中转录，按截止时间排序）\n\n## 待跟进\n（从未解决议题中转录，按重要性排序）\n\n## 完整记录\n（从整理后发言转录）",
        "output": "meeting_summary",
        "depends_on": [
          "extract_decisions",
          "extract_todos",
          "extract_concerns"
        ]
      }
    ]
  },
  {
    "key": "okr-decomposition",
    "file": "okr-decomposition.yaml",
    "name": "OKR 拆解",
    "description": "输入年度目标，自动完成现状分析 → 4 个季度 KR 拆解 → 首季度行动方案 → 完整 OKR 文档",
    "category": "",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "annual_goal",
        "description": "年度目标（一句话），如：让产品 MAU 从 5 万做到 50 万",
        "required": true
      },
      {
        "name": "team_context",
        "description": "团队/公司现状（人数、阶段、资源、关键约束）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "situation_analysis",
        "expert": "agency_product_product_manager",
        "task": "分析达成年度目标的关键现状和挑战。\n\n年度目标: {{annual_goal}}\n团队现状: {{team_context}}\n\n输出格式（markdown，不超过 600 字）:\n### 当前位置\n用 1-2 句话描述团队/产品当前的状态（数据 + 阶段）\n\n### 关键差距（要达成目标必须填的坑）\n1. 差距描述 → 为什么这是瓶颈\n2. ...\n（3-5 条，按\"如果不解决就一定达不成目标\"的程度排序）\n\n### 可用杠杆（已有的优势）\n1. 杠杆 → 怎么用\n2. ...\n\n### 关键假设（如果错就全盘崩）\n- 假设 → 风险等级 [高/中/低]",
        "output": "situation",
        "depends_on": []
      },
      {
        "id": "quarterly_plan",
        "expert": "agency_project-management_project_manager_senior",
        "task": "把年度目标拆成 4 个季度的 KR（关键结果）。\n\n年度目标: {{annual_goal}}\n现状分析:\n{{situation}}\n\n拆解原则:\n- Q1 重点解决\"关键差距\"中最致命的 1-2 个\n- Q2-Q4 渐进推进，不要 Q4 才做风险高的事\n- KR 必须可量化（数字+时间）\n- 每季度 3-5 个 KR，不要超\n\n输出格式（markdown）:\n## Q1 (聚焦: 一句话主题)\n| KR | 指标 | 当前 → 目标 | 验收方式 |\n|---|------|------------|---------|\n\n## Q2 (聚焦: 一句话主题)\n...\n\n## Q3 (聚焦: 一句话主题)\n...\n\n## Q4 (聚焦: 一句话主题)\n...\n\n## 季度间依赖\n用 1-2 句话说明 Q1→Q2→Q3→Q4 的递进关系",
        "output": "quarters",
        "depends_on": [
          "situation_analysis"
        ]
      },
      {
        "id": "q1_action_plan",
        "expert": "agency_marketing_marketing_growth_hacker",
        "task": "给 Q1 出具体可执行的行动方案（3 个月内每周/每月做什么）。\n\nQ1 KR（从季度计划提取）:\n{{quarters}}\n\n输出格式（markdown）:\n### Q1 月度路线图\n\n**Month 1（聚焦: 一句话）**\n- Week 1-2: 行动项 → 期望产出\n- Week 3-4: 行动项 → 期望产出\n\n**Month 2（聚焦: 一句话）**\n- ...\n\n**Month 3（聚焦: 一句话）**\n- ...\n\n### Q1 关键里程碑（3 个）\n1. [日期] 里程碑事件 → 验收标志\n2. ...\n\n### Q1 资源需求\n- 人力: 谁要做什么、是否需要外援\n- 预算: 大致数额（如不确定写\"待估算\"）\n- 工具: 关键工具/平台",
        "output": "q1_plan",
        "depends_on": [
          "quarterly_plan"
        ]
      },
      {
        "id": "final_okr",
        "expert": "agency_project-management_project_manager_senior",
        "task": "整合输出最终 OKR 文档（可直接发团队评审）。\n\n年度目标: {{annual_goal}}\n团队现状: {{team_context}}\n\n现状分析:\n{{situation}}\n\n季度拆解:\n{{quarters}}\n\nQ1 行动方案:\n{{q1_plan}}\n\n输出格式（markdown，可直接复制评审）:\n# 年度 OKR\n\n## Objective\n{{annual_goal}}\n\n## 立项背景\n（从现状分析提炼 1 段，不超过 100 字）\n\n## 关键差距 & 杠杆\n（从现状分析提炼，5 条总数以内）\n\n## 季度 KR 拆解\n（从季度计划转录）\n\n## Q1 详细方案\n（从 Q1 行动方案转录）\n\n## 风险与假设\n（从现状分析的关键假设 + 添加 1-2 条 Q1 执行风险）\n\n## 评审检查清单\n- [ ] KR 是否量化？\n- [ ] 季度间依赖是否清晰？\n- [ ] Q1 行动是否周级别可执行？\n- [ ] 资源是否到位？\n\n⚠️ 只输出上面这份 OKR 文档本身：不要开场白/寒暄、不要\"我改了什么/复盘/修改说明\"、不要向用户提问或请其拍板、不要建议 ao 命令或后续动作、不要\"要我继续吗\"之类收尾。",
        "output": "okr_document",
        "depends_on": [
          "q1_action_plan"
        ]
      }
    ]
  },
  {
    "key": "ops\\incident-postmortem",
    "file": "ops\\incident-postmortem.yaml",
    "name": "事故复盘",
    "description": "故障指挥官梳理时间线 → SRE 分析根因 → 项目经理输出改进计划",
    "category": "ops",
    "featured": false,
    "concurrency": 1,
    "inputs": [
      {
        "name": "incident_description",
        "description": "事故描述（现象、影响范围、持续时间等）",
        "required": true
      },
      {
        "name": "timeline",
        "description": "事件时间线（可选，如已有初步记录）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "timeline_review",
        "expert": "agency_engineering_engineering_incident_response_commander",
        "task": "请梳理以下事故的完整时间线和响应过程：\n\n事故描述：{{incident_description}}\n\n已有时间线：{{timeline}}\n\n请输出：\n1. 事件时间线（从发现到恢复，精确到分钟）\n2. 响应过程评估（告警是否及时、响应是否迅速）\n3. 沟通协调记录（谁在什么时间做了什么决策）\n4. 恢复手段及生效时间\n5. 影响评估（受影响用户数、业务损失）\n6. 响应过程中的问题和不足",
        "output": "timeline_report",
        "depends_on": []
      },
      {
        "id": "root_cause",
        "expert": "agency_engineering_engineering_sre",
        "task": "请根据事件时间线，深入分析事故的根本原因：\n\n## 事件时间线\n{{timeline_report}}\n\n原始事故描述：{{incident_description}}\n\n请分析：\n1. 直接原因（触发事故的具体操作或事件）\n2. 根本原因（为什么会发生，5 Why 分析）\n3. 贡献因素（哪些条件加剧了问题）\n4. 防护缺失（监控、告警、限流等为何未能阻止）\n5. 类似风险排查（其他系统是否有相同隐患）",
        "output": "root_cause_report",
        "depends_on": [
          "timeline_review"
        ]
      },
      {
        "id": "action_plan",
        "expert": "agency_project-management_project_manager_senior",
        "task": "请根据事件时间线和根因分析，输出改进计划和预防措施：\n\n## 事件时间线\n{{timeline_report}}\n\n## 根因分析\n{{root_cause_report}}\n\n请输出：\n1. 短期修复项（1 周内，防止同类事故再次发生）\n2. 中期改进项（1 个月内，增强系统韧性）\n3. 长期优化项（1 季度内，系统性提升）\n4. 每个改进项的负责人角色、优先级、预期完成时间\n5. 流程改进建议（on-call、告警、演练等）\n6. 跟踪与验证机制（如何确认改进已落地）",
        "output": "improvement_plan",
        "depends_on": [
          "root_cause"
        ]
      }
    ]
  },
  {
    "key": "ops\\sre-health-check",
    "file": "ops\\sre-health-check.yaml",
    "name": "SRE 健康检查",
    "description": "可靠性 + 性能 + 基础设施三方检查 → SRE 汇总",
    "category": "ops",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "system_description",
        "description": "系统描述（架构、技术栈、部署方式、用户规模等）",
        "required": true
      },
      {
        "name": "current_metrics",
        "description": "当前监控指标数据（可选，如有可提供）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "reliability",
        "expert": "agency_engineering_engineering_sre",
        "task": "请对以下系统进行可靠性评估：\n\n系统描述：{{system_description}}\n\n当前指标：{{current_metrics}}\n\n请评估：\n1. SLO/SLI 定义是否合理（可用性、延迟、吞吐量）\n2. 错误预算使用情况和策略\n3. 故障模式分析（单点故障、级联故障风险）\n4. 容灾与高可用方案（多活、灾备、自动切换）\n5. 告警策略评估（是否有噪声、是否有盲区）\n6. 可靠性改进建议",
        "output": "reliability_report",
        "depends_on": []
      },
      {
        "id": "performance",
        "expert": "agency_testing_testing_performance_benchmarker",
        "task": "请对以下系统进行性能基准检查：\n\n系统描述：{{system_description}}\n\n当前指标：{{current_metrics}}\n\n请评估：\n1. 响应时间分布（P50/P90/P99）\n2. 吞吐量与并发承载能力\n3. 资源利用率（CPU、内存、磁盘 I/O、网络）\n4. 性能瓶颈识别（慢查询、热点、资源竞争）\n5. 容量规划建议（当前水位、扩容阈值）\n6. 性能优化建议及预期收益",
        "output": "performance_report",
        "depends_on": []
      },
      {
        "id": "infra",
        "expert": "agency_support_support_infrastructure_maintainer",
        "task": "请对以下系统进行基础设施健康检查：\n\n系统描述：{{system_description}}\n\n当前指标：{{current_metrics}}\n\n请检查：\n1. 基础设施配置合理性（实例规格、存储、网络）\n2. 安全合规（补丁更新、访问控制、加密）\n3. 备份与恢复策略（RPO/RTO 是否达标）\n4. 成本效率（资源利用率、是否有浪费）\n5. 自动化水平（IaC、CI/CD、自动扩缩容）\n6. 基础设施改进建议",
        "output": "infra_report",
        "depends_on": []
      },
      {
        "id": "summary",
        "expert": "agency_engineering_engineering_sre",
        "task": "请综合可靠性、性能和基础设施三方面的检查结果，输出系统健康报告：\n\n## 可靠性评估\n{{reliability_report}}\n\n## 性能基准检查\n{{performance_report}}\n\n## 基础设施检查\n{{infra_report}}\n\n系统描述：{{system_description}}\n\n请输出：\n1. 总体健康评分（满分 100 分，含各维度分项）\n2. 风险矩阵（影响 × 概率，标注高危项）\n3. Top 5 优先改进事项（附理由和预期效果）\n4. 各维度详细评分和关键发现\n5. 30/60/90 天改进路线图",
        "output": "health_report",
        "depends_on": [
          "reliability",
          "performance",
          "infra"
        ]
      }
    ]
  },
  {
    "key": "ops\\weekly-report",
    "file": "ops\\weekly-report.yaml",
    "name": "周报/月报生成",
    "description": "数据整理 → 亮点提炼 → 高管摘要，从原始信息快速生成结构化周报",
    "category": "ops",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "raw_notes",
        "description": "本周工作记录（流水账、会议纪要、完成事项等原始素材）",
        "required": true
      },
      {
        "name": "team",
        "description": "团队/部门名称",
        "required": true
      },
      {
        "name": "period",
        "description": "报告周期（如：2026-W13、3月）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "organize",
        "expert": "agency_specialized_specialized_meeting_assistant",
        "task": "请将以下原始工作记录整理成结构化信息：\n\n团队：{{team}}\n周期：{{period}}\n原始记录：\n{{raw_notes}}\n\n请输出：\n1. **已完成事项**（按重要度排序，每项一句话）\n2. **进行中事项**（进度百分比 + 下一步）\n3. **阻塞/风险项**（原因 + 影响）\n4. **关键数据/指标变化**（如有）\n5. **下周计划**（从记录中推断）",
        "output": "organized_data",
        "depends_on": []
      },
      {
        "id": "highlights",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "基于以下结构化数据，提炼本周亮点和叙事：\n\n{{organized_data}}\n\n团队：{{team}}\n\n请输出：\n1. **本周一句话总结**（概括最大成果）\n2. **Top 3 亮点**（每个亮点用\"成果 + 价值\"结构，如\"上线 X 功能，预计提升 Y%\"）\n3. **需要关注的风险**（用\"现状 → 影响 → 建议\"结构）\n4. **数据看板**（用表格展示关键指标的本周 vs 上周对比）",
        "output": "highlights",
        "depends_on": [
          "organize"
        ]
      },
      {
        "id": "final_report",
        "expert": "agency_support_support_executive_summary_generator",
        "task": "请生成一份正式的周报，可直接发送给领导：\n\n{{highlights}}\n\n格式要求：\n## {{team}} {{period}}周报\n\n### 一句话总结\n[总结]\n\n### 本周亮点\n[亮点列表]\n\n### 关键指标\n[数据表格]\n\n### 进行中\n[事项列表]\n\n### 风险与阻塞\n[风险列表]\n\n### 下周计划\n[计划列表]\n\n风格：专业简洁，突出成果和价值，避免流水账。",
        "output": null,
        "depends_on": [
          "highlights"
        ]
      }
    ]
  },
  {
    "key": "pitch-deck-outline",
    "file": "pitch-deck-outline.yaml",
    "name": "创业 Pitch Deck 大纲",
    "description": "输入一句话项目，并行输出市场分析 / 商业模式 / 财务预估 → 整合 5 屏 deck 大纲（创始人评审用）",
    "category": "",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "startup_idea",
        "description": "项目一句话描述（解决什么问题 + 给谁）",
        "required": true
      },
      {
        "name": "target_market",
        "description": "主战场地区",
        "required": false
      },
      {
        "name": "stage",
        "description": "融资阶段（影响 deck 侧重）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "market_analysis",
        "expert": "agency_product_product_trend_researcher",
        "task": "分析项目所在市场的痛点和机会。\n\n项目: {{startup_idea}}\n市场: {{target_market}}\n阶段: {{stage}}\n\n输出格式（markdown，不超过 500 字）:\n### 用户痛点（按强度排序）\n1. 痛点 → 现有方案为什么不够\n2. ...\n3. ...\n\n### 市场规模（粗估）\n- TAM（总市场）: 数字 + 估算逻辑（哪怕粗糙也写）\n- SAM（可服务市场）: 数字 + 缩小逻辑\n- SOM（3 年内可拿下）: 数字 + 凭什么\n\n### 时机为什么是现在\n为什么今天做比 3 年前做更可能成（技术/政策/用户习惯任一角度，1-2 句话）\n\n### 主要竞争对手\n| 对手 | 核心打法 | 我们的差异点 |\n|------|---------|------------|",
        "output": "market",
        "depends_on": []
      },
      {
        "id": "solution_design",
        "expert": "agency_product_product_manager",
        "task": "设计项目的产品/服务方案。\n\n项目: {{startup_idea}}\n市场: {{target_market}}\n\n输出格式（markdown，不超过 500 字）:\n### 核心方案（一句话）\n用户最终拿到的是什么（产品/服务）\n\n### 关键能力（3 个最强）\n1. 能力 → 解决了哪个痛点 → 用户感受\n2. ...\n3. ...\n\n### 产品形态\n- 交付方式（APP/Web/SaaS/线下/其他）\n- 用户使用频率（每天/每周/按需）\n- 关键体验路径（用户从注册到产生价值的最短路径，3-5 步）\n\n### 技术/资源壁垒\n为什么这个方案别人不能轻易复制（数据/网络效应/品牌/技术任一角度）",
        "output": "solution",
        "depends_on": []
      },
      {
        "id": "business_model",
        "expert": "agency_specialized_specialized_pricing_optimizer",
        "task": "设计项目的商业模式和定价策略。\n\n项目: {{startup_idea}}\n市场: {{target_market}}\n阶段: {{stage}}\n\n输出格式（markdown，不超过 400 字）:\n### 收入模式\n- 主要收入来源（如订阅/交易抽成/广告/Saas/硬件）\n- 一句话单笔收入逻辑（\"用户每月付 X 元，因为 Y\"）\n\n### 定价（建议初期）\n| 套餐 | 价格 | 包含 | 目标人群 |\n|------|-----|------|---------|\n\n### 单位经济（粗估）\n- 获客成本 CAC（推测）: 多少元 + 来源\n- 用户生命周期价值 LTV（推测）: 多少元 + 推算逻辑\n- LTV/CAC 比例: X\n\n### 增长引擎\n产品有没有内生的增长机制（推荐 / 内容 / 网络效应 / 都没有靠投放），一句话说明",
        "output": "business",
        "depends_on": []
      },
      {
        "id": "financial_projection",
        "expert": "agency_finance_finance_financial_forecaster",
        "task": "给项目做 3 年简易财务预估。\n\n项目: {{startup_idea}}\n阶段: {{stage}}\n\n要求:\n- 数字可以是粗估（标 \"粗估\" 即可）\n- 假设条件要写出来，方便投资人质疑\n- 不要假装精确，但要逻辑自洽\n\n输出格式（markdown）:\n### 关键假设\n1. 假设 → 数值\n2. ...\n（3-5 条最关键的）\n\n### 3 年预估\n| 维度 | 第 1 年 | 第 2 年 | 第 3 年 |\n|------|--------|--------|--------|\n| 用户数 | | | |\n| 付费用户数 | | | |\n| 月经常性收入 MRR | | | |\n| 团队规模 | | | |\n| 月度烧钱 | | | |\n| 现金跑道（月） | | | |\n\n### 资金需求\n本轮融资多少（{{stage}}）→ 用在哪 → 能撑多久 → 关键里程碑",
        "output": "financials",
        "depends_on": []
      },
      {
        "id": "deck_outline",
        "expert": "agency_product_product_manager",
        "task": "整合所有材料，输出 5 屏（每屏 1 页）的 pitch deck 大纲。\n\n项目: {{startup_idea}}\n市场分析:\n{{market}}\n\n产品方案:\n{{solution}}\n\n商业模式:\n{{business}}\n\n财务预估:\n{{financials}}\n\n要求:\n- 每屏只讲一件事，2-3 句话能说完\n- 5 屏顺序: 问题 → 方案 → 市场 → 商业模式 → 财务/融资\n- 每屏给\"标题 + 主信息 + 视觉建议\"三部分\n- 数据从前面材料中转录，不要新编\n\n输出格式（markdown）:\n# Pitch Deck 大纲：{{startup_idea}}\n\n## Slide 1: 问题\n**标题**: 一句话点题\n**主信息（≤ 3 行）**: ...\n**视觉建议**: 用什么图/数据让评审一眼相信痛点真实存在\n\n## Slide 2: 方案\n...\n\n## Slide 3: 市场\n...\n\n## Slide 4: 商业模式\n...\n\n## Slide 5: 财务 & 融资\n...\n\n## 附录建议（可选 backup slide）\n- 团队介绍\n- 竞争对比表\n- 已有进展（数据 / 用户 / 合作）\n\n## Pitch 演讲节奏建议\n（5 屏总共讲多久，哪几屏要重点停留）\n\n⚠️ 只输出上面这份 deck 大纲本身：不要开场白/寒暄、不要\"我改了什么/复盘/修改说明\"、不要向用户提问或请其拍板、不要建议 ao 命令或后续动作、不要\"要我继续吗\"之类收尾。",
        "output": "pitch_deck",
        "depends_on": [
          "market_analysis",
          "solution_design",
          "business_model",
          "financial_projection"
        ]
      }
    ]
  },
  {
    "key": "product-launch-comms",
    "file": "product-launch-comms.yaml",
    "name": "产品发布物料生成",
    "description": "输入新产品/功能简介，并行产出发布通稿 + 社交短文 + 客户邮件 → 整合发布物料包",
    "category": "",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "product_name",
        "description": "产品/功能名",
        "required": true
      },
      {
        "name": "product_summary",
        "description": "一句话核心价值（用户角度，不要技术术语）",
        "required": true
      },
      {
        "name": "key_features",
        "description": "3-5 个关键能力，每个一句话（换行分隔）",
        "required": true
      },
      {
        "name": "launch_audience",
        "description": "目标受众",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "positioning",
        "expert": "agency_marketing_marketing_social_media_strategist",
        "task": "基于产品信息，输出统一的发布定位（所有物料都基于这一份）。\n\n产品: {{product_name}}\n一句话价值: {{product_summary}}\n关键能力:\n{{key_features}}\n受众: {{launch_audience}}\n\n输出格式（markdown，不超过 500 字）:\n### 核心 Hook（一句话钩子）\n最能让目标受众停下来的那一句话。\n\n### 三个最强卖点（按打动力排序）\n1. 卖点 → 替代了什么旧痛苦 / 解锁了什么新可能\n2. ...\n3. ...\n\n### 产品口吻\n用 3 个形容词定位语气（如\"专业、简洁、稍带克制的兴奋\"）\n\n### 目标行动\n读完这次发布，受众应该做什么（点链接/试用/分享/其他）",
        "output": "positioning",
        "depends_on": []
      },
      {
        "id": "press_release",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "基于定位写一篇可投递媒体或发到公司博客的发布通稿。\n\n产品: {{product_name}}\n产品价值: {{product_summary}}\n关键能力:\n{{key_features}}\n统一定位:\n{{positioning}}\n\n要求:\n- 800-1200 字\n- 结构: 钩子段 → 解决了什么 → 产品能力（每个能力一段）→ 用户故事 / 案例（编 1 个合理的）→ 上线信息（CTA）\n- 标题用定位中的\"核心 Hook\"改写成媒体风格\n- 不要写\"在 AI 时代\"、\"新一代\"、\"颠覆性\"这种空话\n- 直接输出可发布的 markdown 文章",
        "output": "press",
        "depends_on": [
          "positioning"
        ]
      },
      {
        "id": "social_short",
        "expert": "agency_marketing_marketing_social_media_strategist",
        "task": "基于定位写 3 条不同平台的社交短文。\n\n产品: {{product_name}}\n统一定位:\n{{positioning}}\n\n输出格式（markdown）:\n### 微博 / 推特（≤ 140 字）\n（直接发的内容，含 emoji，不要标记 #标签 留位置让用户自己加）\n\n### LinkedIn / 朋友圈（≤ 300 字）\n（专业语气，3 段：钩子 / 价值 / CTA）\n\n### 小红书风格（≤ 250 字）\n（第一人称体验，2-3 个 emoji，结尾问句引互动）\n\n每条都要从定位中的\"核心 Hook\"出发，不要堆能力列表。",
        "output": "socials",
        "depends_on": [
          "positioning"
        ]
      },
      {
        "id": "customer_email",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "基于定位写一封发给老用户的产品发布邮件。\n\n产品: {{product_name}}\n产品价值: {{product_summary}}\n统一定位:\n{{positioning}}\n\n要求:\n- 收件人是已经使用我们产品的老用户（已注册），所以不要重新介绍公司\n- 250-400 字\n- 结构: 称呼（\"嗨\"，不要\"尊敬的\"）→ 一句话钩子 → 这次更新带来什么实际改变 → 怎么开始用（具体步骤）→ 反馈渠道\n- 标题（subject line）用定位 hook 改写，加上\"NEW:\" 或 emoji 让收件箱里能被看见\n- 直接输出邮件内容（含 Subject 行）",
        "output": "email",
        "depends_on": [
          "positioning"
        ]
      },
      {
        "id": "launch_pack",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "把所有物料整合成一份\"发布日物料包\"，方便市场/运营/客服当天取用。\n\n统一定位:\n{{positioning}}\n\n发布通稿:\n{{press}}\n\n社交短文:\n{{socials}}\n\n老用户邮件:\n{{email}}\n\n输出格式（markdown，单文档可直接发）:\n# 产品发布物料包：{{product_name}}\n\n## 发布定位（共享语言）\n（摘录定位中的核心 Hook 和三个卖点，30 行内）\n\n## 渠道物料（按使用场景分组）\n\n### 媒体投放 / 公司博客\n（直接转录通稿）\n\n### 社交渠道\n（直接转录三条社交短文）\n\n### 老用户邮件\n（直接转录邮件）\n\n## 发布日检查清单\n- [ ] 通稿审核（公关/法务）\n- [ ] 社交短文图片素材准备\n- [ ] 邮件 EDM 列表确认\n- [ ] 客服回应口径同步\n- [ ] 发布时间确认（建议工作日上午）",
        "output": "full_pack",
        "depends_on": [
          "press_release",
          "social_short",
          "customer_email"
        ]
      }
    ]
  },
  {
    "key": "product-review",
    "file": "product-review.yaml",
    "name": "产品需求评审",
    "description": "多角色协作评审 PRD 文档 — 产品经理分析需求，架构师评估技术，设计师评估体验，最后汇总结论",
    "category": "",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "prd_content",
        "description": "PRD 文档内容",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "analyze",
        "expert": "agency_product_product_manager",
        "task": "分析以下 PRD 文档，输出结构化评审。\n\nPRD 内容：\n{{prd_content}}\n\n输出格式（markdown）：\n### 核心需求（按优先级 P0/P1/P2 排列）\n- P0: ...\n- P1: ...\n\n### 目标用户画像\n用户类型 | 核心痛点 | 使用场景\n\n### 风险与不确定性\n- [高/中/低] 风险描述 → 建议的验证方式\n\n### 关键成功指标\n- 指标名 | 目标值 | 衡量方式",
        "output": "requirements",
        "depends_on": []
      },
      {
        "id": "tech_review",
        "expert": "agency_engineering_engineering_software_architect",
        "task": "基于以下需求分析，进行技术可行性评估。\n\n需求分析：\n{{requirements}}\n\n输出格式（markdown）：\n### 技术可行性评分：[高/中/低]\n\n### 推荐技术架构\n简要描述核心组件和交互方式（3-5 句话）\n\n### 开发复杂度\n| 模块 | 复杂度(1-5) | 预估人天 | 主要挑战 |\n\n### 技术风险\n- [高/中/低] 风险描述 → 缓解方案",
        "output": "tech_report",
        "depends_on": [
          "analyze"
        ]
      },
      {
        "id": "design_review",
        "expert": "agency_design_design_ux_researcher",
        "task": "基于以下需求分析，进行用户体验评估。\n\n需求分析：\n{{requirements}}\n\n输出格式（markdown）：\n### UX 风险评估\n- [高/中/低] 风险描述 → 影响范围\n\n### 可用性问题\n- 问题 → 建议的解决方案\n\n### 设计建议（Top 3）\n1. 建议 → 预期效果\n\n### 需验证假设\n- 假设 → 建议的验证方法（用户访谈/A-B测试/原型测试）",
        "output": "design_report",
        "depends_on": [
          "analyze"
        ]
      },
      {
        "id": "final_summary",
        "expert": "agency_product_product_manager",
        "task": "综合技术和设计反馈，输出最终评审结论。\n\n## 技术评估\n{{tech_report}}\n\n## 设计评估\n{{design_report}}\n\n输出格式（markdown）：\n### 评审结论：[✅ 通过 / ⚠️ 需修改 / ❌ 不通过]\n\n### 必须解决（合并前）\n1. [来源: 技术/设计] 问题 → 建议方案\n\n### 建议改进（可后续迭代）\n1. 问题 → 优先级\n\n### 下一步行动\n- [ ] 行动项 | 负责方 | 建议时间\n\n⚠️ 只输出上面这份评审报告本身：不要开场白/寒暄、不要\"我改了什么/复盘/修改说明\"、不要向用户提问或请其拍板、不要建议 ao 命令或后续动作、不要\"要我继续吗\"之类收尾。",
        "output": "final_report",
        "depends_on": [
          "tech_review",
          "design_review"
        ]
      }
    ]
  },
  {
    "key": "resume-and-interview-prep",
    "file": "resume-and-interview-prep.yaml",
    "name": "简历优化与面试准备",
    "description": "简历诊断 → 简历重写 + 面试问题预测 + STAR 答题框架",
    "category": "",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "resume_content",
        "description": "当前简历内容（纯文本粘贴即可，支持 @文件）",
        "required": true
      },
      {
        "name": "target_role",
        "description": "目标岗位（如：字节跳动高级产品经理 / 腾讯后端开发）",
        "required": true
      },
      {
        "name": "job_description",
        "description": "目标岗位 JD（可选，越具体越好）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "diagnose",
        "expert": "agency_hr_hr_recruiter",
        "task": "作为招聘过 {{target_role}} 的资深 HR，诊断以下简历的问题。\n\n目标岗位: {{target_role}}\nJD 参考: {{job_description}}\n\n简历内容:\n{{resume_content}}\n\n输出（300-400 字）:\n1. **硬伤 Top 3**: 最影响通过初筛的 3 个问题（每个 1 句话 + 为什么）\n2. **优势盘点**: 简历里最有价值的 2-3 个点（应当被放大）\n3. **ATS 关键词缺失**: 目标岗位必备但简历未提及的关键词（10 个以内）\n4. **简历整体得分**: 按招聘官视角打 0-10 分，并说明扣分点",
        "output": "diagnosis",
        "depends_on": []
      },
      {
        "id": "rewrite",
        "expert": "agency_hr_hr_recruiter",
        "task": "根据诊断结果重写简历。\n\n诊断:\n{{diagnosis}}\n\n原简历:\n{{resume_content}}\n\n目标岗位: {{target_role}}\n\n重写要求:\n- 每条工作经历改写成 STAR 结构的 bullet（用数字和结果说话）\n- 补齐 ATS 关键词，但不要堆砌\n- 砍掉与目标岗位无关的内容\n- 技能栏按目标岗位重排序\n- 输出 markdown 格式的完整简历，直接可用",
        "output": "new_resume",
        "depends_on": [
          "diagnose"
        ]
      },
      {
        "id": "predict_questions",
        "expert": "agency_hr_hr_recruiter",
        "task": "预测 {{target_role}} 面试中高概率会问的问题。\n\n参考诊断里的\"硬伤\"和\"优势\"，尤其要覆盖硬伤的追问:\n{{diagnosis}}\n\nJD:\n{{job_description}}\n\n输出 10 个问题，按以下 4 类各 2-3 个:\n- **基础能力类**: 岗位硬技能\n- **项目深挖类**: 简历中最可能被刨根问底的点\n- **硬伤追问类**: 针对诊断里的硬伤，HR 会怎么问\n- **软素质类**: 团队协作、抗压、冲突处理\n\n每个问题注明「考察意图」。",
        "output": "interview_questions",
        "depends_on": [
          "diagnose"
        ]
      },
      {
        "id": "star_answers",
        "expert": "agency_hr_hr_performance_reviewer",
        "task": "为下面每个面试问题写一个 STAR 答题框架（不是模板答案，是答题思路）。\n\n问题列表:\n{{interview_questions}}\n\n候选人背景:\n{{new_resume}}\n\n每个问题输出:\n- **S (情境)**: 要提及的背景（1 句）\n- **T (任务)**: 要凸显的责任（1 句）\n- **A (行动)**: 应该讲的 2-3 个关键动作\n- **R (结果)**: 要突出的数字或成果\n- **⚠️ 避雷**: 这题最容易踩的 1 个坑\n\n保持简洁，每题 5-6 行。",
        "output": "final_prep",
        "depends_on": [
          "rewrite",
          "predict_questions"
        ]
      }
    ]
  },
  {
    "key": "story-creation",
    "file": "story-creation.yaml",
    "name": "短篇小说创作",
    "description": "从创意到成稿：叙事学家设计结构 → 心理学家塑造人物 + 叙事设计师构建冲突 → 内容创作者执笔成稿",
    "category": "",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "premise",
        "description": "故事创意/主题/一句话梗概",
        "required": true
      },
      {
        "name": "style",
        "description": "风格偏好（如：悬疑、温情、荒诞、科幻）",
        "required": false
      },
      {
        "name": "length",
        "description": "目标字数（默认 800）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "story_structure",
        "expert": "agency_academic_academic_narratologist",
        "task": "请为以下创意设计短篇小说的叙事结构。\n\n创意：{{premise}}\n风格：{{style}}\n\n要求输出（用 markdown 格式）：\n1. **核心冲突**：一句话概括\n2. **叙事视角**：人称 + 视角人物 + 是否为不可靠叙述者\n3. **结构安排**：\n   - 开头钩子（用一个画面/细节抓住读者）\n   - 发展（2-3 个递进事件）\n   - 高潮（情感最大张力点）\n   - 结尾（收束方式：开放/闭合/回环）\n4. **叙事技巧**：选 1-2 种最适合的（倒叙/留白/反转/双线等）\n5. **核心情感/主题**：一句话\n\n保持简洁，每项不超过 2 句话。",
        "output": "structure",
        "depends_on": []
      },
      {
        "id": "character_design",
        "expert": "agency_academic_academic_psychologist",
        "task": "基于以下叙事结构，设计主要人物（2-3 个）。\n\n{{structure}}\n\n每个人物输出（用 markdown 格式）：\n### [人物名]（身份，年龄）\n- **一句话**：用一句话概括这个人物\n- **核心动机**：想要什么\n- **内心矛盾**：害怕什么 / 不愿面对什么\n- **记忆点**：一个让读者记住的具体细节或习惯\n- **弧线**：从 [起点状态] → [终点状态]\n\n人物要真实可信，避免脸谱化。配角也需要独立动机。",
        "output": "characters",
        "depends_on": [
          "story_structure"
        ]
      },
      {
        "id": "conflict_design",
        "expert": "agency_game-development_narrative_designer",
        "task": "基于以下叙事结构，设计具体的冲突场景。\n\n{{structure}}\n\n输出（用 markdown 格式）：\n### 开头钩子\n用 3-5 句话描绘具体画面（环境、动作、感官细节）\n\n### 核心冲突场景\n写出 3-5 句关键对话（要有潜台词和张力，不是直白表达）\n\n### 高潮转折\n描述情感最大张力时刻的具体画面\n\n### 结尾留白\n最后一个画面或声音（用一个意象收束）\n\n要求：具体、有画面感，不要抽象概括。每个场景像电影分镜一样可视化。",
        "output": "scenes",
        "depends_on": [
          "story_structure"
        ]
      },
      {
        "id": "write_story",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "根据以下素材，写一篇完整的短篇小说（约 {{length}} 字）。\n\n## 叙事结构\n{{structure}}\n\n## 人物设定\n{{characters}}\n\n## 关键场景\n{{scenes}}\n\n写作要求：\n- 直接输出小说正文，不要标题、说明或元评论\n- 第一句话就要制造悬念或画面感\n- 对话自然口语化，每个人物有独特的说话方式\n- 用具体感官细节（声音、气味、触感）代替形容词堆砌\n- 叙事节奏：短句加速紧张感，长句放慢沉浸感\n- 结尾留有余韵，让读者读完后还会想一想",
        "output": "story",
        "depends_on": [
          "character_design",
          "conflict_design"
        ]
      }
    ]
  },
  {
    "key": "strategy\\business-plan",
    "file": "strategy\\business-plan.yaml",
    "name": "商业计划书",
    "description": "趋势研究 → 财务预测 + 产品规划 → 高管摘要，生成一份完整的商业计划书",
    "category": "strategy",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "idea",
        "description": "商业创意/项目简介（一段话描述你要做什么）",
        "required": true
      },
      {
        "name": "stage",
        "description": "项目阶段（如：种子轮融资、天使轮、内部立项、新产品线）",
        "required": false
      },
      {
        "name": "market",
        "description": "目标市场（如：中国中小企业、东南亚电商、全球开发者）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "market_research",
        "expert": "agency_product_product_trend_researcher",
        "task": "请为以下商业创意进行市场研究：\n\n创意：{{idea}}\n目标市场：{{market}}\n项目阶段：{{stage}}\n\n请输出：\n1. **市场规模**（TAM/SAM/SOM 三层分析）\n2. **行业趋势**（3-5 个驱动增长的趋势）\n3. **竞争格局**（现有玩家、市场集中度、进入壁垒）\n4. **目标客群画像**（早期用户是谁、痛点是什么、付费意愿如何）\n5. **政策环境**（利好/风险）",
        "output": "market_report",
        "depends_on": []
      },
      {
        "id": "financial_model",
        "expert": "agency_finance_finance_financial_forecaster",
        "task": "基于以下市场研究，构建财务预测模型：\n\n{{market_report}}\n\n商业创意：{{idea}}\n项目阶段：{{stage}}\n\n请输出：\n1. **商业模式**（收入来源、定价策略、单位经济模型）\n2. **3 年财务预测**（表格：收入、成本、毛利、净利，按季度）\n3. **关键假设**（客户获取成本、转化率、留存率、ARPU 等）\n4. **资金需求**（需要多少钱、怎么花、能撑多久）\n5. **盈亏平衡分析**（什么时候开始赚钱）",
        "output": "financial_plan",
        "depends_on": [
          "market_research"
        ]
      },
      {
        "id": "product_roadmap",
        "expert": "agency_product_product_manager",
        "task": "基于以下市场研究，规划产品路线图：\n\n{{market_report}}\n\n商业创意：{{idea}}\n\n请输出：\n1. **核心价值主张**（一句话：我们为谁解决什么问题）\n2. **MVP 定义**（最小可行产品包含哪些功能，不包含哪些）\n3. **产品路线图**（3 个阶段，每阶段的目标、功能、里程碑）\n4. **竞争壁垒**（技术/数据/网络效应/品牌，哪些能构建护城河）\n5. **团队需求**（各阶段需要什么样的人）",
        "output": "product_plan",
        "depends_on": [
          "market_research"
        ]
      },
      {
        "id": "executive_summary",
        "expert": "agency_support_support_executive_summary_generator",
        "task": "请将以下内容整合为一份完整的商业计划书：\n\n## 市场研究\n{{market_report}}\n\n## 财务预测\n{{financial_plan}}\n\n## 产品规划\n{{product_plan}}\n\n输出格式（投资人/决策者阅读）：\n\n# [项目名称] 商业计划书\n\n## 执行摘要（1 页，最重要）\n- 一句话描述\n- 市场机会\n- 商业模式\n- 团队优势\n- 融资需求和用途\n\n## 市场分析\n[整合市场研究]\n\n## 产品方案\n[整合产品规划]\n\n## 财务计划\n[整合财务预测]\n\n## 里程碑与时间表\n[从产品路线图提取]\n\n## 风险与应对\n[从各部分提取风险项，给出应对策略]\n\n风格：专业、数据驱动、适合给投资人/领导审阅。",
        "output": null,
        "depends_on": [
          "financial_model",
          "product_roadmap"
        ]
      }
    ]
  },
  {
    "key": "tech-blog",
    "file": "tech-blog.yaml",
    "name": "技术博客创作",
    "description": "输入一句话主题，自动完成趋势调研 → 大纲 → 正文 → 润色，输出可直接发布的技术博客",
    "category": "",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "topic",
        "description": "博客主题（一句话），如：用 Rust 重写 Python 热点函数的实战经验",
        "required": true
      },
      {
        "name": "audience",
        "description": "目标读者画像",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "research",
        "expert": "agency_product_product_trend_researcher",
        "task": "围绕主题做调研，输出技术博客的核心论点和支撑材料。\n\n主题: {{topic}}\n目标读者: {{audience}}\n\n输出格式（markdown，不超过 600 字）:\n### 核心论点（3 个，按重要性排序）\n1. 论点 → 为什么读者会关心\n2. ...\n3. ...\n\n### 关键事实/数据\n- 事实/数据 → 来源类型（论文/官方文档/常识/经验）\n\n### 容易踩的坑\n- 坑 → 一句话规避方法\n\n### 推荐角度\n最适合切入的写作角度（一句话）。",
        "output": "research_brief",
        "depends_on": []
      },
      {
        "id": "outline",
        "expert": "agency_engineering_engineering_technical_writer",
        "task": "基于以下调研，搭建博客大纲。\n\n调研:\n{{research_brief}}\n\n主题: {{topic}}\n\n输出格式（markdown，不超过 400 字）:\n### 标题（3 个候选，按吸引力排序）\n1. ...\n2. ...\n3. ...\n\n### 文章大纲（5-7 节）\n1. 节标题 → 一句话本节要点\n2. ...\n\n### 写作风格定位\n语气、节奏、深度 一句话指引（如\"先讲故事再上代码，避免论文腔\"）",
        "output": "outline_doc",
        "depends_on": [
          "research"
        ]
      },
      {
        "id": "draft",
        "expert": "agency_engineering_engineering_senior_developer",
        "task": "基于调研和大纲，写出完整博客正文（包含代码示例）。\n\n调研:\n{{research_brief}}\n\n大纲:\n{{outline_doc}}\n\n要求:\n- 选大纲第一个标题\n- 每节 200-400 字，节内逻辑紧凑\n- 必须包含至少 1 段可直接运行的代码示例（带注释）\n- 不要写\"在本文中我们将\"这种 AI 套话\n- 直接给读者价值，避免泛泛而谈\n- 总字数 1500-2500 字",
        "output": "blog_draft",
        "depends_on": [
          "research",
          "outline"
        ]
      },
      {
        "id": "polish",
        "expert": "agency_engineering_engineering_technical_writer",
        "task": "对以下博客做最终润色，输出可直接发布的版本。\n\n原稿:\n{{blog_draft}}\n\n润色要求:\n- 删掉 AI 套话（\"综上所述\"、\"在本文中\"、\"让我们一起\"等）\n- 简化冗长句式\n- 检查代码示例是否可运行（syntax 错误就修正并标注 \"// 修正\"）\n- 标题用大纲第一个候选\n- 在文末加一段\"延伸阅读\"（3 条相关概念，不需要 URL）\n- 保留所有原稿的核心论点和数据，不要漏内容\n\n直接输出润色后的完整 markdown 博客（含标题）。\n\n⚠️ 只输出博客成品本身：不要开场白/寒暄、不要\"我改了什么/复盘/修改说明\"、不要向用户提问或请其拍板、不要建议 ao 命令或后续动作、不要\"要我继续吗\"之类收尾。",
        "output": "final_blog",
        "depends_on": [
          "draft"
        ]
      }
    ]
  },
  {
    "key": "xiaohongshu-viral-post",
    "file": "xiaohongshu-viral-post.yaml",
    "name": "小红书爆款笔记创作",
    "description": "一句话主题 → 策略分析 + 文案撰写 + SEO 标题 + 整合成稿",
    "category": "",
    "featured": false,
    "concurrency": 3,
    "inputs": [
      {
        "name": "topic",
        "description": "笔记主题（如：秋季穿搭技巧 / 职场新人避坑指南）",
        "required": true
      },
      {
        "name": "target_audience",
        "description": "目标人群（如：25-35 岁女性白领，可选）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "strategy",
        "expert": "agency_marketing_marketing_xiaohongshu_specialist",
        "task": "围绕主题「{{topic}}」做爆款策略分析，目标人群：{{target_audience}}。\n\n输出结构（300-400 字）:\n1. **选题角度**：3 个具体的切入角度，每个说明爆款潜力\n2. **情绪钩子**：应该激发用户什么情绪（共鸣 / 焦虑 / 好奇 / 获得感）\n3. **内容骨架**：建议的内容结构（开头钩子→主体价值→结尾互动）\n4. **互动设计**：让用户评论/收藏的 1 个具体触发点",
        "output": "strategy",
        "depends_on": []
      },
      {
        "id": "copy",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "根据策略写一篇小红书正文（500-700 字）。\n\n策略要点：\n{{strategy}}\n\n正文要求：\n- 开头 1 句话抓人（不要寒暄、不要自我介绍）\n- 用\"我\"视角讲亲身经历或观察，真实感\n- 分 3-5 个小节，每节有明确价值点\n- 夹杂 emoji 让视觉轻盈（不要堆砌）\n- 结尾 1 句引导评论/收藏",
        "output": "post_body",
        "depends_on": [
          "strategy"
        ]
      },
      {
        "id": "title",
        "expert": "agency_marketing_marketing_baidu_seo_specialist",
        "task": "围绕主题「{{topic}}」和策略要点，产出:\n\n1. **5 个候选标题**（每个 ≤20 字）：\n   - 至少 2 个带数字\n   - 至少 1 个带对比反差\n   - 至少 1 个带结果承诺\n2. **推荐标题**：从 5 个里选 1 个最可能爆的，说明理由\n3. **10 个话题标签**：按搜索量和相关性排序（#xxx 格式）\n\n参考策略：\n{{strategy}}",
        "output": "title_and_tags",
        "depends_on": [
          "strategy"
        ]
      },
      {
        "id": "final",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "把下面内容整合成一篇可以直接发布的小红书笔记。\n\n标题和标签：\n{{title_and_tags}}\n\n正文：\n{{post_body}}\n\n输出格式（严格按此结构）:\n```\n【标题】：<选用推荐标题>\n\n【正文】：\n<完整正文，可微调以适配标题>\n\n【话题标签】：\n<10 个标签，每个前面加 #，用空格分隔>\n\n【发布建议】：\n<2-3 行，包含建议发布时间、是否配图、评论区引导语>\n```",
        "output": "final_post",
        "depends_on": [
          "copy",
          "title"
        ]
      }
    ]
  },
  {
    "key": "一人公司-做产品",
    "file": "一人公司-做产品.yaml",
    "name": "一人公司·做产品",
    "description": "你出想法，AI 团队出货：产品经理写 PRD、架构师定方案、工程师排计划，老板（你）拿到能直接开工的启动包",
    "category": "一人公司",
    "featured": true,
    "concurrency": 2,
    "inputs": [
      {
        "name": "idea",
        "description": "你的产品想法（如：帮自由职业者自动记账开发票的小工具）",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "ceo_brief",
        "expert": "agency_strategy_nexus_strategy",
        "task": "你是这家一人公司的 CEO。创始人的想法：{{idea}}\n\n给团队下达开工简报：\n1. 产品一句话定位\n2. 目标用户与核心痛点\n3. 这一版只做什么、坚决不做什么（范围栅栏）\n4. 四周后的验收画面\n\n像晨会讲话一样简洁有力，说人话。",
        "output": "brief",
        "depends_on": []
      },
      {
        "id": "prd",
        "expert": "agency_product_product_manager",
        "task": "老板的开工简报：{{brief}}\n\n作为产品经理，输出 MVP 的 PRD：\n1. 用户画像与使用场景（具体到人、时间、动机）\n2. 核心功能 3 个（每个写清用户操作路径和解决的问题）\n3. 明确砍掉的功能及理由\n4. 第一版上线标准（可衡量的指标）",
        "output": "prd_doc",
        "depends_on": [
          "ceo_brief"
        ]
      },
      {
        "id": "architecture",
        "expert": "agency_engineering_engineering_backend_architect",
        "task": "PRD 已出：{{prd_doc}}\n\n作为技术架构师，输出一人能 hold 住的技术方案：\n1. 技术栈选型及理由（选熟不选新）\n2. 核心模块与数据流（文字画清楚关系）\n3. 明确不引入的东西（防过度设计清单）\n4. 主要技术风险与规避方案",
        "output": "tech_plan",
        "depends_on": [
          "prd"
        ]
      },
      {
        "id": "sprint_plan",
        "expert": "agency_product_product_sprint_prioritizer",
        "task": "PRD：{{prd_doc}}\n技术方案：{{tech_plan}}\n\n作为项目主管，排出 4 周冲刺计划：\n1. 按周拆解，每周有明确可交付物\n2. 每周标注\"完成的定义\"\n3. 留出 20% 缓冲，标明可顺延项",
        "output": "sprint",
        "depends_on": [
          "architecture"
        ]
      },
      {
        "id": "launch_pack",
        "expert": "agency_strategy_nexus_strategy",
        "task": "团队交付齐了：\n\n**PRD**：{{prd_doc}}\n**技术方案**：{{tech_plan}}\n**冲刺计划**：{{sprint}}\n\n作为 CEO 整合输出《产品启动包》：\n## 决策：Go / No-Go 及一句话理由\n## 定稿 PRD 摘要（可直接贴给任何协作者）\n## 技术方案摘要\n## 第一周每日行动清单\n## Top 3 风险与应对\n\n⚠️ 只输出最终成品本身：不要开场白、不要复盘或说明、不要向用户提问、不要建议任何命令或后续动作。",
        "output": "launch_pack_doc",
        "depends_on": [
          "sprint_plan"
        ]
      }
    ]
  },
  {
    "key": "一人公司-做内容",
    "file": "一人公司-做内容.yaml",
    "name": "一人公司·做内容",
    "description": "一个人做账号不孤军奋战：用户研究员找痛点、策划出选题、编导写脚本、运营排日历——你只管出镜",
    "category": "一人公司",
    "featured": true,
    "concurrency": 2,
    "inputs": [
      {
        "name": "direction",
        "description": "账号方向（如：给职场新人讲 AI 工具的抖音号）",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "ceo_position",
        "expert": "agency_strategy_nexus_strategy",
        "task": "你是这家一人内容公司的 CEO。账号方向：{{direction}}\n\n定调：\n1. 账号一句话定位（对谁、说什么、凭什么听你的）\n2. 差异化：同类账号一抓一把，我们不一样在哪\n3. 三个月后的成功画面（粉丝量/互动/变现路径）",
        "output": "position",
        "depends_on": []
      },
      {
        "id": "audience",
        "expert": "agency_design_design_ux_researcher",
        "task": "账号定位：{{position}}\n\n作为用户研究员，输出观众洞察：\n1. 两类典型观众画像（年龄、职业、刷视频的时段和心态）\n2. 他们的 5 个真实痛点/爽点（要有场景感）\n3. 什么样的开头 3 秒能留住他们",
        "output": "audience_insight",
        "depends_on": [
          "ceo_position"
        ]
      },
      {
        "id": "topics",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "定位：{{position}}\n观众洞察：{{audience_insight}}\n\n作为内容策划，出首月选题库：\n1. 10 个选题，每个带标题钩子（观众为什么点进来）\n2. 每个选题标注类型（干货/共鸣/争议/热点）\n3. 标注前 3 条冷启动选题及理由",
        "output": "topic_list",
        "depends_on": [
          "audience"
        ]
      },
      {
        "id": "script",
        "expert": "agency_marketing_marketing_douyin_strategist",
        "task": "选题库：{{topic_list}}\n\n作为编导，把冷启动第 1 条选题写成完整脚本：\n1. 逐句口播稿（含开头 3 秒钩子）\n2. 分镜提示（画面/字幕/节奏）\n3. 时长控制在 60 秒内",
        "output": "first_script",
        "depends_on": [
          "topics"
        ]
      },
      {
        "id": "calendar",
        "expert": "agency_marketing_marketing_social_media_strategist",
        "task": "定位：{{position}}\n选题库：{{topic_list}}\n首条脚本：{{first_script}}\n\n作为运营，输出《首月作战日历》：\n## 发布节奏（每周几更、几点发、为什么）\n## 四周排期表（哪天发哪个选题）\n## 每周数据复盘要看的 3 个指标及调整规则\n## 首条视频发布 checklist\n\n⚠️ 只输出最终成品本身：不要开场白、不要复盘或说明、不要向用户提问、不要建议任何命令或后续动作。",
        "output": "content_calendar",
        "depends_on": [
          "script"
        ]
      }
    ]
  },
  {
    "key": "一人公司-做投研",
    "file": "一人公司-做投研.yaml",
    "name": "一人公司·做投研",
    "description": "像券商研究所一样做功课：宏观→行业→标的→风控四道工序，重大结论须你签字放行。仅供研究参考，不构成投资建议",
    "category": "一人公司",
    "featured": true,
    "concurrency": 2,
    "inputs": [
      {
        "name": "target",
        "description": "研究对象（赛道或标的，如：新能源储能行业 / 某上市公司）",
        "required": true
      },
      {
        "name": "horizon",
        "description": "研究视角（长期配置 / 中短期波段 / 学习研究）",
        "required": false
      }
    ],
    "steps": [
      {
        "id": "macro",
        "expert": "agency_finance_finance_financial_analyst",
        "task": "研究对象：{{target}}\n研究视角：{{horizon}}\n\n作为宏观分析师，输出宏观与政策环境分析：\n1. 当前宏观周期位置及对该领域的影响\n2. 相关政策/监管动向（利好利空分开列）\n3. 流动性与资金面环境\n每一条注明判断依据。",
        "output": "macro_view",
        "depends_on": []
      },
      {
        "id": "industry",
        "expert": "agency_finance_finance_investment_researcher",
        "task": "宏观环境：{{macro_view}}\n研究对象：{{target}}\n\n作为行业研究员，输出行业分析：\n1. 产业链结构与价值分布（谁赚走了利润）\n2. 竞争格局与集中度趋势\n3. 行业所处生命周期阶段及证据\n4. 未来 1-3 年的关键变量",
        "output": "industry_view",
        "depends_on": [
          "macro"
        ]
      },
      {
        "id": "fundamentals",
        "expert": "agency_finance_finance_financial_forecaster",
        "task": "行业分析：{{industry_view}}\n研究对象：{{target}}\n\n作为财务分析师，输出基本面与估值框架：\n1. 核心财务指标怎么看（针对该领域该看什么、健康线在哪）\n2. 估值方法选择及理由（PE/PS/DCF/PB 择其适者）\n3. 乐观/中性/悲观三种情景的关键假设",
        "output": "valuation_view",
        "depends_on": [
          "industry"
        ]
      },
      {
        "id": "risk",
        "expert": "agency_finance_finance_fpa_analyst",
        "task": "宏观：{{macro_view}}\n行业：{{industry_view}}\n估值：{{valuation_view}}\n\n作为风控官，输出风险清单：\n1. Top 5 风险，按\"发生概率 × 影响程度\"排序\n2. 每个风险的预警信号（看到什么就该警惕）\n3. 与 {{horizon}} 视角的适配性提示（这个研究对象适不适合这种打法）",
        "output": "risk_report",
        "depends_on": [
          "fundamentals"
        ]
      },
      {
        "id": "boss_signoff",
        "expert": "agency_product_product_manager",
        "task": "",
        "output": null,
        "depends_on": [
          "risk"
        ]
      },
      {
        "id": "final_report",
        "expert": "agency_finance_finance_investment_researcher",
        "task": "各道工序已完成并经老板签字放行：\n\n**宏观**：{{macro_view}}\n**行业**：{{industry_view}}\n**估值**：{{valuation_view}}\n**风控**：{{risk_report}}\n\n作为首席研究员，整合输出《研究报告》：\n## 核心观点（三句话以内）\n## 宏观与行业结论\n## 基本面与估值判断（含三情景）\n## 风险提示（每条观点旁标注对应风险）\n## 跟踪清单（后续按什么节奏看什么信号）\n## 免责声明：本报告由 AI 生成，仅供研究学习参考，不构成任何投资建议\n\n⚠️ 只输出最终成品本身：不要开场白、不要复盘或说明、不要向用户提问、不要建议任何命令或后续动作。",
        "output": "research_report",
        "depends_on": [
          "boss_signoff"
        ]
      }
    ]
  },
  {
    "key": "一人公司全员大会",
    "file": "一人公司全员大会.yaml",
    "name": "AI 一人公司：全员大会",
    "description": "你说一句话，9 个 AI 部门自动协作，2 分钟出完整商业方案——这就是一人公司",
    "category": "一人公司",
    "featured": true,
    "concurrency": 4,
    "inputs": [
      {
        "name": "idea",
        "description": "你的一句话创意（如：做一个帮自由职业者自动开发票的工具）",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "ceo_kickoff",
        "expert": "agency_strategy_nexus_strategy",
        "task": "你是这家一人公司的 CEO。现在开全员大会，你先做开场：\n\n创始人的想法：{{idea}}\n\n请输出：\n1. 产品一句话定位\n2. 我们要解决什么痛点\n3. 目标用户是谁\n4. 6 个月后的成功画面\n\n语气要像 CEO 在晨会上讲话，简洁有力，说人话，不要套话。",
        "output": "vision",
        "depends_on": []
      },
      {
        "id": "market_research",
        "expert": "agency_product_product_trend_researcher",
        "task": "CEO 刚定了方向：{{vision}}\n\n作为趋势研究员，请做快速市场调研：\n1. 这个赛道的市场规模和增速\n2. 现有竞品 Top 3 及各自优劣\n3. 市场空白点在哪里\n4. 未来 12 个月的趋势判断\n\n要求：每一点说透说到位，给出具体数据和判断依据，不要空洞的套话。",
        "output": "market_insight",
        "depends_on": [
          "ceo_kickoff"
        ]
      },
      {
        "id": "user_research",
        "expert": "agency_design_design_ux_researcher",
        "task": "CEO 刚定了方向：{{vision}}\n\n作为用户研究员，请输出用户洞察：\n1. 核心用户画像（2 类典型用户，要具体到年龄、职业、心态）\n2. 他们现在怎么解决这个问题（现有方案及各自的坑）\n3. 最大的 3 个痛点（要有场景感，不要泛泛而谈）\n4. 愿意付费的关键触发点",
        "output": "user_insight",
        "depends_on": [
          "ceo_kickoff"
        ]
      },
      {
        "id": "tech_feasibility",
        "expert": "agency_engineering_engineering_backend_architect",
        "task": "CEO 刚定了方向：{{vision}}\n\n作为技术架构师，请评估技术可行性：\n1. 推荐技术栈（1 人能 hold 住的，说清楚为什么选这个不选那个）\n2. MVP 核心架构（画清楚模块关系，不要过度设计）\n3. 4 周开发计划（按周拆解，每周要有可交付物）\n4. 技术风险和规避方案（说真实会踩的坑，不要教科书式列举）",
        "output": "tech_plan",
        "depends_on": [
          "ceo_kickoff"
        ]
      },
      {
        "id": "brand_design",
        "expert": "agency_design_design_brand_guardian",
        "task": "CEO 刚定了方向：{{vision}}\n\n作为品牌设计师，请输出品牌基础方案：\n1. 品牌名建议（3 个候选 + 理由，要好记、能注册域名）\n2. 品牌调性和关键词\n3. Slogan 候选（3 个，要口语化，能让人记住）\n4. 视觉风格方向（配色 + 字体建议，给出具体色值）",
        "output": "brand_plan",
        "depends_on": [
          "ceo_kickoff"
        ]
      },
      {
        "id": "product_plan",
        "expert": "agency_product_product_manager",
        "task": "调研结果已出：\n\n**市场调研**：{{market_insight}}\n**用户洞察**：{{user_insight}}\n\n作为产品经理，请输出 MVP 规划：\n1. 核心功能 3 个（每个说清楚用户怎么用、解决什么问题）\n2. 用户故事 Top 5\n3. 优先级排序和取舍理由（说清楚为什么砍掉某些功能）\n4. 第一版上线标准（什么算\"能用\"，要有具体可衡量的指标）",
        "output": "product_spec",
        "depends_on": [
          "market_research",
          "user_research"
        ]
      },
      {
        "id": "marketing_plan",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "调研结果已出：\n\n**市场调研**：{{market_insight}}\n**用户洞察**：{{user_insight}}\n**品牌方案**：{{brand_plan}}\n\n作为营销负责人，请输出冷启动方案：\n1. 发布文案（标题要有钩子感，正文要让人想转发）\n2. 首发渠道 Top 3 及理由（说清楚每个渠道的打法）\n3. 0 预算冷启动策略（要可执行，不要说\"做好内容\"这种废话）\n4. 首月增长目标和关键动作（按周拆解）",
        "output": "marketing_spec",
        "depends_on": [
          "market_research",
          "user_research",
          "brand_design"
        ]
      },
      {
        "id": "finance_plan",
        "expert": "agency_finance_finance_financial_forecaster",
        "task": "调研结果已出：\n\n**市场调研**：{{market_insight}}\n**技术方案**：{{tech_plan}}\n\n作为财务顾问，请输出商业模型：\n1. 定价策略（免费版 vs 付费版，说清楚定价逻辑）\n2. 成本结构（月固定开支，列明每一项）\n3. 收入预测（3/6/12 个月，给出关键假设和计算过程）\n4. 盈亏平衡点分析（多少用户、多少收入才能活下来）",
        "output": "finance_spec",
        "depends_on": [
          "market_research",
          "tech_feasibility"
        ]
      },
      {
        "id": "ceo_decision",
        "expert": "agency_strategy_nexus_strategy",
        "task": "全员大会，所有部门已汇报完毕：\n\n**市场调研**：{{market_insight}}\n**用户洞察**：{{user_insight}}\n**技术方案**：{{tech_plan}}\n**品牌方案**：{{brand_plan}}\n**产品规划**：{{product_spec}}\n**营销方案**：{{marketing_spec}}\n**财务模型**：{{finance_spec}}\n\n作为 CEO，请做最终决策，输出《一人公司启动计划》：\n\n## 决策\nGo 还是 No-Go？一句话理由。\n\n## 产品名称\n从品牌方案中选定一个，说明理由。\n\n## 第一周行动清单\n每天做什么，具体到可执行。\n\n## 资源分配\n时间怎么分（产品/技术/营销各占比）。\n\n## 风险预警\nTop 3 风险 + 应对策略。\n\n## 给自己的话\n作为一人公司创始人，最该坚持什么、最该避免什么。\n\n要求：每个部分都要有明确的决策和理由，不要模棱两可。行动清单要具体到可以直接执行，不要写\"做好XX\"这种空话。",
        "output": "launch_plan",
        "depends_on": [
          "product_plan",
          "marketing_plan",
          "finance_plan"
        ]
      }
    ]
  },
  {
    "key": "省钱混用示例",
    "file": "省钱混用示例.yaml",
    "name": "省钱混用示例：便宜模型干轻活，强模型干重活",
    "description": "演示 per-step 模型覆写（step.llm）——把简单步骤放到便宜/快的档位，把需要深度推理的步骤留给强模型，整体更省钱且不掉关键质量。抄这个模板即可。",
    "category": "",
    "featured": false,
    "concurrency": 2,
    "inputs": [
      {
        "name": "topic",
        "description": "要分析的主题",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "gather",
        "expert": "agency_product_product_trend_researcher",
        "task": "针对主题「{{topic}}」，快速列出：\n1. 5 个公众讨论角度\n2. 3 个核心问题\n3. 3 个常见误区\n只做罗列，不做深度论证。",
        "output": "raw_points",
        "depends_on": []
      },
      {
        "id": "analyze",
        "expert": "agency_academic_academic_narratologist",
        "task": "基于以下要点，做深度分析：给出 3 个大多数人没想到的深层观点，\n并指出其中最反直觉但站得住脚的一个，说明推理链条。\n\n要点：\n{{raw_points}}",
        "output": "deep_analysis",
        "depends_on": [
          "gather"
        ]
      },
      {
        "id": "format",
        "expert": "agency_marketing_marketing_content_creator",
        "task": "把下面的分析整理成一段结构清晰、可直接发布的短文（300-500 字），\n不新增观点，只做组织与润色。\n\n分析：\n{{deep_analysis}}",
        "output": null,
        "depends_on": [
          "analyze"
        ]
      }
    ]
  },
  {
    "key": "软件开发标准流程",
    "file": "软件开发标准流程.yaml",
    "name": "软件开发标准流程",
    "description": "一句话需求 → 澄清 → 架构 → TDD 实现 → 代码审查 → 现实验收。标准化的多智能体软件开发流水线，配合 --materialize 把代码写成真实文件。",
    "category": "",
    "featured": false,
    "concurrency": 1,
    "inputs": [
      {
        "name": "requirement",
        "description": "想做的东西（一句话即可，如：一个支持标签和全文搜索的命令行待办工具）",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "clarify",
        "expert": "agency_product_product_manager",
        "task": "这是自动化流水线，没有人能回答你的提问。请直接基于下面的需求，自行做出合理假设，\n产出一份简洁的需求与设计要点（意图、核心功能、非功能要求、使用场景、约束、技术选型）。\n绝对不要反问、不要等待用户确认、不要让用户选 A/B/C。\n\n需求：{{requirement}}",
        "output": "spec",
        "depends_on": []
      },
      {
        "id": "design",
        "expert": "agency_engineering_engineering_software_architect",
        "task": "把下面的需求与设计要点，写成一份可执行的分步实现计划：\n模块划分、目录/文件结构、关键接口与数据结构、依赖、运行与测试方式、风险点。\n\n{{spec}}",
        "output": "plan",
        "depends_on": [
          "clarify"
        ]
      },
      {
        "id": "implement",
        "expert": "agency_engineering_engineering_senior_developer",
        "task": "这是自动化流水线，没有人能回答你的提问。直接基于下面的计划实现一个可运行的最小项目，\n对任何不明确之处用合理默认值，绝对不要反问、不要等待确认、不要让用户做选择。\n遵循测试驱动：关键逻辑要有对应测试。\n\n{{plan}}\n\n严格按以下格式输出每个文件（供自动落盘解析），不要输出与文件无关的解说：\n\n### 相对/路径/文件名.ext\n```语言\n<该文件的完整内容>\n```\n\n要求：\n- 包含入口文件、依赖清单（如 package.json / requirements.txt）、README 运行说明、以及基本测试。\n- 一律用相对路径，禁止绝对路径或包含 `..`。\n- 代码要能跑起来（缺省值齐全、无明显语法错误）。\n- 重要：若某文件内容本身包含 ``` 代码围栏（典型是 README.md 等 markdown），请用四个反引号 ```` 作为该文件的外层围栏，避免内层围栏被误判截断。",
        "output": "code",
        "depends_on": [
          "design"
        ]
      },
      {
        "id": "review",
        "expert": "agency_engineering_engineering_code_reviewer",
        "task": "审查下面生成的代码：正确性 bug、安全问题、可维护性、与计划的偏差、缺失的测试。\n用证据说话（指到文件/片段），给出按严重度排序的问题清单和具体修改建议。\n\n实现计划：\n{{plan}}\n\n代码：\n{{code}}",
        "output": "review",
        "depends_on": [
          "implement"
        ]
      },
      {
        "id": "verify",
        "expert": "agency_testing_testing_reality_checker",
        "task": "现实检验下面的项目：到底能不能跑起来、是否真的满足最初需求、还差哪些文件/步骤、\n代码审查发现的问题是否致命。不要轻信\"应该可以\"，用清单给出\"可交付 / 待补\"的结论。\n\n最初需求：{{requirement}}\n\n代码：\n{{code}}\n\n代码审查意见：\n{{review}}",
        "output": "acceptance",
        "depends_on": [
          "implement",
          "review"
        ]
      }
    ]
  },
  {
    "key": "需求转项目脚手架",
    "file": "需求转项目脚手架.yaml",
    "name": "需求转项目脚手架",
    "description": "一句话需求 → 澄清 → 计划 → 生成可落盘的项目脚手架。配合 ao run ... --materialize <目录> 把代码写成真实文件。",
    "category": "",
    "featured": false,
    "concurrency": 1,
    "inputs": [
      {
        "name": "idea",
        "description": "想做的东西（一句话即可，如：一个自动记账的命令行小工具）",
        "required": true
      }
    ],
    "steps": [
      {
        "id": "clarify",
        "expert": "agency_product_product_manager",
        "task": "这是自动化流水线，没有人能回答你的提问。请直接基于下面的需求，自行做出合理假设，产出一份简洁的需求与设计要点（意图、核心功能、使用场景、约束、技术选型）。绝对不要反问、不要等待用户确认、不要让用户选 A/B/C。\n\n{{idea}}",
        "output": "spec",
        "depends_on": []
      },
      {
        "id": "plan",
        "expert": "agency_engineering_engineering_software_architect",
        "task": "把下面的需求与设计写成可执行的分步实现计划：模块划分、文件结构、关键接口、依赖与运行方式。\n\n{{spec}}",
        "output": "plan",
        "depends_on": [
          "clarify"
        ]
      },
      {
        "id": "build",
        "expert": "agency_engineering_engineering_rapid_prototyper",
        "task": "这是自动化流水线，没有人能回答你的提问。直接基于下面的计划实现一个可运行的最小项目脚手架，\n对任何不明确之处用合理默认值，绝对不要反问、不要等待确认、不要让用户做选择。\n\n{{plan}}\n\n严格按以下格式输出每个文件（供自动落盘解析），不要输出与文件无关的解说：\n\n### 相对/路径/文件名.ext\n```语言\n<该文件的完整内容>\n```\n\n要求：\n- 包含入口文件、依赖清单（如 package.json / requirements.txt）、README 运行说明、以及基本测试。\n- 一律用相对路径，禁止绝对路径或包含 `..`。\n- 代码要能跑起来（缺省值齐全、无明显语法错误）。\n- 重要：如果某个文件内容本身包含 ``` 代码围栏（典型是 README.md 等 markdown 文件），请用四个反引号 ```` 作为该文件的外层围栏，避免内层围栏被误判截断。",
        "output": "code",
        "depends_on": [
          "plan"
        ]
      },
      {
        "id": "verify",
        "expert": "agency_engineering_engineering_code_reviewer",
        "task": "审查下面生成的项目脚手架：完整性、可运行性、缺失文件、明显 bug，以及跑起来还需补的步骤。用证据说话，给出清单。\n\n{{code}}",
        "output": "review",
        "depends_on": [
          "build"
        ]
      }
    ]
  }
];
