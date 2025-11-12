import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { tool as aiTool, generateText } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { execSync } from 'child_process';

import { setTimeout } from 'node:timers/promises';

import { V86 } from "../../vendor/v86/build/libv86.mjs"; 

import { create9pHandler } from './9p.js';
import { set } from 'zod/v4';

// Access resource resolver from global (set by main process in Electron)
// Use a getter function for lazy access to avoid import-time undefined issues
const getResourceResolver = () => global.resourceResolver;

const MAX_LENGTH_TRUNCATE_CONTENT = 300000;

/**
 * Truncate content if it exceeds max length
 */
function truncateContent(content, maxLength = MAX_LENGTH_TRUNCATE_CONTENT) {
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
        this.description = "Performs a google web search for your query then returns a string of the top search results.";
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
                return `No results found for '${query}'${yearFilterMessage}. Try with a more general query, or remove the year filter.`;
            }

            const webSnippets = [];
            if (organicKey in results) {
                results[organicKey].forEach((page, idx) => {
                    let datePublished = "";
                    if ("date" in page) {
                        datePublished = "\nDate published: " + page.date;
                    }

                    let source = "";
                    if ("source" in page) {
                        source = "\nSource: " + page.source;
                    }

                    let snippet = "";
                    if ("snippet" in page) {
                        snippet = "\n" + page.snippet;
                    }

                    const redactedVersion = `${idx}. [${page.title}](${page.link})${datePublished}${source}\n${snippet}`;
                    webSnippets.push(redactedVersion);
                });
            }

            return "## Search Results\n" + webSnippets.join("\n\n");
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
        this.description = "Performs a google scholar search for your query then returns a string of the top search results. Results contain number of citations, year of publication, source, snippet, and sometimes pdf link to the paper.";
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
                return `No results found for '${query}'. Try with a more general query.`;
            }

            this.streamProgress(`📊 Processing ${results[organicKey].length} scholarly results...`);

            const webSnippets = [];
            if (organicKey in results) {
                results[organicKey].forEach((page, idx) => {
                    let datePublished = "";
                    if ("year" in page) {
                        datePublished = "\nYear published: " + page.year.toString();
                    }

                    let source = "";
                    if ("source" in page) {
                        source = "\nSource: " + page.source;
                    }

                    let snippet = "";
                    if ("snippet" in page) {
                        snippet = "\n" + page.snippet;
                    }

                    let citedBy = "";
                    if ("cited_by" in page) {
                        citedBy = "\nCited by: " + page.cited_by.toString();
                    }

                    let publicationInfo = "";
                    if ("publicationInfo" in page) {
                        publicationInfo = "\nPublication info: " + page.publicationInfo.toString();
                    }

                    let pdfUrl = "";
                    if ("pdfUrl" in page) {
                        pdfUrl = "\nPDF URL: " + page.pdfUrl.toString();
                    }

                    const redactedVersion = `${idx}. [${page.title}](${page.link})${datePublished}${citedBy}${publicationInfo}${pdfUrl}${source}\n${snippet}`;
                    webSnippets.push(redactedVersion);
                });
            }

            this.streamProgress(`✅ Formatted ${webSnippets.length} scholarly articles.`);
            return "## Search Results\n" + webSnippets.join("\n\n");
        } catch (error) {
            throw new Error(`Scholar search failed: ${error.message}`);
        }
    }
}



/**
 * You.com Search Tool
 */
