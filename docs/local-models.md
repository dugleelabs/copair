# Connecting Local Models

This guide covers how to run Copair with local models, including Qwen 3.5, using Ollama, vLLM, or other OpenAI-compatible servers.

## Option 1: Ollama (Recommended)

Ollama is the easiest way to run local models like Qwen 3.5.

### 1. Install Ollama

```bash
curl -fsSL https://ollama.ai/install.sh | sh
```

Or download from [ollama.ai](https://ollama.ai).

### 2. Pull Qwen 3.5

```bash
ollama pull qwen2.5:7b       # 7B parameter model
ollama pull qwen2.5:14b      # 14B parameter model  
ollama pull qwen2.5:32b      # 32B parameter model
ollama pull qwen2.5:72b      # 72B parameter model
ollama pull qwen2.5-coder:7b # Code-specialized version
```

### 3. Configure Copair

Create or update `~/.copair/config.yaml`:

```yaml
version: 1
default_model: qwen-7b

providers:
  ollama:
    type: openai-compatible
    base_url: http://localhost:11434/v1
    models:
      qwen-7b:
        id: qwen2.5:7b
        supports_tool_calling: false
        context_window: 131072
      qwen-14b:
        id: qwen2.5:14b
        supports_tool_calling: false
        context_window: 131072
      qwen-coder:
        id: qwen2.5-coder:7b
        supports_tool_calling: false
        context_window: 131072

permissions:
  mode: auto-approve  # Skip approval prompts for faster iteration
```

### 4. Run Copair

```bash
copair --model qwen-7b
```

## Option 2: vLLM

vLLM offers better performance for serving models, especially with multiple concurrent requests.

### 1. Install vLLM

```bash
pip install vllm
```

### 2. Start vLLM Server

```bash
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-7B-Instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 1
```

For larger models on multi-GPU systems:
```bash
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-72B-Instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 4  # Use 4 GPUs
```

### 3. Configure Copair

```yaml
version: 1
default_model: qwen-vllm

providers:
  vllm:
    type: openai-compatible
    base_url: http://localhost:8000/v1
    models:
      qwen-vllm:
        id: Qwen/Qwen2.5-7B-Instruct
        supports_tool_calling: false
        context_window: 131072

permissions:
  mode: auto-approve
```

## Option 3: LM Studio

LM Studio provides a GUI for managing local models.

### 1. Install LM Studio

Download from [lmstudio.ai](https://lmstudio.ai).

### 2. Download Qwen 3.5

In LM Studio:
1. Go to the "Discover" tab
2. Search for "Qwen2.5"
3. Download your preferred size (7B, 14B, 32B, or 72B)

### 3. Start Local Server

1. Go to "Local Server" tab
2. Load your downloaded Qwen model
3. Start the server (usually on port 1234)

### 4. Configure Copair

```yaml
version: 1
default_model: qwen-lm-studio

providers:
  lm_studio:
    type: openai-compatible
    base_url: http://localhost:1234/v1
    models:
      qwen-lm-studio:
        id: qwen2.5-7b-instruct  # Model name from LM Studio
        supports_tool_calling: false
        context_window: 131072

permissions:
  mode: auto-approve
```

## Model Performance Tips

### Memory Requirements

| Model Size | RAM Required | VRAM Required (GPU) |
|------------|--------------|-------------------|
| 7B         | ~8GB         | ~6GB             |
| 14B        | ~16GB        | ~12GB            |
| 32B        | ~32GB        | ~24GB            |
| 72B        | ~64GB        | ~48GB            |

### GPU Acceleration

For NVIDIA GPUs:
```bash
# Ollama automatically uses GPU if available
ollama run qwen2.5:7b

# vLLM with GPU
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-7B-Instruct \
  --gpu-memory-utilization 0.9
```

For Apple Silicon (M1/M2/M3):
```bash
# Ollama uses Metal Performance Shaders automatically
ollama run qwen2.5:7b
```

### CPU-Only Mode

If you don't have a GPU:

**Ollama:**
```bash
OLLAMA_NUM_GPU=0 ollama serve
```

**vLLM:**
```bash
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen2.5-7B-Instruct \
  --device cpu
```

## System-Role Limitations

Some hosted OpenAI-compatible gateways (notably several Qwen-family distills on `inferx.net` and similar platforms) reject requests containing a `role: "system"` message and return an opaque `400 BAD_REQUEST`. If your gateway exhibits this behavior, set:

```yaml
supports_system_role: false
```

on the affected model. Copair will fold its system prompt (tool-use instructions, project context, behavior rules) into the first user message instead, preserving all instruction content in a shape the gateway accepts.

## Tool Calling Limitations

Local models like Qwen 3.5 typically don't support native tool calling. Copair automatically falls back to prompt-based tool extraction, but this can be less reliable.

To improve tool calling with local models:

1. Use **auto-approve** mode to avoid constant prompts
2. Be more explicit in your requests: "Use the bash tool to run tests"
3. Consider the code-specialized Qwen variants: `qwen2.5-coder:7b`

## Switching Between Models

You can switch models mid-conversation:

```bash
copair --model qwen-7b
> /model qwen-14b    # Switch to 14B model
> /model gpt-4o      # Switch to OpenAI (if configured)
```

Context is automatically summarized when switching between local and API models.

## Troubleshooting

### Connection Refused
```
Error: ECONNREFUSED localhost:11434
```
Make sure your model server is running:
```bash
ollama serve  # For Ollama
# or check vLLM/LM Studio status
```

### Out of Memory
- Try a smaller model (7B instead of 14B)
- Reduce `max_tokens` in config
- Close other applications to free RAM/VRAM

### Slow Performance
- Enable GPU acceleration
- Use quantized models (Q4, Q8 versions)
- Increase `--tensor-parallel-size` for vLLM

### Tool Calling Issues
- Set `supports_tool_calling: false` in config
- Use more explicit language: "Please use the read tool to check the file"
- Consider switching to `auto-approve` mode for smoother interaction