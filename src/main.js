#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { globSync } from 'glob';

import { richPrint, endSingleLineMode, flushStreamBuffer, init as initBridge, shutdownMcpClients, getGlobalTools, setVerbose } from './dml-js/bridge.js';
import { DMLAgent } from './electron/main/dml-agent.js';
import { analyzeDmlParameters } from './dml-js/dml-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes for terminal styling
const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    // Colors
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    // Bright colors
    brightBlack: '\x1b[90m',
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',
    brightWhite: '\x1b[97m',
};

// Box drawing characters
const BOX = {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
    leftT: '├',
    rightT: '┤',
};

// ANSI escape sequences for cursor/screen control
const ANSI = {
    saveCursor: '\x1b[s',
    restoreCursor: '\x1b[u',
    clearLine: '\x1b[2K',
    moveToCol: (n) => `\x1b[${n}G`,
    moveUp: (n) => `\x1b[${n}A`,
    moveDown: (n) => `\x1b[${n}B`,
    scrollUp: '\x1b[S',
};

/**
 * Create a styled box around content
 */
function createBox(content, { title = '', color = C.cyan, width = null, icon = '' } = {}) {
    const termWidth = process.stdout.columns || 80;
    const maxWidth = width || Math.min(termWidth - 4, 100);
    
    const lines = content.split('\n');
    const wrappedLines = [];
    for (const line of lines) {
        if (line.length <= maxWidth - 4) {
            wrappedLines.push(line);
        } else {
            let remaining = line;
            while (remaining.length > maxWidth - 4) {
                let breakPoint = remaining.lastIndexOf(' ', maxWidth - 4);
                if (breakPoint <= 0) breakPoint = maxWidth - 4;
                wrappedLines.push(remaining.substring(0, breakPoint));
                remaining = remaining.substring(breakPoint).trimStart();
            }
            if (remaining) wrappedLines.push(remaining);
        }
    }
    
    const titleText = icon ? `${icon} ${title}` : title;
    // Add 1 extra for emoji width compensation
    const emojiAdjust = icon ? 1 : 0;
    const contentWidth = Math.max(...wrappedLines.map(l => l.length), (titleText.length + 2)) + 2;
    const boxWidth = Math.min(Math.max(contentWidth + 2, 20), maxWidth);
    
    let result = '';
    
    if (titleText) {
        const titlePadded = ` ${titleText} `;
        const leftPad = 2;
        const rightPad = Math.max(0, boxWidth - leftPad - titlePadded.length - 2 + emojiAdjust);
        result += `${color}${BOX.topLeft}${BOX.horizontal.repeat(leftPad)}${C.bold}${titlePadded}${C.reset}${color}${BOX.horizontal.repeat(rightPad)}${BOX.topRight}${C.reset}\n`;
    } else {
        result += `${color}${BOX.topLeft}${BOX.horizontal.repeat(boxWidth - 2)}${BOX.topRight}${C.reset}\n`;
    }
    
    for (const line of wrappedLines) {
        const padding = Math.max(0, boxWidth - line.length - 4);
        result += `${color}${BOX.vertical}${C.reset} ${line}${' '.repeat(padding)} ${color}${BOX.vertical}${C.reset}\n`;
    }
    
    result += `${color}${BOX.bottomLeft}${BOX.horizontal.repeat(boxWidth - 2)}${BOX.bottomRight}${C.reset}\n`;
    
    return result;
}

/**
 * Get a styled prompt string for readline
 */
function getStyledPrompt() {
    return `${C.cyan}${C.bold}DeepClause Agent>${C.reset} `;
}

/**
 * Print a styled status message
 */
function printStatus(icon, label, message, color = C.cyan) {
    console.log(`${color}${C.bold}${icon} ${label}${C.reset} ${C.dim}│${C.reset} ${message}`);
}

/**
 * Print a styled error message
 */
function printError(message) {
    console.log(`${C.red}${C.bold}✖ ERROR${C.reset} ${C.dim}│${C.reset} ${message}`);
}

/**
 * Print a styled success message
 */
function printSuccess(message) {
    console.log(`${C.green}${C.bold}✓ SUCCESS${C.reset} ${C.dim}│${C.reset} ${message}`);
}

/**
 * Print a styled info message
 */
function printInfo(message) {
    console.log(`${C.blue}${C.bold}ℹ INFO${C.reset} ${C.dim}│${C.reset} ${message}`);
}

// Global deepclause directory in user's home
const GLOBAL_DEEPCLAUSE_DIR = path.join(os.homedir(), '.deepclause');

// Default paths for CLI usage
// Workspace defaults to current working directory
const DEFAULT_WORKSPACE = process.cwd();
// DML examples and settings stored in ~/.deepclause
const GLOBAL_DML_EXAMPLES = path.join(GLOBAL_DEEPCLAUSE_DIR, 'dml_examples');
const GLOBAL_SETTINGS = path.join(GLOBAL_DEEPCLAUSE_DIR, 'settings.json');
const DEFAULT_CONFIG = path.join(GLOBAL_DEEPCLAUSE_DIR, 'config.json');

// Local .deepclause directory in current working directory (optional per-project override)
const LOCAL_DEEPCLAUSE_DIR = path.join(process.cwd(), '.deepclause');
const LOCAL_DML_EXAMPLES = path.join(LOCAL_DEEPCLAUSE_DIR, 'dml_examples');

/**
 * Resolve DML examples directory - checks local .deepclause first, then global ~/.deepclause
 * @returns {string[]} Array of directories to search (local first if exists, then global), deduplicated
 */
