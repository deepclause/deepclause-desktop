import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { tool as aiTool, generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { openai } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';
import { execSync } from 'child_process';

import { setTimeout } from 'node:timers/promises';

import { V86 } from "../../vendor/v86/build/libv86.mjs"; 

import { create9pHandler } from './9p.js';
import { set } from 'zod/v4';
import { truncate } from 'node:fs';

// Import model configuration
import { getAgentModelConfig, resolveProvider } from '../config/models.js';

// Provider map for resolving model providers

const providerMap = {
    google: (m) => {
        const model = (m && typeof m === 'object') ? m.name : m;
        return google(model);
    },
    openai: (m) => {

        console.log(`[DML Bridge] Resolving OpenAI-compatible model with input: ${JSON.stringify(m)}`);

        // Accept either a model string or an object { model, baseURL }
        const model = (m && typeof m === 'object') ? m.name : m;
        const base = process.env.OPENAI_BASE_URL || process.env.OPENAI_BASE || process.env.OPENAI_API_BASE || "";
        if (base) {
            // Ensure common env vars are set so the OpenAI adapter picks them up
            if (!process.env.OPENAI_API_BASE) 
                process.env.OPENAI_API_BASE = base;
            if (!process.env.OPENAI_BASE_URL)
                 process.env.OPENAI_BASE_URL = base;
        }
        console.log(`[DML Bridge] Creating OpenAI-compatible model ${model} with baseURL: ${base}`);
        const provider = createOpenAICompatible({name: "provider", baseURL: base, apiKey: process.env.OPENAI_API_KEY});
        return provider(model)
    },
    anthropic: (m) => {
        const model = (m && typeof m === 'object') ? m.name : m;
        return anthropic(model);
    },
    openrouter: (m) => {
        const model = (m && typeof m === 'object') ? m.name : m;
        return openrouter(model);
    }
};

// Agent model configuration
let agentModelConfig = null;

function getAgentConfig() {
    if (!agentModelConfig) {
        agentModelConfig = getAgentModelConfig();
        console.log(`[Tools] Agent Model: ${agentModelConfig.provider}/${agentModelConfig.name}`);
        console.log(`[Tools] Environment Keys available: ${Object.keys(process.env).filter(k => k.endsWith('_KEY') || k.endsWith('_API')).join(', ')}`);
    }
    return agentModelConfig;
}

// Setup Mermaid validation
// In Electron: Uses Electron's built-in Chromium via mermaidValidator
// In CLI/Node: Falls back to basic syntax validation
let mermaidValidator = null;

// OPTION: Set to false to disable Electron-based validator and use only basic validation
const USE_ELECTRON_VALIDATOR = true; // Changed to false to prevent window interference

// Try to import Electron-based validator if available
try {
    if (USE_ELECTRON_VALIDATOR && typeof process !== 'undefined' && process.versions && process.versions.electron) {
        // Running in Electron - use the validator
        const validatorModule = await import('../electron/main/mermaid-validator.js');
        mermaidValidator = validatorModule.mermaidValidator;
        console.log('✅ Using Electron-based Mermaid validator');
    } else {
        console.log('ℹ️ Electron validator disabled, using basic syntax validation only');
    }
} catch (error) {
    console.log('ℹ️ Electron validator not available, using basic syntax validation');
}

// Access resource resolver from global (set by main process in Electron)
// Use a getter function for lazy access to avoid import-time undefined issues
const getResourceResolver = () => global.resourceResolver;

const MAX_LENGTH_TRUNCATE_CONTENT = 300000;

/**
 * Truncate content if it exceeds max length
 */
function truncateContent(content, maxLength = MAX_LENGTH_TRUNCATE_CONTENT) {

    if (maxLength === 0) {
        return content;
    }

    if (content.length <= maxLength) {
        return content;
    } else {
        return (
            content.substring(0, maxLength / 2) +
            `\n..._This content has been truncated to stay below ${maxLength} characters_...\n` +
            content.substring(content.length - maxLength / 2)
        );
    }
}

/**
 * Encode image to base64
 */
async function encodeImage(imagePath) {
    if (imagePath.startsWith("http")) {
        // Download image first
        const response = await fetch(imagePath, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36 Edg/119.0.0.0'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to download image: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        return Buffer.from(buffer).toString('base64');
    }

    // Read local file
    const buffer = fs.readFileSync(imagePath);
    return buffer.toString('base64');
}

/**
 * Base Tool class
 */
class Tool {
    constructor() {
        this.name = "";
        this.description = "";
        this.inputs = {};
        this.output_type = "string";
        this.progressCallback = null; // Callback for streaming progress messages
    }

    /**
     * Set the progress callback for streaming messages
     */
    setProgressCallback(callback) {
        this.progressCallback = callback;
    }

    /**
     * Stream a progress message to the callback if set
     */
    streamProgress(message) {
        if (this.progressCallback && typeof this.progressCallback === 'function') {
            this.progressCallback(message);
        }
    }

    async forward(...args) {
        throw new Error("forward method must be implemented by subclass");
    }

    // Adapter used by the Vercel AI SDK wrapper
    async execute(args = {}) {
        const keys = Object.keys(this.inputs || {});
        const ordered = keys.map(k => {
            const spec = this.inputs[k] || {};
            let v = args[k];
            if (v === undefined) {
                if (Object.prototype.hasOwnProperty.call(spec, 'default')) {
                    v = spec.default;
                } else if (spec.nullable) {
                    v = null;
                }
            }
            return v;
        });
        return await this.forward(...ordered);
    }
}

/**
 * Google Search Tool
 */
class GoogleSearchTool extends Tool {
    constructor() {
        super();
        this.name = "web_search";
        this.description = `Performs a google web search using SERPER for your query then returns a JSON string of the top search results.

Output JSON Schema:
{
  "results": [
    {
      "index": number,
      "title": string,
      "url": string,
      "date": string (optional),
      "source": string (optional),
      "snippet": string
    }
  ]
}`;
        this.inputs = {
            query: { type: "string", description: "The search query to perform." },
            filter_year: {
                type: "integer",
                description: "Optionally restrict results to a certain year",
                nullable: true,
            },
            num: {
                type: "integer",
                description: "Number of results to return",
                default: 50,
                nullable: true,
            },
        };
        this.output_type = "string";
    }

    async forward(query, filterYear = null, num = 50) {
        const apiKey = process.env.SERPER_API_KEY;
        if (!apiKey) {
            console.error("[GoogleSearchTool] SERPER_API_KEY is missing.");
            throw new Error("Missing API key. Make sure you have 'SERPER_API_KEY' in your env variables.");
        }

        const params = new URLSearchParams({
            q: query,
            api_key: apiKey,
            num: num.toString(),
        });

        const baseUrl = "https://google.serper.dev/search";
        if (filterYear !== null) {
            params.set("tbs", `cdr:1,cd_min:01/01/${filterYear},cd_max:12/31/${filterYear}`);
        }

        try {
            const response = await fetch(`${baseUrl}?${params}`);
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(JSON.stringify(errorData));
            }

            const results = await response.json();
            const organicKey = "organic";
            
            if (!(organicKey in results)) {
                if (filterYear !== null) {
                    throw new Error(
                        `No results found for query: '${query}' with filtering on year=${filterYear}. Use a less restrictive query or do not filter on year.`
                    );
                } else {
                    throw new Error(`No results found for query: '${query}'. Use a less restrictive query.`);
                }
            }

            if (results[organicKey].length === 0) {
                const yearFilterMessage = filterYear !== null ? ` with filter year=${filterYear}` : "";
                return JSON.stringify({
                    results: [],
                    message: `No results found for '${query}'${yearFilterMessage}. Try with a more general query, or remove the year filter.`
                }, null, 2);
            }

            const jsonResults = [];
            if (organicKey in results) {
                results[organicKey].forEach((page, idx) => {
                    const resultObj = {
                        index: idx,
                        title: page.title,
                        url: page.link,
                        snippet: page.snippet || ""
                    };
                    
                    if ("date" in page) {
                        resultObj.date = page.date;
                    }
                    
                    if ("source" in page) {
                        resultObj.source = page.source;
                    }
                    
                    jsonResults.push(resultObj);
                });
            }

            return JSON.stringify({ results: jsonResults }, null, 2);
        } catch (error) {
            throw new Error(`Search failed: ${error.message}`);
        }
    }
}




/**
 * Google Scholar Search Tool
 */
class GoogleScholarSearchTool extends Tool {
    constructor() {
        super();
        this.name = "google_scholar_search";
        this.description = `Performs a google scholar search for your query then returns a JSON string of the top search results.

Output JSON Schema:
{
  "results": [
    {
      "index": number,
      "title": string,
      "url": string,
      "year": string (optional),
      "cited_by": number (optional),
      "publication_info": string (optional),
      "pdf_url": string (optional),
      "source": string (optional),
      "snippet": string
    }
  ]
}`;
        this.inputs = {
            query: { type: "string", description: "The search query to perform." },
            num: {
                type: "integer",
                description: "Number of results to return",
                default: 10,
                nullable: true,
            },
        };
        this.output_type = "string";
    }

    async forward(query, num = 10) {
        this.streamProgress(`📚 Searching Google Scholar for: ${query}...`);
        
        const apiKey = process.env.SERPER_API_KEY;
        if (!apiKey) {
            throw new Error("Missing API key. Make sure you have 'SERPER_API_KEY' in your env variables.");
        }

        const params = new URLSearchParams({
            q: query,
            api_key: apiKey,
            num: num.toString(),
        });

        const baseUrl = "https://google.serper.dev/scholar";

        try {
            const response = await fetch(`${baseUrl}?${params}`);
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(JSON.stringify(errorData));
            }

            const results = await response.json();
            const organicKey = "organic";
            
            if (!(organicKey in results)) {
                throw new Error(`No results found for query: '${query}'. Use a less restrictive query.`);
            }

            if (results[organicKey].length === 0) {
                return JSON.stringify({
                    results: [],
                    message: `No results found for '${query}'. Try with a more general query.`
                }, null, 2);
            }

            this.streamProgress(`📊 Processing ${results[organicKey].length} scholarly results...`);

            const jsonResults = [];
            if (organicKey in results) {
                results[organicKey].forEach((page, idx) => {
                    const resultObj = {
                        index: idx,
                        title: page.title,
                        url: page.link,
                        snippet: page.snippet || ""
                    };
                    
                    if ("year" in page) {
                        resultObj.year = page.year.toString();
                    }
                    
                    if ("cited_by" in page) {
                        resultObj.cited_by = page.cited_by;
                    }
                    
                    if ("publicationInfo" in page) {
                        resultObj.publication_info = page.publicationInfo.toString();
                    }
                    
                    if ("pdfUrl" in page) {
                        resultObj.pdf_url = page.pdfUrl.toString();
                    }
                    
                    if ("source" in page) {
                        resultObj.source = page.source;
                    }
                    
                    jsonResults.push(resultObj);
                });
            }

            this.streamProgress(`✅ Formatted ${jsonResults.length} scholarly articles.`);
            return JSON.stringify({ results: jsonResults }, null, 2);
        } catch (error) {
            throw new Error(`Scholar search failed: ${error.message}`);
        }
    }
}

