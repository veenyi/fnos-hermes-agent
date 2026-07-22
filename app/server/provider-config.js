// provider-config.js — 供应商配置统一数据源
// ── 供应商预设（18个）──────────────────────────────────────────────
export const PROVIDER_PRESETS = {
  "openai":          { name: "OpenAI",        base_url: "https://api.openai.com/v1" },
  "deepseek":        { name: "DeepSeek",       base_url: "https://api.deepseek.com" },
  "anthropic":       { name: "Anthropic",      base_url: "https://api.anthropic.com/v1" },
  "gemini":          { name: "Google AI",     base_url: "https://generativelanguage.googleapis.com/v1beta/openai" },
  "kimi-coding":     { name: "Moonshot/Kimi",  base_url: "https://api.moonshot.ai/v1" },
  "kimi-coding-cn":  { name: "MoonshotCN",     base_url: "https://api.moonshot.cn/v1" },
  "zai":             { name: "智谱AI",          base_url: "https://open.bigmodel.cn/api/paas/v4" },
  "minimax-cn":      { name: "MiniMax (国内)", base_url: "https://api.minimaxi.com/v1" },
  "minimax":         { name: "MiniMax (国际)", base_url: "https://api.minimax.io/v1" },
  "siliconflow":     { name: "SiliconFlow",    base_url: "https://api.siliconflow.cn/v1" },
  "openrouter":      { name: "OpenRouter",     base_url: "https://openrouter.ai/api/v1" },
  "xai":             { name: "xAI",            base_url: "https://api.x.ai/v1" },
  "mistral":         { name: "Mistral",        base_url: "https://api.mistral.ai/v1" },
  "nvidia":          { name: "NVIDIA",         base_url: "https://integrate.api.nvidia.com/v1" },
  "huggingface":     { name: "HuggingFace",    base_url: "https://api-inference.huggingface.co/v1" },
  "ollama-cloud":    { name: "Ollama Cloud",   base_url: "https://ollama.com/v1" },
  "lmstudio":        { name: "LM Studio",      base_url: "http://localhost:1234/v1" },
  "alibaba":         { name: "通义千问",        base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  // ── Hermes 内置 api_key 类新增商（权威值取自 auth.py PROVIDER_REGISTRY） ──
  "stepfun":             { name: "StepFun Step Plan",          base_url: "https://api.stepfun.ai/step_plan/v1" },
  "arcee":               { name: "Arcee AI",                   base_url: "https://api.arcee.ai/api/v1" },
  "gmi":                 { name: "GMI Cloud",                  base_url: "https://api.gmi-serving.com/v1" },
  "kilocode":            { name: "Kilo Code",                  base_url: "https://api.kilo.ai/api/gateway" },
  "alibaba-coding-plan": { name: "Alibaba Cloud (Coding Plan)", base_url: "https://coding-intl.dashscope.aliyuncs.com/v1" },
  "xiaomi":              { name: "Xiaomi MiMo",                base_url: "https://api.xiaomimimo.com/v1" },
  "tencent-tokenhub":    { name: "Tencent TokenHub",           base_url: "https://tokenhub.tencentmaas.com/v1" },
  // ── 扩展商（OpenAI 兼容，呼应 LightAgent 的广泛兼容）──
  "groq":            { name: "Groq",            base_url: "https://api.groq.com/openai/v1" },
  "deepinfra":       { name: "DeepInfra",       base_url: "https://api.deepinfra.com/v1/openai" },
  "together":        { name: "Together AI",     base_url: "https://api.together.xyz/v1" },
  "atlas":           { name: "Atlas Cloud",     base_url: "https://api.atlascloud.ai/v1" },
  "fireworks":       { name: "Fireworks AI",    base_url: "https://api.fireworks.ai/inference/v1" },
  "perplexity":      { name: "Perplexity",      base_url: "https://api.perplexity.ai" },
};

// ── 每个供应商的可用模型列表（只保留当前主力型号）──────────────────────
export const PROVIDER_MODELS = {
  "openai": [
    "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano",
    "gpt-5.3-codex", "o4-mini", "o3",
  ],
  "deepseek": [
    "deepseek-v4-flash", "deepseek-v4-pro",
  ],
  "anthropic": [
    "claude-fable-5", "claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5-20251001",
  ],
  "gemini": [
    "gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite",
  ],
  "kimi-coding": [
    "kimi-k2.7-code", "kimi-k2.6", "moonshot-v1-128k",
  ],
  "kimi-coding-cn": [
    "kimi-k2.7-code", "kimi-k2.6", "moonshot-v1-128k",
  ],
  "zai": [
    "glm-5.1", "glm-5", "glm-4.7", "glm-4.6v",
  ],
  "minimax-cn": [
    "MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5",
  ],
  "minimax": [
    "MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5",
  ],
  "siliconflow": [
    "deepseek-ai/DeepSeek-V3.2", "Qwen/Qwen3.6-235B-A22B", "zai-org/GLM-5.1",
  ],
  "openrouter": [
    "openai/gpt-5.5", "anthropic/claude-sonnet-5",
    "google/gemini-3.1-pro-preview", "deepseek/deepseek-v4-pro",
  ],
  "xai": [
    // P3：清理 xAI 2026-05-15 已下线的 grok-4.1-fast 家族，补当前主力 grok-4.20。
    "grok-4.5", "grok-4.3", "grok-4.20-0309-reasoning", "grok-4.20-0309-non-reasoning",
  ],
  "mistral": [
    "mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest",
  ],
  "nvidia":          ["meta/llama-3.1-70b-instruct", "minimaxai/minimax-m2.7"],
  "huggingface":     ["meta-llama/Meta-Llama-3-70B-Instruct"],
  "ollama-cloud":    ["gpt-oss:120b", "qwen3-coder:480b-cloud", "glm-4.6:cloud"],
  "ollama-local":    ["llama3.2", "qwen2.5-coder:7b", "gemma2:9b", "mistral:7b", "phi3:mini"],
  "lmstudio":        ["local-model", "custom-model"],
  "alibaba": [
    "qwen-plus", "qwen-max", "qwen3.5-plus", "qwen3-max-2026-01-23", "qwen3-coder-next",
  ],
  // ── Hermes 内置 api_key 类新增商（模型取自 hermes_cli/models.py） ──
  "stepfun": [
    "step-3.5-flash", "step-3.5-flash-2603",
  ],
  "arcee": [
    "trinity-large-thinking", "trinity-large-preview", "trinity-mini",
  ],
  "gmi": [
    "zai-org/GLM-5.1-FP8", "deepseek-ai/DeepSeek-V3.2", "moonshotai/Kimi-K2.5", "google/gemini-3.1-flash-lite-preview",
  ],
  "kilocode": [
    "anthropic/claude-opus-4.6", "anthropic/claude-sonnet-4.6", "openai/gpt-5.4", "google/gemini-3-pro-preview",
  ],
  "alibaba-coding-plan": [
    "qwen3.7-max", "qwen3.6-plus", "qwen3.5-plus", "qwen3-coder-plus",
  ],
  "xiaomi": [
    "mimo-v2.5-pro", "mimo-v2.5", "mimo-v2-pro", "mimo-v2-omni",
  ],
  "tencent-tokenhub": [
    "hy3-preview",
  ],
  "groq":       ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  "deepinfra":  ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-72B-Instruct", "mistralai/Mixtral-8x7B-Instruct-v0.1"],
  "together":   ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3"],
  "atlas":      ["claude-sonnet-4", "gpt-4.1", "openai/gpt-4.1"],
  "fireworks":  ["accounts/fireworks/models/llama-v3p3-70b-instruct", "accounts/fireworks/models/mixtral-8x7b-instruct"],
  "perplexity": ["sonar", "sonar-pro", "llama-3.1-sonar-large-128k-online"],
};

// ── 供应商 → 环境变量名映射 ─────────────────────────────────────────
export const PROVIDER_API_KEYS = {
  "openai": "OPENAI_API_KEY",       "deepseek": "DEEPSEEK_API_KEY",
  "anthropic": "ANTHROPIC_API_KEY",  "gemini": "GOOGLE_API_KEY",
  "kimi-coding": "KIMI_API_KEY",    "kimi-coding-cn": "KIMI_CN_API_KEY",
  "zai": "ZAI_API_KEY",             "minimax-cn": "MINIMAX_CN_API_KEY",
  "minimax": "MINIMAX_API_KEY",     "siliconflow": "SILICONFLOW_API_KEY",
  "openrouter": "OPENROUTER_API_KEY","xai": "XAI_API_KEY",
  "mistral": "MISTRAL_API_KEY",     "nvidia": "NVIDIA_API_KEY",
  "huggingface": "HF_TOKEN",        "ollama-cloud": "OLLAMA_API_KEY",
  "ollama-local": "OLLAMA_LOCAL_API_KEY", "lmstudio": "LMSTUDIO_API_KEY", "alibaba": "DASHSCOPE_API_KEY",
  // ── Hermes 内置 api_key 类新增商（主 env 取自 auth.py api_key_env_vars） ──
  "stepfun": "STEPFUN_API_KEY",     "arcee": "ARCEEAI_API_KEY",
  "gmi": "GMI_API_KEY",             "kilocode": "KILOCODE_API_KEY",
  "alibaba-coding-plan": "ALIBABA_CODING_PLAN_API_KEY",
  "xiaomi": "XIAOMI_API_KEY",       "tencent-tokenhub": "TOKENHUB_API_KEY",
  "groq": "GROQ_API_KEY",
  "deepinfra": "DEEPINFRA_API_KEY",
  "together": "TOGETHER_API_KEY",
  "atlas": "ATLASCLOUD_API_KEY",
  "fireworks": "FIREWORKS_API_KEY",
  "perplexity": "PERPLEXITY_API_KEY",
};

// ── A/B 分类（Sam 任务16 决策表）─────────────────────────────────────
// A 类：仅写 model 段，端点与原生协议交给 Hermes 内置 PROVIDER_REGISTRY 处理；
// B 类：必须写 providers 段（base_url + api_key + default_model）。
// 注：动态 id 约定 —— custom-*（第三方自定义商，写 providers 段含 api_key）、
//     local-*（本地 OpenAI 兼容端点，写 providers 段仅 base_url + default_model，省略 api_key），
//     二者均不在此表中，按“非预设”走 providers 段逻辑（详见 monitor.js customEntries）。
export const PROVIDER_CLASSES = {
  "openai": "A",         "openrouter": "A",     "anthropic": "A",
  "deepseek": "A",       "gemini": "A",         "kimi-coding": "A",
  "kimi-coding-cn": "A", "zai": "A",            "minimax": "A",
  "minimax-cn": "A",     "xai": "A",            "nvidia": "A",
  "huggingface": "A",    "lmstudio": "B",       "alibaba": "A",
  "siliconflow": "B",    "mistral": "B",        "ollama-cloud": "B",
  "ollama-local": "B",
  // ── 新增商均为 Hermes 内置（A 类：只写 model 段、base_url 编辑框只读） ──
  "stepfun": "A",        "arcee": "A",          "gmi": "A",
  "kilocode": "A",       "alibaba-coding-plan": "A",  "xiaomi": "A",
  "tencent-tokenhub": "A",
  "groq": "A",        "deepinfra": "A",    "together": "A",
  "atlas": "A",       "fireworks": "A",    "perplexity": "A",
};

// ── provider id → Hermes 内部 provider id 映射 ───────────────────────
// 仅列出与自身 id 不同的项；未列出者默认使用自身 id。
export const PROVIDER_HERMES_IDS = {
  "openai": "openai-api",
};
