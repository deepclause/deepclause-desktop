#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { glob } from 'glob';
import { globSync } from 'glob';
import crypto from 'crypto';
import SWIPL from '../vendor/swipl-wasm/dist/index.js';

import { z } from 'zod';
import { tool, generateText, streamText, stepCountIs } from 'ai';

import { runDmlAsync, questionToProlog, richPrint, init as initBridge, shutdownMcpClients, getToolsDescription, getGlobalTools } from './dml-js/bridge.js';
import { getAgentModelConfig, resolveProvider } from './config/models.js';
import { google } from '@ai-sdk/google';
import { analyzeDmlParameters, formatParametersInfo, readDmlFileContents, listDmlFiles } from './dml-js/dml-utils.js';
import { create } from 'domain';

// Configuration (models now configurable via settings.json + env overrides + provider)
const providerMap = {
    google: (m) => google(m),
};
const agentModelConfig = getAgentModelConfig();
const { name: AGENT_MODEL, temperature: AGENT_MODEL_TEMP } = agentModelConfig;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function printHeader() {
    console.log("");
    console.log("╔════════════════════════════════════════════════════════════════════════════════════╗");
    console.log("║                                                                                    ║");
    console.log("║  ██████╗ ███████╗███████╗██████╗  ██████╗██╗      █████╗ ██╗   ██╗███████╗███████╗ ║");
    console.log("║  ██╔══██╗██╔════╝██╔════╝██╔══██╗██╔════╝██║     ██╔══██╗██║   ██║██╔════╝██╔════╝ ║");
    console.log("║  ██║  ██║█████╗  █████╗  ██████╔╝██║     ██║     ███████║██║   ██║███████╗█████╗   ║");
    console.log("║  ██║  ██║██╔══╝  ██╔══╝  ██╔═══╝ ██║     ██║     ██╔══██║██║   ██║╚════██║██╔══╝   ║");
    console.log("║  ██████╔╝███████╗███████╗██║     ╚██████╗███████╗██║  ██║╚██████╔╝███████║███████╗ ║");
    console.log("║  ╚═════╝ ╚══════╝╚══════╝╚═╝      ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝ ║");
    console.log("║                                                                                    ║");
    console.log("║                   🧠 Vibe code your LLM workflows with neurosymbolic AI 🔗         ║");
    console.log("║                                                                                    ║");
    console.log("║                              v1.0.0 | Agent Mode                                   ║");
    console.log("║                                                                                    ║");
    console.log("╚════════════════════════════════════════════════════════════════════════════════════╝");
    console.log("");
    console.log("Welcome to DeepClause - A Neurosymbolic AI System");
    console.log("Type 'quit' or 'exit' to exit the agent mode");
    console.log("");
}


function createConsoleInputCallback(existingRl = null) {
    return async function(prompt) {
        return new Promise((resolve) => {
            const p = "\n"+prompt+" > " || "Enter input: ";   
            if (existingRl) {
                existingRl.question(p, (answer) => {
                    resolve(answer);
                });
            }
        });
    };
}

/**
 * Tool: Execute DML code asynchronously
 */
async function runDml(dmlCode, parameters = "{}") {
    try {
        const paramsDict = safeParseJson(parameters, {});
        return await runDmlCode(dmlCode, {
            params: paramsDict,
            sessionPrefix: 'agent',
            on_output:  swiplOutputHandler,
            collect: true,
            rich: true,
            echo: true,
        });
    } catch (error) {
        return `Error executing DML: ${error.message}`;
    }
}

/**
 * Tool: Generate DML code from a natural language prompt
 */
async function generateDmlFromPrompt(prompt) {
    try {

        // Generate DML code
        let generatedCode = null;
        let errorMsg = null;

        const swipl = await SWIPL({ 
            arguments: ["-q"], 
            on_output: (line) => {} 
        });

        // Initialize cooperative execution engine using SWIPL
        const initQuery = `
            use_module(library(clpfd)),
            use_module(library(clpr)),
            use_module(library(readutil)),
            use_module(library(quasi_quotations)),
            use_module(library(strings)),
            use_module(library(lists)).
        `;


        // Initialize cooperative execution engine
        const initResult = await swipl.prolog.query(initQuery).next();

        if (!initResult || initResult.value.Success == 'false') {
                const errorMsg = initResult?.value?.Error || 'Unknown initialization error';
                const msg = `Failed to initialize prolog: ${errorMsg}\n`;
                return;
            }

        // Use the questionToProlog function from bridge
        for await (const result of questionToProlog(prompt, 0, "./dml_examples", swipl, 3)) {
            if (typeof result === 'object') {
                if ('code' in result) {
                    generatedCode = result.code;
                    break;
                } else if ('error' in result) {
                    errorMsg = result.error;
                }
            } else if (typeof result === 'string') {
                // This is intermediate output, we can ignore it for the tool
                richPrint(result)
                continue;
            }
        }

        if (generatedCode) {
            return generatedCode;
        } else if (errorMsg) {
            return `Error generating DML: ${errorMsg}`;
        } else {
            return "Error: No DML code was generated";
        }

    } catch (error) {
        return `Error generating DML from prompt: ${error.message}`;
    }
}