/**
 * Brave Search Tool
 */
class BraveSearchTool extends Tool {
    constructor() {
        super();
        this.name = "brave_search";
        this.description = `Performs a web search using the Brave Search API. Supports web search, news, images, videos, and AI-powered summarization. Returns JSON-formatted search results.

Output JSON Schema (web/news):
{
  "search_type": "web" | "news",
  "results": [
    {
      "index": number,
      "title": string,
      "url": string,
      "description": string,
      "published": string (optional),
      "source": string (optional)
    }
  ]
}

Output JSON Schema (images):
{
  "search_type": "images",
  "results": [
    {
      "index": number,
      "title": string,
      "url": string,
      "thumbnail": string,
      "source": string,
      "dimensions": string (optional)
    }
  ]
}

Output JSON Schema (videos):
{
  "search_type": "videos",
  "results": [
    {
      "index": number,
      "title": string,
      "url": string,
      "thumbnail": string,
      "published": string (optional),
      "duration": string (optional),
      "source": string
    }
  ]
}

Output JSON Schema (summarizer):
{
  "search_type": "summarizer",
  "summary": string,
  "entities": [
    {
      "name": string,
      "description": string
    }
  ]
}`;
        this.inputs = {
            query: { type: "string", description: "The search query to perform." },
            search_type: {
                type: "string",
                description: "Type of search: 'web', 'news', 'images', 'videos', or 'summarizer' (AI summary)",
                default: "web",
                nullable: true,
            },
            count: {
                type: "integer",
                description: "Number of results to return (web/news: max 20, images/videos: max 150)",
                default: 10,
                nullable: true,
            },
            country: {
                type: "string",
                description: "Country code for search results (e.g., 'us', 'uk', 'de')",
                default: "us",
                nullable: true,
            },
            safesearch: {
                type: "string",
                description: "Safe search level: 'off', 'moderate', or 'strict'",
                default: "moderate",
                nullable: true,
            },
            freshness: {
                type: "string",
                description: "Time filter: 'pd' (past day), 'pw' (past week), 'pm' (past month), 'py' (past year), or 'YYYY-MM-DDtoYYYY-MM-DD'",
                nullable: true,
            },
        };
        this.output_type = "string";
        this.headers = {
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate, br",
        };
        this.version = "v1";
        this.base = "https://api.search.brave.com/res";
    }

    async sleep(ms) {
        return new Promise(resolve => globalThis.setTimeout(resolve, ms));
    }

    async forward(query, searchType = "web", count = 10, country = "us", safesearch = "moderate", freshness = null) {
        const apiKey = process.env.BRAVE_KEY || process.env.BRAVE_API_KEY;
        if (!apiKey) {
            throw new Error("Missing API key. Make sure you have 'BRAVE_KEY' or 'BRAVE_API_KEY' in your env variables.");
        }

        const headers = {
            ...this.headers,
            "X-Subscription-Token": apiKey,
        };

        try {
            let results;
            
            switch (searchType.toLowerCase()) {
                case "web":
                    this.streamProgress(`🔍 Searching Brave for: ${query}...`);
                    results = await this.searchWeb(query, { count, country, safesearch, freshness }, headers);
                    return this.formatWebResults(results);
                    
                case "news":
                    this.streamProgress(`📰 Searching Brave News for: ${query}...`);
                    results = await this.searchNews(query, { count, country, safesearch, freshness }, headers);
                    return this.formatNewsResults(results);
                    
                case "images":
                    this.streamProgress(`🖼️ Searching Brave Images for: ${query}...`);
                    results = await this.searchImages(query, { count, country, safesearch }, headers);
                    return this.formatImageResults(results);
                    
                case "videos":
                    this.streamProgress(`🎥 Searching Brave Videos for: ${query}...`);
                    results = await this.searchVideos(query, { count, country, safesearch }, headers);
                    return this.formatVideoResults(results);
                    
                case "summarizer":
                    this.streamProgress(`🤖 Getting AI summary from Brave for: ${query}...`);
                    results = await this.getSummarizer(query, { count, country, safesearch, freshness }, headers);
                    return this.formatSummarizerResults(results);
                    
                default:
                    throw new Error(`Invalid search_type: ${searchType}. Must be 'web', 'news', 'images', 'videos', or 'summarizer'.`);
            }
        } catch (error) {
            throw new Error(`Brave search failed: ${error.message}`);
        }
    }

