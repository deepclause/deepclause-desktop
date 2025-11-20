import fs from 'fs';
import path from 'path';
import { glob } from 'glob';
import { globSync } from 'glob';
import crypto from 'crypto';
import { execSync } from 'child_process';
import SWIPL from '../../../vendor/swipl-wasm/dist/index.js';
import { z } from 'zod';
import { tool, generateText, streamText, stepCountIs, hasToolCall } from 'ai';
import { runDmlAsync, questionToProlog, richPrint, init as initBridge, shutdownMcpClients, getToolsDescription, getGlobalTools } from '../../dml-js/bridge.js';
import { getAgentModelConfig, resolveProvider } from '../../config/models.js';
import { google } from '@ai-sdk/google';
import { anthropic } from '@ai-sdk/anthropic';
import { openrouter } from '@openrouter/ai-sdk-provider';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { openai, createOpenAI } from '@ai-sdk/openai';
import { analyzeDmlParameters, formatParametersInfo, readDmlFileContents, listDmlFiles } from '../../dml-js/dml-utils.js';

// Configuration - lazily loaded
let agentModelConfig = null;
let AGENT_MODEL = null;
let AGENT_MODEL_TEMP = null;

const MAX_LENGTH_TRUNCATE_CONTENT = 300000;

function getAgentConfig() {
    if (!agentModelConfig) {
        agentModelConfig = getAgentModelConfig();
        AGENT_MODEL = agentModelConfig.name;
        AGENT_MODEL_TEMP = agentModelConfig.temperature;
    }
    return { name: AGENT_MODEL, temperature: AGENT_MODEL_TEMP };
}

// Provider adapter map used when resolving models so all providers are supported
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



function buildSessionId(prefix) {
    return `${prefix}_${new Date().toISOString().replace(/[:.]/g, '_')}_${crypto.randomBytes(4).toString('hex')}`.replaceAll('-', '_');
}

// DML Agent System Prompt
const DML_AGENT_SYSTEM_PROMPT = `<role>
You are a DeepClause, a neurosymbolic AI system created by the team from deepclause.ai.
Your primary job is to analyze user requests and solve them by creating and executing DML (Declarative Machine Language) files.
You have access to a library of existing DML files that you can analyze, read, and execute to fulfill user requests.
</role>

<background>
## 🧠 What is DeepClause?

**DeepClause** is a **neurosymbolic AI agent** that bridges the gap between symbolic reasoning and neural language models. Unlike pure LLM-based agents that struggle with complex logic, multi-step reasoning, and deterministic behavior, DeepClause uses **DML (DeepClause Meta Language)** - a Prolog-based DSL - to encode agent behaviors as executable logic programs.

### The Core Insight

Modern LLMs excel at natural language understanding but fail at:
- ✗ Deterministic execution (same input → same output)
- ✗ Complex logical reasoning (constraint solving, formal verification)
- ✗ Multi-step workflows with branching and backtracking
- ✗ Verifiable, inspectable decision-making

Traditional logic programming (Prolog) excels at these but lacks:
- ✗ Natural language understanding
- ✗ Semantic reasoning over unstructured text
- ✗ Flexible adaptation to novel tasks

**DeepClause combines both paradigms**: Prolog handles the logical scaffolding, control flow, and symbolic reasoning, while LLMs provide natural language understanding, semantic extraction, and content generation.
</background>

<capabilities>
You have access to the following tools:
- list_dml_files_tool: List all available DML files with brief metadata
- analyze_dml_file: Analyze a specific DML file (parameters, comments, structure)
- read_dml_file: Read full contents of a DML file
- run_dml_file_tool: Execute a DML file with optional parameters
- create_dml_from_prompt: Generate new DML code from a natural language prompt
- save_last_dml: Save the last generated DML code to a file
- explain_execution: Explain the last executed DML file in simple, non-technical terms
- final_answer: Provide your final answer and end the session
</capabilities>

<workflow>
0. INITIALIZATION PHASE
   - Greet the user and confirm their request
   - Clarify any ambiguities in the request before proceeding
   - Set up any necessary session state or context
   - Check if the request can be handled by existing context from previous messages and answer directly if so
   - Otherwise proceed to the discovery phase


1. DISCOVERY PHASE
   - Start by using list_dml_files_tool to see what DML files are available
   - Use analyze_dml_file to get detailed information about specific DML files
   - Use read_dml_file to understand the contents of relevant files

2. PLANNING PHASE
   - Create a plan of which DML files to create and run and in what order
   - Keep each DML file's purpose focused and simple
   - Focus on composing solutions from existing building blocks rather than creating new ones
   - Explain the plan and ask for permission before execution

3. EXECUTION PHASE
   - When running DML files, pass parameters as a JSON object in the params field
   - Match parameter keys from the DML analysis to provide correct parameter values
   - Example: run_dml_file_tool("search.dml", {"query": "Python programming", "max_results": 5})
   - Always check what parameters a DML file expects using analyze_dml_file before running it

4. REFLECTION PHASE
   - After each execution, analyze the output to see if further steps are needed
   - Always reflect on the current state after each step and decide the next best action
   - If multiple files are needed, run them in logical sequence
   - Modify newly created DML code in case the execution did not yield expected results

5. COMPLETION PHASE
   - When you have completed the task and have a final answer ready, use the final_answer tool
   - This will present your response and end the session
   - Do not use the explain tool unless explicitly asked by the user.
</workflow>

<dml_creation_guidelines>
When creating DML files:
- Use clear and concise prompts to describe what the DML should do
- Do not use reasoning in the prompt - just describe the task directly
- The create_dml_from_prompt tool has a powerful reasoning engine built-in
- Make sure the DML is relevant to the user's request and fits into the overall plan
- When you have created a DML file, you may save it for later if it worked well
- All DML files for this session will be saved in a session-specific subfolder
- Always inform the user about where files will be saved when you first save a DML
- Do not create DML that contains DML
- Use only natural language and pseudo code to describe the DML you want to create
- Prompts for dml file creation should be as precise as possible. If unclear, ask the user for clarification first.
- For questions that require complex reasoning, make it clear that you expect the DML to implement a hybrid approach with LLM fallback.
- For user request that involve complex workflows, such as e.g. web browsing, data analysis, or multi-step problem solving, make sure to formulate the DML prompt such that the resulting code uses fallbacks and alternative approaches whereever possible. Ensure robustness of the solution.
</dml_creation_guidelines>

<parameter_handling>
DML files use param(Key, Description, Value) predicates to define their parameters.
You must:
- Always check parameters using analyze_dml_file before running a DML file
- Match the exact parameter keys when passing values
- Provide values in the correct type (string, number, boolean, etc.)
- Parameters can have type suffixes:
  - :file - for file paths
  - :select(option1, option2, ...) - for single selection
  - :multiselect(option1, option2, ...) - for multiple selection
</parameter_handling>

<important_rules>
- Today's date is {date}
- Any user request that does not relate to your previous output should be treated as a complex request requiring DML execution or creation.
</important_rules>`;