function resolveDmlExamplesDirs() {
    const dirsSet = new Set();
    
    // Check local .deepclause/dml_examples first
    if (fs.existsSync(LOCAL_DML_EXAMPLES)) {
        dirsSet.add(LOCAL_DML_EXAMPLES);
    }
    
    // Always include global ~/.deepclause/dml_examples
    dirsSet.add(GLOBAL_DML_EXAMPLES);
    
    return Array.from(dirsSet);
}

/**
 * Get the primary DML examples directory for saving files
 * Uses local if it exists, otherwise global
 */
function getPrimaryDmlExamplesDir() {
    if (fs.existsSync(LOCAL_DEEPCLAUSE_DIR)) {
        return LOCAL_DML_EXAMPLES;
    }
    return GLOBAL_DML_EXAMPLES;
}

// Ensure global ~/.deepclause directories exist
if (!fs.existsSync(GLOBAL_DEEPCLAUSE_DIR)) {
    fs.mkdirSync(GLOBAL_DEEPCLAUSE_DIR, { recursive: true });
    console.log(`Created global DeepClause directory: ${GLOBAL_DEEPCLAUSE_DIR}`);
}
if (!fs.existsSync(GLOBAL_DML_EXAMPLES)) {
    fs.mkdirSync(GLOBAL_DML_EXAMPLES, { recursive: true });
    console.log(`Created global DML examples directory: ${GLOBAL_DML_EXAMPLES}`);
}

// Copy default settings.json to ~/.deepclause if it doesn't exist
const defaultSettingsSource = path.join(__dirname, '..', 'config', 'settings.json');
if (!fs.existsSync(GLOBAL_SETTINGS) && fs.existsSync(defaultSettingsSource)) {
    fs.copyFileSync(defaultSettingsSource, GLOBAL_SETTINGS);
    console.log(`Copied default settings to ${GLOBAL_SETTINGS}`);
}

// Copy mi.qsave from initial_workspace to global ~/.deepclause if it doesn't exist
const globalMiQsavePath = path.join(GLOBAL_DEEPCLAUSE_DIR, 'mi.qsave');
if (!fs.existsSync(globalMiQsavePath)) {
    const sourceMiQsave = path.join(__dirname, 'electron', 'initial_workspace', 'mi.qsave');
    if (fs.existsSync(sourceMiQsave)) {
        fs.copyFileSync(sourceMiQsave, globalMiQsavePath);
        console.log(`Copied mi.qsave to ${globalMiQsavePath}`);
    } else {
        console.warn(`Warning: mi.qsave not found at ${sourceMiQsave}. DML execution may not work in production mode.`);
    }
}

// Copy initial examples to global ~/.deepclause/dml_examples if empty
const initialExamplesSource = path.join(__dirname, 'electron', 'initial_examples');
if (fs.existsSync(initialExamplesSource)) {
    const globalLearnedDir = path.join(GLOBAL_DML_EXAMPLES, 'learned');
    if (!fs.existsSync(globalLearnedDir)) {
        fs.mkdirSync(globalLearnedDir, { recursive: true });
    }
    try {
        const exampleFiles = fs.readdirSync(initialExamplesSource);
        for (const file of exampleFiles) {
            const sourcePath = path.join(initialExamplesSource, file);
            const destPath = path.join(globalLearnedDir, file);
            const stats = fs.statSync(sourcePath);
            if (stats.isFile() && !fs.existsSync(destPath)) {
                fs.copyFileSync(sourcePath, destPath);
            }
        }
    } catch (err) {
        // Ignore errors copying initial examples
    }
}

// Add global flag to track DML execution state
let isDmlExecuting = false;