    async searchWeb(query, params, headers) {
        const path = "/web/search";
        //truncate query to at most 50 characters
        const truncatedQuery = query.length > 50 ? query.substring(0, 50) + "..." : query;
        console.log(`[Brave Search] Query: ${truncatedQuery}`);
        const searchParams = new URLSearchParams({
            q: truncatedQuery,
            count: String(params.count || 10),
            country: params.country || "us",
            search_lang: "en",
            safesearch: params.safesearch || "moderate",
        });

        if (params.freshness) {
            searchParams.set("freshness", params.freshness);
        }

        const endpoint = `${this.base}/${this.version}${path}?${searchParams}`;
        const response = await fetch(endpoint, { headers });

        

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${response.statusText}. Details: ${errorText}`);
        }

        return await response.json();
    }

    async searchNews(query, params, headers) {
        const path = "/news/search";
        const searchParams = new URLSearchParams({
            q: query,
            count: params.count.toString(),
            country: params.country,
            search_lang: "en",
            safesearch: params.safesearch,
        });

        if (params.freshness) {
            searchParams.set("freshness", params.freshness);
        }

        const endpoint = `${this.base}/${this.version}${path}?${searchParams}`;
        const response = await fetch(endpoint, { headers });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    }

    async searchImages(query, params, headers) {
        const path = "/images/search";
        const searchParams = new URLSearchParams({
            q: query,
            count: params.count.toString(),
            country: params.country,
            search_lang: "en",
            safesearch: params.safesearch,
        });

        const endpoint = `${this.base}/${this.version}${path}?${searchParams}`;
        const response = await fetch(endpoint, { headers });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    }

    async searchVideos(query, params, headers) {
        const path = "/videos/search";
        const searchParams = new URLSearchParams({
            q: query,
            count: params.count.toString(),
            country: params.country,
            search_lang: "en",
            safesearch: params.safesearch,
        });

        const endpoint = `${this.base}/${this.version}${path}?${searchParams}`;
        const response = await fetch(endpoint, { headers });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return await response.json();
    }

    async getSummarizer(query, params, headers) {
        // First perform a web search with summary=true
        const searchParams = new URLSearchParams({
            q: query,
            count: params.count.toString(),
            country: params.country,
            search_lang: "en",
            safesearch: params.safesearch,
            summary: "true",
        });

        if (params.freshness) {
            searchParams.set("freshness", params.freshness);
        }

        const searchEndpoint = `${this.base}/${this.version}/web/search?${searchParams}`;
        const searchResponse = await fetch(searchEndpoint, { headers });

        if (!searchResponse.ok) {
            throw new Error(`HTTP ${searchResponse.status}: ${searchResponse.statusText}`);
        }

        const searchResults = await searchResponse.json();

        if (!searchResults.summarizer || !searchResults.summarizer.key) {
            throw new Error("No summarizer key found in search results");
        }

        // Poll the summarizer endpoint
        const path = "/summarizer/search";
        const summaryParams = new URLSearchParams({
            key: searchResults.summarizer.key,
            entity_info: "1",
        });

        const summaryEndpoint = `${this.base}/${this.version}${path}?${summaryParams}`;
        
        this.streamProgress(`⏳ Waiting for AI summary to generate...`);
        
        let summaryResults = null;
        let attempts = 0;
        const maxAttempts = 40; // 40 attempts * 50ms = 2 seconds max

        while (!summaryResults && attempts < maxAttempts) {
            await this.sleep(50);
            const summaryResponse = await fetch(summaryEndpoint, { headers });
            
            if (summaryResponse.ok) {
                summaryResults = await summaryResponse.json();
            }
            attempts++;
        }

        if (!summaryResults) {
            throw new Error("Summarizer timed out after polling");
        }

        return summaryResults;
    }

    formatWebResults(results) {
        if (!results.web || !results.web.results || results.web.results.length === 0) {
            return JSON.stringify({
                search_type: "web",
                results: [],
                message: "No web results found."
            }, null, 2);
        }

        this.streamProgress(`✅ Processing ${results.web.results.length} web results...`);

        const jsonResults = results.web.results.map((page, idx) => {
            const resultObj = {
                index: idx,
                title: page.title || "Untitled",
                url: page.url || "",
                description: page.description || ""
            };
            
            if (page.age) {
                resultObj.published = page.age;
            }
            
            return resultObj;
        });

        return JSON.stringify({ search_type: "web", results: jsonResults }, null, 2);
    }

    formatNewsResults(results) {
        if (!results.results || results.results.length === 0) {
            return JSON.stringify({
                search_type: "news",
                results: [],
                message: "No news results found."
            }, null, 2);
        }

        this.streamProgress(`✅ Processing ${results.results.length} news results...`);

        const jsonResults = results.results.map((article, idx) => {
            const resultObj = {
                index: idx,
                title: article.title || "Untitled",
                url: article.url || "",
                description: article.description || ""
            };
            
            if (article.age) {
                resultObj.published = article.age;
            }
            
            if (article.source) {
                resultObj.source = article.source.name;
            }
            
            return resultObj;
        });

        return JSON.stringify({ search_type: "news", results: jsonResults }, null, 2);
    }

    formatImageResults(results) {
        if (!results.results || results.results.length === 0) {
            return JSON.stringify({
                search_type: "images",
                results: [],
                message: "No image results found."
            }, null, 2);
        }

        this.streamProgress(`✅ Processing ${results.results.length} image results...`);

        const jsonResults = results.results.map((image, idx) => {
            const resultObj = {
                index: idx,
                title: image.title || "Untitled",
                url: image.url || "",
                thumbnail: image.thumbnail?.src || "",
                source: image.source || ""
            };
            
            if (image.properties) {
                resultObj.dimensions = `${image.properties.width}x${image.properties.height}`;
            }
            
            return resultObj;
        });

        return JSON.stringify({ search_type: "images", results: jsonResults }, null, 2);
    }

    formatVideoResults(results) {
        if (!results.results || results.results.length === 0) {
            return JSON.stringify({
                search_type: "videos",
                results: [],
                message: "No video results found."
            }, null, 2);
        }

        this.streamProgress(`✅ Processing ${results.results.length} video results...`);

        const jsonResults = results.results.map((video, idx) => {
            const resultObj = {
                index: idx,
                title: video.title || "Untitled",
                url: video.url || "",
                thumbnail: video.thumbnail?.src || "",
                source: video.meta_url?.hostname || ""
            };
            
            if (video.age) {
                resultObj.published = video.age;
            }
            
            if (video.meta_url?.duration) {
                resultObj.duration = video.meta_url.duration;
            }
            
            return resultObj;
        });

        return JSON.stringify({ search_type: "videos", results: jsonResults }, null, 2);
    }

    formatSummarizerResults(results) {
        if (!results) {
            return JSON.stringify({
                search_type: "summarizer",
                summary: "",
                entities: [],
                message: "No summary available."
            }, null, 2);
        }

        this.streamProgress(`✅ Summary generated successfully.`);

        const output = {
            search_type: "summarizer",
            summary: "",
            entities: []
        };
        
        if (results.summary && results.summary.length > 0) {
            output.summary = results.summary[0];
        }

        if (results.enrichments && results.enrichments.entities) {
            output.entities = results.enrichments.entities.map(entity => ({
                name: entity.name,
                description: entity.description || 'No description'
            }));
        }

        return JSON.stringify(output, null, 2);
    }
}



/**
 * You.com Search Tool
 */
export class YouComSearchTool extends Tool {
    constructor() {
        super();
        this.name = "web_search";
        this.description = `Performs a web search using the You.com (ydc-index) API and returns a JSON string of top results.

Output JSON Schema:
{
  "results": [
    {
      "index": number,
      "title": string,
      "url": string,
      "date": string (optional),
      "description": string (optional),
      "snippets": [string] (optional)
    }
  ]
}`;
        this.inputs = {
            query: { type: "string", description: "The search query to perform." },
            filter_year: {
                type: "integer",
                description: "Optionally restrict results to a certain publication year (performed locally on page_age if available).",
                nullable: true,
            },
            num: {
                type: "integer",
                description: "Number of results to return (after optional filtering).",
                default: 50,
                nullable: true,
            },
        };
        this.output_type = "string";
    }

    async forward(query, filterYear = null, num = 50) {
        this.streamProgress(`🔍 Searching for: ${query}...`);
        
        const apiKey =
            process.env.YOU_COM_API_KEY ||
            process.env.YOUCOM_API_KEY ||
            process.env.YDC_API_KEY;
        if (!apiKey) {
            throw new Error("Missing API key. Set YOU_COM_API_KEY (or YOUCOM_API_KEY / YDC_API_KEY).");
        }

        const endpoint = "https://api.ydc-index.io/v1/search";
        const requestUrl = `${endpoint}?query=${encodeURIComponent(query)}&count=${num || 10}`;

        let data;
        try {
            const resp = await fetch(requestUrl, {
                method: 'GET',
                headers: { 'X-API-Key': apiKey }
            });
            if (!resp.ok) {
                let errText;
                try { errText = await resp.text(); } catch { errText = resp.statusText; }
                throw new Error(`HTTP ${resp.status} ${resp.statusText}: ${errText}`);
            }
            data = await resp.json();
            this.streamProgress(`📊 Processing ${data?.results?.web?.length || 0} search results...`);
        } catch (e) {
            throw new Error(`Search failed: ${e.message}`);
        }

        const webResults = (data?.results?.web || []);
        if (!webResults.length) {
            return JSON.stringify({
                results: [],
                message: `No results found for '${query}'.`
            }, null, 2);
        }

        // Optional year filter (local)
        let filtered = webResults;
        if (filterYear !== null) {
            this.streamProgress(`📅 Filtering results for year ${filterYear}...`);
            filtered = webResults.filter(r => {
                if (!r.page_age) return false;
                const yr = new Date(r.page_age).getUTCFullYear();
                return yr === filterYear;
            });
            if (!filtered.length) {
                return JSON.stringify({
                    results: [],
                    message: `No results found for '${query}' with filter year=${filterYear}.`
                }, null, 2);
            }
        }

        const limited = filtered.slice(0, Math.max(1, num || 50));
        this.streamProgress(`✅ Formatted ${limited.length} results.`);

        const jsonResults = limited.map((r, idx) => {
            const resultObj = {
                index: idx,
                title: r.title || r.url || "Untitled",
                url: r.url || ""
            };
            
            if (r.page_age) {
                resultObj.date = r.page_age;
            }
            
            if (r.description) {
                resultObj.description = r.description;
            }
            
            if (Array.isArray(r.snippets) && r.snippets.length) {
                resultObj.snippets = r.snippets.slice(0, 3);
            }
            
            return resultObj;
        });

        return JSON.stringify({ results: jsonResults }, null, 2);
    }
}

/**
 * Visit Webpage Tool
 */
class VisitWebpageTool extends Tool {
    constructor(maxOutputLength = MAX_LENGTH_TRUNCATE_CONTENT) {
        super();
        this.name = "visit_webpage";
        this.description = "Visits a webpage at the given url and reads its content as a markdown string. Use this to browse webpages.";
        this.inputs = {
            url: {
                type: "string",
                description: "The url of the webpage to visit.",
            },
            truncate_length: {
                type: "integer",
                description: "Maximum length of the output content. Defaults to " + MAX_LENGTH_TRUNCATE_CONTENT + "set to zero if you don't want any truncation.",
                default: maxOutputLength,
                nullable: true,
            }
        };
        this.output_type = "string";
        this.maxOutputLength = maxOutputLength;
    }

    async forward(url, truncate_length = null) {
        this.streamProgress(`🌐 Visiting webpage: ${url}...`);
        
        // Use the provided truncate_length parameter, or fall back to maxOutputLength
        const maxLength = truncate_length !== null ? truncate_length : this.maxOutputLength;
        
        try {
            const serpUrl = "https://scrape.serper.dev";
            const apiKey = process.env.SERPER_API_KEY;
            
            if (!apiKey) {
                throw new Error("Missing API key. Make sure you have 'SERPER_API_KEY' in your env variables.");
            }

            const payload = {
                url: url,
                includeMarkdown: true,
                num: 25
            };

            this.streamProgress(`📄 Scraping page content...`);
            
            const response = await fetch(serpUrl, {
                method: 'POST',
                headers: {
                    'X-API-KEY': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const res = await response.json();
            const title = res.metadata?.title || "No title found";

            this.streamProgress(`✅ Page content retrieved.`);
            return `URL: ${url}\nTitle: ${title}\nText: ${truncateContent(res.markdown, maxLength)}`;
        } catch (error) {

            // try to download the raw HTML as a fallback
            try {
                const fallbackResponse = await fetch(url);
                if (fallbackResponse.ok) {
                    const htmlContent = await fallbackResponse.text();
                    this.streamProgress(`✅ Fallback content retrieved.`);

                    return `${truncateContent(htmlContent, maxLength)}`;
                }
            } catch (fallbackError) {
                console.error("Fallback failed:", fallbackError);
            }

            return "Error reading URL.";
        }
    }
}

/**
 * Workspace Reader Tool
 */
class WorkspaceReaderTool extends Tool {
    constructor(sessionId = null) {
        super();
        this.name = "workspace_reader";
        this.description = "Reads a file from the given file_name in the workspace and converts it to markdown. Use this to easily read files in the workspace. This works only for HTML, PDF, XLS, PPTX and might truncate the output if its too long.";
        this.inputs = {
            file_name: {
                type: "string",
                description: "Relative path to file in the workspace",
            }
        };
        this.output_type = "string";
        this.sessionId = sessionId;
    }

    async forward(fileName) {
        this.streamProgress(`📖 Reading file: ${fileName}...`);
        
        const maxOutputLength = MAX_LENGTH_TRUNCATE_CONTENT;
        
        // Use session_id if provided, otherwise try to get from environment
        let userWorkspace = process.env.USER_WORKSPACES;
        let sessionWorkspace;
        
        if (!userWorkspace) {
            userWorkspace = process.env.DML_CLI_WORKSPACE || "./workspace";
            sessionWorkspace = userWorkspace;
            
            // Create directory if it doesn't exist
            if (!fs.existsSync(sessionWorkspace)) {
                fs.mkdirSync(sessionWorkspace, { recursive: true });
            }
        } else {
            const session = this.sessionId || process.env.PLOGCHAIN_SESSION_ID;
            sessionWorkspace = path.join(userWorkspace, session);
            
            // Create directory if it doesn't exist
            if (!fs.existsSync(sessionWorkspace)) {
                fs.mkdirSync(sessionWorkspace, { recursive: true });
            }
        }

        const filePath = path.join(sessionWorkspace, fileName);

        try {
            let content;
            
            // For non-markdown files, we'd need a conversion library
            // For now, we'll just read as text
            if (!fileName.endsWith(".md")) {
                
                try {
                    this.streamProgress(`🔄 Converting ${fileName} to markdown...`);
                    const cmd = `uvx --with "markitdown[all]" markitdown "${filePath}"`;
                    content = execSync(cmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }); // 10MB buffer
                    this.streamProgress(`✅ File converted successfully.`);
                } catch (error) {
                    throw new Error(`Error converting file to markdown: ${error.message}`);
                }

                return `Title: ${fileName}\nText: ${truncateContent(content, maxOutputLength)}`;

            } else {

                content = fs.readFileSync(filePath, 'utf-8');
                this.streamProgress(`✅ File read successfully.`);
                return `Title: ${fileName}\nText: ${truncateContent(content, maxOutputLength)}`;

            }

        } catch (error) {
            throw new Error(`Error reading file: ${error.message}`);
        }
    }
}

/**
 * File Downloader Tool
 */
class FileDownloaderTool extends Tool {
    constructor(sessionId = null) {
        super();
        this.name = "file_downloader";
        this.description = "Downloads a file from the given URL and saves it in the user's workspace with the specified file name. If the file already exists, appends a random string to the name. Returns the adjusted file_name.";
        this.inputs = {
            url: {
                type: "string",
                description: "The URL of the file to download.",
            },
            file_name: {
                type: "string",
                description: "The name to save the file as in the workspace.",
            }
        };
        this.output_type = "string";
        this.sessionId = sessionId;
    }

    async forward(url, fileName) {
        this.streamProgress(`📥 Starting download from ${url}...`);
        
        let userWorkspace = process.env.USER_WORKSPACES;
        let sessionWorkspace;
        
        if (!userWorkspace) {
            userWorkspace = process.env.DML_CLI_WORKSPACE || "./workspace";
            sessionWorkspace = userWorkspace;
            
            if (!fs.existsSync(sessionWorkspace)) {
                fs.mkdirSync(sessionWorkspace, { recursive: true });
            }
        } else {
            const session = this.sessionId || process.env.PLOGCHAIN_SESSION_ID;
            sessionWorkspace = path.join(userWorkspace, session);
            
            if (!fs.existsSync(sessionWorkspace)) {
                fs.mkdirSync(sessionWorkspace, { recursive: true });
            }
        }

        const ext = path.extname(fileName);
        const baseName = path.basename(fileName, ext);
        let adjustedFileName = fileName;
        let filePath = path.join(sessionWorkspace, adjustedFileName);

        // Ensure the file does not overwrite an existing one
        while (fs.existsSync(filePath)) {
            const randomSuffix = crypto.randomBytes(4).toString('hex');
            adjustedFileName = `${baseName}_${randomSuffix}${ext}`;
            filePath = path.join(sessionWorkspace, adjustedFileName);
        }

        try {
            const response = await fetch(url);
            
            if (response.ok) {
                this.streamProgress(`💾 Saving file as ${adjustedFileName}...`);
                const buffer = await response.arrayBuffer();
                fs.writeFileSync(filePath, Buffer.from(buffer));
                this.streamProgress(`✅ File downloaded successfully.`);
                return adjustedFileName;
            } else {
                this.streamProgress(`⚠️ Direct download failed, trying to scrape page...`);
                
                // Fall back to scraping
                const serpUrl = "https://scrape.serper.dev";
                const apiKey = process.env.SERPER_API_KEY;
                
                if (!apiKey) {
                    throw new Error("Missing API key. Make sure you have 'SERPER_API_KEY' in your env variables.");
                }

                const payload = {
                    url: url,
                    includeMarkdown: true
                };

                const scrapeResponse = await fetch(serpUrl, {
                    method: 'POST',
                    headers: {
                        'X-API-KEY': apiKey,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                if (!scrapeResponse.ok) {
                    throw new Error(`Scraping failed: ${scrapeResponse.statusText}`);
                }

                this.streamProgress(`📄 Scraping page content...`);
                const res = await scrapeResponse.json();
                const title = res.metadata?.title || "No title found";

                const content = `The file could not be downloaded directly, but these contents could be scraped:\n\nURL: ${url}\nTitle: ${title}\nText: ${res.text}`;

                fs.writeFileSync(filePath, content, 'utf-8');
                this.streamProgress(`✅ Content saved from scrape.`);
                return adjustedFileName;
            }
        } catch (error) {
            throw new Error(`Download failed: ${error.message}`);
        }
    }
}

/**
 * Diagram Generator Tool - Creates diagrams from structured data or descriptions
 */
class DiagramGeneratorTool extends Tool {
    constructor(sessionId = null) {
        super();
        this.name = "diagram_generator";
        this.description = "Creates diagrams from structured data, files, or natural language descriptions. Supports flowcharts, sequence diagrams, class diagrams, state diagrams, Gantt charts, pie charts, bar charts (horizontal bars using gantt), entity-relationship diagrams, and network graphs using Mermaid.js syntax. Can read data from workspace files (CSV, JSON) to generate data-driven visualizations. Can export as markdown, SVG, or PNG. Returns markdown-compatible diagram code.";
        this.inputs = {
            diagram_type: {
                type: "string",
                description: "Type of diagram: 'flowchart', 'sequence', 'class', 'state', 'gantt', 'pie', 'bar' (horizontal bars), 'line', 'er' (entity-relationship), or 'graph'",
            },
            data_source: {
                type: "string",
                description: "Either: (1) a natural language description, (2) a relative file path to CSV/JSON data in workspace, or (3) inline Mermaid syntax",
            },
            title: {
                type: "string",
                description: "Optional title for the diagram",
                nullable: true,
                default: null,
            },
            save_to_file: {
                type: "string",
                description: "Optional filename to save the diagram (e.g., 'my_diagram.md', 'chart.svg', 'graph.png'). Extension determines format: .md (markdown), .svg (vector image), .png (raster image). If not provided, only returns the diagram code.",
                nullable: true,
                default: null,
            }
        };
        this.output_type = "string";
        this.sessionId = sessionId;
    }

    async forward(diagramType, dataSource, title = null, saveToFile = null) {
        this.streamProgress(`📊 Creating ${diagramType} diagram...`);
        
        const sessionWorkspace = this.getSessionWorkspace();
        
        try {
            // Determine if data_source is a file path
            let mermaidCode;
            if (this.isFilePath(dataSource)) {

                try {
                    this.streamProgress(`📂 Reading data from file: ${dataSource}`);
                    mermaidCode = await this.createDiagramFromFile(sessionWorkspace, dataSource, diagramType);
                } catch (error) {
                    console.error(`Probably not a file path or failed to read file: ${error.message}. Assuming description is passed.`);
                    mermaidCode = await this.ensureMermaidSyntax(diagramType, dataSource);
                }
            } else {
                // Either Mermaid syntax or natural language description
                mermaidCode = await this.ensureMermaidSyntax(diagramType, dataSource);
            }
            
            // Create markdown with diagram
            const titleStr = title ? `# ${title}\n\n` : '';
            const content = `${titleStr}\`\`\`mermaid\n${mermaidCode}\n\`\`\`\n`;
            
            // Save to file if requested
            if (saveToFile) {
                const ext = path.extname(saveToFile).toLowerCase();
                
                if (ext === '.svg' || ext === '.png') {
                    // Export as image
                    await this.exportDiagramAsImage(mermaidCode, saveToFile, sessionWorkspace, ext);
                } else {
                    // Export as markdown
                    const fileName = saveToFile.endsWith('.md') ? saveToFile : `${saveToFile}.md`;
                    const filePath = path.join(sessionWorkspace, fileName);
                    fs.writeFileSync(filePath, content, 'utf-8');
                    this.streamProgress(`✅ Diagram saved as ${fileName}`);
                }
            }
            
            this.streamProgress(`✅ Diagram created successfully`);
            return content;
            
        } catch (error) {
            throw new Error(`Failed to create diagram: ${error.message}`);
        }
    }

    getSessionWorkspace() {
        let userWorkspace = process.env.USER_WORKSPACES;
        let sessionWorkspace;
        
        if (!userWorkspace) {
            userWorkspace = process.env.DML_CLI_WORKSPACE || "./workspace";
            sessionWorkspace = userWorkspace;
            if (!fs.existsSync(sessionWorkspace)) {
                fs.mkdirSync(sessionWorkspace, { recursive: true });
            }
        } else {
            const session = this.sessionId || process.env.PLOGCHAIN_SESSION_ID;
            sessionWorkspace = path.join(userWorkspace, session);
            if (!fs.existsSync(sessionWorkspace)) {
                fs.mkdirSync(sessionWorkspace, { recursive: true });
            }
        }
        return sessionWorkspace;
    }

    isFilePath(str) {
        // Check if string looks like a file path
        const fileExtensions = ['.csv', '.json', '.txt', '.tsv', '.xlsx', '.xls'];
        return fileExtensions.some(ext => str.toLowerCase().endsWith(ext)) || str.includes('/') || str.includes('\\');
    }

    async createDiagramFromFile(workspacePath, filePath, diagramType) {
        const fullPath = path.join(workspacePath, filePath);
        
        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        
        const fileExt = path.extname(filePath).toLowerCase();
        let data;
        
        // Parse file based on extension
        if (fileExt === '.json') {
            const content = fs.readFileSync(fullPath, 'utf-8');
            data = JSON.parse(content);
        } else if (fileExt === '.csv' || fileExt === '.tsv') {
            const content = fs.readFileSync(fullPath, 'utf-8');
            data = this.parseCSV(content, fileExt === '.tsv' ? '\t' : ',');
        } else {
            throw new Error(`Unsupported file format: ${fileExt}. Supported: .json, .csv, .tsv`);
        }
        
        // Convert data to Mermaid syntax based on diagram type
        return await this.dataToMermaid(data, diagramType);
    }

    parseCSV(content, delimiter = ',') {
        const lines = content.trim().split('\n');
        const headers = lines[0].split(delimiter).map(h => h.trim());
        const rows = [];
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(delimiter).map(v => v.trim());
            const row = {};
            headers.forEach((header, idx) => {
                row[header] = values[idx];
            });
            rows.push(row);
        }
        
        return { headers, rows };
    }

    async dataToMermaid(data, diagramType) {
        this.streamProgress(`🔄 Converting data to ${diagramType} format...`);
        
        const config = getAgentConfig();
        
        const dataStr = JSON.stringify(data, null, 2);
        
        // Special handling for bar charts - use gantt for more reliable rendering
        let actualType = diagramType;
        let additionalInstructions = '';
        
        if (diagramType === 'bar' || diagramType === 'line') {
            // Use gantt chart for bar-like visualizations (more stable than xychart-beta)
            actualType = 'gantt';
            additionalInstructions = `
IMPORTANT: For bar/line charts with numeric data, use gantt chart as horizontal bars.

Example gantt bar chart:
gantt
    title Sales Performance
    dateFormat X
    axisFormat %s
    
    section Products
    Widget A : 0, 150
    Widget B : 0, 200
    Widget C : 0, 175

Key rules for gantt bar charts:
- Use "dateFormat X" for numeric data (not dates)
- Use "axisFormat %s" to show numbers on axis
- Each bar: "Label : start, value" where start is usually 0
- Group bars using "section" labels
- Values are shown as bar lengths

DO NOT use xychart-beta as it's not stable in all Mermaid versions.`;
        }
        
        const prompt = `Your primary function is to transform ANY textual diagram idea, natural language description, malformed/incomplete Mermaid code, or embedded Mermaid blocks within Markdown into **production-ready, syntactically pristine, visually compelling, and interactive Mermaid diagrams.** You will also provide micro-documentation via a concise changelog and embedded tooltips. Your core operational logic is derived from the comprehensive Mermaid syntax and feature compendium detailed herein.

TASK: Convert the following data into a valid Mermaid.js ${actualType} diagram. Correct any syntax errors, enforce best practices, and enhance visual clarity.

Data:
<data>
${dataStr}
</data>

${additionalInstructions}

---
**OPERATIONAL PHASES (Your Refinement Lifecycle)**
---

**Phase 1: Input Ingestion & Contextual Analysis**
   1. Isolate Mermaid Content: Extract diagram-related data from the input.
   2. Pre-sanitize: Normalize whitespace; identify explicit flags.
   3. Diagram Type & Layout Inference: Use ${actualType} as the target diagram type. Default to TD layout for flowcharts if not specified.

**Phase 2: Syntactic & Structural Perfection**
   1. **Strict Syntax Enforcement:** Apply correct syntax rules for ${actualType}.
   2. **Code Formatting:** Apply consistent indentation and spacing.

**Phase 3: Visual Styling & Clarity Enhancement**
   1. **Theme & Color Application:** Apply WCAG-compliant, professional base theme.
   2. **Layout Optimization:** Refine layout for balance and legibility.

**Phase 4: Output Assembly**
   Output ONLY the Mermaid code block - no markdown fences, no explanations.

**CRITICAL RULES:**
- DO NOT use xychart-beta or barChart (unstable)
- For bar/line charts, use gantt with dateFormat X
- Always quote labels with special characters
- Use proper arrow syntax for each diagram type
- Apply WCAG-compliant colors
- Only output the Mermaid code itself

Mermaid ${actualType} code:`;

        const maxAttempts = 3;
        let cleanCode = '';
        let validationErrors = [];
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (attempt > 0) {
                this.streamProgress(`🔄 Validation failed, retrying (attempt ${attempt + 1}/${maxAttempts})...`);
            }
            
            // Increase temperature with each attempt for more creative solutions
            const temperature = (config.temperature || 0.7) + attempt * 0.1;
            
            const { text: mermaidCode } = await generateText({
                model: resolveProvider(config, providerMap),
                prompt: attempt === 0 ? prompt : `${prompt}

PREVIOUS ATTEMPT FAILED WITH THESE ERRORS:
${validationErrors.join('\n')}

Please fix these issues and generate valid Mermaid code.`,
                maxTokens: 3000,
                temperature: temperature,
            });
            
            // Strip any markdown code fences that the LLM might have included
            cleanCode = mermaidCode.trim();
            cleanCode = cleanCode.replace(/^```mermaid\s*/i, '');
            cleanCode = cleanCode.replace(/^```\s*/i, '');
            cleanCode = cleanCode.replace(/\s*```$/i, '');
            cleanCode = cleanCode.trim();
            
            // Validate the generated Mermaid code
            validationErrors = await this.validateMermaidSyntax(cleanCode, actualType);
            
            if (validationErrors.length === 0) {
                this.streamProgress(`✅ Generated valid ${actualType} diagram`);
                break;
            } else {
                this.streamProgress(`⚠️ Validation found ${validationErrors.length} issue(s)`);
            }
        }
        
        if (validationErrors.length > 0) {
            this.streamProgress(`⚠️ Warning: Generated diagram may have syntax issues`);
            console.warn('Mermaid validation errors:', validationErrors);
        }
        
        return cleanCode;
    }

    /**
     * Validate Mermaid syntax for common errors
     * Returns array of error messages (empty if valid)
     */
    async validateMermaidSyntax(code, diagramType) {
        const errors = [];
        
        // Check for empty code
        if (!code || code.trim().length === 0) {
            errors.push('Empty diagram code');
            return errors;
        }
        
        // Try using Electron-based validator if available
        if (mermaidValidator) {
            try {
                const result = await mermaidValidator.validate(code);
                
                if (result.valid) {
                    return errors; // No errors - diagram is valid!
                } else if (result.error) {
                    errors.push(`Mermaid syntax error: ${result.error}`);
                    // Don't return yet - continue to basic validation for additional checks
                }
            } catch (validatorError) {
                console.debug('Electron validator error:', validatorError.message);
                // Fall through to basic validation
            }
        }
        
        // Fallback: Basic syntax validation
        const lines = code.split('\n');
        
        // Check for proper diagram declaration
        const firstLine = lines[0].trim();
        const validDeclarations = [
            'flowchart', 'graph', 'sequenceDiagram', 'classDiagram',
            'stateDiagram', 'stateDiagram-v2', 'erDiagram', 'journey',
            'gantt', 'pie', 'quadrantChart', 'requirementDiagram',
            'gitGraph', 'C4Context', 'C4Container', 'C4Component', 'C4Dynamic',
            'mindmap', 'timeline', 'zenuml', 'sankey-beta', 'xychart-beta',
            'block-beta', 'packet-beta', 'kanban', 'architecture-beta', 'radar-beta'
        ];
        
        const hasValidDeclaration = validDeclarations.some(decl => firstLine.startsWith(decl));
        if (!hasValidDeclaration) {
            errors.push(`Invalid or missing diagram declaration. Expected one of: ${validDeclarations.join(', ')}`);
        }
        
        // Type-specific validation
        switch (diagramType) {
            case 'flowchart':
            case 'graph':
                // Check for valid direction
                if (firstLine.includes('flowchart') && !firstLine.match(/flowchart\s+(TD|TB|BT|LR|RL)/)) {
                    errors.push('Flowchart missing valid direction (TD, TB, BT, LR, or RL)');
                }
                // Check for unmatched brackets
                const brackets = { '[': ']', '(': ')', '{': '}' };
                for (const line of lines) {
                    for (const [open, close] of Object.entries(brackets)) {
                        const openCount = (line.match(new RegExp('\\' + open, 'g')) || []).length;
                        const closeCount = (line.match(new RegExp('\\' + close, 'g')) || []).length;
                        if (openCount !== closeCount) {
                            errors.push(`Unmatched brackets in line: ${line.substring(0, 50)}...`);
                            break;
                        }
                    }
                }
                break;
                
            case 'sequenceDiagram':
                // Check for valid message syntax
                const invalidMessages = lines.filter(line => {
                    const trimmed = line.trim();
                    return trimmed.includes('->') && 
                           !trimmed.match(/(->>|-->>|->|-x|--x|-\)|--\))/);
                });
                if (invalidMessages.length > 0) {
                    errors.push('Invalid message syntax in sequence diagram. Use ->>, -->>, -x, etc.');
                }
                break;
                
            case 'pie':
                // Check for proper pie chart syntax
                const hasTitle = lines.some(line => line.trim().startsWith('title'));
                const hasData = lines.some(line => line.includes(':') && line.includes('"'));
                if (!hasData) {
                    errors.push('Pie chart missing data entries. Use format: "Label" : value');
                }
                break;
                
            case 'gantt':
                // Check for gantt chart essentials
                const hasDateFormat = lines.some(line => line.trim().startsWith('dateFormat'));
                const hasSections = lines.some(line => line.trim().startsWith('section'));
                if (!hasDateFormat) {
                    errors.push('Gantt chart missing dateFormat declaration');
                }
                break;
                
            case 'erDiagram':
                // Check for entity definitions
                const hasEntities = lines.some(line => line.includes('{') && !line.trim().startsWith('%%'));
                if (!hasEntities) {
                    errors.push('ER diagram missing entity definitions');
                }
                break;
                
            case 'classDiagram':
                // Check for class definitions
                const hasClasses = lines.some(line => line.trim().startsWith('class ') || line.includes('{'));
                if (!hasClasses) {
                    errors.push('Class diagram missing class definitions');
                }
                break;
        }
        
        // Check for common syntax errors
        
        // Unclosed quotes
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.includes('"')) {
                const quoteCount = (line.match(/"/g) || []).length;
                if (quoteCount % 2 !== 0) {
                    errors.push(`Unclosed quotes in line ${i + 1}: ${line.substring(0, 50)}...`);
                }
            }
        }
        
        // Invalid characters or sequences
        const invalidSequences = ['```', '```mermaid'];
        for (const seq of invalidSequences) {
            if (code.includes(seq)) {
                errors.push(`Code should not contain markdown fences: ${seq}`);
            }
        }
        
        // Check for xychart-beta or barChart (unstable features)
        if (code.includes('xychart-beta') || code.includes('barChart')) {
            errors.push('Using unstable features (xychart-beta or barChart). Use gantt for bar charts instead.');
        }
        
        return errors;
    }

    async ensureMermaidSyntax(diagramType, definition) {
        // Check if definition already looks like Mermaid syntax
        const mermaidKeywords = ['graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 
                                  'stateDiagram', 'gantt', 'pie', 'erDiagram', '%%{'];
        
        const trimmedDef = definition.trim();
        const hasKeyword = mermaidKeywords.some(kw => trimmedDef.startsWith(kw));
        
        //if (hasKeyword) {
        //    return definition;
        //}
        
        // If not, use LLM to convert natural language to Mermaid
        this.streamProgress(`🤖 Converting description to Mermaid syntax...`);
        
        const config = getAgentConfig();
        
        // Special handling for bar charts - use gantt for more reliable rendering
        let actualType = diagramType;
        let additionalInstructions = '';
        
        if (diagramType === 'bar' || diagramType === 'line') {
            // Use gantt chart for bar-like visualizations (more stable than xychart-beta)
            actualType = 'gantt';
            additionalInstructions = `
IMPORTANT: For bar/line charts with numeric data, use gantt chart as horizontal bars.

Example gantt bar chart:
gantt
    title Sales Performance
    dateFormat X
    axisFormat %s
    
    section Products
    Widget A : 0, 150
    Widget B : 0, 200
    Widget C : 0, 175

Key rules for gantt bar charts:
- Use "dateFormat X" for numeric data (not dates)
- Use "axisFormat %s" to show numbers on axis
- Each bar: "Label : start, value" where start is usually 0
- Group bars using "section" labels
- Values are shown as bar lengths

DO NOT use xychart-beta as it's not stable in all Mermaid versions.`;
        }
        
        const prompt = `Your primary function is to transform ANY textual diagram idea, natural language description, malformed/incomplete Mermaid code, or embedded Mermaid blocks within Markdown into **production-ready, syntactically pristine, visually compelling, and interactive Mermaid diagrams.** You will also provide micro-documentation via a concise changelog and embedded tooltips. Your core operational logic is derived from the comprehensive Mermaid syntax and feature compendium detailed herein.

TASK: Convert the following description into a valid Mermaid.js ${actualType} diagram.

Description:
<description>
${definition}
</description>



${additionalInstructions}

---
**OPERATIONAL PHASES (Your Refinement Lifecycle)**
---

**Phase 0: Preliminary Assessment**
   1. Identify Diagram Type: Determine if the input is a flowchart, sequence diagram, etc.
   2. Detect Syntax Errors: Check for malformed Mermaid code or missing elements. Pay attention to common mistakes like string escapes, unmatched brackets, and incorrect arrow usage.
   3. Validate Input: Ensure the description is clear and actionable.   

**Phase 1: Input Ingestion & Contextual Analysis**
   1. Isolate Mermaid Content: Extract diagram-related data from the input.
   2. Pre-sanitize: Normalize whitespace; identify explicit flags.
   3. Diagram Type & Layout Inference: Use ${actualType} as the target diagram type. Default to TD layout for flowcharts if not specified.

**Phase 2: Syntactic & Structural Perfection**
   1. **Strict Syntax Enforcement:** Apply correct syntax rules for ${actualType}.
   2. **Code Formatting:** Apply consistent indentation and spacing.
   3. **Make sure to escape any text e.g. node descriptions by enclosing them in quotes.**

**Phase 3: Visual Styling & Clarity Enhancement**
   1. **Theme & Color Application:** Apply WCAG-compliant, professional base theme.
   2. **Layout Optimization:** Refine layout for balance and legibility.

**Phase 4: Output Assembly**
   Output ONLY the Mermaid code block - no markdown fences, no explanations.

---
**KEY SYNTAX RULES FOR ${actualType}**
---

**Flowcharts:**
- Declaration: flowchart <TD|LR|BT|RL>
- Nodes: id[Label], id(Rounded), id{Diamond}, id{{Hexagon}}, etc.
- Connections: -->, ---, -.->, ===>, etc.
- Styling: style nodeId fill:#color, classDef className

**Sequence Diagrams:**
- Declaration: sequenceDiagram
- Participants: participant/actor Name
- Messages: ->> (sync), -->> (async), -x (lost)
- Groups: loop, alt, opt, par

**Pie Charts:**
- Declaration: pie or pie showData
- Title: title "Chart Title"
- Slices: "Label" : value

**Gantt Charts (for bar/line charts):**
- Declaration: gantt
- For numeric bars: dateFormat X, axisFormat %s
- Bars: Label : start, value
- For project timeline: standard date format

**ER Diagrams:**
- Declaration: erDiagram
- Entities: ENTITY { type attribute }
- Relationships: ||--o{ (cardinality symbols)

**Class Diagrams:**
- Declaration: classDiagram
- Classes: class Name { +attribute -method() }
- Relationships: <|-- (inheritance), --* (composition), etc.

**CRITICAL RULES:**
- DO NOT use xychart-beta or barChart (unstable)
- For bar/line charts, use gantt with dateFormat X
- Always quote labels with special characters
- Use proper arrow syntax for each diagram type
- Apply WCAG-compliant colors
- Only output the Mermaid code itself

For labels always use quotes if they contain spaces or special characters or parentheses.

Do not add any comments!

Mermaid ${actualType} code:`;

        const maxAttempts = 3;
        let cleanCode = '';
        let validationErrors = [];
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            if (attempt > 0) {
                this.streamProgress(`🔄 Validation failed, retrying (attempt ${attempt + 1}/${maxAttempts})...`);
            }
            
            // Increase temperature with each attempt for more creative solutions
            const temperature = (config.temperature || 0.7) + attempt * 0.1;
            
            const { text: mermaidCode } = await generateText({
                model: resolveProvider(config, providerMap),
                prompt: attempt === 0 ? prompt : `${prompt}

PREVIOUS ATTEMPT FAILED WITH THESE ERRORS:
${validationErrors.join('\n')}

Please fix these issues and generate valid Mermaid code.`,
                maxTokens: 3000,
                temperature: temperature,

            });
            
            // Strip any markdown code fences that the LLM might have included
            cleanCode = mermaidCode.trim();
            cleanCode = cleanCode.replace(/^```mermaid\s*/i, '');
            cleanCode = cleanCode.replace(/^```\s*/i, '');
            cleanCode = cleanCode.replace(/\s*```$/i, '');
            cleanCode = cleanCode.trim();
            
            // Validate the generated Mermaid code
            validationErrors = await this.validateMermaidSyntax(cleanCode, actualType);
            
            if (validationErrors.length === 0) {
                this.streamProgress(`✅ Generated valid ${actualType} diagram`);
                break;
            } else {
                this.streamProgress(`⚠️ Validation found ${validationErrors.length} issue(s)`);
            }
        }
        
        if (validationErrors.length > 0) {
            this.streamProgress(`⚠️ Warning: Generated diagram may have syntax issues`);
            console.warn('Mermaid validation errors:', validationErrors);
        }
        
        return cleanCode;
    }

    /**
     * Export diagram as image (SVG or PNG)
     * Uses mermaid-cli (mmdc) if available, otherwise creates an HTML file with rendering instructions
     */
    async exportDiagramAsImage(mermaidCode, fileName, workspacePath, format) {
        this.streamProgress(`🖼️ Exporting diagram as ${format.toUpperCase()}...`);
        
        const filePath = path.join(workspacePath, fileName);
        
        try {
            // Try using mermaid-cli (mmdc) if available
            const tempMmdFile = path.join(workspacePath, '.temp_diagram.mmd');
            fs.writeFileSync(tempMmdFile, mermaidCode, 'utf-8');
            
            try {
                // Try npx mmdc first (mermaid-cli)
                const outputFlag = format === '.svg' ? '-o' : '-o';
                execSync(`npx -y @mermaid-js/mermaid-cli mmdc -i "${tempMmdFile}" ${outputFlag} "${filePath}"`, {
                    stdio: 'pipe',
                    timeout: 30000
                });
                
                // Clean up temp file
                if (fs.existsSync(tempMmdFile)) {
                    fs.unlinkSync(tempMmdFile);
                }
                
                this.streamProgress(`✅ Diagram exported as ${fileName}`);
                return;
            } catch (mmdcError) {
                // mermaid-cli not available, use alternative approach
                console.debug('mermaid-cli not available, creating HTML renderer instead');
                
                // Clean up temp file
                if (fs.existsSync(tempMmdFile)) {
                    fs.unlinkSync(tempMmdFile);
                }
                
                // Create an HTML file that can be opened in a browser to render and save
                const htmlFileName = fileName.replace(/\.(svg|png)$/, '.html');
                const htmlFilePath = path.join(workspacePath, htmlFileName);
                
                const html = this.createMermaidRenderHTML(mermaidCode, format, fileName);
                fs.writeFileSync(htmlFilePath, html, 'utf-8');
                
                this.streamProgress(`⚠️ Mermaid CLI not available. Created ${htmlFileName} instead.`);
                this.streamProgress(`📝 Open ${htmlFileName} in a browser, then right-click the diagram to save as ${format.toUpperCase()}.`);
            }
        } catch (error) {
            throw new Error(`Failed to export diagram as image: ${error.message}`);
        }
    }

    /**
     * Create HTML file with Mermaid diagram and download button
     */
    createMermaidRenderHTML(mermaidCode, format, targetFileName) {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Mermaid Diagram Export</title>
    <script type="module">
        import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
        
        mermaid.initialize({ 
            startOnLoad: true,
            theme: 'default',
            securityLevel: 'loose'
        });
        
        // Add pan/zoom functionality
        window.addEventListener('load', () => {
            const diagram = document.getElementById('diagram');
            
            // Download functionality
            document.getElementById('downloadBtn').addEventListener('click', async () => {
                const svg = diagram.querySelector('svg');
                if (!svg) return;
                
                const format = '${format.replace('.', '')}';
                
                if (format === 'svg') {
                    // Download as SVG
                    const svgData = new XMLSerializer().serializeToString(svg);
                    const blob = new Blob([svgData], { type: 'image/svg+xml' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = '${targetFileName}';
                    link.click();
                    URL.revokeObjectURL(url);
                } else if (format === 'png') {
                    // Convert to PNG
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    const img = new Image();
                    
                    const svgData = new XMLSerializer().serializeToString(svg);
                    const blob = new Blob([svgData], { type: 'image/svg+xml' });
                    const url = URL.createObjectURL(blob);
                    
                    img.onload = () => {
                        canvas.width = img.width * 2; // 2x scale for better quality
                        canvas.height = img.height * 2;
                        ctx.scale(2, 2);
                        ctx.drawImage(img, 0, 0);
                        
                        canvas.toBlob((pngBlob) => {
                            const pngUrl = URL.createObjectURL(pngBlob);
                            const link = document.createElement('a');
                            link.href = pngUrl;
                            link.download = '${targetFileName}';
                            link.click();
                            URL.revokeObjectURL(pngUrl);
                            URL.revokeObjectURL(url);
                        }, 'image/png');
                    };
                    
                    img.src = url;
                }
            });
            
            // Zoom controls
            let scale = 1;
            
            document.getElementById('zoomIn').addEventListener('click', () => {
                scale = Math.min(scale + 0.1, 3);
                diagram.style.transform = \`scale(\${scale})\`;
            });
            
            document.getElementById('zoomOut').addEventListener('click', () => {
                scale = Math.max(scale - 0.1, 0.3);
                diagram.style.transform = \`scale(\${scale})\`;
            });
            
            document.getElementById('zoomReset').addEventListener('click', () => {
                scale = 1;
                diagram.style.transform = 'scale(1)';
            });
            
            // Pan with mouse drag
            let isDragging = false;
            let startX, startY, scrollLeft, scrollTop;
            const container = document.getElementById('container');
            
            container.addEventListener('mousedown', (e) => {
                isDragging = true;
                container.style.cursor = 'grabbing';
                startX = e.pageX - container.offsetLeft;
                startY = e.pageY - container.offsetTop;
                scrollLeft = container.scrollLeft;
                scrollTop = container.scrollTop;
            });
            
            container.addEventListener('mouseleave', () => {
                isDragging = false;
                container.style.cursor = 'grab';
            });
            
            container.addEventListener('mouseup', () => {
                isDragging = false;
                container.style.cursor = 'grab';
            });
            
            container.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                e.preventDefault();
                const x = e.pageX - container.offsetLeft;
                const y = e.pageY - container.offsetTop;
                const walkX = (x - startX) * 2;
                const walkY = (y - startY) * 2;
                container.scrollLeft = scrollLeft - walkX;
                container.scrollTop = scrollTop - walkY;
            });
        });
    </script>
    <style>
        body {
            margin: 0;
            padding: 20px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #f5f5f5;
        }
        
        .controls {
            position: fixed;
            top: 20px;
            right: 20px;
            background: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            z-index: 1000;
        }
        
        button {
            display: block;
            width: 100%;
            margin: 5px 0;
            padding: 8px 16px;
            background: #0066cc;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        
        button:hover {
            background: #0052a3;
        }
        
        .zoom-controls button {
            display: inline-block;
            width: auto;
            margin: 2px;
        }
        
        #container {
            width: 100%;
            height: calc(100vh - 40px);
            overflow: auto;
            cursor: grab;
            background: white;
            border-radius: 8px;
            padding: 40px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        #diagram {
            display: inline-block;
            transform-origin: top left;
            transition: transform 0.2s ease;
        }
        
        h1 {
            margin-top: 0;
            color: #333;
        }
        
        .instructions {
            background: #fff3cd;
            border: 1px solid #ffc107;
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="controls">
        <h3 style="margin-top: 0; font-size: 16px;">Controls</h3>
        <button id="downloadBtn">💾 Download ${format.toUpperCase()}</button>
        <hr style="margin: 10px 0; border: 0; border-top: 1px solid #ddd;">
        <div class="zoom-controls">
            <button id="zoomIn" title="Zoom In">🔍+</button>
            <button id="zoomOut" title="Zoom Out">🔍−</button>
            <button id="zoomReset" title="Reset Zoom">↺</button>
        </div>
        <small style="display: block; margin-top: 10px; color: #666;">
            Drag to pan<br/>
            Scroll to zoom
        </small>
    </div>
    
    <div id="container">
        <h1>Mermaid Diagram</h1>
        <div class="instructions">
            💡 Use the Download button to save as ${format.toUpperCase()}, or right-click the diagram below and choose "Save image as..."
        </div>
        <div id="diagram" class="mermaid">
${mermaidCode}
        </div>
    </div>
</body>
</html>`;
    }
}

