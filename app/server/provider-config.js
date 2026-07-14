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
    "grok-4.5", "grok-4.3", "grok-4.1-fast-reasoning", "grok-4.1-fast-non-reasoning",
  ],
  "mistral": [
    "mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest",
  ],
  "nvidia":          ["meta/llama-3.1-70b-instruct", "minimaxai/minimax-m2.7"],
  "huggingface":     ["meta-llama/Meta-Llama-3-70B-Instruct"],
  "ollama-cloud":    ["gpt-oss:120b", "qwen3-coder:480b-cloud", "glm-4.6:cloud"],
  "lmstudio":        ["local-model"],
  "alibaba": [
    "qwen-plus", "qwen-max", "qwen3.5-plus", "qwen3-max-2026-01-23", "qwen3-coder-next",
  ],
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
  "lmstudio": "LM_API_KEY",         "alibaba": "DASHSCOPE_API_KEY",
};