function printHeader() {
    const dc = C.cyan;      // DEEP color
    const cc = C.magenta;   // CLAUSE color
    const bc = C.brightBlue; // Box color
    const vc = C.yellow;    // Version color
    
    // ASCII art is 84 chars wide (with 2 space indent), so box inner = 86, total = 88
    console.log("");
    console.log(`${bc}╭────────────────────────────────────────────────────────────────────────────────────╮${C.reset}`);
    console.log(`${bc}│${C.reset}                                                                                    ${bc}│${C.reset}`);
    console.log(`${bc}│${C.reset} ${dc}██████╗ ███████╗███████╗██████╗ ${C.reset} ${cc}██████╗██╗      █████╗ ██╗   ██╗███████╗███████╗${C.reset}  ${bc}│${C.reset}`);
    console.log(`${bc}│${C.reset} ${dc}██╔══██╗██╔════╝██╔════╝██╔══██╗${C.reset} ${cc}██╔════╝██║     ██╔══██╗██║   ██║██╔════╝██╔════╝${C.reset} ${bc}│${C.reset}`);
    console.log(`${bc}│${C.reset} ${dc}██║  ██║█████╗  █████╗  ██████╔╝${C.reset} ${cc}██║     ██║     ███████║██║   ██║███████╗█████╗  ${C.reset} ${bc}│${C.reset}`);
    console.log(`${bc}│${C.reset} ${dc}██║  ██║██╔══╝  ██╔══╝  ██╔═══╝ ${C.reset} ${cc}██║     ██║     ██╔══██║██║   ██║╚════██║██╔══╝  ${C.reset} ${bc}│${C.reset}`);
    console.log(`${bc}│${C.reset} ${dc}██████╔╝███████╗███████╗██║     ${C.reset} ${cc}╚██████╗███████╗██║  ██║╚██████╔╝███████║███████╗${C.reset} ${bc}│${C.reset}`);
    console.log(`${bc}│${C.reset} ${dc}╚═════╝ ╚══════╝╚══════╝╚═╝     ${C.reset} ${cc} ╚═════╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚══════╝${C.reset} ${bc}│${C.reset}`);
    console.log(`${bc}│${C.reset}                                                                                    ${bc}│${C.reset}`);
    console.log(`${bc}│${C.reset}                  ${vc}🧠 Neurosymbolic AI System${C.reset} ${C.dim}•${C.reset} ${vc}v1.0.0${C.reset} ${C.dim}•${C.reset} ${C.green}Agent Mode${C.reset}                  ${bc}│${C.reset}`);
    console.log(`${bc}│${C.reset}                                                                                    ${bc}│${C.reset}`);
    console.log(`${bc}╰────────────────────────────────────────────────────────────────────────────────────╯${C.reset}`);
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
 * CLI wrapper for DMLAgent - adds interactive terminal features
 */
class CLIAgent {
    constructor() {
        // Resolve DML examples directories (local first, then global)
        const dmlExamplesDirs = resolveDmlExamplesDirs();
        const primaryDmlExamples = getPrimaryDmlExamplesDir();
        
        const paths = {
            workspace: DEFAULT_WORKSPACE,
            dmlExamples: primaryDmlExamples,  // Primary directory for saving
            dmlExamplesDirs: dmlExamplesDirs,  // All directories to search
            config: DEFAULT_CONFIG,
            globalDeepclauseDir: GLOBAL_DEEPCLAUSE_DIR,
            miQsavePath: globalMiQsavePath
        };

        // Create the core DML agent
        this.agent = new DMLAgent(paths, null, null);
        this.dmlExamplesDirs = dmlExamplesDirs;  // For tab completion

        // Setup readline interface with styled prompt
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            prompt: getStyledPrompt(),
            completer: this.completer.bind(this)
        });

        // Handle Ctrl+D (EOF) to exit
        this.rl.on('close', () => {
            if (!isDmlExecuting) {
                console.log('\n\nGoodbye!');
                process.exit(0);
            }
        });

        // AbortController for cancellation support
        this.currentAbortController = null;
        
        // Setup global SIGINT handler
        this.rl.on('SIGINT', () => {
            if (isDmlExecuting) {
                console.log('\n\n⚠️  Interrupting execution (Ctrl+C)...');
                // Abort via AbortController
                if (this.currentAbortController) {
                    this.currentAbortController.abort();
                }
                this.agent.abortExecution();
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
        const completions = ['/help', '/quit', '/exit', '/save', '/run', '/list', '/create', '/explain', '/learn', '/tools', '/settings'];
        
        // Get the current command
        const parts = line.trim().split(' ');
        
        if (!parts[0] || parts[0] === '') {
            // Complete commands when nothing is typed
            const hits = completions.filter(c => c.startsWith(line));
            return [hits.length ? hits : completions, line];
        }

        if (parts[0] === '/run' || parts[0] === '/save' || parts[0] === '/learn') {
            // Complete DML filenames from all directories
            if (parts.length === 1 || (parts.length === 2 && !line.endsWith(' '))) {
                try {
                    const allNames = new Set();
                    for (const dir of this.dmlExamplesDirs) {
                        if (fs.existsSync(dir)) {
                            const dmlFiles = globSync(path.join(dir, "**/*.dml"));
                            for (const f of dmlFiles) {
                                const filename = path.relative(dir, f);
                                allNames.add(filename);
                                allNames.add(filename.replace('.dml', '').replace(/[\/\\]/g, '.'));
                            }
                        }
                    }
                    
                    const searchTerm = parts[1] || '';
                    const hits = Array.from(allNames).filter(name => name.startsWith(searchTerm));
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
        console.log(`
${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}
${C.bold}${C.cyan}                    DEEPCLAUSE HELP${C.reset}
${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}

${C.yellow}${C.bold}📋 Commands${C.reset}
${C.dim}────────────────────────────────────────────────────────────${C.reset}
  ${C.cyan}help${C.reset}              Show this help message
  ${C.cyan}quit${C.reset} / ${C.cyan}exit${C.reset}      Exit the agent

${C.yellow}${C.bold}🔨 DML Operations${C.reset}
${C.dim}────────────────────────────────────────────────────────────${C.reset}
  ${C.cyan}/create ${C.dim}<desc>${C.reset}    Generate new DML code from description
  ${C.cyan}/create:${C.dim}<file>${C.reset}    Generate DML from prompt in file
  ${C.cyan}/save ${C.dim}<name>${C.reset}      Save last generated DML
  ${C.cyan}/run ${C.dim}<name>${C.reset}       Run a DML file
  ${C.cyan}/learn ${C.dim}<name>${C.reset}     Copy DML to learned examples
  ${C.cyan}/list${C.reset}             List all DML files
  ${C.cyan}/explain${C.reset}          Explain last execution
  ${C.cyan}/tools${C.reset}            List all available tools
  ${C.cyan}/settings${C.reset}         Show current settings

${C.yellow}${C.bold}📁 DML Resolution${C.reset}
${C.dim}────────────────────────────────────────────────────────────${C.reset}
  ${C.brightBlack}1.${C.reset} ./.deepclause/dml_examples  ${C.dim}(local project)${C.reset}
  ${C.brightBlack}2.${C.reset} ~/.deepclause/dml_examples  ${C.dim}(global user)${C.reset}

${C.yellow}${C.bold}💡 Tips${C.reset}
${C.dim}────────────────────────────────────────────────────────────${C.reset}
  • ${C.dim}Tab completion available for commands and filenames${C.reset}
  • ${C.dim}Command history saved between sessions${C.reset}
  • ${C.dim}Press Ctrl+C to interrupt execution${C.reset}
  • ${C.dim}Natural language input processes via AI agent${C.reset}

${C.yellow}${C.bold}📝 Examples${C.reset}
${C.dim}────────────────────────────────────────────────────────────${C.reset}
  ${C.brightWhite}Search for Python tutorials${C.reset}
  ${C.brightWhite}/run web_search.dml${C.reset}
  ${C.brightWhite}/create a web scraper for news${C.reset}

${C.bold}${C.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}
`);
    }

    async createDml(description) {
        if (!description) {
            printError("Usage: /create <description>");
            return;
        }
        
        try {
            const generatedCode = await this.agent.createDml(description);
            
            printSuccess("DML code generated successfully!");
            console.log(createBox(generatedCode, { title: 'GENERATED DML', color: C.magenta, icon: '📜' }));
            printInfo("DML code tracked - use '/save <filename>' to save");

        } catch (error) {
            printError(error.message);
        }
    }

    async createDmlFromFile(filename) {
        if (!filename) {
            printError("Usage: /create:[filename]");
            return;
        }

        try {
            const generatedCode = await this.agent.createDmlFromFile(filename);
            
            printSuccess("DML code generated successfully!");
            console.log(createBox(generatedCode, { title: 'GENERATED DML', color: C.magenta, icon: '📜' }));
            printInfo("DML code tracked - use '/save <filename>' to save");
            
        } catch (error) {
            printError(error.message);
        }
    }

    saveDml(filename) {
        try {
            let result;
            // CLI-only: Check if filename looks like a path (contains / or \, or is absolute)
            if (filename.includes('/') || filename.includes('\\') || path.isAbsolute(filename)) {
                // Save to arbitrary path
                result = this.agent.saveDmlToPath(filename);
            } else {
                // Save to standard examples directory
                result = this.agent.saveDml(filename);
            }
            printSuccess(result);
        } catch (error) {
            printError(error.message);
        }
    }

    async runDmlFile(filename, parameters = "{}") {
        try {
            console.log(`\n${C.dim}${'─'.repeat(50)}${C.reset}`);
            
            // Set up output callback to print to console with rich formatting
            this.agent.outputCallback = (text) => {
                richPrint(text);
            };
            
            isDmlExecuting = true;
            this.currentAbortController = new AbortController();
            
            // CLI-only: Check if filename is a direct path to an existing file
            // (absolute path or relative path that exists)
            const resolvedPath = path.isAbsolute(filename) ? filename : path.resolve(filename);
            if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
                // Read file directly and run its content
                const content = fs.readFileSync(resolvedPath, 'utf-8');
                await this.agent.runDmlContent(content, parameters);
            } else {
                // Fall back to searching in standard directories
                await this.agent.runDmlFile(filename, parameters, null);
            }
            
            flushStreamBuffer(); // Flush any remaining buffered text
            endSingleLineMode(); // Ensure we're on a new line after streaming
            console.log(`${C.dim}${'─'.repeat(50)}${C.reset}`);
            printSuccess("DML execution completed");
        } catch (error) {
            flushStreamBuffer();
            endSingleLineMode();
            if (error.name === 'AbortError' || this.currentAbortController?.signal?.aborted) {
                console.log(`\n${C.yellow}${C.bold}⚠${C.reset} ${C.dim}Execution interrupted by user${C.reset}\n`);
            } else {
                printError(`Error running DML file: ${error.message}`);
            }
        } finally {
            isDmlExecuting = false;
            this.currentAbortController = null;
        }
    }

    async listDmlFiles() {
        try {
            const result = await this.agent.listDmlFiles();
            console.log(result);
        } catch (error) {
            printError(`Error listing DML files: ${error.message}`);
        }
    }

    /**
     * Read the content of a DML file for parameter analysis
     * @param {string} filename - The DML filename (with or without .dml extension)
     * @returns {string|null} - The file content or null if not found
     */
    readDmlFileContent(filename) {
        // CLI-only: First check if filename is a direct path to an existing file
        const resolvedPath = path.isAbsolute(filename) ? filename : path.resolve(filename);
        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isFile()) {
            return fs.readFileSync(resolvedPath, 'utf-8');
        }
        
        // Support both dot notation (browser.find_trials) and direct paths
        let fname = filename;
        if (!fname.endsWith('.dml')) {
            fname = fname.replace(/\./g, '/') + '.dml';
        }
        
        for (const dir of this.dmlExamplesDirs) {
            try {
                const filepath = path.join(dir, fname);
                if (fs.existsSync(filepath)) {
                    return fs.readFileSync(filepath, 'utf-8');
                }
            } catch (err) {
                continue;
            }
        }
        return null;
    }

    async explainLastExecution() {
        try {
            const conversationId = 'cli_session';
            await this.agent.explainLastExecution(conversationId);
        } catch (error) {
            printError(error.message);
        }
    }

    async learnDmlFile(filename) {
        try {
            const result = await this.agent.learnDmlFile(filename);
            printSuccess(result);
        } catch (error) {
            printError(error.message);
        }
    }

    listTools() {
        const tools = getGlobalTools();
        
        if (tools.length === 0) {
            printInfo("No tools available. Bridge may not be initialized.");
            return;
        }

        console.log(`\n${C.bold}${C.cyan}Available Tools${C.reset} ${C.dim}(${tools.length} total)${C.reset}\n`);
        console.log(`${C.dim}${'═'.repeat(60)}${C.reset}`);
        
        // Separate built-in tools from MCP tools
        const builtInTools = tools.filter(t => !t.fromMcp);
        const mcpTools = tools.filter(t => t.fromMcp);
        
        if (builtInTools.length > 0) {
            console.log(`\n${C.yellow}${C.bold}📦 Built-in Tools${C.reset} ${C.dim}(${builtInTools.length})${C.reset}\n`);
            for (const tool of builtInTools) {
                console.log(`  ${C.cyan}●${C.reset} ${C.bold}${tool.name}${C.reset}`);
                if (tool.description) {
                    const desc = tool.description.length > 70 
                        ? tool.description.substring(0, 67) + '...' 
                        : tool.description;
                    console.log(`    ${C.dim}${desc}${C.reset}`);
                }
            }
        }
        
        if (mcpTools.length > 0) {
            console.log(`\n${C.magenta}${C.bold}🔌 MCP Tools${C.reset} ${C.dim}(${mcpTools.length})${C.reset}\n`);
            for (const tool of mcpTools) {
                console.log(`  ${C.magenta}●${C.reset} ${C.bold}${tool.name}${C.reset}`);
                if (tool.description) {
                    const desc = tool.description.length > 70 
                        ? tool.description.substring(0, 67) + '...' 
                        : tool.description;
                    console.log(`    ${C.dim}${desc}${C.reset}`);
                }
            }
        }
        
        console.log(`\n${C.dim}${'═'.repeat(60)}${C.reset}`);
    }

    displaySettings() {
        console.log(`\n${C.bold}${C.cyan}Current Settings${C.reset}\n`);
        console.log(`${C.dim}${'═'.repeat(60)}${C.reset}`);
        
        // Show settings file location
        console.log(`\n${C.yellow}${C.bold}📁 Settings File${C.reset}`);
        console.log(`  ${C.dim}${GLOBAL_SETTINGS}${C.reset}`);
        
        // Read and display settings
        try {
            if (fs.existsSync(GLOBAL_SETTINGS)) {
                const settings = JSON.parse(fs.readFileSync(GLOBAL_SETTINGS, 'utf-8'));
                
                // Display each section
                for (const [section, values] of Object.entries(settings)) {
                    console.log(`\n${C.yellow}${C.bold}⚙️  ${section}${C.reset}`);
                    
                    if (typeof values === 'object' && values !== null) {
                        for (const [key, value] of Object.entries(values)) {
                            const displayValue = typeof value === 'object' 
                                ? JSON.stringify(value) 
                                : String(value);
                            
                            // Mask sensitive values like API keys
                            const maskedValue = key.toLowerCase().includes('key') || key.toLowerCase().includes('token') || key.toLowerCase().includes('secret')
                                ? (displayValue.length > 8 ? displayValue.substring(0, 4) + '****' + displayValue.slice(-4) : '********')
                                : displayValue;
                            
                            console.log(`  ${C.cyan}${key}${C.reset}: ${C.dim}${maskedValue}${C.reset}`);
                        }
                    } else {
                        console.log(`  ${C.dim}${values}${C.reset}`);
                    }
                }
            } else {
                printInfo("No settings file found. Using defaults.");
            }
        } catch (error) {
            printError(`Error reading settings: ${error.message}`);
        }
        
        // Show paths
        console.log(`\n${C.yellow}${C.bold}📂 Paths${C.reset}`);
        console.log(`  ${C.cyan}Workspace${C.reset}:     ${C.dim}${DEFAULT_WORKSPACE}${C.reset}`);
        console.log(`  ${C.cyan}DML Examples${C.reset}:  ${C.dim}${this.dmlExamplesDirs.join(', ')}${C.reset}`);
        console.log(`  ${C.cyan}Config Dir${C.reset}:    ${C.dim}${GLOBAL_DEEPCLAUSE_DIR}${C.reset}`);
        
        console.log(`\n${C.dim}${'═'.repeat(60)}${C.reset}`);
        console.log(`${C.brightBlack}Edit settings at: ${GLOBAL_SETTINGS}${C.reset}\n`);
    }

    async processNaturalLanguageInput(input) {
        printStatus('🤖', 'AGENT', 'Processing request...', C.cyan);
        
        isDmlExecuting = true;
        this.currentAbortController = new AbortController();
        
        try {
            const conversationId = 'cli_session';
            const conversationMessages = [
                { type: 'user', content: input }
            ];
            
            await this.agent.processNaturalLanguageInput(input, conversationId, conversationMessages, this.currentAbortController.signal);
            
            flushStreamBuffer(); // Flush any remaining buffered text
            endSingleLineMode(); // Ensure we're on a new line after streaming
            console.log(`\n${C.green}${C.bold}✓${C.reset} ${C.dim}Agent processing completed${C.reset}\n`);
        } catch (error) {
            flushStreamBuffer();
            endSingleLineMode();
            if (error.name === 'AbortError' || this.currentAbortController?.signal?.aborted) {
                console.log(`\n${C.yellow}${C.bold}⚠${C.reset} ${C.dim}Execution interrupted by user${C.reset}\n`);
            } else {
                printError(error.message);
            }
        } finally {
            isDmlExecuting = false;
            this.currentAbortController = null;
        }
    }

    async runInteractive() {
        printHeader();

        // Print initialization info in a nice box
        const initInfo = `Workspace:     ${DEFAULT_WORKSPACE}
DML Examples:  ${this.dmlExamplesDirs.join(', ')}`;
        console.log(createBox(initInfo, { title: 'CONFIGURATION', color: C.cyan, icon: '⚙️' }));

        console.log(`${C.green}${C.bold}✓ Agent Ready${C.reset}`);
        console.log(`${C.dim}Describe what you want to do and I'll find or create the right DML files.${C.reset}`);
        console.log(`${C.dim}Type 'help' for commands, 'quit' to exit. Tab completion enabled.${C.reset}`);
        console.log();

        // Quick command reference
        console.log(`${C.brightBlack}Quick Commands: ${C.cyan}/list${C.brightBlack} · ${C.cyan}/run${C.brightBlack} · ${C.cyan}/create${C.brightBlack} · ${C.cyan}/tools${C.brightBlack} · ${C.cyan}/explain${C.brightBlack} · ${C.cyan}help${C.reset}`);
        console.log();

        // Set up output callback to print to console with rich formatting
        this.agent.outputCallback = (text) => {
            richPrint(text);
        };
        
        // Set up input callback for readline
        this.agent.inputCallback = createConsoleInputCallback(this.rl);

        return new Promise((resolve) => {
            this.rl.prompt();

            this.rl.on('line', async (input) => {
                const userInput = input.trim();

                // Skip empty input
                if (!userInput) {
                    this.rl.prompt();
                    return;
                }

                try {
                    // Handle special commands
                    if (['quit', 'exit', '/quit', '/exit', '/q'].includes(userInput.toLowerCase())) {
                        console.log(`\n${C.dim}Goodbye! 👋${C.reset}\n`);
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
                                printError("Usage: /create:[filename] or /create <description>");
                            } else {
                                await this.createDmlFromFile(filePart);
                            }
                        } else {
                            const parts = userInput.split(' ');
                            if (parts.length < 2) {
                                printError("Usage: /create <description> or /create:[filename]");
                            } else {
                                const description = parts.slice(1).join(' ');
                                await this.createDml(description);
                            }
                        }
                    } else if (userInput.startsWith('/save')) {
                        const parts = userInput.split(' ');
                        if (parts.length < 2) {
                            printError("Usage: /save <filename>");
                        } else {
                            this.saveDml(parts[1]);
                        }
                    } else if (userInput.startsWith('/run')) {
                        const parts = userInput.split(' ');
                        if (parts.length < 2) {
                            printError("Usage: /run <filename>");
                        } else {
                            await this.runDmlFile(parts[1]);
                        }
                    } else if (userInput.startsWith('/learn')) {
                        const parts = userInput.split(' ');
                        if (parts.length < 2) {
                            printError("Usage: /learn <filename>");
                        } else {
                            await this.learnDmlFile(parts[1]);
                        }
                    } else if (userInput.toLowerCase() === '/explain') {
                        await this.explainLastExecution();
                    } else if (userInput.toLowerCase() === '/list') {
                        await this.listDmlFiles();
                    } else if (userInput.toLowerCase() === '/tools') {
                        this.listTools();
                    } else if (userInput.toLowerCase() === '/settings') {
                        this.displaySettings();
                    } else if (userInput) {
                        await this.processNaturalLanguageInput(userInput);
                    }
                    this.rl.prompt();
                } catch (error) {
                    printError(`Unexpected error: ${error.message}`);
                    this.rl.prompt();
                }
            });

            this.rl.on('close', () => resolve());
        });
    }

    /**
     * Execute a single command or prompt in headless mode (no interactive REPL)
     * @param {string} input - The command or prompt to execute
     * @returns {Promise<void>}
     */
    async executeHeadless(input) {
        const userInput = input.trim();
        
        // Set up output callback to print to console with rich formatting
        this.agent.outputCallback = (text) => {
            richPrint(text);
        };

        try {
            // Handle special commands
            if (userInput.startsWith('/create')) {
                if (userInput.includes(':') && userInput.startsWith('/create:')) {
                    // Handle /create:[file] syntax
                    const filePart = userInput.substring(8); // Remove '/create:' prefix
                    if (!filePart) {
                        printError("Usage: /create:[filename] or /create <description>");
                        return;
                    }
                    await this.createDmlFromFile(filePart);
                } else {
                    const parts = userInput.split(' ');
                    if (parts.length < 2) {
                        printError("Usage: /create <description> or /create:[filename]");
                        return;
                    }
                    const description = parts.slice(1).join(' ');
                    await this.createDml(description);
                }
            } else if (userInput.startsWith('/save')) {
                const parts = userInput.split(' ');
                if (parts.length < 2) {
                    printError("Usage: /save <filename>");
                    return;
                }
                this.saveDml(parts[1]);
            } else if (userInput.startsWith('/run')) {
                const parts = userInput.split(' ');
                if (parts.length < 2) {
                    printError("Usage: /run <filename>");
                    return;
                }
                await this.runDmlFile(parts[1]);
            } else if (userInput.startsWith('/learn')) {
                const parts = userInput.split(' ');
                if (parts.length < 2) {
                    printError("Usage: /learn <filename>");
                    return;
                }
                await this.learnDmlFile(parts[1]);
            } else if (userInput.toLowerCase() === '/explain') {
                await this.explainLastExecution();
            } else if (userInput.toLowerCase() === '/list') {
                await this.listDmlFiles();
            } else if (userInput.toLowerCase() === '/tools') {
                this.listTools();
            } else if (userInput.toLowerCase() === '/help' || userInput.toLowerCase() === 'help') {
                this.displayHelp();
            } else if (userInput) {
                // Natural language input - process with agent
                await this.processNaturalLanguageInput(userInput);
            }
        } catch (error) {
            printError(error.message);
            process.exit(1);
        }
    }
}

/**
 * Parse command line arguments
 * @returns {{ headless: boolean, prompt: string | null, create: string | null, run: string | null, output: string | null, list: boolean, input: string | null, help: boolean }}
 */
function parseArgs() {
    const args = process.argv.slice(2);
    const result = { headless: false, prompt: null, create: null, run: null, output: null, list: false, input: null, help: false };
    
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        
        if (arg === '-x' || arg === '--execute') {
            // Legacy: -x for any prompt (kept for backward compatibility)
            result.headless = true;
            if (i + 1 < args.length) {
                result.prompt = args[i + 1];
                i++;
            }
        } else if (arg === '-p' || arg === '--prompt') {
            // -p [prompt]: any prompt including / commands
            result.headless = true;
            if (i + 1 < args.length) {
                result.prompt = args[i + 1];
                i++;
            }
        } else if (arg === '-c' || arg === '--create') {
            // -c [prompt]: run /create [prompt], expects -o for output
            result.headless = true;
            if (i + 1 < args.length) {
                result.create = args[i + 1];
                i++;
            }
        } else if (arg === '-r' || arg === '--run') {
            // -r [filename]: run /run [filename]
            result.headless = true;
            if (i + 1 < args.length) {
                result.run = args[i + 1];
                i++;
            }
        } else if (arg === '-o' || arg === '--output') {
            // -o [name]: output filename for -c (create)
            if (i + 1 < args.length) {
                result.output = args[i + 1];
                i++;
            }
        } else if (arg === '-l' || arg === '--list') {
            // -l: list all DML files with parameters
            result.headless = true;
            result.list = true;
        } else if (arg === '-i' || arg === '--input') {
            // -i [json]: input parameters for DML execution
            if (i + 1 < args.length) {
                result.input = args[i + 1];
                i++;
            }
        } else if (arg === '-h' || arg === '--help') {
            result.help = true;
        } else if (arg === '-v' || arg === '--verbose') {
            result.verbose = true;
        }
    }
    
    return result;
}

