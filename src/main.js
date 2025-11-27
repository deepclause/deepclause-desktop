#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { globSync } from 'glob';

import { richPrint, init as initBridge, shutdownMcpClients } from './dml-js/bridge.js';
import { DMLAgent } from './electron/main/dml-agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Default paths for CLI usage
const DEFAULT_WORKSPACE = "./workspace";
const DEFAULT_DML_EXAMPLES = "./dml_examples";
const DEFAULT_CONFIG = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.deepclause', 'config.json');

// Ensure default directories exist and copy initial files
if (!fs.existsSync(DEFAULT_WORKSPACE)) {
    fs.mkdirSync(DEFAULT_WORKSPACE, { recursive: true });
}
if (!fs.existsSync(DEFAULT_DML_EXAMPLES)) {
    fs.mkdirSync(DEFAULT_DML_EXAMPLES, { recursive: true });
}

// Copy mi.qsave from initial_workspace if it doesn't exist in workspace
const miQsavePath = path.join(DEFAULT_WORKSPACE, 'mi.qsave');
if (!fs.existsSync(miQsavePath)) {
    const sourceMiQsave = path.join(__dirname, 'electron', 'initial_workspace', 'mi.qsave');
    if (fs.existsSync(sourceMiQsave)) {
        fs.copyFileSync(sourceMiQsave, miQsavePath);
        console.log(`Copied mi.qsave to ${miQsavePath}`);
    } else {
        console.warn(`Warning: mi.qsave not found at ${sourceMiQsave}. DML execution may not work in production mode.`);
    }
}

// Add global flag to track DML execution state
let isDmlExecuting = false;

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
 * CLI wrapper for DMLAgent - adds interactive terminal features
 */
class CLIAgent {
    constructor() {
        const paths = {
            workspace: DEFAULT_WORKSPACE,
            dmlExamples: DEFAULT_DML_EXAMPLES,
            config: DEFAULT_CONFIG
        };

        // Create the core DML agent
        this.agent = new DMLAgent(paths, null, null);
        this.dmlExamplesDir = DEFAULT_DML_EXAMPLES;

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
            if (isDmlExecuting) {
                console.log('\n\n⚠️  Interrupting execution (Ctrl+C)...');
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
                    const dmlFiles = globSync(path.join(this.dmlExamplesDir, "**/*.dml"));
                    const filenames = dmlFiles.map(f => path.relative(this.dmlExamplesDir, f));
                    const baseNames = filenames.map(f => f.replace('.dml', '').replace(/[\/\\]/g, '.'));
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
- "Search for information about Python" (agent will find and use DML files that do some form of search)
- "Analyze this document" (agent will use any existing analysis DML files)
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
        
        try {
            const generatedCode = await this.agent.createDml(description);
            
            console.log("\n✅ DML code generated successfully!");
            console.log("-".repeat(50));
            console.log(generatedCode);
            console.log("-".repeat(50));
            console.log(`💾 DML code tracked (use '/save <filename>' to save)`);

        } catch (error) {
            console.log(`\n❌ ${error.message}`);
        }
    }

    async createDmlFromFile(filename) {
        if (!filename) {
            console.log("❌ Usage: /create:[filename]");
            return;
        }

        try {
            const generatedCode = await this.agent.createDmlFromFile(filename);
            
            console.log("\n✅ DML code generated successfully!");
            console.log("-".repeat(50));
            console.log(generatedCode);
            console.log("-".repeat(50));
            console.log(`💾 DML code tracked (use '/save <filename>' to save)`);
            
        } catch (error) {
            console.log(`❌ ${error.message}`);
        }
    }

    saveDml(filename) {
        try {
            const result = this.agent.saveDml(filename);
            console.log(`✅ ${result}`);
        } catch (error) {
            console.log(`❌ ${error.message}`);
        }
    }

    async runDmlFile(filename) {
        try {
            console.log(`🚀 Running DML file: ${filename}`);
            console.log("-".repeat(40));
            
            isDmlExecuting = true;
            await this.agent.runDmlFile(filename);
            
            console.log("-".repeat(40));
            console.log("✅ DML execution completed");
        } catch (error) {
            console.log(`❌ Error running DML file: ${error.message}`);
        } finally {
            isDmlExecuting = false;
        }
    }

    async listDmlFiles() {
        try {
            const result = await this.agent.listDmlFiles();
            console.log(result);
        } catch (error) {
            console.log(`❌ Error listing DML files: ${error.message}`);
        }
    }

    async explainLastExecution() {
        try {
            const conversationId = 'cli_session';
            await this.agent.explainLastExecution(conversationId);
        } catch (error) {
            console.log(`❌ ${error.message}`);
        }
    }

    async processNaturalLanguageInput(input) {
        console.log("\n🤖 Running agent...");
        
        isDmlExecuting = true;
        
        try {
            // Create a simple conversation ID for CLI
            const conversationId = 'cli_session';
            
            // Set up output callback to print to console with rich formatting
            this.agent.outputCallback = (text) => {
                richPrint(text);
            };
            
            // Set up input callback for readline
            this.agent.inputCallback = createConsoleInputCallback(this.rl);
            
            // Build conversation messages array with the current user input
            const conversationMessages = [
                { type: 'user', content: input }
            ];
            
            await this.agent.processNaturalLanguageInput(input, conversationId, conversationMessages);
            
            console.log("\n\n✅ Agent processing completed.");
        } catch (error) {
            console.log(`❌ Error: ${error.message}`);
        } finally {
            isDmlExecuting = false;
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
        console.log("- help: Show help message");
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
    const agent = new CLIAgent();
    await agent.runInteractive();
    try { await shutdownMcpClients(); } catch {}
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('Error:', error);
        process.exit(1);
    });
}

export { CLIAgent, main };