/**
 * Data Analysis Tool - Analyzes data files and generates summaries/insights
 */
class DataAnalysisTool extends Tool {
    constructor(sessionId = null) {
        super();
        this.name = "data_analyzer";
        this.description = "Analyzes data from CSV, JSON, or other structured files in the workspace. Can provide statistics, summaries, patterns, and insights about the data. Useful before creating visualizations to understand what data you have.";
        this.inputs = {
            file_path: {
                type: "string",
                description: "Relative path to the data file in the workspace (CSV, JSON, TSV)",
            },
            analysis_type: {
                type: "string",
                description: "Type of analysis: 'summary' (basic stats), 'columns' (column info), 'preview' (first rows), 'full' (comprehensive analysis)",
                default: "summary",
                nullable: true,
            }
        };
        this.output_type = "string";
        this.sessionId = sessionId;
    }

    async forward(filePath, analysisType = "summary") {
        this.streamProgress(`📊 Analyzing data file: ${filePath}...`);
        
        const sessionWorkspace = this.getSessionWorkspace();
        const fullPath = path.join(sessionWorkspace, filePath);
        
        if (!fs.existsSync(fullPath)) {
            throw new Error(`File not found: ${filePath}`);
        }
        
        const fileExt = path.extname(filePath).toLowerCase();
        let data;
        let analysis = `# Data Analysis: ${filePath}\n\n`;
        
        // Parse file
        if (fileExt === '.json') {
            const content = fs.readFileSync(fullPath, 'utf-8');
            data = JSON.parse(content);
        } else if (fileExt === '.csv' || fileExt === '.tsv') {
            const content = fs.readFileSync(fullPath, 'utf-8');
            data = this.parseCSV(content, fileExt === '.tsv' ? '\t' : ',');
        } else {
            throw new Error(`Unsupported file format: ${fileExt}`);
        }
        
        // Perform analysis based on type
        if (analysisType === 'preview' || analysisType === 'full') {
            analysis += this.generatePreview(data);
        }
        
        if (analysisType === 'columns' || analysisType === 'full') {
            analysis += this.generateColumnInfo(data);
        }
        
        if (analysisType === 'summary' || analysisType === 'full') {
            analysis += this.generateSummary(data);
        }
        
        this.streamProgress(`✅ Analysis complete`);
        return analysis;
    }