// DML parameter analysis and formatting are now imported from dml-utils.js

/**
 * Tool: Analyze a DML file
 */
async function analyzeDmlFile(filename) {
    try {
        const { filename: fname, content } = readDmlExample(filename);

        // Extract parameters
        const parameters = analyzeDmlParameters(content);

        // Basic structure analysis
        const lines = content.split('\n');
        const commentLines = lines.filter(line => line.trim().startsWith('%'));
        const ruleLines = lines.filter(line => line.includes(':-') && !line.trim().startsWith('%'));

        let analysis = `Analysis of ${fname}:\n\n`;

        // File statistics
        analysis += `File size: ${content.length} characters, ${lines.length} lines\n`;
        analysis += `Comments: ${commentLines.length} lines\n`;
        analysis += `Rules: ${ruleLines.length} lines\n\n`;

        // Parameters
        if (parameters.length > 0) {
            analysis += "Parameters:\n";
            for (const param of parameters) {
                analysis += `  • ${param.key}: ${param.description}\n`;
            }
            analysis += "\n";
        } else {
            analysis += "Parameters: None defined\n\n";
        }

        // Main comments (first few comment lines often contain description)
        if (commentLines.length > 0) {
            analysis += "Description (from comments):\n";
            for (let i = 0; i < Math.min(5, commentLines.length); i++) {
                const cleanLine = commentLines[i].trim().replace(/^%/, '').trim();
                if (cleanLine) {
                    analysis += `  ${cleanLine}\n`;
                }
            }
            analysis += "\n";
        }

        return analysis;
    } catch (error) {
        return `Error analyzing DML file: ${error.message}`;
    }
}

/**
 * Tool: Read the contents of a DML file
 */
async function readDmlFile(filename) {
    try {
        const { filename: fname, content } = readDmlExample(filename);
        const parameters = analyzeDmlParameters(content);
        let result = `Contents of ${fname}:\n${"=".repeat(50)}\n\n`;
        if (parameters.length > 0) result += formatParametersInfo(parameters) + "\n\n";
        result += content;
        return result;
    } catch (error) {
        return `Error reading DML file: ${error.message}`;
    }
}

/**
 * Tool: Run a DML file from the dml_examples directory
 */
async function runDmlFileTool(filename, parameters = "{}") {
    try {
        const { content } = readDmlExample(filename);
        const paramsDict = safeParseJson(parameters, {});
        return await runDmlCode(content, {
            params: paramsDict,
            sessionPrefix: 'tool',
            collect: true,
            rich: true,
            echo: true,
        });
    } catch (error) {
        return `Error running DML file: ${error.message}`;
    }
}

/**
 * Tool: List all available DML files
 */
async function listDmlFilesTool() {
    try {
        const pattern = path.join(DML_EXAMPLES_DIR, "*.dml");
        const dmlFiles = glob.sync(pattern);

        if (dmlFiles.length === 0) {
            return "No DML files found in dml_examples directory";
        }

        let result = "Available DML files:\n\n";
        for (const filepath of dmlFiles.sort()) {
            const filename = path.basename(filepath);

            // Read and analyze the DML file
            let parameters = [];
            try {
                const content = fs.readFileSync(filepath, 'utf-8');
                parameters = analyzeDmlParameters(content);
            } catch (error) {
                // Continue with empty parameters
            }

            // Look for corresponding description file
            const descFilename = filename.replace('.dml', '.txt');
            const descFilepath = path.join(DML_EXAMPLES_DIR, descFilename);

            let description = "";
            if (fs.existsSync(descFilepath)) {
                try {
                    description = fs.readFileSync(descFilepath, 'utf-8').trim();
                    // Limit description to first line or 100 characters
                    if (description.includes('\n')) {
                        description = description.split('\n')[0];
                    }
                    if (description.length > 100) {
                        description = description.substring(0, 97) + "...";
                    }
                } catch (error) {
                    description = `(Error reading description: ${error.message})`;
                }
            } else {
                description = "(No description available)";
            }

            result += `📄 ${filename}\n`;
            result += `   Description: ${description}\n`;

            if (parameters.length > 0) {
                result += `   Parameters:\n`;
                for (const param of parameters) {
                    result += `     • ${param.key}: ${param.description}\n`;
                }
            } else {
                result += `   Parameters: None\n`;
            }

            result += "\n";
        }

        return result;
    } catch (error) {
        return `Error listing DML files: ${error.message}`;
    }
}