/**
 * Print CLI usage help
 */
function printUsage() {
    console.log(`
${C.bold}${C.cyan}DeepClause CLI${C.reset} ${C.dim}- Neurosymbolic AI Agent${C.reset}

${C.yellow}${C.bold}Usage:${C.reset}
  ${C.brightWhite}deepclause${C.reset}                              ${C.dim}Start interactive mode${C.reset}
  ${C.brightWhite}deepclause -p "<prompt>"${C.reset}                ${C.dim}Execute any prompt (including / commands)${C.reset}
  ${C.brightWhite}deepclause -c "<prompt>" -o <name>${C.reset}      ${C.dim}Create DML and save to file${C.reset}
  ${C.brightWhite}deepclause -r <filename> [-i <json>]${C.reset}    ${C.dim}Run a DML file with optional parameters${C.reset}
  ${C.brightWhite}deepclause -l${C.reset}                           ${C.dim}List all DML files with parameters${C.reset}
  ${C.brightWhite}deepclause -h, --help${C.reset}                   ${C.dim}Show this help${C.reset}

${C.yellow}${C.bold}Options:${C.reset}
  ${C.cyan}-p, --prompt${C.reset}  ${C.dim}<prompt>${C.reset}    Any prompt including / commands
  ${C.cyan}-c, --create${C.reset}  ${C.dim}<prompt>${C.reset}    Run /create <prompt>, use with -o to save
  ${C.cyan}-r, --run${C.reset}     ${C.dim}<file>${C.reset}      Run a DML file (name or path)
  ${C.cyan}-l, --list${C.reset}               List all DML files with parameters
  ${C.cyan}-i, --input${C.reset}   ${C.dim}<json>${C.reset}      Input parameters as JSON for -r or -p "/run ..."
  ${C.cyan}-o, --output${C.reset}  ${C.dim}<file>${C.reset}      Output file for -c (name or path)
  ${C.cyan}-v, --verbose${C.reset}            Show detailed execution logs
  ${C.cyan}-x, --execute${C.reset} ${C.dim}<prompt>${C.reset}    Legacy: same as -p
  ${C.cyan}-h, --help${C.reset}                 Show this help

${C.yellow}${C.bold}Examples:${C.reset}
  ${C.cyan}deepclause -l${C.reset}                                   ${C.dim}List all DML files${C.reset}
  ${C.cyan}deepclause -r myagent.dml${C.reset}                       ${C.dim}Run a DML file${C.reset}
  ${C.cyan}deepclause -r ./path/to/agent.dml${C.reset}               ${C.dim}Run a DML file by path${C.reset}
  ${C.cyan}deepclause -r search.dml -i '{"query":"AI news"}'${C.reset} ${C.dim}Run with parameters${C.reset}
  ${C.cyan}deepclause -c "a web search agent" -o websearch${C.reset} ${C.dim}Create and save DML${C.reset}
  ${C.cyan}deepclause -c "a web search agent" -o ./agents/search.dml${C.reset} ${C.dim}Save to path${C.reset}
  ${C.cyan}deepclause -p "Search for Python tutorials"${C.reset}     ${C.dim}Natural language${C.reset}

${C.yellow}${C.bold}Interactive Commands:${C.reset}
  ${C.cyan}/create${C.reset} ${C.dim}<desc>${C.reset}       Generate DML from description
  ${C.cyan}/run${C.reset} ${C.dim}<file>${C.reset}         Run a DML file
  ${C.cyan}/save${C.reset} ${C.dim}<name>${C.reset}        Save last generated DML
  ${C.cyan}/list${C.reset}              List available DML files
  ${C.cyan}/tools${C.reset}             List all tools
  ${C.cyan}/explain${C.reset}           Explain last execution
  ${C.cyan}quit${C.reset}               Exit

${C.yellow}${C.bold}Configuration:${C.reset}
  ${C.dim}Settings:${C.reset}      ~/.deepclause/settings.json
  ${C.dim}DML Files:${C.reset}     ~/.deepclause/dml_examples/
  ${C.dim}Workspace:${C.reset}     Current directory
`);
}