    getSessionWorkspace() {
        let userWorkspace = process.env.USER_WORKSPACES;
        let sessionWorkspace;
        
        if (!userWorkspace) {
            userWorkspace = process.env.DML_CLI_WORKSPACE || "./workspace";
            sessionWorkspace = userWorkspace;
            if (!fs.existsSync(sessionWorkspace)) {
                fs.mkdirSync(sessionWorkspace, { recursive: true });
            }
        } else {
            const session = this.sessionId || process.env.PLOGCHAIN_SESSION_ID;
            sessionWorkspace = path.join(userWorkspace, session);
            if (!fs.existsSync(sessionWorkspace)) {
                fs.mkdirSync(sessionWorkspace, { recursive: true });
            }
        }
        return sessionWorkspace;
    }

    parseCSV(content, delimiter = ',') {
        const lines = content.trim().split('\n');
        const headers = lines[0].split(delimiter).map(h => h.trim());
        const rows = [];
        
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(delimiter).map(v => v.trim());
            const row = {};
            headers.forEach((header, idx) => {
                row[header] = values[idx];
            });
            rows.push(row);
        }
        
        return { headers, rows };
    }

    generatePreview(data) {
        let preview = `## Preview\n\n`;
        
        if (Array.isArray(data)) {
            preview += `**Type:** Array with ${data.length} items\n\n`;
            preview += `**First 5 items:**\n\`\`\`json\n${JSON.stringify(data.slice(0, 5), null, 2)}\n\`\`\`\n\n`;
        } else if (data.rows) {
            preview += `**Type:** Tabular data with ${data.rows.length} rows\n\n`;
            preview += `**First 5 rows:**\n`;
            preview += this.formatTable(data.headers, data.rows.slice(0, 5));
        } else {
            preview += `\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 500)}\n\`\`\`\n\n`;
        }
        
        return preview;
    }

    generateColumnInfo(data) {
        let info = `## Column Information\n\n`;
        
        if (data.headers && data.rows) {
            info += `**Total Columns:** ${data.headers.length}\n\n`;
            
            for (const header of data.headers) {
                const values = data.rows.map(row => row[header]).filter(v => v !== undefined && v !== '');
                const numericValues = values.filter(v => !isNaN(parseFloat(v))).map(v => parseFloat(v));
                
                info += `### ${header}\n`;
                info += `- **Non-empty values:** ${values.length}\n`;
                
                if (numericValues.length > 0) {
                    const min = Math.min(...numericValues);
                    const max = Math.max(...numericValues);
                    const avg = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
                    info += `- **Type:** Numeric\n`;
                    info += `- **Range:** ${min.toFixed(2)} to ${max.toFixed(2)}\n`;
                    info += `- **Average:** ${avg.toFixed(2)}\n`;
                } else {
                    const unique = new Set(values);
                    info += `- **Type:** Text\n`;
                    info += `- **Unique values:** ${unique.size}\n`;
                }
                info += `\n`;
            }
        }
        
        return info;
    }

    generateSummary(data) {
        let summary = `## Summary\n\n`;
        
        if (data.rows) {
            summary += `- **Total rows:** ${data.rows.length}\n`;
            summary += `- **Total columns:** ${data.headers.length}\n`;
            summary += `- **Columns:** ${data.headers.join(', ')}\n\n`;
        } else if (Array.isArray(data)) {
            summary += `- **Total items:** ${data.length}\n`;
            summary += `- **Data type:** Array\n\n`;
        } else {
            summary += `- **Data type:** Object\n`;
            summary += `- **Top-level keys:** ${Object.keys(data).join(', ')}\n\n`;
        }
        
        return summary;
    }

    formatTable(headers, rows) {
        let table = '| ' + headers.join(' | ') + ' |\n';
        table += '| ' + headers.map(() => '---').join(' | ') + ' |\n';
        
        for (const row of rows) {
            const values = headers.map(h => row[h] || '');
            table += '| ' + values.join(' | ') + ' |\n';
        }
        
        return table + '\n';
    }
}