// ===== Shared constants & helpers (moved up to avoid TDZ issues) =====
const DML_EXAMPLES_DIR = "./dml_examples";
const WORKSPACE_DIR = "./workspace";

// Add global flag to track DML execution state
let isDmlExecuting = false;
let currentDmlAbortController = null;

function ensureDml(name) {
    return name.endsWith('.dml') ? name : `${name}.dml`;
}
function buildSessionId(prefix) {
    return `${prefix}_${new Date().toISOString().replace(/[:.]/g, '_')}_${crypto.randomBytes(4).toString('hex')}`.replaceAll('-', '_');
}
function safeParseJson(str, fallback = {}) {
    try { return JSON.parse(str); } catch { return fallback; }
}
function swiplOutputHandler(line) {
    if (process.env.DEBUG) {
        console.log("SWI-Prolog Output:", line);
    }
}
function readDmlExample(filename) {
    const fname = ensureDml(filename);
    const filepath = path.join(DML_EXAMPLES_DIR, fname);
    if (!fs.existsSync(filepath)) throw new Error(`File not found: ${filepath}`);
    return { filepath, content: fs.readFileSync(filepath, 'utf-8'), filename: fname };
}
async function runDmlCode(dmlCode, {
    params = {},
    sessionPrefix = 'session',
    on_output = swiplOutputHandler,
    inputCallback = null,
    collect = true,
    rich = true,
    echo = false,
    memory = [],
} = {}) {
    const sessionId = buildSessionId(sessionPrefix);
    const swipl = await SWIPL({ arguments: ["-q"], on_output });
    console.log("SWI-Prolog initialized");

    // Track execution state
    isDmlExecuting = true;
    currentDmlAbortController = new AbortController();

    // --- new: lightweight spinner for CLI feedback ---
    const useSpinner = Boolean(process.stdout.isTTY && echo);
    const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
    let spinnerTimer = null;
    let spinnerIdx = 0;
    let spinnerPaused = false;

    function drawSpinner() {
        if (spinnerPaused) return;
        const frame = frames[spinnerIdx = (spinnerIdx + 1) % frames.length];
        try {
            process.stdout.write(`\r${frame} DML Execution in progress...`);
        } catch {}
    }
    function startSpinner() {
        if (!useSpinner || spinnerTimer) return;
        spinnerTimer = setInterval(drawSpinner, 80);
    }
    function pauseSpinner() {
        if (!useSpinner) return;
        spinnerPaused = true;
        try {
            if (process.stdout.clearLine) process.stdout.clearLine(0);
            if (process.stdout.cursorTo) process.stdout.cursorTo(0);
        } catch {}
    }
    function resumeSpinner() {
        if (!useSpinner) return;
        spinnerPaused = false;
    }
    function stopSpinner() {
        if (spinnerTimer) {
            clearInterval(spinnerTimer);
            spinnerTimer = null;
        }
        if (useSpinner) {
            try {
                if (process.stdout.clearLine) process.stdout.clearLine(0);
                if (process.stdout.cursorTo) process.stdout.cursorTo(0);
                process.stdout.write('\r');
            } catch {}
        }
    }
    // --- end spinner ---

    const lines = [];
    try {
        startSpinner();
        for await (const line of runDmlAsync(dmlCode, sessionId, params, WORKSPACE_DIR, swipl, inputCallback, memory)) {
            // Check if execution was aborted
            if (currentDmlAbortController.signal.aborted) {
                stopSpinner();
                console.log('\n⚠️  DML execution stopped');
                break;
            }
            
            pauseSpinner(); // Pause before any output

            const isInputPrompt = typeof line === 'string' && line.includes('<input>');

            if (collect) lines.push(line);
            if (rich && echo) richPrint(line);
            else if (echo) console.log(line);

            // Do not resume spinner if we are waiting for user input.
            // The input callback will be awaited inside runDmlAsync in the next iteration.
            if (!isInputPrompt) {
                resumeSpinner(); // Resume after output
            }
        }
    } catch (error) {
        if (!currentDmlAbortController.signal.aborted) {
            throw error;
        }
    } finally {
        stopSpinner();
        isDmlExecuting = false;
        currentDmlAbortController = null;
    }
    return collect ? lines.join('') : undefined;
}
// ===== End helpers =====