// ===== Main entry point =====
async function main() {
    const args = parseArgs();
    
    // Show help and exit
    if (args.help) {
        printUsage();
        process.exit(0);
    }
    
    // Set verbose mode if -v flag is provided
    if (args.verbose) {
        setVerbose(true);
    }
    
    try {
        await initBridge();
    } catch (e) {
        console.error(`${C.yellow}${C.bold}⚠ WARNING${C.reset} ${C.dim}│${C.reset} MCP initialization failed: ${e.message}`);
    }
    
    const agent = new CLIAgent();
    
    // Headless mode: execute prompt and exit
    if (args.headless) {
        // -l: list all DML files with parameters
        if (args.list) {
            await agent.listDmlFiles();
            try { await shutdownMcpClients(); } catch {}
            process.exit(0);
        }
        
        // -c [prompt]: create DML and optionally save with -o
        if (args.create) {
            await agent.executeHeadless(`/create ${args.create}`);
            if (args.output) {
                await agent.executeHeadless(`/save ${args.output}`);
            }
            try { await shutdownMcpClients(); } catch {}
            process.exit(0);
        }
        
        // -r [filename]: run DML file with optional parameters
        if (args.run) {
            let params = "{}";
            
            // Validate JSON if -i is provided
            if (args.input) {
                try {
                    JSON.parse(args.input);
                    params = args.input;
                } catch (e) {
                    printError(`Invalid JSON for -i parameter: ${e.message}`);
                    console.error(`${C.dim}Provided: ${args.input}${C.reset}`);
                    console.error(`${C.dim}Example:  -i '{"topic":"AI news"}'${C.reset}`);
                    process.exit(1);
                }
            }
            
            // Try to read the DML file and check for missing parameters
            try {
                const dmlContent = agent.readDmlFileContent(args.run);
                if (dmlContent) {
                    const dmlParams = analyzeDmlParameters(dmlContent);
                    if (dmlParams.length > 0) {
                        const providedParams = JSON.parse(params);
                        const providedKeys = Object.keys(providedParams);
                        const missingParams = dmlParams.filter(p => {
                            // Extract the base name (without type suffix like :file, :select, etc.)
                            const baseName = p.name || p.key.split(':')[0];
                            return !providedKeys.includes(baseName) && !providedKeys.includes(p.key);
                        });
                        
                        if (missingParams.length > 0) {
                            console.log(`${C.yellow}${C.bold}⚠ WARNING${C.reset} ${C.dim}│${C.reset} Missing parameters for ${C.cyan}${args.run}${C.reset}:`);
                            for (const p of missingParams) {
                                const baseName = p.name || p.key.split(':')[0];
                                console.log(`  ${C.dim}•${C.reset} ${C.cyan}${baseName}${C.reset}: ${p.description}`);
                            }
                            console.log(`${C.dim}Use -i '{"${missingParams[0].name || missingParams[0].key.split(':')[0]}":"value",...}' to provide parameters${C.reset}\n`);
                        }
                    }
                }
            } catch (e) {
                // File not found or other error - let runDmlFile handle it
            }
            
            await agent.runDmlFile(args.run, params);
            try { await shutdownMcpClients(); } catch {}
            process.exit(0);
        }
        
        // -p or -x [prompt]: any prompt (may include /run with -i parameters)
        if (!args.prompt) {
            printError("Headless mode requires -p <prompt>, -c <prompt>, -r <filename>, or -l");
            console.error(`${C.dim}Usage: deepclause -p "<prompt>" | -c "<prompt>" -o <name> | -r <filename> [-i <json>] | -l${C.reset}`);
            process.exit(1);
        }
        
        // Handle /run in prompt with -i parameters
        if (args.prompt.startsWith('/run ') && args.input) {
            const filename = args.prompt.substring(5).trim();
            await agent.runDmlFile(filename, args.input);
        } else {
            await agent.executeHeadless(args.prompt);
        }
        try { await shutdownMcpClients(); } catch {}
        process.exit(0);
    }
    
    // Interactive mode
    await agent.runInteractive();
    try { await shutdownMcpClients(); } catch {}
}

// Check if this is the main module - handle both direct execution and symlinks (npm link)
const isMainModule = (() => {
    const scriptPath = process.argv[1];
    const modulePath = fileURLToPath(import.meta.url);
    
    // Direct match
    if (import.meta.url === `file://${scriptPath}`) return true;
    
    // Handle symlinks by resolving real paths
    try {
        const realScriptPath = fs.realpathSync(scriptPath);
        return realScriptPath === modulePath;
    } catch {
        return false;
    }
})();

if (isMainModule) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

export { CLIAgent, main };
