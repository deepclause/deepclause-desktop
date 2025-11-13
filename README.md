# DeepClause

<p align="center">
  <img src="src/electron/renderer/public/assets/logo_only.png" alt="DeepClause Logo" width="120"/>
</p>

<p align="center">
  <strong>The Missing Logic Agent</strong><br/>
</p>

<p align="center">
  <a href="#-download">Download</a> •
  <a href="#-what-is-deepclause">What is DeepClause?</a> •
  <a href="#-key-features">Features</a> •
  <a href="#-use-cases">Use Cases</a> •
  <a href="#-examples">Examples</a> •
  <a href="#-development">Development</a>
</p>

---

## 🎬 Demo Videos

TODO

---

## 🧠 What is DeepClause?

**DeepClause** is a **neurosymbolic Agentic AI system** that bridges the gap between symbolic reasoning and neural language models. Unlike pure LLM-based agents that struggle with complex logic, multi-step reasoning, and deterministic behavior, DeepClause uses **DML (DeepClause Meta Language)** - a Prolog-based DSL - to encode agent behaviors as executable logic programs.

### Core Motivation

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


### Quick Introduction to the DeepClause Desktop-App

The **DeepClause Desktop Application** is an Electron-based development environment that provides an intuitive interface for creating, managing, and executing DML (DeepClause Meta Language) programs. Built with React and TypeScript, the app features a modern chat-based interface where you interact with an intelligent agent that can discover existing DML skills, create new ones on-the-fly from natural language descriptions, and orchestrate complex multi-step workflows. The interface includes specialized panels for browsing your DML skill library, exploring workspace files, monitoring the embedded Linux VM console (V86 emulator), and managing conversation history—all synchronized through a unified state management system powered by Zustand.

Under the hood, the desktop app orchestrates a sophisticated three-layer architecture: the **JavaScript/Node.js layer** (Electron main process) handles file I/O, settings management, and tool integration; the **WebAssembly layer** runs the SWI-Prolog WASM module for symbolic reasoning and DML execution; and the **sandboxed V86 Linux VM** provides isolated execution for Python scripts and bash commands. The agent system uses a hybrid planning approach—it first analyzes your request, searches for relevant existing DML files, determines if modifications or new skills are needed, then generates a multi-step execution plan. Each DML file can declare typed parameters (file pickers, dropdowns, multi-select) that are automatically rendered as interactive input dialogs, and execution output is streamed in real-time with support for progress indicators, structured logs, and rich markdown rendering including embedded diagrams (Mermaid), code highlighting, and workspace file previews.

Whether you're conducting research, processing data, solving logic puzzles, or building custom AI agents, the desktop app provides a polished, self-contained environment where symbolic reasoning meets neural intelligence—no terminal commands required, just natural language conversations that compile into executable logic programs.

---

## 🎮 Basic Usage Guide

### Natural Language Mode

Simply describe what you want to accomplish in natural language. The DeepClause agent will:
1. Analyze your request and search for relevant existing DML skills
2. Determine if existing skills can solve the task or if new ones are needed
3. Create an execution plan and either run existing DML files or generate new ones
4. Execute the plan and stream results in real-time

**Example**: "Research recent advances in quantum computing and create a summary report with citations"

### Slash Commands

For more direct control, use these commands in the chat interface:

- **`/run [skill.dml]`** - Execute a specific DML skill file
  - *Tip: Click any DML file in the left sidebar to auto-populate this command*
  
- **`/create [description]`** - Generate a new DML skill from a natural language description
  - *Example*: `/create Search for Python tutorials and extract the top 5 beginner-friendly resources`
  
- **`/explain`** - Get a detailed explanation of the last execution
  - Shows which decisions were made by symbolic logic vs AI/LLM
  - Provides reliability estimates and step-by-step breakdowns
  - Ideal for understanding, debugging, or learning how DML works
  
- **`/learn [skill.dml]`** - Add a skill to the agent's context for future reference
  
- **`/help`** - Display all available commands

### Interactive Parameters

When a DML skill requires input, interactive dialogs will appear automatically:
- **File pickers** for selecting workspace files
- **Dropdown menus** for single-choice options
- **Multi-select lists** for choosing multiple items
- **Text inputs** for custom values