/**
 * DML Agent class
 */
class DMLAgent {
    constructor() {
        this.tools = { runDml, readDmlFile, runDmlFileTool, listDmlFilesTool, analyzeDmlFile, generateDmlFromPrompt };
        this.lastGeneratedDml = null;
        this.lastExecutedDml = null;
        this.lastExecutedDmlFile = null;
        this.lastExecutedOutput = null;
        this.dmlExamplesDir = DML_EXAMPLES_DIR;

        // Ensure dml_examples directory exists
        if (!fs.existsSync(this.dmlExamplesDir)) {
            fs.mkdirSync(this.dmlExamplesDir, { recursive: true });
        }

        // Setup readline interface
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: 'DeepClause Agent> ',
            completer: this.completer.bind(this)
        });

        // Handle Ctrl+D (EOF) to exit
        this.rl.on('close', () => {
            if (!isDmlExecuting) {
                console.log('\n\nGoodbye!');
                process.exit(0);
            }
        });

        // Setup global SIGINT handler
        this.rl.on('SIGINT', () => {
            if (isDmlExecuting && currentDmlAbortController) {
                console.log('\n\n⚠️  Interrupting DML execution (Ctrl+C)...');
                currentDmlAbortController.abort();
                console.log("\n\nPress Ctrl+D to exit, or type '/quit' to exit gracefully.");
                this.rl.prompt();
            }
        });

        // Setup history
        this.setupHistory();
    }

    setupHistory() {
        try {
            const historyFile = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.deepclause_agent_history');

            // Read existing history
            if (fs.existsSync(historyFile)) {
                const history = fs.readFileSync(historyFile, 'utf-8').split('\n').filter(line => line.trim());
                this.rl.history = history.reverse(); // readline expects reverse order
            }

            // Save history on exit
            process.on('exit', () => {
                try {
                    const history = this.rl.history.slice().reverse().slice(0, 1000); // Keep last 1000 entries
                    fs.writeFileSync(historyFile, history.join('\n'));
                } catch (error) {
                    console.error('Warning: Could not save command history:', error.message);
                }
            });

        } catch (error) {
            console.log('Warning: Could not setup command history:', error.message);
        }
    }

    completer(line) {
        const completions = ['/help', '/quit', '/exit', '/save', '/run', '/list', '/create', '/explain'];
        
        // Get the current command
        const parts = line.trim().split(' ');
        
        if (!parts[0] || parts[0] === '') {
            // Complete commands when nothing is typed
            const hits = completions.filter(c => c.startsWith(line));
            return [hits.length ? hits : completions, line];
        }

        if (parts[0] === '/run' || parts[0] === '/save') {
            // Complete DML filenames
            if (parts.length === 1 || (parts.length === 2 && !line.endsWith(' '))) {
                try {
                    const dmlFiles = globSync(path.join(this.dmlExamplesDir, "*.dml"));
                    const filenames = dmlFiles.map(f => path.basename(f));
                    const baseNames = filenames.map(f => f.replace('.dml', ''));
                    const allNames = [...filenames, ...baseNames];
                    
                    const searchTerm = parts[1] || '';
                    const hits = allNames.filter(name => name.startsWith(searchTerm));
                    return [hits, searchTerm];
                } catch (error) {
                    return [[], line];
                }
            }
        }

        const hits = completions.filter(c => c.startsWith(parts[0]));
        return [hits, parts[0]];
    }

    displayHelp() {
        const helpText = `
Available commands:
- help: Show this help message
- quit/exit: Exit the agent
- /create <description>: Generate new DML code from description
- /create:[filename]: Generate new DML code from prompt stored in a file
- /save <filename>: Save last generated DML to dml_examples directory
- /run <filename>: Run a DML file from dml_examples directory
- /explain: Explain the last executed DML file in simple, non-technical terms
- /list: List all DML files in dml_examples directory
- Any other input: Will be processed by the AI agent to create, find and execute existing DML files

Tab completion is available for commands and filenames.
Command history is saved between sessions.

File locations for /create:[filename]:
- Direct path (e.g., /create:my_prompt.txt)
- ./workspace/filename
- ./dml_examples/filename
- Current directory
- Automatically tries .txt extension if not provided

The agent will analyze your request and try to solve it using existing DML files.
Use /create only when you need to generate completely new DML code.

The /explain command provides a detailed, non-technical explanation of:
- What the last executed DML program was designed to do
- How it worked step-by-step
- Which decisions were made by symbolic logic vs AI/LLM
- What the final result means

Examples:
- "Search for information about Python" (agent will find and DML files that do some form of search)
- "Analyze this document" (agent will use any existing analysis like  DML files)
- "Extract tables from a webpage" (agent will try to find table extraction DML)
- "/create a DML that sends emails"
- "/create:my_prompt.txt" (reads prompt from file)
- "/save my_script.dml"
- "/run my_script.dml"
- "/explain"
- "/list"
`;
        console.log(helpText);
    }

    async createDml(description) {
        if (!description) {
            console.log("❌ Usage: /create <description>");
            return;
        }

        console.log(`\n🔧 Generating new DML code for: ${description}\n`);
        //console.log("-".repeat(50));

        try {
            const generatedCode = await generateDmlFromPrompt(description);
            
            if (generatedCode && !generatedCode.startsWith('Error')) {
                console.log("\n✅ DML code generated successfully!");
                console.log("-".repeat(50));
                console.log(generatedCode);
                console.log("-".repeat(50));
                this.trackGeneratedDml(generatedCode);
            } else {
                console.log(`\n❌ ${generatedCode}`);
            }

        } catch (error) {
            console.log(`\n❌ Error generating DML: ${error.message}`);
        }
    }

    async createDmlFromFile(filename) {
        if (!filename) {
            console.log("❌ Usage: /create:[filename]");
            return;
        }

        // Try different possible locations for the file
        const possiblePaths = [
            filename,
            path.join("./workspace", filename),
            path.join("./dml_examples", filename),
            path.join(".", filename)
        ];

        // Add .txt extension if not present and try again
        if (!filename.endsWith('.txt')) {
            const txtFilename = filename + '.txt';
            possiblePaths.push(
                txtFilename,
                path.join("./workspace", txtFilename),
                path.join("./dml_examples", txtFilename),
                path.join(".", txtFilename)
            );
        }

        // Try to find and read the file
        let fileContent = null;
        let usedPath = null;

        for (const filePath of possiblePaths) {
            try {
                if (fs.existsSync(filePath)) {
                    fileContent = fs.readFileSync(filePath, 'utf-8').trim();
                    usedPath = filePath;
                    break;
                }
            } catch (error) {
                continue;
            }
        }

        if (fileContent === null) {
            console.log(`❌ File not found: ${filename}`);
            console.log("   Searched in: workspace/, dml_examples/, and current directory");
            console.log("   Tried extensions: .txt");
            return;
        }

        if (!fileContent) {
            console.log(`❌ File is empty: ${usedPath}`);
            return;
        }

        console.log(`📖 Reading prompt from: ${usedPath}`);
        console.log(`📝 Prompt content:`);
        console.log("-".repeat(50));
        console.log(fileContent);
        console.log("-".repeat(50));
        console.log();

        // Generate DML using the file content as the prompt
        await this.createDml(fileContent);
    }

    saveDml(filename) {
        if (!this.lastGeneratedDml) {
            console.log("❌ No DML code to save. Generate some DML first.");
            return;
        }

        // Ensure filename has .dml extension
        if (!filename.endsWith('.dml')) {
            filename += '.dml';
        }

        const filepath = path.join(this.dmlExamplesDir, filename);

        try {
            fs.writeFileSync(filepath, this.lastGeneratedDml);
            console.log(`✅ DML saved to ${filepath}`);
        } catch (error) {
            console.log(`❌ Error saving DML: ${error.message}`);
        }
    }

    async runDmlFile(filename) {
        try {
            const { filename: fname, content } = readDmlExample(filename);
            console.log(`🚀 Running DML file: ${fname}`);
            console.log("-".repeat(40));
            const output = await runDmlCode(content, {
                params: {},
                sessionPrefix: 'file',
                on_output: swiplOutputHandler,
                inputCallback: createConsoleInputCallback(this.rl),
                collect: true,
                rich: true,
                echo: true,
            });
            
            // Track execution for /explain command
            this.lastExecutedDml = content;
            this.lastExecutedDmlFile = fname;
            this.lastExecutedOutput = output;
            
            console.log("-".repeat(40));
            console.log("✅ DML execution completed");
        } catch (error) {
            console.log(`❌ Error running DML file: ${error.message}`);
        }
    }

    async listDmlFiles() {
        try {
            const result = await listDmlFilesTool();
            console.log(result);
        } catch (error) {
            console.log(`❌ Error listing DML files: ${error.message}`);
        }
    }

    trackGeneratedDml(dmlCode) {
        this.lastGeneratedDml = dmlCode;
        console.log(`💾 DML code tracked (use '/save <filename>' to save)`);
    }

    async explainLastExecution() {
        if (!this.lastExecutedDml || !this.lastExecutedOutput) {
            console.log('❌ No DML execution to explain. Please run a DML file first using /run <filename>.');
            return;
        }

        try {
            console.log('\n🔍 Generating explanation...\n');
            
            const dmlFile = this.lastExecutedDmlFile || 'unknown';
            const dmlCode = this.lastExecutedDml;
            const output = this.lastExecutedOutput;

            // Truncate if too long to avoid context overflow
            const MAX_DML_LENGTH = 8000;
            const MAX_OUTPUT_LENGTH = 8000;
            const truncatedDml = dmlCode.length > MAX_DML_LENGTH 
                ? dmlCode.slice(0, MAX_DML_LENGTH) + '\n...[truncated]...'
                : dmlCode;
            const truncatedOutput = output.length > MAX_OUTPUT_LENGTH
                ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n...[truncated]...'
                : output;

            const explanationPrompt = `You are an expert at explaining technical AI and logic programming concepts to non-technical users.

Your task is to analyze a DML (DeepClause Meta Language) program execution and explain what happened in simple terms that anyone can understand.

**DML File:** ${dmlFile}

**DML Code:**
\`\`\`prolog
${truncatedDml}
\`\`\`

**Execution Output:**
\`\`\`
${truncatedOutput}
\`\`\`

Please provide a clear, non-technical explanation that covers:

1. **What the program was designed to do** - Explain the goal in simple terms
2. **The execution flow** - Walk through what happened step by step
3. **Decision points** - Clearly identify and explain:
   - Decisions made by **symbolic logic** (traditional programming rules, if-then logic, data processing)
   - Decisions made by **AI/LLM constructs** (calls to language models, natural language understanding, @ predicates that use AI)
4. **The final result** - What was accomplished and why it matters

Use analogies and simple language. Avoid jargon. When you must use technical terms, explain them.
Make it engaging and educational for someone who doesn't know programming or AI.

Format your response in clear sections with headers.`;

            const { text: explanation } = await generateText({
                model: resolveProvider(getAgentModelConfig(), providerMap),
                prompt: explanationPrompt,
                maxTokens: 2000,
                temperature: AGENT_MODEL_TEMP || 0.7,
            });

            console.log('\n' + '='.repeat(60));
            console.log('EXECUTION EXPLANATION');
            console.log('='.repeat(60) + '\n');
            console.log(explanation);
            console.log('\n' + '='.repeat(60) + '\n');

        } catch (error) {
            console.log(`❌ Error generating explanation: ${error.message}`);
        }
    }

    async processNaturalLanguageInput(input) {
        console.log("\n🤖 Running agent...");
        
        // Track agent execution state
        isDmlExecuting = true;
        currentDmlAbortController = new AbortController();
        
        try {
            const today = new Date().toISOString().split('T')[0];
            const systemPrompt = [
                `Today is ${today}.`,
                'You are a DML (DeepClause Meta Language) assistant and workflow orchestrator.',
                'Your primary job is to analyze user requests and solve them using existing DML files or creating new ones.',
                'When you have created a DML file you may also save it for later if it worked well.',
                'Start by using list_dml_files_tool to see what DML files are available with their parameters.',
                'Use analyze_dml_file to get detailed information about specific DML files including their parameters.',
                'Then read the contents of relevant files using read_dml_file to understand what they do.',
                'Create a plan of which DML files to run and in what order to solve the user\'s request.',
                'Create a new DML file if neccesary, but keep each DML file\'s purpose focused and simple.',
                'Execute the plan by running the appropriate DML files using run_dml_file_tool.',
                'If multiple files are needed, run them in logical sequence.',
                'When running DML files, you can pass parameters as a JSON object in the params field.',
                'The DML files use param(Key, Description, Value) predicates to define their parameters.',
                'Match the parameter keys from the DML analysis to provide the correct parameter values.',
                'For example: run_dml_file_tool("search.dml", {"query": "Python programming", "max_results": 5})',
                'Always check what parameters a DML file expects using analyze_dml_file before running it.',
                //'If no existing DML files can solve the problem, inform the user they should use "/create <description>" to generate new DML.',
                'Always explain your reasoning and show which DML files you\'re using and why.',
                'Focus on composing solutions from existing building blocks rather than creating new ones.',
              
            ].join('\n');

            const tools = {
                list_dml_files_tool: tool({
                    description: "List all available DML files with brief metadata",
                    inputSchema: z.object({}),

                    execute: async () => ({ listing: await listDmlFilesTool() })
                }),
                analyze_dml_file: tool({
                    description: "Analyze a specific DML file (parameters, comments, structure)",
                    inputSchema: z.object({ filename: z.string() }),
                    execute: async ({ filename }) => ({ analysis: await analyzeDmlFile(filename) })
                }),
                read_dml_file: tool({
                    description: "Read full contents of a DML file (truncated if large)",
                    inputSchema: z.object({ filename: z.string() }),
                    execute: async ({ filename }) => {
                        const out = await readDmlFile(filename);
                        return { content: out.length > 6000 ? out.slice(0,6000) + '\n...[truncated]...' : out };
                    }
                }),
                run_dml_file_tool: tool({
                    description: "Execute a DML file with optional params object",
                    inputSchema: z.object({ filename: z.string(), params: z.record(z.any()).optional() }),
                    execute: async ({ filename, params }) => {
                        const result = await runDmlFileTool(filename, params ? JSON.stringify(params) : '{}');
                        
                        // Track the last executed DML for /explain command
                        try {
                            const { content } = readDmlExample(filename);
                            this.lastExecutedDml = content;
                            this.lastExecutedDmlFile = filename;
                            this.lastExecutedOutput = result;
                        } catch (err) {
                            // Continue even if tracking fails
                        }
                        
                        return { runOutput: result.length > 8000 ? result.slice(0,8000) + '\n...[truncated]...' : result };
                    }
                }),
                create_dml_from_prompt: tool({
                    description: "Generate new DML code from a natural language prompt",
                    inputSchema: z.object({ prompt: z.string() }),
                    execute: async ({ prompt }) => {
                        const code = await generateDmlFromPrompt(prompt);
                        if (code.startsWith('Error')) {
                            return { code: null, error: code };
                        }
                        this.trackGeneratedDml(code);
                        return { code };
                    }
                }),
                save_last_dml: tool({
                    description: "Save the last generated DML code to a file in dml_examples directory",
                    inputSchema: z.object({ filename: z.string() }),
                    execute: async ({ filename }) => {
                        if (!this.lastGeneratedDml) {
                            return { success: false, message: "No DML code to save." };
                        }
                        // Ensure filename has .dml extension
                        if (!filename.endsWith('.dml')) {
                            filename += '.dml';
                        }
                        const filepath = path.join(this.dmlExamplesDir, filename);
                        try {
                            fs.writeFileSync(filepath, this.lastGeneratedDml);
                            return { success: true, message: `DML saved to ${filepath}` };
                        } catch (error) {
                            return { success: false, message: `Error saving DML: ${error.message}` };
                        }
                    }
                }),
            };

            let result;
            try {
                result = await streamText({
                    model: resolveProvider(agentModelConfig, { google: (m) => google(m) }),
                    system: systemPrompt,
                    prompt: `User request:\n${input}`,
                    stopWhen: stepCountIs(10),
                    tools,
                    temperature: AGENT_MODEL_TEMP,
                    abortSignal: currentDmlAbortController.signal
                });

                for await (const chunk of result.fullStream) {
                    // Check if execution was aborted
                    if (currentDmlAbortController.signal.aborted) {
                        console.log('\n⚠️  Agent processing stopped');
                        break;
                    }
                    
                    if (chunk.type === 'text-delta') {
                        richPrint(chunk.text);
                    }

                    if (chunk.type === 'tool-call') {
                        richPrint('\nCalling tool  ' +  chunk.toolName + ' with parameters:\n');
                        richPrint(JSON.stringify(chunk.input));
                    }

                    if (chunk.type === 'tool-result') {
                        richPrint('\nTool result:', chunk.output?.listing || '');
                    }
                }
            } catch (e) {
                if (currentDmlAbortController.signal.aborted) {
                    console.log('\n⚠️  Agent processing was interrupted');
                } else {
                    richPrint(`❌ Model/tool orchestration failed: ${e.message}`);
                }
                return;
            }

            if (!currentDmlAbortController.signal.aborted) {
                richPrint("\n\n✅ Agent processing completed.");
            }
        } finally {
            isDmlExecuting = false;
            currentDmlAbortController = null;
        }
    }

    async runInteractive() {
        printHeader();

        console.log("Initializing DeepClause Agent...");
        console.log("Agent is ready! Describe what you want to do and I'll create or find the right DML files to help.");
        console.log("Type 'help' for more information or 'quit' to exit.");
        console.log("Tab completion and command history are enabled.");
        console.log("Press Ctrl+C during DML execution to stop it, or Ctrl+D to exit.");
        console.log();
        console.log("All available commands:");
        console.log("- help: Show  help message");
        console.log("- quit/exit: Exit the agent");
        console.log("- /create <description>: Generate new DML code from description");
        console.log("- /create:[filename]: Generate new DML code from prompt stored in a file");
        console.log("- /save <filename>: Save last generated DML to dml_examples directory");
        console.log("- /run <filename>: Run a DML file from dml_examples directory");
        console.log("- /explain: Explain the last executed DML in simple terms");
        console.log("- /list: List all DML files in dml_examples directory");
        console.log("- Any other input: Will be processed by the AI agent to find and execute existing DML files");
        console.log();

        return new Promise((resolve) => {
            this.rl.prompt();

            this.rl.on('line', async (input) => {
                const userInput = input.trim();

                try {
                    // Handle special commands
                    if (['quit', 'exit', '/quit', '/exit', '/q'].includes(userInput.toLowerCase())) {
                        console.log("Goodbye!");
                        this.rl.close();
                        resolve();
                        process.exit(0);
                        return;
                    } else if (['help', '/help', '/h', '/?'].includes(userInput.toLowerCase())) {
                        this.displayHelp();
                    } else if (userInput.startsWith('/create')) {
                        if (userInput.includes(':') && userInput.startsWith('/create:')) {
                            // Handle /create:[file] syntax
                            const filePart = userInput.substring(8); // Remove '/create:' prefix
                            if (!filePart) {
                                console.log("❌ Usage: /create:[filename] or /create <description>");
                            } else {
                                await this.createDmlFromFile(filePart);
                            }
                        } else {
                          const parts = userInput.split(' ');
                          if (parts.length < 2) {
                            console.log("❌ Usage: /create <description> or /create:[filename]");
                          } else {
                            const description = parts.slice(1).join(' ');
                            await this.createDml(description);
                          }
                        }
                    } else if (userInput.startsWith('/save')) {
                        const parts = userInput.split(' ');
                        if (parts.length < 2) {
                            console.log("❌ Usage: /save <filename>");
                        } else {
                            this.saveDml(parts[1]);
                        }
                    } else if (userInput.startsWith('/run')) {
                        const parts = userInput.split(' ');
                        if (parts.length < 2) {
                            console.log("❌ Usage: /run <filename>");
                        } else {
                            await this.runDmlFile(parts[1]);
                        }
                    } else if (userInput.toLowerCase() === '/explain') {
                        await this.explainLastExecution();
                    } else if (userInput.toLowerCase() === '/list') {
                        await this.listDmlFiles();
                    } else if (userInput) {
                        await this.processNaturalLanguageInput(userInput);
                    }
                    console.log();
                    this.rl.prompt();
                } catch (error) {
                    console.log(`\n❌ Unexpected error: ${error.message}`);
                    this.rl.prompt();
                }
            });

            this.rl.on('close', () => resolve());
        });
    }
}

// ===== Main entry point =====
async function main() {
    try {
        await initBridge();
    } catch (e) {
        console.error(`Warning: MCP initialization failed: ${e.message}`);
    }
    const agent = new DMLAgent();
    await agent.runInteractive();
    try { await shutdownMcpClients(); } catch {}
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}


export { DMLAgent, main };