/**
 * Visualizer Tool
 */
class VisualizerTool extends Tool {
    constructor(sessionId = null) {
        super();
        this.name = "visualizer";
        this.description = "A tool that can answer questions about attached images. If no question is asked, it will create a caption for the image.";
        this.inputs = {
            image_path: {
                type: "string",
                description: "The path to the image on which to answer the question. This should be a relative path to a downloaded image in the user workspace.",
            },
            question: {
                type: "string",
                description: "The question to answer.",
                nullable: true,
            }
        };
        this.output_type = "string";
        this.sessionId = sessionId;
    }

    async forward(imagePath, question = null) {
        let addNote = false;
        if (!question) {
            addNote = true;
            question = "Please write a detailed caption for this image.";
        }

        let userWorkspace = process.env.USER_WORKSPACES;
        let sessionWorkspace;
        
        if (!userWorkspace) {
            userWorkspace = process.env.DML_CLI_WORKSPACE || "./workspace";
            sessionWorkspace = userWorkspace;
            
            if (!fs.existsSync(sessionWorkspace)) {
                fs.mkdirSync(sessionWorkspace, { recursive: true });
            }
        } else {
            const session = this.sessionId || process.env.PLOGCHAIN_SESSION_ID;
            sessionWorkspace = path.join(userWorkspace, session);
            
            if (!fs.existsSync(sessionWorkspace)) {
                fs.mkdirSync(sessionWorkspace, { recursive: true });
            }
        }

        const imagePathFull = path.join(sessionWorkspace, imagePath);

        if (!fs.existsSync(imagePathFull)) {
            throw new Error(`Image file not found at ${imagePathFull}`);
        }

        const modelName = "gemini-2.5-flash" //process.env.VISUALQA_MODEL;
        if (!modelName) {
            throw new Error("VISUALQA_MODEL environment variable is not set.");
        }

        try {
     
            const { text: output } = await generateText({
                model: google(modelName),
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: question },
                            { type: "image", image: fs.readFileSync(imagePathFull, {
            encoding: 'base64',
          })},
                        ],
                    }
                ],
                maxTokens: 1000,
            });

            if (addNote) {
                return `You did not provide a particular question, so here is a detailed caption for the image: ${output}`;
            }

            return output;

        } catch (error) {
            throw new Error(`Error during model inference: ${error.message}`);
        }
    }
}