function safeParseJson(str, fallback = {}) {
    try { return JSON.parse(str); } catch { return fallback; }
}

function swiplOutputHandler(line) {
    if (process.env.DEBUG) {
        console.log("SWI-Prolog Output:", line);
    }
}

function ensureDml(name) {
    return name.endsWith('.dml') ? name : `${name}.dml`;
}

/**
 * Convert dot notation (browser.find_trials) to file path (browser/find_trials.dml)
 */
function convertDotPathToFilePath(name) {
    // If the name already contains path separators or ends with .dml, just ensure .dml extension
    if (name.includes('/') || name.includes('\\')) {
        return ensureDml(name);
    }
    
    // Convert dots to path separators (but preserve .dml extension if present)
    if (name.endsWith('.dml')) {
        const nameWithoutExt = name.slice(0, -4);
        const pathName = nameWithoutExt.replace(/\./g, path.sep);
        return `${pathName}.dml`;
    }
    
    const pathName = name.replace(/\./g, path.sep);
    return ensureDml(pathName);
}

function readDmlExample(filename, dmlExamplesDir) {
    // dmlExamplesDir may be a string or an array of directories to search (learned + session)
    console.log("Reading DML example:", filename, "from", dmlExamplesDir);

    // Support both dot notation (browser.find_trials) and direct paths (browser/find_trials.dml)
    const fname = convertDotPathToFilePath(filename);

    const dirs = Array.isArray(dmlExamplesDir) ? dmlExamplesDir : [dmlExamplesDir];

    for (const dir of dirs) {
        try {
            const filepath = path.join(dir, fname);
            if (fs.existsSync(filepath)) {
                return { filepath, content: fs.readFileSync(filepath, 'utf-8'), filename: fname, baseDir: dir };
            }
        } catch (err) {
            continue;
        }
    }

    // If not found in any provided dirs, throw an error showing where we looked
    throw new Error(`File not found: ${fname} in any of: ${dirs.join(', ')}`);
}

async function runDmlCode(dmlCode, workspaceDir, {
    params = {},
    sessionPrefix = 'session',
    on_output = swiplOutputHandler,
    inputCallback = null,
    outputCallback = null,
    collect = true,
    rich = true,
    echo = false,
    memory = [],
    swipl = null,
    abortController = null,
} = {}) {
    const sessionId = buildSessionId(sessionPrefix);
    const shouldCleanupSwipl = !swipl;
    
    if (!swipl) {
        try {
            if (process.env.DML_DEV_MODE) {
                swipl = await SWIPL({ 
                    arguments: ["-q"], 
                    on_output: (line) => {
                        if (process.env.DEBUG) {
                            console.log(`SWI-Prolog:`, line);
                        }
                    }
                });
            } else {
                swipl = await SWIPL({ 
                    arguments: ["-x", "mi.qsave"], 
                    on_output: (line) => {
                        if (process.env.DEBUG) {
                            console.log(`SWI-Prolog:`, line);
                        }
                    },
                    preRun: [(module) => { 
                        console.log("[PRE-RUN] Loading mi.qsave into SWIPL filesystem");
                        const miData = fs.readFileSync(path.join(workspaceDir, 'mi.qsave'));
                        module.FS.writeFile('mi.qsave', miData); }
                    ]
                });
            }

        } catch (error) {
            console.error(`[ABORT] Error creating SWIPL instance for conversation ${conversationId}:`, error);
            throw error;
        }
    }

    const lines = ["\n\n<START OF TOOL OUTPUT FOR run_dml_file_tool>\n"];

    try {
        console.log(`[ABORT] Starting runDmlAsync with abort signal:`, abortController?.signal.aborted);
        for await (const line of runDmlAsync(dmlCode, sessionId, params, workspaceDir, swipl, inputCallback, memory, abortController?.signal)) {
            if (abortController?.signal.aborted) {
                console.log(`[ABORT] Abort detected in runDmlCode loop`);
                break;
            }
            if (collect) lines.push(line);
            if (echo) {
                //console.log(line);
            }
            // Stream output to frontend if callback is provided
            if (outputCallback && typeof outputCallback === 'function') {
                outputCallback(line);
            }
        }
    } catch (error) {
        if (!abortController?.signal.aborted) {
            throw error;
        }
    } finally {
        // Only cleanup if we created the SWIPL instance
        if (shouldCleanupSwipl && swipl) {
            // Optionally cleanup SWIPL resources here if needed
        }
        if (collect) {
            lines.push("\n<END OF TOOL OUTPUT FOR run_dml_file_tool>\n\n");
        }
    }
    return collect ? lines.join('') : undefined;
}

/**
 * Tool: Execute DML code asynchronously
 */