export class YouComSearchTool extends Tool {
    constructor() {
        super();
        this.name = "web_search";
        this.description = "Performs a web search using the You.com (ydc-index) API and returns a markdown list of top results.";
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
            return `No results found for '${query}'.`;
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
                return `No results found for '${query}' with filter year=${filterYear}.`;
            }
        }

        const limited = filtered.slice(0, Math.max(1, num || 50));
        this.streamProgress(`✅ Formatted ${limited.length} results.`);

        const formatted = limited.map((r, idx) => {
            const title = r.title || r.url || "Untitled";
            const url = r.url || "";
            const dateStr = r.page_age ? `\nDate: ${r.page_age}` : "";
            const description = r.description ? `\n${r.description}` : "";
            let snippet = "";
            if (Array.isArray(r.snippets) && r.snippets.length) {
                // Join a few snippets (truncate to keep concise)
                const joined = r.snippets.slice(0, 3).join(" ");
                snippet = `\n${joined}`;
            }
            return `${idx}. [${title}](${url})${dateStr}${description}${snippet}`.trim();
        });

        return "## Search Results\n" + formatted.join("\n\n");
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
            }
        };
        this.output_type = "string";
        this.maxOutputLength = maxOutputLength;
    }

    async forward(url) {
        this.streamProgress(`🌐 Visiting webpage: ${url}...`);
        
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
            return `URL: ${url}\nTitle: ${title}\nText: ${truncateContent(res.markdown, this.maxOutputLength)}`;
        } catch (error) {
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
        this.description = "Creates diagrams from structured data, files, or natural language descriptions. Supports flowcharts, sequence diagrams, class diagrams, state diagrams, Gantt charts, pie charts, entity-relationship diagrams, and network graphs using Mermaid.js syntax. Can read data from workspace files (CSV, JSON) to generate data-driven visualizations. Returns markdown-compatible diagram code.";
        this.inputs = {
            diagram_type: {
                type: "string",
                description: "Type of diagram: 'flowchart', 'sequence', 'class', 'state', 'gantt', 'pie', 'bar', 'line', 'er' (entity-relationship), or 'graph'",
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
                description: "Optional filename to save the diagram markdown (e.g., 'my_diagram.md'). If not provided, only returns the diagram code.",
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
                this.streamProgress(`📂 Reading data from file: ${dataSource}`);
                mermaidCode = await this.createDiagramFromFile(sessionWorkspace, dataSource, diagramType);
            } else {
                // Either Mermaid syntax or natural language description
                mermaidCode = await this.ensureMermaidSyntax(diagramType, dataSource);
            }
            
            // Create markdown with diagram
            const titleStr = title ? `# ${title}\n\n` : '';
            const content = `${titleStr}\`\`\`mermaid\n${mermaidCode}\n\`\`\`\n`;
            
            // Save to file if requested
            if (saveToFile) {
                const fileName = saveToFile.endsWith('.md') ? saveToFile : `${saveToFile}.md`;
                const filePath = path.join(sessionWorkspace, fileName);
                fs.writeFileSync(filePath, content, 'utf-8');
                this.streamProgress(`✅ Diagram saved as ${fileName}`);
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
        
        const modelName = process.env.AGENT_MODEL || "gemini-2.0-flash-exp";
        
        const dataStr = JSON.stringify(data, null, 2);
        const prompt = `Convert the following data into a valid Mermaid.js ${diagramType} diagram.

Data:
${dataStr}

Requirements:
- Create a clear, well-structured ${diagramType} diagram
- Use appropriate labels and formatting
- For pie/bar/line charts: extract numeric data and categories
- For flowcharts: infer logical flow from data structure
- For ER diagrams: identify entities and relationships
- For sequence diagrams: extract actors and message flows
- Only output the Mermaid code, no explanations or markdown fences

Mermaid ${diagramType} code:`;

        const { text: mermaidCode } = await generateText({
            model: google(modelName),
            prompt: prompt,
            maxTokens: 3000,
        });
        
        return mermaidCode.trim();
    }

    async ensureMermaidSyntax(diagramType, definition) {
        // Check if definition already looks like Mermaid syntax
        const mermaidKeywords = ['graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 
                                  'stateDiagram', 'gantt', 'pie', 'erDiagram', '%%{'];
        
        const trimmedDef = definition.trim();
        const hasKeyword = mermaidKeywords.some(kw => trimmedDef.startsWith(kw));
        
        if (hasKeyword) {
            return definition;
        }
        
        // If not, use LLM to convert natural language to Mermaid
        this.streamProgress(`🤖 Converting description to Mermaid syntax...`);
        
        const modelName = process.env.AGENT_MODEL || "gemini-2.0-flash-exp";
        
        const diagramExamples = {
            'flowchart': 'flowchart TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Action]\n    B -->|No| D[Alternative]',
            'sequence': 'sequenceDiagram\n    participant A as Actor\n    participant B as System\n    A->>B: Request\n    B->>A: Response',
            'pie': 'pie title Distribution\n    "Category A" : 45\n    "Category B" : 30\n    "Category C" : 25',
            'gantt': 'gantt\n    title Project Timeline\n    dateFormat YYYY-MM-DD\n    section Phase 1\n    Task 1 :2024-01-01, 30d',
        };
        
        const exampleHint = diagramExamples[diagramType] || '';
        
        const prompt = `Convert the following description into valid Mermaid.js ${diagramType} syntax.
Only output the Mermaid code, nothing else. No markdown code fences, just the raw Mermaid syntax.

${exampleHint ? `Example ${diagramType} format:\n${exampleHint}\n\n` : ''}Description: ${definition}

Mermaid ${diagramType} code:`;

        const { text: mermaidCode } = await generateText({
            model: google(modelName),
            prompt: prompt,
            maxTokens: 2000,
        });
        
        return mermaidCode.trim();
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
    //new GoogleSearchTool(),
    new YouComSearchTool(),
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
 * Build a Vercel AI SDK tools map from our class tools.
 * Keeps backward compatibility while enabling ai.tool usage.
 * @param {string} sessionId - Session identifier
 * @param {function} progressCallback - Optional callback for streaming progress messages
 */
export function buildAiTools(sessionId = null, progressCallback = null) {
    // Fresh instances so session-aware tools receive sessionId
    let instances = [
        new WorkspaceReaderTool(sessionId),
        new FileDownloaderTool(sessionId),
        //new GoogleSearchTool(),
        new YouComSearchTool(),
        new GoogleScholarSearchTool(),
        new VisitWebpageTool(),
        new VisualizerTool(sessionId),
        new DiagramGeneratorTool(sessionId),
        new DataAnalysisTool(sessionId),
        getGlobalLinuxVMTool(), // Use the global singleton instance
    ];


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
    //GoogleSearchTool,
    YouComSearchTool,
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