/**
 * Python Interpreter Tool
 */
class LinuxVMTool extends Tool {

     constructor() {
        super();
        this.name = "linux_vm_with_sh_and_python";
        this.description = "This is a tool that gives you access to a complete linux environment via a sh shell. Use this to run sh commands. The linux_vm tool runs in a sandboxed environment and will by default execute in /mnt. This is where the user workspace is mounted. Additionally, python is installed in the VM. So you can safely run python scripts as well. The following pip packages are available: pandas numpy openpyxl docx python-pptx.";

        this.inputs = {
            command: {
                type: "string",
                description: "The bash command to run.",
            },
        };
        this.output_type = "string";

        const resolver = getResourceResolver();

        console.log(`DML CLI: Initializing Linux VM tool with V86 emulator...`);
        console.log(`DML_CLI_WORKSPACE: ${process.env.DML_CLI_WORKSPACE}`);

        this.emulator = new V86({
            bios: {
                url: resolver ? resolver.getV86BiosPath('seabios.bin') : "vendor/v86/bios/seabios.bin",
            },
            vga_bios: {
                url: resolver ? resolver.getV86BiosPath('vgabios.bin') : "vendor/v86/bios/vgabios.bin",
            },
            hda: {
                url: resolver ? resolver.getV86ImagePath('alpine.img') : "vendor/v86/images/alpine.img"
            },
            memory_size: 2048 * 1024 * 1024,
            vga_memory_size: 128 * 1024 * 1024,
            filesystem: { handle9p: create9pHandler(process.env.DML_CLI_WORKSPACE || "./workspace")},
            bzimage_initrd_from_filesystem: true, 
            cmdline: "tsc=reliable modules=virtio_pci",
            autostart: true,
            disable_keyboard: true,
            wasm_path: resolver ? resolver.getV86WasmPath() : "vendor/v86/build/v86.wasm",
        });


        this.processing = false;
        this.init = false;
        this.buffer = "";
        // Track a single pending command (one-at-a-time)
        this.pending = null;

        let instance = this;

        this.emulator.add_listener("serial0-output-byte", function(byte)
        {

            if (!instance)
                return;

            var chr = String.fromCharCode(byte);
            if(chr <= "~")
            {
                if (process.env.DEBUG_BASH_TOOL)
                    process.stdout.write(chr);
                instance.buffer += chr;
            }

            if (!instance.init && instance.buffer.slice(-2) === "~#") {
                instance.init = true;
                console.log("\n Linux environment has booted.");
                console.log("Mounting 9p filesystem...");
                instance.emulator.serial0_send("mount -t 9p -o trans=virtio,version=9p2000.L host9p /mnt && cd /mnt/ \n");
            }

            // Detect end-of-command sentinel and resolve pending promise
            if (instance.pending) {
                const { id, startIndex } = instance.pending;
                const re = new RegExp(`__CMD_DONE__${id}__([0-9]+)__`);
                const match = re.exec(instance.buffer);
                if (match) {
                    const exitCode = parseInt(match[1], 10);
                    const markerStart = match.index;
                    const markerEnd = match.index + match[0].length;
                    // Capture output between command start and marker
                    const output = instance.buffer.slice(startIndex, markerStart).split("$?")[1] || "";

                    // Trim buffer up to markerEnd; keep anything after for future
                    instance.buffer = instance.buffer.slice(markerEnd);

                    const resolve = instance.pending.resolve;
                    // Clear pending and processing
                    instance.pending = null;
                    instance.processing = false;

                    // Resolve with clean output and exit code
                    resolve({ stdout: output.trim(), exitCode });
                }
            }

            
        });

        
        
    }


