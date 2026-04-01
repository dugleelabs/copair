import { z } from 'zod';
import type { Tool, ToolResult } from './interface.js';
import type { CopairConfig } from '../config/schema.js';
import { logger } from '../core/logger.js';

export const WebSearchInputSchema = z.object({
  query: z.string().min(1),
}).strict();

interface SearchResult {
  title: string;
  url: string;
  content: string;
}

// Tavily adapter
async function searchTavily(
  query: string,
  apiKey: string,
  maxResults: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, max_results: maxResults }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Tavily error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    results: Array<{ title: string; url: string; content: string }>;
  };
  return data.results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}

// Serper adapter
async function searchSerper(
  query: string,
  apiKey: string,
  maxResults: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': apiKey,
    },
    body: JSON.stringify({ q: query, num: maxResults }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Serper error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    organic: Array<{ title: string; link: string; snippet: string }>;
  };
  return (data.organic ?? []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.link,
    content: r.snippet,
  }));
}

// SearXNG adapter (self-hosted)
async function searchSearxng(
  query: string,
  baseUrl: string,
  maxResults: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const url = new URL('/search', baseUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');

  const response = await fetch(url.toString(), { signal });
  if (!response.ok) {
    if (response.status === 403) {
      throw new Error(
        `SearXNG returned 403 Forbidden. The JSON format is likely disabled on this instance. ` +
        `Enable it in settings.yml under search.formats by adding "json" to the list.`,
      );
    }
    throw new Error(`SearXNG error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    results: Array<{ title: string; url: string; content?: string }>;
  };
  return (data.results ?? []).slice(0, maxResults).map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content ?? '',
  }));
}

export function createWebSearchTool(config: CopairConfig): Tool | null {
  const webSearchConfig = config.web_search;
  if (!webSearchConfig) return null;

  const maxResults = webSearchConfig.max_results;
  const timeoutMs = config.network?.web_search_timeout_ms ?? 15_000;

  return {
    inputSchema: WebSearchInputSchema,
    definition: {
      name: 'web_search',
      description:
        'Search the web for information. Returns titles, URLs, and snippets from search results.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
        },
        required: ['query'],
      },
    },
    requiresPermission: true,
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      const query = String(input['query'] ?? '');
      if (!query) {
        return { content: 'Error: query is required', isError: true };
      }

      logger.info('web_search', `Agent web search via ${webSearchConfig.provider}: "${query}"`);

      try {
        const signal = AbortSignal.timeout(timeoutMs);
        let results: SearchResult[];
        switch (webSearchConfig.provider) {
          case 'tavily':
            results = await searchTavily(query, webSearchConfig.api_key ?? '', maxResults, signal);
            break;
          case 'serper':
            results = await searchSerper(query, webSearchConfig.api_key ?? '', maxResults, signal);
            break;
          case 'searxng':
            results = await searchSearxng(
              query,
              webSearchConfig.base_url ?? 'http://localhost:8080',
              maxResults,
              signal,
            );
            break;
          default:
            return { content: 'Error: unknown search provider', isError: true };
        }

        if (results.length === 0) {
          return { content: 'No results found.' };
        }

        const formatted = results
          .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.content}`)
          .join('\n\n');

        return { content: `Search results for "${query}":\n\n${formatted}` };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: `Search failed: ${message}`, isError: true };
      }
    },
  };
}