async function runDml(dmlCode, workspaceDir, parameters = "{}") {
    try {
        const paramsDict = safeParseJson(parameters, {});
        return await runDmlCode(dmlCode, workspaceDir, {
            params: paramsDict,
            sessionPrefix: 'agent',
            on_output: swiplOutputHandler,
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
async function generateDmlFromPrompt(prompt, dmlExamplesDir, outputCallback = null) {
    try {
        let generatedCode = null;
        let errorMsg = null;

        // Ensure bridge is initialized before proceeding (initializes GLOBAL_TOOLS)
        await initBridge();

        const swipl = await SWIPL({ 
            arguments: ["-q"], 
            on_output: (line) => {console.log(line)} 
        });

        const initQuery = `
            use_module(library(clpfd)),
            use_module(library(clpr)),
            use_module(library(readutil)),
            use_module(library(quasi_quotations)),
            use_module(library(strings)),
            use_module(library(lists)).
        `;

        const initResult = await swipl.prolog.query(initQuery).next();

        if (!initResult || initResult.value.Success == 'false') {
            const errorMsg = initResult?.value?.Error || 'Unknown initialization error';
            const msg = `Failed to initialize prolog: ${errorMsg}\n`;
            return msg;
        }
        
        // Stream initial status
        if (outputCallback) {
            outputCallback('\n<log>Generating DML code from prompt...</log>\n\n');
        }

        for await (const result of questionToProlog(prompt, 0, dmlExamplesDir, swipl, 3)) {
            if (typeof result === 'object') {
                if ('code' in result) {
                    generatedCode = result.code;
                    break;
                } else if ('error' in result) {
                    errorMsg = result.error;
                }
            } else if (typeof result === 'string') {
                // Stream intermediate output to the frontend
                if (outputCallback) {
                    outputCallback(result);
                } else {
                    process.stdout.write(result);
                }
                continue;
            }
        }

        if (generatedCode) {
            // Wrap the generated code in a special collapsible format
            if (outputCallback) {
                outputCallback('\n<dml-code>\n```prolog\n' + generatedCode + '\n```\n</dml-code>\n');
            }
            return generatedCode;
        } else {
            return errorMsg || `Error generating DML from prompt`;
        }

    } catch (error) {
        return `Error generating DML from prompt: ${error.message}`;
    }
}

/**
 * Tool: Analyze a DML file
 */
async function analyzeDmlFile(filename, dmlExamplesDir) {
    try {
        const { filename: fname, content } = readDmlExample(filename, dmlExamplesDir);
        const parameters = analyzeDmlParameters(content);
        const lines = content.split('\n');
        const commentLines = lines.filter(line => line.trim().startsWith('%'));
        const ruleLines = lines.filter(line => line.includes(':-') && !line.trim().startsWith('%'));

        let analysis = `Analysis of ${fname}:\n\n`;
        analysis += `File size: ${content.length} characters, ${lines.length} lines\n`;
        analysis += `Comments: ${commentLines.length} lines\n`;
        analysis += `Rules: ${ruleLines.length} lines\n\n`;

        if (parameters.length > 0) {
            analysis += `Parameters:\n${formatParametersInfo(parameters)}\n\n`;
        } else {
            analysis += `No parameters defined\n\n`;
        }

        if (commentLines.length > 0) {
            analysis += `Description (from comments):\n`;
            const descLines = commentLines.slice(0, Math.min(10, commentLines.length));
            for (const line of descLines) {
                analysis += `${line.trim().substring(1).trim()}\n`;
            }
        }

        return analysis;
    } catch (error) {
        return `Error analyzing DML file: ${error.message}`;
    }
}

/**
 * Tool: Read the contents of a DML file
 */
async function readDmlFile(filename, dmlExamplesDir) {
    try {
        const { filename: fname, content } = readDmlExample(filename, dmlExamplesDir);
        const parameters = analyzeDmlParameters(content);
        let result = `Contents of ${fname}:\n${"=".repeat(50)}\n\n`;
        if (parameters.length > 0) {
            result += `Parameters:\n${formatParametersInfo(parameters)}\n\n`;
        }
        result += content;
        return result;
    } catch (error) {
        return `Error reading DML file: ${error.message}`;
    }
}

/**
 * Tool: Run a DML file from the dml_examples directory
 */
async function runDmlFileTool(filename, dmlExamplesDir, workspaceDir, inputCallback, outputCallback, parameters = "{}", swipl = null, abortController = null) {
    try {
        const paramsDict = safeParseJson(parameters, {});

        // If filename is a wildcard or special token, run all DML files found in the provided dirs
        if (!filename || filename === '*' || filename === 'ALL') {
            const dirs = Array.isArray(dmlExamplesDir) ? dmlExamplesDir : [dmlExamplesDir];
            const fileSet = new Set();
            for (const dir of dirs) {
                try {
                    const pattern = path.join(dir, '**/*.dml');
                    const found = glob.sync(pattern);
                    for (const f of found) fileSet.add(f);
                } catch (err) {
                    // ignore this dir
                }
            }

            const files = Array.from(fileSet).sort();
            if (files.length === 0) {
                const msg = `No DML files found in ${dirs.join(', ')}`;
                console.log(msg);
                if (outputCallback) outputCallback(`<log>${msg}</log>\n`);
                return msg;
            }

            console.log(`Found ${files.length} DML files to run`);
            if (outputCallback) outputCallback(`<log>Found ${files.length} DML files to run</log>\n`);

            let aggregateOutput = '';
            for (const filepath of files) {
                if (abortController?.signal?.aborted) {
                    console.log('Abort detected, stopping multi-file run');
                    if (outputCallback) outputCallback('<log>⏹️ Aborted multi-file run</log>\n');
                    break;
                }

                const content = fs.readFileSync(filepath, 'utf-8');
                const baseDir = dirs.find(d => filepath.startsWith(d));
                const relative = baseDir ? path.relative(baseDir, filepath) : path.basename(filepath);

                const header = `\n--- Running: ${relative} ---\n`;
                aggregateOutput += header;
                if (outputCallback) outputCallback(`<dml-file-start file="${relative}">${header}</dml-file-start>\n`);

                try {
                    console.log(`Running file: ${filepath}`);
                    const out = await runDmlCode(content, workspaceDir, {
                        params: paramsDict,
                        sessionPrefix: 'tool',
                        inputCallback: inputCallback,
                        outputCallback: outputCallback,
                        collect: true,
                        rich: true,
                        echo: true,
                        swipl,
                        abortController,
                    });
                    aggregateOutput += out;
                    if (outputCallback) outputCallback(`<dml-file-end file="${relative}">--- End: ${relative} ---</dml-file-end>\n`);
                } catch (err) {
                    const errMsg = `Error running ${relative}: ${err.message}\n`;
                    aggregateOutput += errMsg;
                    if (outputCallback) outputCallback(`<log>${errMsg}</log>\n`);
                }
            }

            return aggregateOutput;
        }

        // Default: run a single named file (searching across provided dirs)
        const { content } = readDmlExample(filename, dmlExamplesDir);
        return await runDmlCode(content, workspaceDir, {
            params: paramsDict,
            sessionPrefix: 'tool',
            inputCallback: inputCallback,
            outputCallback: outputCallback,
            collect: true,
            rich: true,
            echo: true,
            swipl,
            abortController,
        });
    } catch (error) {
        return `Error running DML file: ${error.message}`;
    }
}

/**
 * Tool: List all available DML files (with nested directory support)
 */
async function listDmlFilesTool(dmlExamplesDir) {
    try {
        const dirs = Array.isArray(dmlExamplesDir) ? dmlExamplesDir : [dmlExamplesDir];
        const fileSet = new Set();

        for (const dir of dirs) {
            const pattern = path.join(dir, "**/*.dml");
            try {
                const found = glob.sync(pattern);
                for (const f of found) fileSet.add(f);
            } catch (err) {
                // ignore this dir
            }
        }

        const dmlFiles = Array.from(fileSet);

        if (dmlFiles.length === 0) {
            return `No DML files found in ${dirs.join(', ')}`;
        }

        let result = "Available DML files:\n\n";
        for (const filepath of dmlFiles.sort()) {
            // best-effort: find which base dir this file belongs to for relative path
            const baseDir = dirs.find(d => filepath.startsWith(d));
            const relativePath = baseDir ? path.relative(baseDir, filepath) : path.basename(filepath);
            const pathWithoutExt = relativePath.replace(/\.dml$/, '');
            const dotPath = pathWithoutExt.replace(/[\/\\]/g, '.');
            
            const content = fs.readFileSync(filepath, 'utf-8');
            const parameters = analyzeDmlParameters(content);
            
            result += `📄 ${dotPath}\n`;
            result += `   Path: ${relativePath}\n`;
            
            const lines = content.split('\n');
            const commentLines = lines.filter(line => line.trim().startsWith('%'));
            if (commentLines.length > 0) {
                const desc = commentLines[0].trim().substring(1).trim();
                result += `   ${desc}\n`;
            }
            
            if (parameters.length > 0) {
                result += `   Parameters: ${parameters.map(p => p.key).join(', ')}\n`;
            }
            
            result += '\n';
        }

        return result;
    } catch (error) {
        return `Error listing DML files: ${error.message}`;
    }
}

/**
 * DML Agent class for Electron
 */
export class DMLAgent {
    constructor(paths, inputCallback = null, outputCallback = null) {
        this.workspacePath = paths.workspace;
        this.dmlExamplesDir = paths.dmlExamples;
        this.learnedExamplesDir = path.join(paths.dmlExamples, 'learned');
        this.configPath = paths.config;
        this.conversationsDir = path.join(path.dirname(this.configPath), 'conversations');
        this.lastGeneratedDml = null;
        this.inputCallback = inputCallback; // Store the input callback
        this.outputCallback = outputCallback; // Store the output callback

        // Per-conversation state tracking
        this.activeConversations = new Map(); // conversationId -> { abortController, swipl, status }

        // Set environment variable for tools to access workspace
        process.env.DML_CLI_WORKSPACE = this.workspacePath;

        // Ensure directories exist
        if (!fs.existsSync(this.dmlExamplesDir)) {
            fs.mkdirSync(this.dmlExamplesDir, { recursive: true });
        }
        if (!fs.existsSync(this.workspacePath)) {
            fs.mkdirSync(this.workspacePath, { recursive: true });
        }
        if (!fs.existsSync(this.conversationsDir)) {
            fs.mkdirSync(this.conversationsDir, { recursive: true });
        }

        // Initialize learned folder and README if it doesn't exist
        this.initializeLearnedFolder();

        initBridge();
    }

    /**
     * Initialize the 'learned' folder with README on first run
     */
    initializeLearnedFolder() {
        if (!fs.existsSync(this.learnedExamplesDir)) {
            fs.mkdirSync(this.learnedExamplesDir, { recursive: true });
            console.log(`Created learned folder at: ${this.learnedExamplesDir}`);
        }
        
        // Copy initial examples from bundled resources
        this.copyInitialExamples();
    }

    /**
     * Copy initial example files from the app bundle to the learned folder
     */
    copyInitialExamples() {
        try {
            // Determine the initial examples directory based on environment
            let initialExamplesDir;
            
            if (process.env.NODE_ENV === 'development') {
                // In development, use the source directory
                initialExamplesDir = path.join(process.cwd(), 'src', 'electron', 'initial_examples');
            } else {
                // In production, check if running from asar or unpacked
                const appPath = process.resourcesPath || process.cwd();
                
                // Try unpacked location first (for asar.unpacked)
                initialExamplesDir = path.join(appPath, 'app.asar.unpacked', 'src', 'electron', 'initial_examples');
                
                // If not found, try regular asar location
                if (!fs.existsSync(initialExamplesDir)) {
                    initialExamplesDir = path.join(appPath, 'app.asar', 'src', 'electron', 'initial_examples');
                }
                
                // Fallback to regular path structure
                if (!fs.existsSync(initialExamplesDir)) {
                    initialExamplesDir = path.join(appPath, 'src', 'electron', 'initial_examples');
                }
            }
            
            if (!fs.existsSync(initialExamplesDir)) {
                console.warn(`Initial examples directory not found at: ${initialExamplesDir}`);
                return;
            }
            
            console.log(`Copying initial examples from: ${initialExamplesDir}`);
            
            // Read all files from initial_examples directory
            const files = fs.readdirSync(initialExamplesDir);
            let copiedCount = 0;
            
            for (const file of files) {
                const sourcePath = path.join(initialExamplesDir, file);
                const destPath = path.join(this.learnedExamplesDir, file);
                
                // Skip if not a file
                const stats = fs.statSync(sourcePath);
                if (!stats.isFile()) continue;
                
                // Copy file if it doesn't exist in destination
                if (!fs.existsSync(destPath)) {
                    fs.copyFileSync(sourcePath, destPath);
                    copiedCount++;
                    console.log(`Copied: ${file}`);
                }
            }
            
            if (copiedCount > 0) {
                console.log(`Successfully copied ${copiedCount} initial example files to learned folder`);
            } else {
                console.log(`All initial examples already present in learned folder`);
            }
            
        } catch (error) {
            console.error(`Error copying initial examples: ${error.message}`);
        }
    }

    async createDml(description) {
        if (!description) {
            throw new Error("Description is required");
        }

        // Use the learned folder for examples
        const generatedCode = await generateDmlFromPrompt(description, this.learnedExamplesDir, this.outputCallback);
        
        if (generatedCode && !generatedCode.startsWith('Error')) {
            this.trackGeneratedDml(generatedCode);
            return generatedCode;
        } else {
            throw new Error(generatedCode);
        }
    }

    async createDmlFromFile(filename) {
        if (!filename) {
            throw new Error("Filename is required");
        }

        const possiblePaths = [
            filename,
            path.join(this.workspacePath, filename),
            path.join(this.dmlExamplesDir, filename),
            path.join(".", filename)
        ];

        if (!filename.endsWith('.txt')) {
            const txtFilename = filename + '.txt';
            possiblePaths.push(
                txtFilename,
                path.join(this.workspacePath, txtFilename),
                path.join(this.dmlExamplesDir, txtFilename),
                path.join(".", txtFilename)
            );
        }

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
            throw new Error(`File not found: ${filename}`);
        }

        if (!fileContent) {
            throw new Error(`File is empty: ${usedPath}`);
        }

        return await this.createDml(fileContent);
    }

    saveDml(filename) {
        if (!this.lastGeneratedDml) {
            throw new Error("No DML code to save. Generate some DML first.");
        }

        // Convert dot notation to path (e.g., browser.search -> browser/search.dml)
        const fname = convertDotPathToFilePath(filename);
        const filepath = path.join(this.dmlExamplesDir, fname);
        
        // Ensure directory exists
        const dir = path.dirname(filepath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        fs.writeFileSync(filepath, this.lastGeneratedDml);
        return `DML saved to ${filepath}`;
    }

    async runDmlFile(filename, parameters = "{}", conversationId = null) {
        // Determine dirs to search: root examples, learned, + optional session-specific folder
        const dirs = [this.dmlExamplesDir, this.learnedExamplesDir];
        if (conversationId) {
            const sessionDmlDir = path.join(this.dmlExamplesDir, 'sessions', conversationId);
            dirs.push(sessionDmlDir);
        }
        
        // Read the DML content for tracking
        let dmlContent = null;
        try {
            const { content } = readDmlExample(filename, dirs);
            dmlContent = content;
        } catch (err) {
            // If we can't read the file, the execution will fail anyway
        }
        
        // Delegate to runDmlFileTool which understands arrays of dirs and wildcards
        const abortController = new AbortController();
        const result = await runDmlFileTool(filename, dirs, this.workspacePath, this.inputCallback, this.outputCallback, parameters, null, abortController);
        
        // Track execution in conversation state if conversationId is provided
        if (conversationId && dmlContent) {
            let convState = this.activeConversations.get(conversationId);
            
            // Create conversation state if it doesn't exist
            if (!convState) {
                console.log(`[runDmlFile] Creating new conversation state for: ${conversationId}`);
                convState = {
                    swipl: null, // Will be created when needed
                    abortController: new AbortController(),
                    status: 'active',
                    createdAt: Date.now(),
                    lastExecutedDml: null,
                    lastExecutedDmlFile: null,
                    lastExecutedOutput: null,
                };
                this.activeConversations.set(conversationId, convState);
            }
            
            // Update tracking info
            convState.lastExecutedDml = dmlContent;
            convState.lastExecutedDmlFile = filename;
            convState.lastExecutedOutput = result;
            console.log(`[runDmlFile] Tracked execution for conversation ${conversationId}: ${filename}`);
        }
        
        return result;
    }

    async listDmlFiles() {
        return await listDmlFilesTool(this.dmlExamplesDir);
    }

    async analyzeDmlFile(filename) {
        return await analyzeDmlFile(filename, this.dmlExamplesDir);
    }

    async readDmlFile(filename) {
        return await readDmlFile(filename, this.dmlExamplesDir);
    }

    async readDmlFileContent(filename) {
        const { content } = readDmlExample(filename, this.dmlExamplesDir);
        
        // Try to read description file
        let description = '';
        try {
            const fname = convertDotPathToFilePath(filename);
            const descFilePath = path.join(
                this.dmlExamplesDir, 
                fname.replace(/\.dml$/, '.txt')
            );
            if (fs.existsSync(descFilePath)) {
                description = fs.readFileSync(descFilePath, 'utf-8');
            }
        } catch (error) {
            // Description file doesn't exist or error reading it
            console.log('No description file found or error reading:', error.message);
        }
        
        return { content, description };
    }

    async saveDmlFileContent(filename, content, description) {
        // Convert dot notation to path
        const fname = convertDotPathToFilePath(filename);
        const filepath = path.join(this.dmlExamplesDir, fname);
        
        // Ensure directory exists
        const dir = path.dirname(filepath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Save DML file
        fs.writeFileSync(filepath, content);
        
        // Save description file if provided
        if (description !== undefined && description !== null) {
            const descFilePath = filepath.replace(/\.dml$/, '.txt');
            if (description.trim() === '') {
                // Delete description file if empty
                if (fs.existsSync(descFilePath)) {
                    fs.unlinkSync(descFilePath);
                }
            } else {
                fs.writeFileSync(descFilePath, description);
            }
        }
        
        return `DML file saved to ${filepath}`;
    }

    async deleteDmlFile(filename) {
        // Convert dot notation to path
        const fname = convertDotPathToFilePath(filename);
        const filepath = path.join(this.dmlExamplesDir, fname);
        
        if (!fs.existsSync(filepath)) {
            throw new Error(`File not found: ${filepath}`);
        }
        
        fs.unlinkSync(filepath);
        return `DML file deleted: ${filepath}`;
    }

    async createDmlFile(filename) {
        // Convert dot notation to path
        const fname = convertDotPathToFilePath(filename);
        const filepath = path.join(this.dmlExamplesDir, fname);
        
        // Check if file already exists
        if (fs.existsSync(filepath)) {
            throw new Error(`File already exists: ${filepath}`);
        }
        
        // Ensure directory exists
        const dir = path.dirname(filepath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        
        // Create file with basic template
        const template = `% ${filename.split('.').pop() || filename}
% Description: Add your description here

% Define parameters if needed
% param(key, 'Description', default_value).

% Your DML code here
`;
        
        fs.writeFileSync(filepath, template);
        return `DML file created: ${filepath}`;
    }

    async learnDmlFile(filename) {
        // Convert dot notation to path
        const fname = convertDotPathToFilePath(filename);
        const sourcePath = path.join(this.dmlExamplesDir, fname);
        
        // Check if source file exists
        if (!fs.existsSync(sourcePath)) {
            throw new Error(`File not found: ${sourcePath}`);
        }
        
        // Extract just the filename (not the full path)
        const baseFilename = path.basename(fname);
        const targetPath = path.join(this.dmlExamplesDir, 'learned', baseFilename);
        
        // Ensure learned directory exists
        const learnedDir = path.join(this.dmlExamplesDir, 'learned');
        if (!fs.existsSync(learnedDir)) {
            fs.mkdirSync(learnedDir, { recursive: true });
        }
        
        // Check if file already exists in learned folder
        if (fs.existsSync(targetPath)) {
            throw new Error(`File already exists in learned folder: ${baseFilename}`);
        }
        
        // Copy the DML file
        fs.copyFileSync(sourcePath, targetPath);
        
        // Also copy the description file if it exists
        const sourceDescPath = sourcePath.replace(/\.dml$/, '.txt');
        if (fs.existsSync(sourceDescPath)) {
            const targetDescPath = targetPath.replace(/\.dml$/, '.txt');
            fs.copyFileSync(sourceDescPath, targetDescPath);
        }
        
        return `DML file copied to learned folder: ${baseFilename}`;
    }

    trackGeneratedDml(dmlCode) {
        this.lastGeneratedDml = dmlCode;
    }

    /**
     * Internal helper to generate execution explanation
     * Used by both explainLastExecution and explain_execution tool
     */
    async _generateExplanation(dmlFile, dmlCode, output) {
        // Truncate if too long to avoid context overflow
        const MAX_DML_LENGTH = 100000;
        const MAX_OUTPUT_LENGTH = 100000;
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
Be concise and use professional language, focus on the task and the result and which decisions were made at a high level. Do not mention any technical details.
Give an estimate at how reliable the results are based on the execution output.

Format your response in clear sections with headers.`;

        const model = resolveProvider(getAgentModelConfig(), providerMap);
        const agentCfg = getAgentConfig();

        // Output header
        if (this.outputCallback) {
            this.outputCallback(`\n## Execution Explanation\n\n`);
        }

        // Stream the explanation in real-time
        const result = await streamText({
            model,
            prompt: explanationPrompt,
            maxTokens: 2000,
            temperature: agentCfg.temperature || 0.7,
        });

        let explanation = '';
        for await (const chunk of result.textStream) {
            explanation += chunk;
            if (this.outputCallback) {
                this.outputCallback(chunk);
            }
        }

        if (this.outputCallback) {
            this.outputCallback(`\n\n`);
        }

        return explanation;
    }

    /**
     * Explain the last executed DML in a conversation
     */
    async explainLastExecution(conversationId) {
        console.log(`[EXPLAIN] Starting explanation for conversation: ${conversationId}`);
        const convState = this.activeConversations.get(conversationId);
        
        if (!convState) {
            console.log(`[EXPLAIN] No conversation state found for: ${conversationId}`);
            const errorMsg = 'Error: No active conversation found.';
            if (this.outputCallback) {
                this.outputCallback(`\n❌ ${errorMsg}\n`);
            }
            return errorMsg;
        }

        console.log(`[EXPLAIN] Conversation state exists. lastExecutedDml: ${!!convState.lastExecutedDml}, lastExecutedOutput: ${!!convState.lastExecutedOutput}`);

        if (!convState.lastExecutedDml || !convState.lastExecutedOutput) {
            const errorMsg = 'Error: No DML execution to explain. Please run a DML file first using /run <filename>.';
            console.log(`[EXPLAIN] ${errorMsg}`);
            if (this.outputCallback) {
                this.outputCallback(`\n❌ ${errorMsg}\n`);
            }
            return errorMsg;
        }

        try {
            console.log(`[EXPLAIN] Generating explanation...`);
            const dmlFile = convState.lastExecutedDmlFile || 'unknown';
            const dmlCode = convState.lastExecutedDml;
            const output = convState.lastExecutedOutput;

            // Delegate to shared helper
            return await this._generateExplanation(dmlFile, dmlCode, output);
        } catch (error) {
            console.error(`[EXPLAIN] Error:`, error);
            const errorMsg = `Error generating explanation: ${error.message}`;
            if (this.outputCallback) {
                this.outputCallback(`\n❌ ${errorMsg}\n`);
            }
            return errorMsg;
        }
    }

    /**
     * Initialize fresh SWIPL instance for a conversation (no state persistence)
     */
    async getOrCreateSwiplForConversation(conversationId) {
        console.log(`[ABORT] getOrCreateSwiplForConversation called with conversationId: ${conversationId}`);
        console.log(`[ABORT] Current activeConversations Map size: ${this.activeConversations.size}`);
        console.log(`[ABORT] Current activeConversations keys:`, Array.from(this.activeConversations.keys()));
        
        let convState = this.activeConversations.get(conversationId);
        
        // Always create a fresh SWIPL instance - no state persistence
        console.log(`[ABORT] Creating fresh SWIPL instance for conversation ${conversationId}`);

        let swipl;
        const workspaceDir = this.workspacePath;
        try {
            if (process.env.DML_DEV_MODE) {
                swipl = await SWIPL({ 
                    arguments: ["-q"], 
                    on_output: (line) => {
                        if (process.env.DEBUG) {
                            console.log(`[${conversationId}] SWI-Prolog:`, line);
                        }
                    }
                });
            } else {
                swipl = await SWIPL({ 
                    arguments: ["-x", "mi.qsave"], 
                    on_output: (line) => {
                        if (process.env.DEBUG) {
                            console.log(`[${conversationId}] SWI-Prolog:`, line);
                        }
                    },
                    preRun: [(module) => { 
                        console.log("[PRE-RUN] Loading mi.qsave into SWIPL filesystem");
                        const miData = fs.readFileSync(path.join(workspaceDir, 'mi.qsave'));
                        module.FS.writeFile('mi.qsave', miData); }
                    ]
                });
            }

        } catch (error) {
            console.error(`[ABORT] Error creating SWIPL instance for conversation ${conversationId}:`, error);
            throw error;
        }
        
        if (!convState) {
            // Create new conversation state
            convState = {
                swipl,
                abortController: new AbortController(),
                status: 'active',
                createdAt: Date.now(),
                lastExecutedDml: null,
                lastExecutedDmlFile: null,
                lastExecutedOutput: null,
            };
            
            this.activeConversations.set(conversationId, convState);
            console.log(`[ABORT] Added conversation to Map. New size: ${this.activeConversations.size}`);
            console.log(`[ABORT] Verifying conversation was added:`, this.activeConversations.has(conversationId));
            console.log(`Created fresh SWIPL instance for conversation ${conversationId}`);
        } else {
            // Replace with fresh SWIPL instance and new abort controller
            console.log(`[ABORT] Replacing existing SWIPL instance with fresh one for ${conversationId}`);
            convState.swipl = swipl;
            convState.abortController = new AbortController();
            convState.status = 'active';
        }
        
        return convState;
    }

    /**
     * Cleanup conversation resources
     */
    async cleanupConversation(conversationId) {
        const convState = this.activeConversations.get(conversationId);
        
        if (convState) {
            // Abort any ongoing execution
            if (convState.abortController) {
                convState.abortController.abort();
            }
            
            // Cleanup SWIPL instance if needed
            // Note: SWIPL WASM doesn't have explicit cleanup, but we remove our reference
            convState.swipl = null;
            
            this.activeConversations.delete(conversationId);
            console.log(`Cleaned up resources for conversation ${conversationId}`);
        }
    }

    /**
     * Abort execution for a specific conversation
     */
    abortConversation(conversationId) {
        const convState = this.activeConversations.get(conversationId);
        
        if (convState && convState.abortController) {
            console.log(`[ABORT] Aborting conversation ${conversationId}`);
            console.log(`[ABORT] AbortController exists:`, !!convState.abortController);
            console.log(`[ABORT] Signal before abort:`, convState.abortController.signal.aborted);
            
            convState.abortController.abort();
            convState.status = 'aborted';
            
            console.log(`[ABORT] Signal after abort:`, convState.abortController.signal.aborted);
            console.log(`[ABORT] Abort signal sent for conversation ${conversationId}`);
        } else {
            console.log(`[ABORT] No active conversation found with id ${conversationId}`);
            console.log(`[ABORT] Active conversations:`, Array.from(this.activeConversations.keys()));
        }
    }

    /**
     * Legacy method - aborts all active conversations
     */
    abortExecution() {
        console.log(`Aborting all active conversations (${this.activeConversations.size} active)`);
        for (const [conversationId, convState] of this.activeConversations.entries()) {
            if (convState.abortController) {
                convState.abortController.abort();
                convState.status = 'aborted';
            }
        }
    }

    /**
     * Get status of all active conversations
     */
    getActiveConversationsStatus() {
        const status = [];
        for (const [conversationId, convState] of this.activeConversations.entries()) {
            status.push({
                conversationId,
                status: convState.status,
                createdAt: convState.createdAt,
                duration: Date.now() - convState.createdAt,
            });
        }
        return status;
    }

    /**
     * Conversation Management Methods
     */

    // Create a new conversation
    createConversation(title = 'New Conversation') {
        const conversationId = `conv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const conversation = {
            id: conversationId,
            title,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: []
        };
        
        const filePath = path.join(this.conversationsDir, `${conversationId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2));
        
        return conversation;
    }

    // List all conversations
    listConversations() {
        if (!fs.existsSync(this.conversationsDir)) {
            return [];
        }

        const files = fs.readdirSync(this.conversationsDir)
            .filter(file => file.endsWith('.json'))
            .sort((a, b) => {
                // Sort by modification time, newest first
                const statA = fs.statSync(path.join(this.conversationsDir, a));
                const statB = fs.statSync(path.join(this.conversationsDir, b));
                return statB.mtime.getTime() - statA.mtime.getTime();
            });

        return files.map(file => {
            const filePath = path.join(this.conversationsDir, file);
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const conversation = JSON.parse(content);
                // Return just the metadata, not all messages
                return {
                    id: conversation.id,
                    title: conversation.title,
                    createdAt: conversation.createdAt,
                    updatedAt: conversation.updatedAt,
                    messageCount: conversation.messages?.length || 0
                };
            } catch (error) {
                console.error(`Error reading conversation ${file}:`, error);
                return null;
            }
        }).filter(Boolean);
    }

    // Load a specific conversation
    loadConversation(conversationId) {
        const filePath = path.join(this.conversationsDir, `${conversationId}.json`);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`Conversation not found: ${conversationId}`);
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
    }

    // Save conversation (update messages)
    async saveConversation(conversationId, messages, title) {
        const filePath = path.join(this.conversationsDir, `${conversationId}.json`);
        let conversation;
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            conversation = JSON.parse(content);
        } else {
            // Create new if doesn't exist
            conversation = {
                id: conversationId,
                createdAt: new Date().toISOString()
            };
        }

        // Set messages and updated time
        conversation.messages = messages;
        conversation.updatedAt = new Date().toISOString();

        // Only attempt LLM title generation when there is at least one message
        let generatedTitle = null;
        try {
            if (Array.isArray(messages) && messages.length > 0) {
                // Build a brief transcript to send to the model
                const transcript = messages.map(m => {
                    const who = (m.type === 'user') ? 'User' : (m.type === 'agent') ? 'Agent' : m.type;
                    const text = (typeof m.content === 'string') ? m.content : JSON.stringify(m.content);
                    return `${who}: ${text.replace(/\n+/g, ' ').trim()}`;
                }).join('\n');

                // Truncate transcript to avoid very long prompts
                const MAX_PROMPT_CHARS = 4000;
                const promptTranscript = transcript.length > MAX_PROMPT_CHARS ? transcript.slice(0, MAX_PROMPT_CHARS) + '\n...[truncated]...' : transcript;

                const prompt = `Summarize the following conversation into a short descriptive title (5 words or less). Respond with a concise title only, no punctuation around it.\n\nConversation:\n${promptTranscript}`;

                const model = resolveProvider(getAgentModelConfig(), providerMap);
                const agentCfg = getAgentConfig();

                const { text: llmText } = await generateText({
                    model,
                    prompt,
                    maxTokens: 30,
                    temperature: agentCfg.temperature || 0.0,
                });

                if (llmText && typeof llmText === 'string') {
                    generatedTitle = llmText.trim().split('\n')[0].trim();
                    // Remove surrounding quotes if any
                    generatedTitle = generatedTitle.replace(/^\"|\"$/g, '').replace(/^'|'$/g, '');
                    if (generatedTitle.length === 0) generatedTitle = null;
                }
            }
        } catch (err) {
            // LLM failed - log and continue with fallback
            console.error('Failed to generate conversation title:', err);
            generatedTitle = null;
        }

        // Prefer explicit title argument; otherwise use generated title when available
        conversation.title = title || generatedTitle || conversation.title || 'New Conversation';

        // Write to disk
        fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2));

        return conversation;
    }

    // Delete a conversation
    deleteConversation(conversationId) {
        const filePath = path.join(this.conversationsDir, `${conversationId}.json`);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`Conversation not found: ${conversationId}`);
        }

        fs.unlinkSync(filePath);
        return { success: true };
    }

    // Rename a conversation
    renameConversation(conversationId, newTitle) {
        const filePath = path.join(this.conversationsDir, `${conversationId}.json`);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`Conversation not found: ${conversationId}`);
        }

        const content = fs.readFileSync(filePath, 'utf-8');
        const conversation = JSON.parse(content);
        
        conversation.title = newTitle;
        conversation.updatedAt = new Date().toISOString();

        fs.writeFileSync(filePath, JSON.stringify(conversation, null, 2));
        
        return conversation;
    }

    async processNaturalLanguageInput(input, conversationId, conversationMessages = []) {
        console.log(`[ABORT] processNaturalLanguageInput called with conversationId: ${conversationId}`);
        
        if (!conversationId) {
            throw new Error('conversationId is required for processNaturalLanguageInput');
        }

        // Get or create SWIPL instance and abort controller for this conversation
        const convState = await this.getOrCreateSwiplForConversation(conversationId);
        console.log(`[ABORT] Got convState from getOrCreateSwiplForConversation:`, convState ? 'exists' : 'null');
        convState.status = 'executing';
        
        // Create session-specific DML save directory
        const sessionDmlDir = path.join(this.dmlExamplesDir, 'sessions', conversationId);
        if (!fs.existsSync(sessionDmlDir)) {
            fs.mkdirSync(sessionDmlDir, { recursive: true });
        }
        
        try {
            const today = new Date().toISOString().split('T')[0];
            const systemPrompt = DML_AGENT_SYSTEM_PROMPT.replace('{date}', today);

            const tools = {
                list_dml_files_tool: tool({
                    description: "List all available DML files with brief metadata from the learned examples directory",
                    inputSchema: z.object({}),
                    execute: async () => ({ listing: await listDmlFilesTool([this.dmlExamplesDir, this.learnedExamplesDir, sessionDmlDir]) })
                }),
                analyze_dml_file: tool({
                    description: "Analyze a specific DML file (parameters, comments, structure) from the learned examples directory",
                    inputSchema: z.object({ filename: z.string() }),
                    execute: async ({ filename }) => ({ analysis: await analyzeDmlFile(filename, [this.dmlExamplesDir, this.learnedExamplesDir, sessionDmlDir]) })
                }),
                read_dml_file: tool({
                    description: "Read full contents of a DML file (truncated if large) from the learned examples directory",
                    inputSchema: z.object({ filename: z.string() }),
                    execute: async ({ filename }) => {
                        const out = await readDmlFile(filename, [this.dmlExamplesDir, this.learnedExamplesDir, sessionDmlDir]);
                        return { content: out.length > 6000 ? out.slice(0,6000) + '\n...[truncated]...' : out };
                    }
                }),
                run_dml_file_tool: tool({
                    description: "Execute a DML file with optional params object",
                    inputSchema: z.object({ filename: z.string(), params: z.record(z.any()).optional() }),
                    execute: async ({ filename, params }) => {
                        // Output visual marker for DML file execution
                        this.outputCallback(`<dml-execution>Executing: ${filename}</dml-execution>\n`);
                        
                        // Read the DML content for tracking
                        let dmlContent = null;
                        try {
                            const { content } = readDmlExample(filename, [this.dmlExamplesDir, this.learnedExamplesDir, sessionDmlDir]);
                            dmlContent = content;
                        } catch (err) {
                            // Continue even if we can't read the content for tracking
                        }

                        const convState = await this.getOrCreateSwiplForConversation(conversationId);
                        
                        const result = await runDmlFileTool(
                            filename, 
                            [this.dmlExamplesDir, this.learnedExamplesDir, sessionDmlDir], 
                            this.workspacePath, 
                            this.inputCallback, 
                            this.outputCallback, 
                            params ? JSON.stringify(params) : '{}',
                            convState.swipl, // Pass conversation's SWIPL instance
                            convState.abortController // Pass conversation's abort controller
                        );
                        
                        // Track the last executed DML in conversation state
                        convState.lastExecutedDml = dmlContent;
                        convState.lastExecutedDmlFile = filename;
                        convState.lastExecutedOutput = result;
                        
                        return { runOutput: result.length > 100000 ? result.slice(0,100000) + '\n...[truncated]...' : result };
                    }
                }),
                create_dml_from_prompt: tool({
                    description: "Generate new DML code from a natural language prompt",
                    inputSchema: z.object({ prompt: z.string() }),
                    execute: async ({ prompt }) => {
                        const code = await generateDmlFromPrompt(prompt, this.learnedExamplesDir, this.outputCallback);
                        if (code.startsWith('Error')) {
                            return { error: code };
                        }
                        this.trackGeneratedDml(code);
                        // Return success message - the code was already streamed with <dml-code> wrapper
                        return 'DML code generated successfully';
                    }
                }),
                save_last_dml: tool({
                    description: "Save the last generated DML code to a file in the session-specific dml_examples directory",
                    inputSchema: z.object({ filename: z.string() }),
                    execute: async ({ filename }) => {
                        try {
                            if (!this.lastGeneratedDml) {
                                return 'Error: No DML code to save. Generate some DML first.';
                            }

                            // Save to session-specific directory
                            const fname = convertDotPathToFilePath(filename);
                            const filepath = path.join(sessionDmlDir, fname);
                            
                            // Ensure directory exists
                            const dir = path.dirname(filepath);
                            if (!fs.existsSync(dir)) {
                                fs.mkdirSync(dir, { recursive: true });
                            }
                            
                            fs.writeFileSync(filepath, this.lastGeneratedDml);
                            
                            // Return user-friendly message with relative path
                            const relativePath = path.relative(this.dmlExamplesDir, filepath);
                            return `DML file saved successfully to: dml_examples/${relativePath}`;
                        } catch (error) {
                            return `Error saving DML file: ${error.message}`;
                        }
                    }
                }),
                explain_execution: tool({
                    description: "Explain the last executed DML file and its output in simple, non-technical terms. This analyzes what happened during execution, pointing out decisions made by symbolic logic vs LLM-powered constructs.",
                    inputSchema: z.object({}),
                    execute: async ({}) => {
                        try {
                            if (!convState.lastExecutedDml || !convState.lastExecutedOutput) {
                                return 'Error: No DML execution to explain. Please run a DML file first using run_dml_file_tool.';
                            }

                            const dmlFile = convState.lastExecutedDmlFile || 'unknown';
                            const dmlCode = convState.lastExecutedDml;
                            const output = convState.lastExecutedOutput;

                            // Delegate to shared helper
                            return await this._generateExplanation(dmlFile, dmlCode, output);
                        } catch (error) {
                            return `Error generating explanation: ${error.message}`;
                        }
                    }
                }),
                final_answer: tool({
                    description: "Provide the final answer to the user's request. Use this when you have completed the task and want to deliver your final response. This will end the agent's execution.",
                    inputSchema: z.object({ 
                        message: z.string().describe("The final answer or summary to present to the user")
                    }),
                    execute: async ({ message }) => {
                        // Check for DML files created in this session
                        let dmlFilesList = '';
                        try {
                            if (fs.existsSync(sessionDmlDir)) {
                                const files = fs.readdirSync(sessionDmlDir, { recursive: true })
                                    .filter(f => f.endsWith('.dml'));
                                
                                if (files.length > 0) {
                                    dmlFilesList = '\n\n**DML Files Created in This Session:**\n';
                                    files.forEach(f => {
                                        const relativePath = path.join('sessions', conversationId, f);
                                        dmlFilesList += `- \`dml_examples/${relativePath}\`\n`;
                                    });
                                }
                            }
                        } catch (error) {
                            console.log('Error listing session DML files:', error);
                        }
                        
                        // Output the final message to the user with DML files list
                        if (this.outputCallback) {
                            this.outputCallback(`\n${message}${dmlFilesList}\n`);
                        }
                        return { status: 'completed', message: message + dmlFilesList };
                    }
                })
            };

            // Build messages array from conversation history
            const messages = [];
            
            // Add conversation history (excluding system messages and the current input)
            for (const msg of conversationMessages) {
                if (msg.type === 'user') {
                    messages.push({ role: 'user', content: msg.content });
                } else if (msg.type === 'agent') {
                    messages.push({ role: 'assistant', content: msg.content });
                }
                // Skip 'system', 'error', 'streaming' messages
            }
            
            // Add current user input
            //messages.push({ role: 'user', content: input });

            console.log('DML Agent processing input with messages:', messages);
            console.log('[ABORT] Starting streamText with abort signal:', convState.abortController?.signal.aborted);

            const agentConfig = getAgentConfig();
                const result = await streamText({
                model: resolveProvider(getAgentModelConfig(), providerMap),
                system: systemPrompt,
                messages: messages,
                stopWhen: [
                    stepCountIs(20), // Maximum 20 steps
                    hasToolCall('final_answer'), // Stop after calling final_answer
                ],
                tools,
                temperature: agentConfig.temperature,
                abortSignal: convState.abortController?.signal,
                onAbort: () => {
                    console.log('[ABORT] streamText onAbort callback triggered!');
                    if (this.outputCallback) {
                        this.outputCallback('\n<log>⏹️ Execution aborted</log>\n');
                    }
                }
            });

            let output = '';
            let chunkCount = 0;
            for await (const chunk of result.fullStream) {
                chunkCount++;
                if (chunkCount % 10 === 0) {
                    console.log(`[ABORT] Chunk ${chunkCount}, abort signal:`, convState.abortController?.signal.aborted);
                }
                
                if (convState.abortController?.signal.aborted) {
                    console.log('[ABORT] Abort detected in streamText loop at chunk', chunkCount);
                    break;
                }
                
                if (chunk.type === 'text-delta') {
                    output += chunk.text;
                    // Stream text chunks to frontend
                    if (this.outputCallback) {
                        this.outputCallback(chunk.text);
                    }
                }

                if (chunk.type === 'tool-call') {
                    const toolMsg = `<log>Calling tool: ${chunk.toolName}</log>\n`;
                    output += toolMsg;
                    // Stream tool call notification
                    if (this.outputCallback) {
                        this.outputCallback(toolMsg);
                    }
                }

                if (chunk.type === 'tool-result') {
                    // Skip displaying tool output for run_dml_file_tool since it's already streamed during execution
                    if (chunk.toolName === 'run_dml_file_tool') {
                        // Still include in output string but don't stream to frontend
                        const outputStr = typeof chunk.output === 'string' 
                            ? chunk.output 
                            : JSON.stringify(chunk.output, null, 2);
                        output += outputStr;
                        continue;
                    }
                    
                    // Tool output is now handled by bridge.js with <tool_output> markers
                    // Just pass it through without additional formatting
                    const outputStr = typeof chunk.output === 'string' 
                        ? chunk.output 
                        : JSON.stringify(chunk.output, null, 2);

                    const outputRender = `<tool-output tool="${chunk.toolName}">\n${outputStr}\n</tool-output>`;

                    output += outputRender;
                    if (this.outputCallback) {
                        this.outputCallback(outputRender);
                    }
                }
            }

            return output;
        } catch (error) {
            convState.status = 'error';
            throw error;
        } finally {
            // Mark conversation as idle but keep resources (SWIPL instance) alive
            if (convState.status === 'executing') {
                convState.status = 'idle';
            }
        }
    }
}