No manual parameter configuration needed—the interface guides you through each step.

---

## 📥 Download

> **Status**: DeepClause is currently in active development (v0.0.1).

**Pre-release downloads** (available soon):
- [Windows (x64)](https://github.com/apfadler/DeepClauseCLI/releases) - `.exe` installer
- [macOS (Intel)](https://github.com/apfadler/DeepClauseCLI/releases) - `.dmg` 
- [macOS (Apple Silicon)](https://github.com/apfadler/DeepClauseCLI/releases) - `.dmg`
- [Linux (x64)](https://github.com/apfadler/DeepClauseCLI/releases) - `.AppImage` or `.deb` 

**Requirements**: 
- OpenAI API key or compatible LLM provider (Anthropic, Google, OpenRouter, etc.)
- For search tools: API keys for either Serper, Brave or You.com

---

### Architecture Highlights

DeepClause runs on a **unique three-layer security architecture**:

1. **JavaScript Layer** (Electron/Node.js) - Orchestration, LLM integration, tool calling
2. **WebAssembly Layer** (SWI-Prolog WASM Module) - Symbolic reasoning, logic execution
3. **Isolated Linux VM** (V86 emulator) - Sandboxed Python/Bash execution for heavy computation

This architecture provides:
- **Memory Safety**: WASM prevents buffer overflows and memory corruption
- **Filesystem Isolation**: All file operations restricted to workspace directory
- **VM Sandboxing**: Untrusted code execution isolated from host system
- **Explicit Permissions**: No ambient authority - capabilities must be invoked explicitly

Learn more: [DML Reference Documentation](docs/dml_reference.md)

---

## ✨ Key Features

### 🎯 Hybrid Execution Model
- **Symbolic reasoning** via Prolog (pattern matching, unification, constraint solving)
- **Neural understanding** via LLMs (semantic extraction, content generation)
- **Seamless integration** through `@-predicates` that transform natural language instructions into Prolog predicates

### 🔍 Explainability Out of the Box
- **Transparent Logic**: Every skill is readable Prolog source code - no hidden prompts or black boxes
- **Execution Tracing**: See exactly which predicates were called, which tools were invoked, and in what order
- **AI vs Logic Attribution**: The `/explain` command automatically identifies which decisions were made by:
  - **Symbolic logic** (deterministic rules, pattern matching, constraint solving)
  - **AI/LLM** (semantic understanding, content generation, @-predicates)
- **Plain-English Summaries**: Get non-technical explanations of what happened during execution
- **Reliability Estimates**: Understand confidence levels based on execution output
- **Step-by-Step Walkthroughs**: See the reasoning process, not just the final answer

Unlike pure LLM agents where decisions are opaque, DeepClause makes every choice traceable and explainable - critical for regulated industries, debugging, and building trust.

### 🔧 Rich Tool Ecosystem
- **Web Search**: Google, Brave, Google Scholar integration
- **Linux VM**: Execute Python scripts, bash commands, data processing pipelines
- **File I/O**: Read/write workspace files with automatic path sandboxing
- **MCP Protocol**: Extensible tool integration via Model Context Protocol
- **Custom Tools**: Mermaid diagrams, data visualization, web scraping

### 🧩 Declarative Skills (DML Programs)
- **Skills as Code**: Every capability encoded as a `.dml` file
- **Multi-branch Logic**: Sophisticated fallback strategies via Prolog's backtracking
- **Inspectable & Debuggable**: Read the actual logic, no hidden prompt engineering
- **Composable**: Creating complex workflows by orchestrating skills

### 🔄 Interactive Workflows
- **Typed Parameters**: File pickers, dropdowns, multi-select inputs
- **Streaming Output**: Real-time progress updates during long-running tasks
- **User Input**: Pause execution to request clarification or additional data
- **Cooperative Execution**: Non-blocking async execution model

### 🛡️ Security by Design
- Defense-in-depth architecture with multiple isolation boundaries
- Workspace-restricted file access (no system file reading)
- VM sandboxing for untrusted code execution
- Explicit tool invocation (no hidden capabilities)



---

## 💡 Use Cases

### 📊 Research & Analysis
**Problem**: Conducting literature reviews, market research, or competitive analysis requires gathering data from multiple sources, synthesizing findings, and generating structured reports.

**DeepClause Solution**: Create DML skills that orchestrate multi-step research workflows:
- Search academic databases and web sources
- Extract key information with LLM semantic understanding
- Use Prolog logic to verify completeness and identify gaps
- Generate citation-backed reports with proper attribution

**Example**: `deep_research.dml` - Automatically generates comprehensive research reports with citations

### 🧩 Logic Puzzles, Constraint Solving, linear optimization
**Problem**: Solving Sudoku, N-Queens, scheduling problems, or combinatorial optimization requires systematic search and constraint propagation.

**DeepClause Solution**: Leverage SWI-Prolog's CLP(FD) library:
- Define constraints declaratively
- Let Prolog's constraint solver find solutions
- Use LLM to explain solutions in natural language
- Visualize results with generated diagrams

**Example**: `logic_puzzle.dml` - Constraint-based puzzle solver with step-by-step explanations


### 🤖 ReAct-Style Agents
**Problem**: Building agents that reason about available tools, plan multi-step actions, and adapt based on observations.

**DeepClause Solution**: Implement ReAct (Reasoning + Acting) loop natively in DML:
- LLM generates thoughts and action plans
- Prolog manages the reasoning loop and history
- Tools execute actions with type-safe invocation
- Deterministic control flow prevents hallucinated actions

**Example**: `react_agent.dml` - General-purpose ReAct agent with 30-step planning


---

## 🎯 Examples

### Example 1: Hello World

The simplest DML program:

```prolog
agent_main :-
    answer("Hello from DeepClause! 🎉").
```

**What happens**: 
- Entry point `agent_main` is called
- `answer/1` sends final response to user
- Execution completes

### Example 2: Web Search with LLM Extraction

Combine tool calling with semantic understanding:

```prolog
agent_main :-
    % Search the web
    tool(web_search("latest AI breakthroughs 2024"), Results),
    
    % Extract structured data using LLM
    extract_breakthroughs(Results, Breakthroughs),
    
    % Present findings
    format_report(Breakthroughs, Report),
    answer(Report).

% @-predicate: LLM-powered function
extract_breakthroughs(SearchResults, BreakthroughsList) :-
    @("From the SearchResults, extract a list of major AI breakthroughs. 
       Each item should include: technology name, organization, and key innovation.
       Return as a Prolog list of structured terms.").

% Standard Prolog predicate
format_report([], "No breakthroughs found.").
format_report([H|T], Report) :-
    format_report(T, RestReport),
    format(string(Report), "• ~w\n~w", [H, RestReport]).
```

**What happens**:
1. `tool(web_search(...), Results)` - JavaScript layer calls web search API
2. `extract_breakthroughs(...)` - WASM layer delegates to LLM via `@-predicate`
3. `format_report(...)` - Prolog recursively builds formatted output
4. `answer(Report)` - Final response streamed to UI

### Example 3: Multi-Branch Reasoning

Implement robust fallback strategies:

```prolog
agent_main :-
    % Branch 1: Try Google Scholar for academic sources
    tool(google_scholar_search("quantum computing", 10), Papers),
    Papers \= "",  % Verify we got results
    analyze_papers(Papers, Analysis),
    answer("Academic Analysis:\n\n{Analysis}").

agent_main :-
    % Branch 2: Fallback to general web search
    log("Scholar search failed, using web search"),
    tool(web_search("quantum computing research"), Results),
    summarize_findings(Results, Summary),
    answer("Web Summary:\n\n{Summary}").

agent_main :-
    % Branch 3: Last resort - provide general information
    answer("I apologize, but I couldn't access current research. 
            However, I can explain quantum computing concepts if helpful.").
```

**What happens**:
- DeepClause tries Branch 1 first
- If Branch 1 **fails** (scholar search returns empty), **backtracks** to Branch 2
- If Branch 2 **succeeds**, execution **stops** (Branch 3 never tried)
- Branch 3 always succeeds - guarantees graceful degradation

### Example 4: Constraint Logic Programming

Solve combinatorial problems declaratively:

```prolog
:- use_module(library(clpfd)).

agent_main :-
    % Define Sudoku puzzle (0 = empty cell)
    Puzzle = [
        [5,3,0, 0,7,0, 0,0,0],
        [6,0,0, 1,9,5, 0,0,0],
        % ... more rows
    ],
    
    % Solve using CLP(FD)
    sudoku(Puzzle, Solution),
    
    % Visualize solution
    create_sudoku_diagram(Solution, Diagram),
    answer("Solved! 🎉\n\n{Diagram}").

sudoku(Rows, Rows) :-
    length(Rows, 9),
    maplist(length_(9), Rows),
    append(Rows, Vs), Vs ins 1..9,
    maplist(all_distinct, Rows),
    transpose(Rows, Columns),
    maplist(all_distinct, Columns),
    Rows = [A,B,C,D,E,F,G,H,I],
    blocks(A, B, C), blocks(D, E, F), blocks(G, H, I),
    label(Vs).
```

**What happens**:
- Prolog's CLP(FD) solver finds valid Sudoku solution
- No brute-force search needed - constraint propagation guides search
- Solution guaranteed to satisfy all constraints
- LLM generates readable explanation

### Example 5: Python Data Processing

Execute complex computations in isolated VM:

```prolog
agent_main :-
    param("data_file:file", "Select CSV dataset", DataFile),
    
    % Read data
    read_file_to_string(DataFile, CSV, []),
    
    % Generate Python analysis script
    Script = {|string||
import pandas as pd
import matplotlib.pyplot as plt
from io import StringIO

# Read CSV from stdin
df = pd.read_csv(StringIO('''~w'''))

# Statistical analysis
stats = df.describe().to_json()
print(stats)

# Create visualization
df.plot(kind='bar')
plt.savefig('analysis.png')
|},
    format(string(FullScript), Script, [CSV]),
    
    % Execute in VM
    tool(vm_exec(FullScript), StatsJSON),
    
    % Parse and present results
    atom_json_dict(StatsJSON, Stats, []),
    answer("Analysis complete! 📊\n\n![Chart](analysis.png)\n\nStatistics: {Stats}").
```

**What happens**:
1. User selects CSV file via file picker
2. Prolog reads file content
3. Multi-line Python script generated with quasi-quotation `{|string||...|}` 
4. Script executed in sandboxed Linux VM (no host access)
5. Results parsed and displayed with embedded chart

### Example 6: Explainability in Action

After running any skill, use `/explain` to understand what happened:

```bash
User: /run deep_research.dml
[... execution output ...]

User: /explain
```

**DeepClause responds with:**

```markdown
## Execution Explanation

### What the program was designed to do
This program conducted comprehensive research on your topic by gathering 
information from multiple sources and synthesizing it into a structured report.

### The execution flow
1. Performed initial web search to understand the topic broadly
2. Analyzed search results to identify key themes and concepts
3. Generated 5 targeted search queries for deeper investigation
4. Executed those searches and gathered detailed information
5. Verified that enough quality information was collected
6. Structured the findings into a logical report outline
7. Wrote each section with proper citations
8. Saved the final report to your workspace

### Decision points
**Symbolic Logic Decisions:**
- Validating search result format (checking for non-empty strings)
- Controlling the research loop (try initial → try targeted → fallback)
- Verifying information sufficiency (counting sources, checking completeness)
- Managing file I/O (opening, writing, closing research_report.md)

**AI/LLM Decisions:**
- Understanding the initial search results to create topic overview
- Crafting targeted search queries based on gaps found
- Extracting key information and associating with sources
- Generating the report structure and section titles
- Writing natural language summaries of findings

### The final result
Successfully generated a comprehensive research report saved to 
'research_report.md'. The report includes 8 sections with citations 
to 12 unique sources.

**Reliability estimate:** High - multiple sources cross-referenced, 
logical structure validated, all citations properly attributed.
```

**Why this matters:**
- **Transparency**: You see exactly which parts used AI reasoning vs deterministic logic
- **Trust**: Understand why certain decisions were made
- **Debugging**: If something went wrong, you know where to look
- **Learning**: Understand how DML programs work by seeing them explained

---

## 📚 Documentation

- **[DML Language Reference](docs/dml_reference.md)** - Complete guide to DML syntax, built-in predicates, and execution model
- **[Architecture Security](docs/dml_reference.md#security-benefits-of-the-three-layer-architecture)** - Deep dive into the three-layer isolation model
- **Example Skills** - See `src/electron/initial_examples/*.dml` for 20+ working examples

---

## 🚀 Getting Started

### Using Pre-built Binaries (Coming Soon)

1. Download the installer for your platform
2. Install and launch DeepClause
3. Configure your LLM provider (OpenAI, Anthropic, etc.) in Settings
4. Try example skills or chat naturally to create new ones

### Commands

- **Natural language**: Just describe what you want - DeepClause will find or create appropriate skills

or use any of these slash commands:

- `/run [skill.dml]` - Execute a specific skill
- `/create [description]` - Generate a new skill from natural language
- `/explain` - Get a plain-English explanation of the last execution, showing which decisions were symbolic logic vs AI
- `/learn [skill.dml]` - Add skill to context for future skill creation
- `/help` - Show all available commands

---

## 🛠️ Development Setup

### Prerequisites

- **Node.js** v18+ and npm
- **Git**

### Installation

```bash
# Clone the repository
git clone https://github.com/apfadler/DeepClauseCLI.git
cd DeepClauseCLI/wasm

# Install dependencies
npm install

# Download the Alpine Linux VM image (required for vm_exec tool)
# Download from: https://drive.google.com/file/d/1gyV4Xfn-s9JSV_nThe-fhKO5886OmEmf/view?usp=sharing
# Place the downloaded alpine.img file in: vendor/v86/images/alpine.img


### Running in Development

```bash
# Start vite
npm run dev:vite

# Start the Electron app in development mode
npm run electron:dev
```

This will start both the Vite dev server for the renderer process and the Electron main process with hot reload enabled.

### Project Structure

```
wasm/
├── src/
│   ├── electron/          # Electron app
│   │   ├── main/         # Main process (Node.js)
│   │   ├── renderer/     # Renderer process (React UI)
│   │   └── initial_examples/  # Example DML skills
│   ├── dml-js/           # JavaScript bridge & tools
│   │   ├── bridge.js     # WASM ↔ JS orchestration
│   │   └── tools.js      # Tool implementations
│   ├── dml-core/         # SWI-Prolog WASM core
│   │   ├── plogchain.pl  # Meta-interpreter (mi/5)
│   │   └── cmdline.pl    # Cooperative engine
│   └── main.js           # CLI entry point
├── vendor/               # SWI-Prolog WASM & V86 binaries
├── workspace/            # User workspace (sandboxed)
├── docs/                 # Documentation
└── package.json
```

### Building

```bash
# Build for current platform
npm run build

# Build for specific platforms
npm run build:linux
npm run build:mac
npm run build:win
```

Binaries will be output to `dist/`.

### Contributing

DeepClause is in active development. Contributions welcome! Areas of focus:

1. **New Tool Integrations** - Add tools to `src/dml-js/tools.js`
2. **Example Skills** - Create `.dml` examples showcasing interesting use cases
3. **Documentation** - Improve guides, tutorials, API docs

and many more!

Please open issues for bugs or feature requests.

---

## 🎓 Research & Background

DeepClause builds on decades of research in:

- **Logic Programming**: Prolog (1972), constraint logic programming
- **Neurosymbolic AI**: Combining neural networks with symbolic reasoning
- **LLM Agents**: ReAct, Chain-of-Thought, tool-augmented language models
- **WebAssembly**: Sandboxed execution, portable bytecode

---


## 📜 License

ISC License - See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

DeepClause stands on the shoulders of giants:

- **SWI-Prolog** team for the incredible Prolog system and WASM port
- **V86** project for JavaScript x86 emulation
- **Vercel AI SDK** for LLM streaming abstraction
- **Model Context Protocol** for standardized tool integration
- The entire **logic programming** and **neurosymbolic AI** research communities

---

## 📧 Contact

- **E-Mail**: andreas (at) deepclause.ai
- **GitHub**: [github.com/deepclause/deepclause-desktop](https://github.com/deepclause/deepclause-desktop)
- **Issues**: [github.com/deepclause/deepclause-desktop/issues](https://github.com/deepclause/deepclause-desktop/issues)
