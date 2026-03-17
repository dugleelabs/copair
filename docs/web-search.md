# Web Search

Copair supports web search via external APIs or provider-native search.

## Configuration

```yaml
web_search:
  provider: tavily          # tavily | serper | searxng
  api_key: ${TAVILY_API_KEY}
  max_results: 5
```

## Providers

| Provider | Self-hosted | API Key Required |
|----------|-------------|-----------------|
| [Tavily](https://tavily.com) | No | Yes |
| [Serper](https://serper.dev) | No | Yes |
| [SearXNG](https://searxng.org) | Yes | No |

For SearXNG, set `base_url` to your instance (default: `http://localhost:8080`):

```yaml
web_search:
  provider: searxng
  base_url: http://localhost:8080
  max_results: 10
```

## Model-Native Search

When using Anthropic models, the `web_search` tool is passed through natively using Anthropic's built-in search capability (`web_search_20250305`). No external API key required.