    async forward(code) {

        let c = 0;

        if (!this.init) {
            console.log("Waiting for Linux environment to boot...");
            this.streamProgress("🔄 Waiting for Linux environment to boot, this may take some time...");
        }
        
        while (!this.init) {
            if (c % 5 === 0) { // Stream progress every 5 seconds
                console.log("Booting Linux VM...");
                this.streamProgress("⏳ Booting Linux VM...");
            }
            //sleep 1 sec
            await setTimeout(1000)
            c+=1;
            if (c > 200) {
                return "ERROR: could not initialize linux environment."
            }

            if (this.init) {
                console.log("Linux environment is ready.");
                this.streamProgress("✅ Linux environment is ready.");
                
            }
        }


        if (this.processing) {
            return "ERROR: Please wait while previous command is running."
        }

        this.processing = true;
        this.streamProgress(`🔧 Executing command in VM...`);


        // Create a unique marker for this command
        const id = `${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
        const startIndex = this.buffer.length;

        const doneCmd = `printf '\\n__CMD_DONE__${id}__%s__' $?`;
        // Wrap command: capture stderr, then print sentinel with exit code
        const wrapped = `(\n${code}\n) 2>&1; ${doneCmd}\n`;

        const resultPromise = new Promise((resolve, reject) => {
            // Timeout in case command hangs (2 minutes)
            const timeoutMs = 120000;
            const to = globalThis.setTimeout(() => {
                if (this.pending && this.pending.id === id) {
                    this.pending = null;
                    this.processing = false;
                    reject(new Error("Command timed out"));
                }
            }, timeoutMs);

            this.pending = {
                id,
                startIndex,
                resolve: (res) => {
                    globalThis.clearTimeout(to);
                    resolve(res);
                },
                reject: (err) => {
                    globalThis.clearTimeout(to);
                    reject(err);
                }
            };
        });

        // Send command to the emulator shell
        this.emulator.serial0_send(wrapped);

        try {
            const { stdout, exitCode } = await resultPromise;
            return `Exit code:${exitCode}\nCommand output:\n${stdout}`;
        } catch (e) {
            return `ERROR: ${e.message}`;
        }
        
    }
}

// Default tools list for export
export const DEFAULT_TOOLS = [
    new WorkspaceReaderTool(),
    new FileDownloaderTool(),
    new GoogleSearchTool(),
    new YouComSearchTool(),
    new BraveSearchTool(),
    new GoogleScholarSearchTool(),
    new VisitWebpageTool(),
    new VisualizerTool(),
    new DiagramGeneratorTool(),
    new DataAnalysisTool(),
   // new LinuxVMTool(),
];

// Global singleton instance of LinuxVMTool - shared across all sessions
let globalLinuxVMTool = null;

/**
 * Get or create the global LinuxVMTool instance
 */
function getGlobalLinuxVMTool() {
    if (!globalLinuxVMTool) {
        console.log("Creating global LinuxVMTool instance...");
        globalLinuxVMTool = new LinuxVMTool();
    }
    return globalLinuxVMTool;
}

// Helper: convert our inputs spec to a zod schema
function inputsToZod(inputs) {
    const shape = {};
    for (const [k, spec] of Object.entries(inputs || {})) {
        let t = spec;
        let desc;
        if (typeof spec === 'object' && spec !== null) {
            t = spec.type || spec.kind || 'any';
            desc = spec.description || spec.help;
        }
        let zt;
        switch (String(t).toLowerCase()) {
            case 'string': zt = z.string(); break;
            case 'integer': zt = z.number().int(); break;
            case 'number': zt = z.number(); break;
            case 'boolean': zt = z.boolean(); break;
            case 'array': zt = z.array(z.any()); break;
            case 'object': zt = z.object({}).passthrough(); break;
            default: zt = z.any();
        }
        if (spec && spec.nullable) zt = zt.nullable();
        if (desc) zt = zt.describe(desc);
        shape[k] = zt;
    }
    return Object.keys(shape).length ? z.object(shape).passthrough() : z.object({}).passthrough();
}


var sessionTools = {}

/**
 * Load settings from config file
 */
function loadToolSettings() {
    try {
        // Use the same settings path resolution as models.js
        let settingsPath = null;
        
        // Check if we're in Electron mode (has global.resourceResolver)
        const resolver = typeof global !== 'undefined' ? global.resourceResolver : null;
        
        if (resolver) {
            // Electron mode - use ~/.deepclause/config/settings.json
            const homeDir = process.env.HOME || process.env.USERPROFILE;
            if (!homeDir) {
                console.warn('[Tools] Could not determine home directory for settings');
                return null;
            }
            settingsPath = path.join(homeDir, '.deepclause', 'config', 'settings.json');
        } else {
            // CLI/Deployed mode - check for local settings.json first (deployed mode)
            const __dirname = path.dirname(new URL(import.meta.url).pathname);
            const localSettings = path.join(__dirname, '..', 'config', 'settings.json');
            
            if (fs.existsSync(localSettings)) {
                settingsPath = localSettings;
            } else {
                // Fall back to project config
                settingsPath = path.resolve(process.cwd(), 'config', 'settings.json');
            }
        }
        
        if (!settingsPath || !fs.existsSync(settingsPath)) {
            console.log('[Tools] Settings file not found at:', settingsPath || 'undefined');
            return null;
        }
        
        const data = fs.readFileSync(settingsPath, 'utf-8');
        const settings = JSON.parse(data);
        console.log('[Tools] Loaded tool settings from:', settingsPath);
        return settings.defaultTools || null;
    } catch (error) {
        console.error('[Tools] Error loading tool settings:', error);
        return null;
    }
}

/**
 * Build a Vercel AI SDK tools map from our class tools.
 * Keeps backward compatibility while enabling ai.tool usage.
 * @param {string} sessionId - Session identifier
 * @param {function} progressCallback - Optional callback for streaming progress messages
 */
export function buildAiTools(sessionId = null, progressCallback = null) {
    // Load tool configuration
    const toolConfig = loadToolSettings();
    
    // Determine which search tool to use
    let searchTool = null;
    if (toolConfig) {
        if (toolConfig.brave_search) {
            searchTool = new BraveSearchTool();
        } else if (toolConfig.you_search) {
            searchTool = new YouComSearchTool();
        } else if (toolConfig.google_search) {
            searchTool = new GoogleSearchTool();
        }
    } else {
        // Default: use You.com search if no config
        searchTool = new YouComSearchTool();
    }
    
    // Build tool instances based on configuration
    let instances = [];
    
    // Add search tool
    if (searchTool) {
        instances.push(searchTool);
    }
    
    // Add Google Scholar (independent from main search tools)
    if (!toolConfig || toolConfig.google_scholar_search) {
        instances.push(new GoogleScholarSearchTool());
    }
    
    // Add other tools based on config
    if (!toolConfig || toolConfig.visit_webpage) {
        instances.push(new VisitWebpageTool());
    }
    
    if (!toolConfig || toolConfig.workspace_reader) {
        instances.push(new WorkspaceReaderTool(sessionId));
    }
    
    if (!toolConfig || toolConfig.file_downloader) {
        instances.push(new FileDownloaderTool(sessionId));
    }
    
    if (!toolConfig || toolConfig.visualizer) {
        instances.push(new VisualizerTool(sessionId));
    }
    
    if (!toolConfig || toolConfig.diagram_generator) {
        instances.push(new DiagramGeneratorTool(sessionId));
    }
    
    if (!toolConfig || toolConfig.data_analyzer) {
        instances.push(new DataAnalysisTool(sessionId));
    }
    
    if (toolConfig && toolConfig.linux_vm) {
        instances.push(getGlobalLinuxVMTool());
    }


    if (!sessionTools[sessionId]) {
         sessionTools[sessionId] = []
    }

    instances = instances.concat(sessionTools[sessionId])

    // Set progress callback on all tool instances
    if (progressCallback && typeof progressCallback === 'function') {
        instances.forEach(tool => {
            if (tool && typeof tool.setProgressCallback === 'function') {
                tool.setProgressCallback(progressCallback);
            }
        });
    }

    const tools = {};
    for (const t of instances) {
        tools[t.name] = aiTool({
            description: t.description || t.name,
            inputSchema: inputsToZod(t.inputs || {}),
            execute: async (args) => t.execute(args || {}),
        });
    }
    return tools;
}

// Export as named exports for ES6 imports
export { getGlobalLinuxVMTool };

export default {
    DEFAULT_TOOLS,
    Tool,
    GoogleSearchTool,
    YouComSearchTool,
    BraveSearchTool,
    GoogleScholarSearchTool,
    VisitWebpageTool,
    WorkspaceReaderTool,
    FileDownloaderTool,
    VisualizerTool,
    DiagramGeneratorTool,
    DataAnalysisTool,
    LinuxVMTool,
    getGlobalLinuxVMTool,
    truncateContent,
    encodeImage,
    buildAiTools
};

 //Only run demo when explicitly enabled
 if (process.env.DEBUG_BASH_TOOL === '1') {
     let bash = new LinuxVMTool()

     console.log(await bash.forward("echo 'echo Hello' >test.sh && ls -l test.sh && sh test.sh &&chmod a+x test.sh && ./test.sh"));
 }

 //Only run demo when explicitly enabled
 if (process.env.DEBUG_VISUALIZER_TOOL === '1') {
    (async () => {
        console.log("--- VisualizerTool Test ---");
        const sessionId = 'visualizer_test';
        const downloader = new FileDownloaderTool(sessionId);
        const visualizer = new VisualizerTool(sessionId);
        const imageUrl = "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png";
        const imageName = "google_logo.png";
        const question = "What does this image show?";

        try {
            console.log(`Downloading test image: ${imageUrl}`);
            const savedFileName = await downloader.forward(imageUrl, imageName);
            console.log(`Image saved to workspace as: ${savedFileName}`);

            console.log(`Asking question: "${question}"`);
            const result = await visualizer.forward("./deepclause.png", question);
            
            console.log("\n--- VisualizerTool Result ---");
            console.log(result);
            console.log("---------------------------\n");

        } catch (error) {
            console.error("VisualizerTool test failed:", error);
        }
    })();
 }