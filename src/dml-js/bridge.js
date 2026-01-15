import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { generateText, tool as aiTool, streamText, experimental_createMCPClient, generateObject, stepCountIs, hasToolCall  } from "ai";
import { google } from '@ai-sdk/google';
import {openrouter} from '@openrouter/ai-sdk-provider'
import {createOpenAI, openai} from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {anthropic} from '@ai-sdk/anthropic';
import { getGoalModelConfig, getConverterModelConfig, resolveProvider, getAgentModelConfig } from '../config/models.js';

// Access resource resolver from global (set by main process in Electron)
// Use a getter function for lazy access to avoid import-time undefined issues
const getResourceResolver = () => global.resourceResolver;

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

let agentModelConfig = null;
function getAgentConfig() {
    if (!agentModelConfig) {
        agentModelConfig = getAgentModelConfig();
    }
    return { name: agentModelConfig.name, temperature: agentModelConfig.temperature };
}

const debugLog = (...args) => {
    if (process.env.DEBUG === '1') {
        console.log(...args);
    }
};


const providerMap = {
    google: (m) => {
        const model = (m && typeof m === 'object') ? m.name : m;
        return google(model);
    },
    openai: (m) => {

        debugLog(`[DML Bridge] Resolving OpenAI-compatible model with input: ${JSON.stringify(m)}`);

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
        debugLog(`[DML Bridge] Creating OpenAI-compatible model ${model} with baseURL: ${base}`);
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


// Configuration from settings.json + environment variables (includes provider)
// These are now functions to allow dynamic reloading when settings change
function getCurrentGoalModelConfig() {
    const config = getGoalModelConfig();
    debugLog(`[Bridge] Goal Model: ${config.provider}/${config.name} (API Key present: ${!!(process.env.OPENAI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.ANTHROPIC_API_KEY)})`);
    return config;
}

function getCurrentConverterModelConfig() {
    const config = getConverterModelConfig();
    debugLog(`[Bridge] Converter Model: ${config.provider}/${config.name}`);
    return config;
}

// Legacy constants for backward compatibility
const API_BASE = process.env.API_BASE || null;
const MCP_SERVER = process.env.MCP_SERVER || null;
const SUMMARY_MODEL_TEMP = parseFloat(process.env.SUMMARY_MODEL_TEMP || '0.0');

// Global variables to track available tools
let GLOBAL_TOOLS = [];
let GLOBAL_TOOLS_DESCRIPTION= "";
// Added MCP globals
let MCP_CLIENTS = [];
let MCP_TOOL_MAP = {};
let MCP_CONFIG_PATH = null; // Will be set lazily
let INITIALIZED = false; // Guard against double initialization

/**
 * Get MCP config path - handles both Electron and CLI modes
 * Lazily evaluated to ensure resource resolver is available
 */
function getMcpConfigPath() {
    // Return cached path if already set
    if (MCP_CONFIG_PATH) return MCP_CONFIG_PATH;
    
    const resolver = getResourceResolver();
    
    // Both Electron and CLI use the same settings path: ~/.deepclause/settings.json
    const globalSettings = path.join(os.homedir(), '.deepclause', 'settings.json');
    
    if (resolver) {
        // Electron mode
        MCP_CONFIG_PATH = globalSettings;
        debugLog(`[MCP] Using Electron config path: ${MCP_CONFIG_PATH}`);
    } else {
        // CLI mode
        if (fs.existsSync(globalSettings)) {
            MCP_CONFIG_PATH = globalSettings;
            debugLog(`[MCP] Using global CLI settings path: ${MCP_CONFIG_PATH}`);
        } else {
            // Fallback: check if settings.json exists in the ../config directory (deployed mode)
            const localSettings = path.join(__dirname, '..', 'config', 'settings.json');
            if (fs.existsSync(localSettings)) {
                MCP_CONFIG_PATH = localSettings;
                debugLog(`[MCP] Using local settings path: ${MCP_CONFIG_PATH}`);
            } else {
                // Last fallback: project config directory
                MCP_CONFIG_PATH = path.resolve(process.cwd(), 'config', 'settings.json');
                debugLog(`[MCP] Using fallback CLI config path: ${MCP_CONFIG_PATH}`);
            }
        }
    }
    
    return MCP_CONFIG_PATH;
}

/**
 * System prompt for goal evaluation
 */
const goalSystemPrompt = `
{todays_date}

You are an expert reasoning engine and are given a piece of text enclosed
in triple backticks and a prolog goal. Your task is to emulate a prolog interpreter and to
determine if the goal is achievable given the text.

You can make use of the following steps:
1. Identify whether the goal can be achieved by following the instruction that can be deduced from the goal name. In this case try your best to follow the instruction and assign variables accordingly. If the goal can be achieved, execute the neccesary steps, so that all variables will be assigned the data such that the goal is achieved. 
   When following the instruction, you must make sure to follow it to the letter and ensure that the data you assign is in the format and datatype expected. 
2. Otherwise, if the goal does not directly resemble an instruction,  convert the text into a list of prolog facts. Then verify if the prolog predicates holds or not. 
   To make sure it holds you may assign missing variables based on facts from the text. 
   A variable may have more than one assignment.
   A variable in the goal always starts with and underscore. 
   So "is_true(_1234)" depends on the variable _1234, which you need to assign.
   "is_related(_1234,_3456)" depends on two variables.
   "is_related(_1234,apple)" depends on one variable and one constant, so you only need to assign one variable with possible values, and treat the constant apple as if it was a variable which has only one possible value: apple.
    You must always include already assigned variables in the output, so that the number of variables assignments in the output JSON matches the number of arguments for the goal.
3. If the text is empty, you may not use your own knowledge to assign variables with best guesses {tool_str}
4. Do not include input data in your output. Only add the assignments for variables. 
5. For values assigned to variables always return a string containing a valid prolog term of the form X=[Value], that can be parsed by prolog, e.g. X=1234. X="String value", or X=true or X=false or X=[a,b,c] or X=dict{bla:"asd"} or X=row(12,\"abcde\").  
   Remember: A prolog dictionary always starts with an atom followed by {
   Make sure the returned prolog is compatible with swi prolog and can be feed into read_term_from_atom.
   
6. Use string types with double quotes, do not return atoms defined by single quotes.
   Make sure the prolog terms you generate are properly escaped when needed, e.g. X="This is a string with a \\\"quote\\\" inside".
7. Explain your reasoning.

Finally, after a newline output a JSON dictionary of the following format:
{{
"result": [boolean true or false],
"variable_assignments" : [ 
    {dictionary with values for assigned variables}, 
    {dictionary with values for assigned variables}, 
    {dictionary with values for assigned variables} 
]
If a variable is not assigned simply add "null". All assingments should either be strings or lists of strings. The dictionaries only need to contain the values for the variables that you have deduced. 
Ignore the comments and ... in the above, always output valid JSON and make sure to only use \" quotes to encapsulate a string in JSON.

}}

Examples:
- For a goal of "get_value(_1234)", if you think it evaluates to true, the output format would be:
{{
    "result": true, 
    "variable_assignments": [
        {"_1234": "X=\"some_string_value\""}, {"_1234":"X=\"another_value\""}, {"_1234": "X=\"yet another value\""}
    ]
}}

- For a goal of "is_related_to(apple, _1234)", if you think it evaluates to true,  the output format would be:
{{
    "result": true, 
    "variable_assignments": [
        {"_1234:" : "X=\"some_value\""}, {"_1234" : "X=\"another_value\""}
    ]
}}
Note how the value apple gets assigned in the output, although it is passed as a constant.
- For a goal  "similar_to("Apple", "Orange")", if you think it evaluates to false,  the output format would be:
{{
    "result": false, 
    "variable_assignments": [
    ]
}}
Note how the values Apple and Orange get assigned in the output, although they are passed as constants.
- For a goal  "similar_to("Granny Smith", "Pink Lady")", if you think it evaluates to true,  the output format would be:
{{
    "result": true, 
    "variable_assignments": [
    ]
}}
Note how the values Granny Smith and Pink Lady get assigned in the output, although they are passed as constants.
- For a goal  "friend(A, B)", if you think it evaluates to true,  the output format would be:
{{
    "result": true, 
    "variable_assignments": [
        {"A": "X=\\\"Peter\\\"", "B": "X=\\\"Bob\\\""},
        {"A": "X=\\\"Peter\\\"", "B": "X=\\\"Mary\\\""},
        {"A": "X=\\\"Alex\\\"", "B": "X=\\\"Dieter\\\""}
     ]
}}
- For a goal  "friendlist(peter, ListOfFriends)", if you think it evaluates to true,  the output format would be:
{{
    "result": true, 
    "variable_assignments": [
        {"ListOfFriends" : "X=[\\\"Bob\\\", \\\"Mary\\\"]"}
    ]
}}
- For a goal without variables e.g. like "does_some_condition_hold", if you think it evaluates to true,  the output format would be:
{{
    "result": true, 
    "variable_assignments": [
    ]
}}
- For a goal like "search("What is xyz?", ListOfResults)", if you think it evaluates to true,  the output format would be:
{{
    "result": true, 
    "variable_assignments": [
        {"ListOfResults" : "X=[\\\"xyz are three letters\\\", \\\"the last three letters in the alphabet\\\"]"}
    ]
}}
- For a goal like "extract_table_list("Some very long text...", ListOfTables)", if you think it evaluates to true,  the output format would be:
{{
    "result": true, 
    "variable_assignments": [
        {"ListOfResults" : "X=[\\\"Some table as markdown or other format...\\\", \\\"Another tables as markdown or other format\\\"]"}
    ]
}}
- For a goal like "search("What is xyz?", ListOfResultsDicts)", if you think it evaluates to true,  the output format would be:
{{
    "result": true, 
    "variable_assignments": [
        {"ListOfResults" : "X=[row{title:\\\"xyz are three letters\\\"}, row{title:\\\"the last three letters in the alphabet\\\"}]"}
    ]
}}
- For a goal like "get_table_data("[long text...]", ListOfTables)", if you think it evaluates to true,  the output format would be:
{{
    "result": true, 
    "variable_assignments": [
        {"ListOfResults" : "X=[row{title:\\\"xyz are three letters\\\"}, row{title:\\\"the last three letters in the alphabet\\\"}]"}
    ]
}}
- For a goal like "parse_name_age(\"John Doe, 30\", string(Name), int(Age))", if you think it evaluates to true,  the output format would be:
{{
    "result": true, 
    "variable_assignments": [
        {"Name" : "X=\\\"John Doe\\\""},
        {"Age" : "X=30"}
    ]
}}

If you assign long string variables, especially if the content contains lots characters that need to be escaped,then you should use
quasi quotations to enclose the string, e.g. X={|string|| This is a long string with "quotes" and \\backslashes\\ and so on |}. Make sure this ends with "|}" (Only one "|" at the end!)
Also, please add a "reasoning" field to the output JSON, which contains a detailed explanation of how you arrived at your conclusion. This should include the steps you took, any assumptions made, and how the information from the text influenced your decision. The reasoning should be clear and comprehensive, providing insight into your thought process.

If you generate code and put it into variables it is always a good idea to use quasi quotations to enclose the string, e.g. X={|string|| ... |}, especially because the code (like LaTex) might contain expressions that can be mistaken for prolog escape sequences.
You can also use quasiquotations to enclose text pieces in terms, e.g. paper({|string|| This paper deals with... [lots of latex code]...|})

You may use python to process the all the data and put it into the right format.
`;

/**
 * Conversion prompt for generating DML from natural language
 */
const conversionPrompt = `
{todays_date}

# SYSTEM IDENTITY

You are the DeepClause Assistant, created in 2025 by the team from deepclause.ai.

You are an expert Prolog programmer. Your task is to convert user requests into executable DML (DeepClause Markup Language) code - a Prolog-based language for building AI-powered workflows.

# CORE OBJECTIVE

Break down user requests into small discrete steps and generate Prolog code that describes their execution. Each step should be either:
1. A tool call (e.g., web search, file operations)
2. Data processing (entity extraction, summarization, logical operations)

The main execution logic goes in the \`agent_main\` predicate.

# AVAILABLE TOOLS

<tool_list>
{tools}
</tool_list>

# BUILT-IN PREDICATES

## File Operations
- \`open(File, Mode, Stream)\` - Open files (modes: read, write, append)
- \`close(Stream)\` - Close file streams
- \`read_string(Stream, Length, Content)\` - Read file content
- \`directory_files(Dir, Files)\` - List files (use relative paths, no leading /)
- \`exists_file(Filename)\` - Check if file exists
- \`make_directory(Dir)\` - Create directory
- All files are stored in a "workspace" directory accessible to the user

## LLM Interaction
- \`chat(Command)\` - Execute instruction and stream output to user
- \`chat(Command, Output)\` - Execute instruction and capture output
- \`generate(Prompt, Output)\` - Generate text with LLM (no streaming, for long content)
- \`answer(Text)\` - Send final answer to user (calls end_thinking automatically)
- \`yield(Text)\` - Send intermediate output to user
- \`agent_loop(TaskPrompt, Output, Options)\` - Use an autonotmous sub agent to try solve the task given by TaskPrompt using the tools provided in the Options.
    Example:  agent_loop("Find  recipes for Chicken Tika Massala", Result,[tools([brave_search])]) 

## Sub-DML Execution
- \`run_dml(DmlCode, Output)\` - Execute inline DML code as a sub-agent
  - Creates isolated execution context (separate session, memory)
  - Captures all output (yield, answer, chat) as a string in Output
  - Sub-DML has access to all tools available to the parent
  - Inherits parent's parameters
  - Example: \`run_dml("agent_main :- tool(websearch(\\"AI news\\"), R), answer(R).", SearchOutput)\`

- \`run_dml(DmlCode, Params, Output)\` - Execute inline DML with custom parameters
  - Params is a dictionary that replaces parent params (workspace_path is preserved)
  - Example: \`run_dml(Code, _{topic: "quantum computing", max_results: 10}, Output)\`
  
- \`run_dml_file(Filename, Output)\` - Execute a DML file as a sub-agent
  - Searches for file in: current dir, workspace, dml_examples/, dml_examples/learned/, ~/.deepclause/dml_examples/
  - Inherits parent's parameters
  - Example: \`run_dml_file("deep_research.dml", ResearchOutput)\`

- \`run_dml_file(Filename, Params, Output)\` - Execute a DML file with custom parameters
  - Params is a dictionary that replaces parent params (workspace_path is preserved)
  - Example: \`run_dml_file("deep_research.dml", _{topic: "AI safety"}, Output)\`
  - Use this to pass specific parameters to reusable DML components
  
When to use sub-DML execution:
- Orchestrating multiple specialized agents (e.g., research + analysis + summary)
- Building pipelines of processing steps
- Reusing existing DML files as building blocks
- Conditional execution of different strategies based on context

Example - Orchestrating multiple agents with parameters:
\`\`\`prolog
agent_main :-
    param("topic", "Research topic", Topic),
    % Run specialized research sub-agent with custom params
    run_dml_file("deep_research.dml", _{topic: Topic}, ResearchResults),
    % Run analysis using a saved DML file with different params
    run_dml_file("analyzer.dml", _{input: ResearchResults, depth: "detailed"}, AnalysisResults),
    % Synthesize results
    end_thinking,
    observation("Research: {ResearchResults}"),
    observation("Analysis: {AnalysisResults}"),
    chat("Provide a comprehensive summary combining both findings.").
\`\`\`

## Context Management
- \`system(Text)\` - Add system message to agent memory
- \`user(Text)\` - Add user message to agent memory  
- \`observation(Text)\` - Add observation to agent memory
- \`end_thinking\` - Mark end of reasoning phase, start answer generation

## User Input
- \`wait_for_input(Prompt, UserInput)\` - Request input from user (pauses execution)

## Parameters
- \`param(Key, Description, Value)\` - Access external parameters
  - Key types: \`:file\`, \`:select(Opt1, Opt2, ...)\`, \`:multiselect(...)\`
  - Example: \`param("input:file", "Select input file", File)\`

## Logging
- \`log(task="Message")\` - Display message to user (use string interpolation for variables)

## Tool Calls
- \`tool(Goal, Output)\` - Execute a tool
  - Example: \`tool(websearch("AI news"), Results)\`
  - There is only tool/2 and NO tool/1, even if a tool does not have an output, use tool(Goal, Output)!

## Linux VM with Bash/Python/CLI Tools
For complex data processing, analysis, and system tasks, you have access to a persistent Linux VM:
- \`tool(vm_exec(BashCommand), Output)\` - Execute bash commands in a persistent Linux VM
  - Full Linux environment with Python 3, common CLI tools, and development utilities
  - Pre-installed: Python (with pandas, numpy, matplotlib, scipy, requests, etc.), nodejs, git, curl, jq, etc.
  - Persistent session - files, installed packages, and environment persist across calls
  - Cannot install additional packages (pip, apt-get, npm, etc.)
  - Access to workspace directory (mounted, can read/write user files)
  - Commands run in bash shell - use semicolons or && to chain commands
  - Always write Python code to a file and then execute it in the VM with the python3 command
  - Always check the return code of any vm command, do not assume that it all went fine
  - Examples:
   - \`tool(vm_exec("python3 train_model.py"), Result)\`
    - \`tool(vm_exec("cat data.json | jq '.results[] | select(.score > 90)'"), FilteredData)\`
    - \`tool(vm_exec("curl -s https://api.example.com/data | python3 process.py"), ProcessedData)\`

When to use VM execution:
- Complex numerical computations or statistical analysis
- Data manipulation with pandas, numpy, or command-line tools (awk, sed, jq)
- Machine learning tasks
- Creating plots and visualizations (save to workspace files)
- Processing large datasets or files
- Tasks requiring specialized Python libraries or CLI tools
- Multi-step data transformations using shell pipelines
- Web scraping, API calls, or data downloads
- Running existing Python scripts or CLI programs

Best practices:
- Write Python scripts to workspace files for complex logic, then execute them
- Write Python scripts in one go rather than line-by-line in Prolog so that formatting and indentation is correct
- Use shell pipelines to chain processing steps efficiently
- Save output files (images, CSVs, etc.) to workspace for user access
- Check if packages are installed before using
- Use \`python3\` explicitly (not just \`python\`)

## @-Predicates (LLM-Powered Functions)
Define custom predicates that use LLM for processing:
\`\`\`prolog
extract_temp(Data, Temp) :- @("Extract temperature from Data in celsius and output in Temp as a string").
\`\`\`

Rules for @-Predicates:
- Act like pure functions (no side effects, no tool calls)
- Cannot mix @ notation with regular Prolog in the same predicate
- Take only a single string argument
- External data must be fetched via tool/2 first
- May only have a single branch.
- For complex data processing or system tasks, prefer VM execution over @-predicates

When to use @-predicates and when to use agent_loop:
- Use @-predicates for simple data extraction, transformation, or formatting tasks that can be done in a single step
- Use agent_loop for complex tasks that require highly dynamic adaptation, multi-step reasoning, or iterative refinement. 
  When using agent_loop try to provide a clear task prompt and limit the tools available to the agent to only those that are neccesary for the task.


# CODE STRUCTURE REQUIREMENTS

## Multiple Solution Branches
- Create 3-5 branches for complex tasks
- First branch: Most sophisticated approach
- Middle branches: Moderate complexity
- Second-to-last branch: Simple, highly likely to succeed
- Last branch: Fallback that apologizes if all else fails

Example structure:
\`\`\`prolog
agent_main :- 
    % Branch 1: Advanced approach with verification
    complex_solution.

agent_main :-
    % Branch 2: Simpler approach
    moderate_solution.

agent_main :-
    % Branch 3: Fallback
    simple_search_and_summary.

agent_main :-
    % Branch 4: Error handling
    answer("I apologize, but I encountered difficulties processing your request.").
\`\`\`

## Code Organization
- All code must be in predicates or \`agent_main\`
- Use explicit, self-documenting predicate and variable names
- One predicate call per step (or simple Prolog expressions like \`X > Y\`)
- Split complex tasks into small, simple steps
- Add verification steps after complex operations and tool calls
    - Verify that data is in expected format
    - Verify that tool call succeded: 
        - tool call output will usually be strings and might be unstructured or JSON output
        - when in doubt use an @-predicate to verify correctness
    - Log progress to user with \`log/1\`
    - Assume that standard rules (not @-predicates) may not work correctly
    - Be explicit about each step
    - Better safe than sorry!
- Use comments to explain each step
- Add fallbacks and "llm extrapolation" branches for robustness
    Example 1:
    ----------

    is_a_rule("banana", "fruit"). 
    is_a_llm(Object, Type) :- @("Determine if Object is of Type. If unsure, make an educated guess based on common knowledge.").

    is_a(Object, Type) :- is_a_rule(Object, Type),!.
    is_a(Object, Type) :- is_a_llm(Object, Type).

    Example 2:
    ----------
    complex_parsing_operations_rule(In, Out) :- ...[pure prolog]...
    complex_parsing_operations_llm(In, Out) :- @("Perform complex parsing on In to produce Out. Use best effort to handle edge cases.").

    complex_parsing_operations(In, Out) :- 
        complex_parsing_operations_rule(In, Out), !.
    complex_parsing_operations(In, Out) :- 
        complex_parsing_operations_llm(In, Out).
- Verify datatypes and convert where necessary 

## Final Answer Pattern
\`\`\`prolog
% Gather all information first
...,
% Mark end of reasoning
end_thinking,
% Build context for final answer
system("You are a helpful assistant..."),
observation("Here is the gathered data: ..."),
% Generate final answer
chat("Provide a comprehensive answer based on the data").
\`\`\`

# STRING FORMATTING

## Format Predicate
- Syntax: \`format(string(Output), "Template ~w", [Input])\`
- Only use \`~w\` as format character
- Escape tilde: \`format(string(R), "\\\\~ this is a tilde", [])\`
- Example: \`format(string(Greeting), "Hello ~w!", [Name])\`

## String Interpolation (Preferred)
- Syntax: \`log(task="Age is {Age}")\`
- DO NOT mix format/3 and string interpolation
- DO NOT use string interpolation inside format strings
- THIS IS WRONG: \`format(string(R), "Value is {Value}", [Value])\`
- THIS IS WRONG: \`format(string(R), "Value is {Value}", [])\`
- THIS IS RIGHT: \`log(task="Value is {Value}")\`

## Quasi-Quotations (For Complex Content)
Use for code, LaTeX, or strings with many special characters:
\`\`\`prolog
X={|string|| Content with "quotes" and \\backslashes\\ |}
\`\`\`
- Must end with \`|}\` (exactly one pipe before closing brace)
- Example: \`Code={|string|| def hello():\\n    print("world") |}\`

# PROLOG COMPATIBILITY

## Standard Library
Pre-loaded libraries:
- \`library(clpfd)\`, \`library(clpr)\` - Constraint programming
- \`library(readutil)\`, \`library(lists)\` - List/file utilities
- \`library(quasi_quotations)\`, \`library(strings)\` - String handling

## Data Handling
- Avoid atoms such as atom (lowercase), 'single quoted' and use strings instead
- Use strings when defininig facts and predicates
- Convert between atoms and numbers/strings explicitly if needed
- Use \`atom_string(Atom, String)\` for type conversion
- Use \`atom_number(Atom, Number)\` for type conversion
- Parse JSON: \`atom_json_dict(JsonString, Dict, [])\`
- Substring: \`sub_string(Str, Before, Length, After, Substring)\`
- String joining: \`atomic_list_concat(List, "\\\\n", Result)\`
- Use \`length(List, Length)\` NOT \`length/1\`

## Prolog Style
- Write pure Prolog code (avoid complex control structures)
- NO catch/3 blocks
- NO yall library (>>-style lambdas)
- NO type hints in predicate definitions
- Use double quotes for strings, NOT single quotes
- Compatible with SWI-Prolog
- You may use SWI-Prolog dictionaries, e.g. \`Dict = dict{key1:"value1", key2:"value2"}\`. Make sure keys are always atoms!
- DO NOT use findall/4, only use findall/3!

# OUTPUT REQUIREMENTS

- Return markdown-formatted text to users, not raw data
- Enclose final code in \`\`\`prolog ... \`\`\`
- Add meaningful log messages for user visibility
- Explain reasoning step by step
- Do NOT add debug output, write/writeln statements
- Do NOT attempt to answer directly - generate code only

# SPECIAL CASES

## Deep Analysis
For comprehensive analysis requests:
- Use tools that read entire webpages/documents
- Process all content, not just snippets
- Add verification steps

## Structured Data
For tables/structured extraction:
- Use structured Prolog terms
- Consider @-predicates for extraction logic
- For complex transformations, use Python with pandas

##
For requests that need mathematical expressions or LaTeX:
- Generate LaTeX code as string
- Use quasi-quotations for complex LaTeX

##
For code generation tasks:
- Write code to workspace files
- Use quasi-quotations for formatting
- Execute/test code in VM if needed

## For tasks that generate reports
- Try to add images and charts where appropriate
- Save images to workspace and reference them in markdown
- Make sure to add sources and references where appropriate
- Use professional language and formatting

## Complex Data Processing
When tasks involve:
- Statistical analysis or numerical computation → Use VM with Python/R
- Large dataset manipulation → Use VM with pandas/numpy or CLI tools (awk, sed, jq)
- Data visualization/plotting → Use VM with Python matplotlib/seaborn (save to workspace)
- Machine learning → Use VM with Python scikit-learn/tensorflow
- Complex text processing → Use VM with Python, grep, awk, sed, or specialized tools
- Mathematical modeling → Use VM with Python scipy/sympy
- File format conversions → Use VM with appropriate CLI tools (pandoc, imagemagick, ffmpeg)
- Data extraction from APIs/web → Use VM with curl, wget, Python requests

Example workflow combining Prolog orchestration with VM execution:
\`\`\`prolog
agent_main :-
    % Step 1: Fetch data using a tool
    tool(websearch("stock market data CSV"), SearchResults),
    
    % Step 2: Extract URL and download data using VM
    extract_url(SearchResults, DataURL),
    format(string(DownloadCmd), "curl -o data.csv '~w'", [DataURL]),
    tool(vm_exec(DownloadCmd), _),
    
    % Step 3: Create Python analysis script
    open("analyze.py", write, Stream),
    write(Stream, "import pandas as pd\n"),
    write(Stream, "import matplotlib.pyplot as plt\n"),
    write(Stream, "df = pd.read_csv('data.csv')\n"),
    write(Stream, "print(df.describe().to_string())\n"),
    write(Stream, "df.plot()\n"),
    write(Stream, "plt.savefig('chart.png')\n"),
    close(Stream),
    
    % Step 4: Execute analysis in VM
    tool(vm_exec("python3 analyze.py"), AnalysisOutput),
    
    % Step 5: Present results to user
    end_thinking,
    observation(AnalysisOutput),
    answer("Analysis complete! Here are the results:\n\n" + AnalysisOutput + "\n\n![Chart](chart.png)").
\`\`\`

Alternative: Using shell pipeline for quick data processing:
\`\`\`prolog
agent_main :-
    % Fetch, filter, and process data in one VM command
    tool(vm_exec("curl -s 'https://api.example.com/data.json' | jq '.results[] | select(.score > 90)' | python3 -c 'import sys, json; data = [json.loads(l) for l in sys.stdin]; print(len(data), \"high-scoring results found\")'"), Result),
    end_thinking,
    answer(Result).
\`\`\`

## File Display
For images: \`![Description](filename.png)\` (relative to workspace)

## File Loading
Use \`consult(File)\` to load Prolog facts (relative to workspace root)

DO NOT USE ANY PROVIDED SEARCH CONTEXT IN THE DML CODE UNLESS SPECIFICALLY REQUESTED BY THE USER!

# EXAMPLES

<examples>
{examples}
</examples>
`;

// Validation prompt for analyzing generated Prolog code
const validationPrompt = `You are an expert Prolog code reviewer specializing in DML (DeepClause Markup Language). Your task is to deeply analyze generated Prolog code and identify issues based on the DML specification.

# YOUR TASK

Analyze the provided Prolog/DML code and determine if it is VALID or INVALID. If INVALID, provide specific correction points.

# ANALYSIS CRITERIA

Perform a deep analysis checking for:

## 1. Structural Issues
- Missing or malformed \`agent_main\` predicate
- Insufficient solution branches (should have 3-5 branches with varying complexity)
- Missing final fallback branch
- Incorrect predicate organization
- Code outside predicates or \`agent_main\`

## 2. String Handling Errors
- Single quotes used instead of double quotes for strings
- Mixing format/3 with string interpolation (e.g., \`format(string(R), "Value is {Value}", [])\` is WRONG)
- Incorrect format/3 syntax (must use ~w, not other format characters)
- Incorrect quasi-quotation syntax (must end with \`|}\`, not \`||}\`)
- Improperly escaped special characters in strings

## 3. Tool Usage Issues
- Using \`tool/1\` instead of \`tool/2\` (even for tools with no output, use tool/2)
- Not verifying tool call results
- Missing error handling for tool failures
- Not logging progress after tool calls

## 4. Data Type Errors
- Using atoms (lowercase or 'single quoted') where strings should be used
- Missing type conversions (atom_string, atom_number)
- Incorrect dictionary syntax (keys must be atoms, not strings)
- Using length/1 instead of length/2

## 5. @-Predicate Violations
- @-predicates with side effects or tool calls
- @-predicates mixed with regular Prolog code
- @-predicates with multiple branches
- @-predicates not taking a single string argument
- Using @-predicates for tasks better suited to VM execution

## 6. VM Execution Issues
- Complex data processing not using VM when appropriate
- Not writing Python scripts to files before executing
- Missing explicit python3 command
- Not checking return codes from VM commands

## 7. Control Flow Problems
- Using catch/3 blocks
- Using yall library lambda syntax (>>)
- Over-complex control structures instead of simple predicate chains
- Missing verification steps after complex operations

## 8. Final Answer Pattern
- Not calling \`end_thinking\` before generating final answer
- Not using \`system/1\` and \`observation/1\` to build context
- Directly answering without gathering information first
- Using write/writeln for output instead of answer/yield/chat

## 9. Prolog Compatibility
- Using features not compatible with SWI-Prolog
- Type hints in predicate definitions
- Incorrect library usage
- Missing required library imports

## 10. Logical Correctness
- Predicates that don't match the user's request
- Missing essential steps to accomplish the task
- Incorrect sequencing of operations
- Lack of fallback strategies

## 11. Best Practices
- Missing meaningful log messages
- No comments explaining complex steps
- Variables not properly scoped
- Missing verification after complex operations
- Not using appropriate branches (complex -> moderate -> simple -> fallback)

## 12. Special Cases
- Use findall/4 instead of findall/3
- For analysis tasks, not using tools to read full content
- For structured data, not using Prolog terms or @-predicates
- For code generation, not using quasi-quotations

# OUTPUT FORMAT

You must respond with EXACTLY this structure:

**If code is valid:**
\`\`\`
VALID
\`\`\`

**If code has issues:**
\`\`\`
INVALID

Issues found:

1. [Category]: [Specific issue description]
   Location: [Where in the code]
   Fix: [How to correct it]

2. [Category]: [Specific issue description]
   Location: [Where in the code]
   Fix: [How to correct it]

[... more issues ...]
\`\`\`

# EXAMPLES

Example 1 - INVALID (using tool/1):
\`\`\`
INVALID

Issues found:

1. Tool Usage: Using tool/1 instead of tool/2
   Location: tool(websearch("AI news"))
   Fix: Change to tool(websearch("AI news"), Results) and use the Results variable

2. Missing Verification: No check of tool call result
   Location: After tool call
   Fix: Add verification step to ensure Results is not empty/error
\`\`\`

Example 2 - INVALID (string formatting):
\`\`\`
INVALID

Issues found:

1. String Formatting: Mixing format/3 with string interpolation
   Location: format(string(R), "Value is {Value}", [])
   Fix: Use either format(string(R), "Value is ~w", [Value]) OR log(task="Value is {Value}")

2. String Type: Using single quotes for strings
   Location: X = 'hello'
   Fix: Change to X = "hello"
\`\`\`

Now analyze the following code:`;


/**
 * Validate generated Prolog code using LLM analysis
 * Returns { valid: boolean, issues: string[] }
 */
async function validatePrologCode(code, question) {
    try {
        const userPrompt = `User Request: ${question}

Generated Code:
\`\`\`prolog
${code}
\`\`\`

Analyze this code thoroughly and determine if it is VALID or INVALID.`;

        const goalConfig = getCurrentGoalModelConfig();
        const result = await generateText({
            model: resolveProvider(goalConfig, providerMap),
            system: validationPrompt,
            prompt: userPrompt,
            temperature: 0.1,
            maxTokens: 4096,
        });

        const response = result.text.trim();
        
        // Check if response starts with VALID
        if (response.startsWith('VALID')) {
            return { valid: true, issues: [] };
        }
        
        // Extract issues from INVALID response
        if (response.startsWith('INVALID')) {
            // Extract the issues section
            const issuesMatch = response.match(/Issues found:([\s\S]*)/);
            if (issuesMatch) {
                const issuesText = issuesMatch[1].trim();
                // Split into individual issues (numbered lines)
                const issues = issuesText
                    .split(/\n(?=\d+\.)/)
                    .map(issue => issue.trim())
                    .filter(issue => issue.length > 0);
                
                return { valid: false, issues };
            }
            
            // Fallback: return the whole response as a single issue
            return { valid: false, issues: [response] };
        }
        
        // Unexpected format - treat as invalid
        debugLog('Unexpected validation response format:', response);
        return { valid: false, issues: ['Validation returned unexpected format: ' + response] };
        
    } catch (error) {
        debugLog('Code validation failed:', error);
        // Don't fail the whole process, just skip validation
        return { valid: true, issues: [] };
    }
}


// Extract the first valid JSON object/array from a Markdown LLM response.
// - Prefers ```json fenced blocks
// - Falls back to any fenced block that looks like JSON
// - Final fallback scans for a balanced {...} or [...] at top level
function extractJsonFromMarkdown(md) {
  if (typeof md !== 'string') throw new Error('Response is not a string');

  // 1) Prefer ```json ... ```
  const jsonFence = /```(?:json|JSON)\s*([\s\S]*?)```/g;
  let m = jsonFence.exec(md);
  if (m && m[1]) {
    const raw = m[1].trim();
    return JSON.parse(raw);
  }

  // 2) Any fenced block that looks like JSON
  const anyFence = /```\s*([\s\S]*?)```/g;
  while ((m = anyFence.exec(md)) !== null) {
    const raw = (m[1] || '').trim();
    if (raw.startsWith('{') || raw.startsWith('[')) {
      try { return JSON.parse(raw); } catch (_) { /* try next */ }
    }
  }

  // 3) Fallback: find first balanced top-level JSON object/array
  const found = findFirstTopLevelJson(md);
  if (found) return JSON.parse(found);

  throw new Error('No valid JSON found in response');
}

// Balanced-scan for a top-level {...} or [...]
function findFirstTopLevelJson(s) {
  const openers = ['{', '['];
  const closers = { '{': '}', '[': ']' };

  let i = 0, inStr = false, esc = false, quote = null, stack = [];
  const startIdx = [];

  while (i < s.length) {
    const ch = s[i];

    if (inStr) {
      if (esc) { esc = false; }
      else if (ch === '\\') { esc = true; }
      else if (ch === quote) { inStr = false; quote = null; }
      i++; continue;
    }

    if (ch === '"' || ch === "'") { inStr = true; quote = ch; i++; continue; }

    if (openers.includes(ch)) {
      stack.push(ch);
      if (stack.length === 1) startIdx.push(i);
    } else if (stack.length > 0 && ch === closers[stack[stack.length - 1]]) {
      stack.pop();
      if (stack.length === 0) {
        const start = startIdx.pop();
        const chunk = s.slice(start, i + 1).trim();
        if (chunk.startsWith('{') || chunk.startsWith('[')) return chunk;
      }
    }

    i++;
  }
  return null;
}


/**
 * Generate JSON schema for goal evaluation
 */
function generateGoalSchema(newArgs) {
    const schema = {
        type: "object",
        properties: {
            result: { type: "boolean" },
            variable_assignments: {
                type: "array",
                items: {
                    type: "object",
                    properties: {},
                    required: [],
                    additionalProperties: false
                }
            }
        },
        required: ["result", "variable_assignments"],
        additionalProperties: false
    };

    // Add properties for variables that start with underscore
    const varProps = {};
    const required = [];
    
    for (const arg of newArgs) {
        if (arg.startsWith('_')) {
            varProps[arg] = { type: "string" };
            required.push(arg);
        }
    }

    if (Object.keys(varProps).length === 0) {
        schema.properties.variable_assignments.items = { type: "string" };
    } else {
        schema.properties.variable_assignments.items.properties = varProps;
        schema.properties.variable_assignments.items.required = required;
    }

    return schema;

}


/**
 * Generate JSON schema for goal evaluation
 */
function generateGoalSchemaZod(newArgs) {
    // Build a Zod schema that mirrors generateGoalSchema but using Zod objects
    // Shape:
    //  {
    //    result: boolean,
    //    variable_assignments: [
    //        { _var1: string, _var2: string, ... }* OR strings if no underscore vars
    //    ]
    //  }
    // Rules:
    //  - Collect args that start with '_'
    //  - If none: variable_assignments is array of strings (each assignment row just a string)
    //  - Else: variable_assignments is array of strict objects with those keys required
    try {
        const underscoreVars = [];
        for (const arg of newArgs || []) {
            if (typeof arg === 'string' && arg.startsWith('_') &&!arg.includes("{")) underscoreVars.push(arg);
        }

        let assignmentsSchema;
        if (underscoreVars.length === 0) {
            // No variable placeholders -> each entry is just a string (constant-only goals)
            assignmentsSchema = z.array(z.string());
        } else {
            const shape = {};
            for (const v of underscoreVars) {
                shape[v] = z.string();
            }
            assignmentsSchema = z.array(z.object(shape).strict());
        }

        const schema = z.object({
            result: z.boolean(),
            variable_assignments: assignmentsSchema,
            reasoning: z.string(),  //  reasoning string
        }).strict();

        return schema;
    } catch (e) {
        // In case something unexpected happens, fall back to a permissive schema
        return z.object({
            result: z.boolean().optional(),
            variable_assignments: z.any().optional(),
            reasoning: z.string()  // Optional reasoning string
        });
    }
}


/**
 * Validate variable assignment terms by attempting to parse them with Prolog.
 * Each assignment value is expected to be a string of the form "X=SomePrologTerm".
 * Strategy (mirrors Python implementation):
 *  - For every term, write it into a temporary file inside the WASM /tmp FS with a trailing '.'
 *  - Call plogchain:try_parse_file(File) to let Prolog parse it
 *  - If validation fails, attempt to correct the term using an LLM
 *  - Collect any failures and return as an array of error messages (empty if all good)
 * Notes:
 *  - Function is async; caller must await it.
 *  - If swipl not provided or no assignments, returns [].
 */
async function validateTermsWithProlog(swipl, response) {
    const errors = [];
    try {
        if (!swipl || !response || !Array.isArray(response.variable_assignments)) return errors;

        for (const assignment of response.variable_assignments) {
            if (!assignment || typeof assignment !== 'object') continue;
            for (const [arg, termRaw] of Object.entries(assignment)) {
                if (typeof termRaw !== 'string') continue;
                let term = termRaw.trim();
                if (!term) continue;
                
                // Try to validate and auto-correct if needed
                const correctedTerm = await validateAndCorrectTerm(swipl, term, arg);
                
                if (correctedTerm.error) {
                    errors.push(correctedTerm.error);
                } else if (correctedTerm.corrected) {
                    // Update the assignment with the corrected term
                    assignment[arg] = correctedTerm.term;
                    debugLog(`Auto-corrected term for var ${arg}: ${termRaw} -> ${correctedTerm.term}`);
                }
            }
        }
    } catch (outer) {
        errors.push(`Validation runtime error: ${outer.message}`);
    }
    return errors;
}

/**
 * Validate a single Prolog term and attempt to correct it if validation fails.
 * Returns an object with either:
 *  - { term: string, corrected: boolean } if successful
 *  - { error: string } if failed even after correction attempt
 */
async function validateAndCorrectTerm(swipl, termRaw, varName, maxAttempts = 2) {
    let term = termRaw.trim();

    if (!term.endsWith(')') && !term.endsWith('.')) {
        term += ').';
    }

    term = term.replace(/\{\|string\|([^|])/g, '{|string||$1');

    const quasiQuoteRegex = /\{\|string\|\|([\s\S]*?)(\|?)(\})/g;
    term = term.replace(quasiQuoteRegex, (match, p1, p2, p3) => {
        if (p2 !== '|') {
            return `{|string||${p1}|}}`;
        }
        return match;
    });

    if (term.endsWith('|}\').')) {
        term = term.slice(0, -3) + ').';
    }

    if (term.endsWith('|}.')) {
        term = term.slice(0, -2) + ').';
    }

    if (!term.endsWith('.')) term += '.';
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const tmpPath = `/tmp/validate_${Date.now()}_${Math.random().toString(36).slice(2)}.pl`;
        
        try {
            swipl.FS.writeFile(tmpPath, term + '\n');
        } catch (fsErr) {
            return { error: `FS write failed for term (${varName}): ${fsErr.message}` };
        }

        try {
            // Query once; if it throws we mark an error
            let result = await swipl.prolog.query(`plogchain:try_parse_file('${tmpPath}')`).once();
            
            if (result && result.error) {
                const errorMsg = result.error.toString();
                debugLog(`Prolog parse error for term '${term}' (var ${varName}): ${errorMsg}`);

                //if debug is activated copy the tmp file to /workspace for inspection
                if(process.env.DEBUG){
                    try {
                        const debugPath = `validate_${Date.now()}_${Math.random().toString(36).slice(2)}.pl`;
                        const fileContent = swipl.FS.readFile(tmpPath);
                        fs.writeFileSync(debugPath, fileContent);
                        debugLog(`Debug: Copied invalid term file to: ${debugPath}`);
                    } catch (copyErr) {
                        debugLog(`Debug: Failed to copy invalid term file to workspace: ${copyErr.message}`);
                    }
                }
                
                // If this is not the last attempt, try to correct with LLM
                if (attempt < maxAttempts - 1) {
                    debugLog(`Attempting LLM correction for term (attempt ${attempt + 1}/${maxAttempts})...`);
                    const corrected = await correctTermWithLLM(term, errorMsg, varName);
                    
                    if (corrected) {
                        term = corrected;
                        if (!term.endsWith('.')) term += '.';
                        debugLog(`LLM suggested correction: ${corrected}`);
                        // Continue loop to validate the corrected term
                        try { swipl.FS.unlink(tmpPath); } catch (_) {}
                        continue;
                    }
                }
                
                try { swipl.FS.unlink(tmpPath); } catch (_) {}
                return { error: `Prolog error for term '${termRaw}' (var ${varName}): ${errorMsg}` };
            }
            
            // Success!
            try { swipl.FS.unlink(tmpPath); } catch (_) {}
            return { term: term.endsWith('.') ? term.slice(0, -1) : term, corrected: attempt > 0 };
            
        } catch (parseErr) {
            const errorMsg = parseErr.message;
            debugLog(`Prolog parse exception for term '${term}' (var ${varName}): ${errorMsg}`);
            
            // If this is not the last attempt, try to correct with LLM
            if (attempt < maxAttempts - 1) {
                debugLog(`Attempting LLM correction for term (attempt ${attempt + 1}/${maxAttempts})...`);
                const corrected = await correctTermWithLLM(term, errorMsg, varName);
                
                if (corrected) {
                    term = corrected;
                    if (!term.endsWith('.')) term += '.';
                    debugLog(`LLM suggested correction: ${corrected}`);
                    // Continue loop to validate the corrected term
                    try { swipl.FS.unlink(tmpPath); } catch (_) {}
                    continue;
                }
            }
            
            try { swipl.FS.unlink(tmpPath); } catch (_) {}
            return { error: `Parse failed for term '${termRaw}' (var ${varName}): ${errorMsg}` };
        }
    }
    
    return { error: `Failed to validate term after ${maxAttempts} attempts` };
}

/**
 * Use an LLM to attempt to correct a malformed Prolog term.
 * Returns the corrected term string or null if correction failed.
 */
async function correctTermWithLLM(term, errorMsg, varName) {
    try {
        const systemPrompt = `You are a Prolog syntax expert. Your task is to fix malformed Prolog terms to make them valid for SWI-Prolog's read_term_from_atom/2.

Rules:
1. The term should be in the form "X=Value" where Value is a valid Prolog term
2. Strings must use double quotes, not single quotes
3. Escape special characters properly (e.g., \" for quotes, \\\\ for backslashes)
4. For long strings with many special characters, use quasi-quotations: X={|string|| content |}
5. Quasi-quotations must end with "|}" (exactly one pipe before the closing brace)
6. Lists use brackets: [a, b, c]
7. Dictionaries use atom{key:value} syntax, e.g., row{name:"John"}
8. Numbers and atoms (lowercase identifiers) don't need quotes
9. Return ONLY the corrected term, nothing else`;

        const userPrompt = `Fix this Prolog term for variable ${varName}:

Term: ${term}

Error: ${errorMsg}

Return ONLY the corrected term in valid Prolog syntax.`;

        const goalConfig = getCurrentGoalModelConfig();
        const result = await generateText({
            model: resolveProvider(goalConfig, providerMap),
            system: systemPrompt,
            prompt: userPrompt,
            temperature: 0.1,
            maxTokens: 2048,
        });

        let corrected = result.text.trim();
        
        // Remove markdown code blocks if present
        corrected = corrected.replace(/```prolog\s*/g, '').replace(/```\s*/g, '');
        
        // Ensure it doesn't have a trailing period (we'll add it during validation)
        if (corrected.endsWith('.')) {
            corrected = corrected.slice(0, -1);
        }
        
        return corrected || null;
        
    } catch (error) {
        debugLog(`LLM correction failed: ${error.message}`);
        return null;
    }
}

/**
 * Trigger a tool calling agent to execute a task using Vercel AI SDK tools.
 * - Wraps GLOBAL_TOOLS into ai tools with zod schemas (via buildAiTools).
 * - Forces exactly one tool call (toolChoice: 'required').
 * - Yields raw tool output first, then { tool_output, success }.
 */
export async function* toolAgent(task, attempt, messages, session, mcpServers, abortSignal = null) {

    try {
        if (!GLOBAL_TOOLS || GLOBAL_TOOLS.length === 0) {
            const { DEFAULT_TOOLS } = await import('./tools.js');
            GLOBAL_TOOLS = DEFAULT_TOOLS.slice();
        }

        // Use a shared message queue that can be accessed during tool execution
        const messageQueue = [];
        let queueResolver = null;
        
        // Create a progress callback that signals new messages
        const progressCallback = function(message) {
            messageQueue.push(message);
            // Notify any waiting consumers
            if (queueResolver) {
                const resolve = queueResolver;
                queueResolver = null;
                resolve();
            }
        };

        // Build the AI SDK tools map with progress callback
        const { buildAiTools } = await import('./tools.js');
        const aiToolsBase = await buildAiTools(session, progressCallback);

        // Wrap each tool's execute function to enable polling during execution
        let wrappedTools = {};
        const self = this; // Capture generator context
        
        for (const [name, tool] of Object.entries(aiToolsBase)) {
            const originalExecute = tool.execute;
            wrappedTools[name] = {
                ...tool,
                execute: async function(args) {
                    // Start a background task to yield progress messages
                    const progressPoller = (async () => {
                        while (true) {
                            if (messageQueue.length > 0) {
                                // We can't yield from here directly, so we'll rely on
                                // the messages being queued and check them after execution
                                await new Promise(resolve => setTimeout(resolve, 50));
                            } else {
                                // Wait for new messages
                                await new Promise(resolve => {
                                    queueResolver = resolve;
                                    setTimeout(resolve, 100); // Timeout to prevent infinite wait
                                });
                            }
                        }
                    })();
                    
                    try {
                        return await originalExecute.call(this, args);
                    } finally {
                        // Cancel the poller
                        queueResolver = () => {}; // Dummy to stop the poller
                    }
                }
            };
        }

        // Merge MCP tools (without wrapping, as they don't have progress callbacks)
        const aiTools = { ...wrappedTools, ...MCP_TOOL_MAP };

        // Check if task matches a tool name exactly (before the opening parenthesis)
        const taskStr = String(task ?? '');
        const parenIndex = taskStr.indexOf('(');
        // if (parenIndex > 0) {
        //     const potentialToolName = taskStr.substring(0, parenIndex).trim();
        //     if (aiTools[potentialToolName]) {
        //         // Direct tool execution without LLM
        //         debugLog(`Direct tool match found: ${potentialToolName}`);
                
        //         // Parse arguments from task string (content between parentheses)
        //         let argsStr = taskStr.substring(parenIndex + 1);
        //         if (argsStr.endsWith(')')) {
        //             argsStr = argsStr.slice(0, -1);
        //         }
                
        //         // Try to parse as JSON first, otherwise treat as single string argument
        //         let args = {};
        //         try {
        //             args = JSON.parse(argsStr);
        //         } catch {
        //             // If not valid JSON, treat as a query string for search-like tools
        //             if (argsStr.trim()) {
        //                 args = { query: argsStr.trim() };
        //             }
        //         }
                
        //         const toolDef = aiTools[potentialToolName];
        //         if (typeof toolDef.execute === 'function') {
        //             debugLog(`Executing tool ${potentialToolName} directly with args:`, args);
        //             const resultValue = await toolDef.execute(args);
                    
        //             // Flush any messages generated during execution
        //             while (messageQueue.length > 0) {
        //                 const msg = messageQueue.shift();
        //                 yield `<log>${msg}</log>\n`;
        //             }
                    
        //             const printable = typeof resultValue === 'string' ? resultValue : JSON.stringify(resultValue, null, 2);
                    
        //             yield `\n<tool-output tool="${potentialToolName}">\n`;
        //             yield printable;
        //             yield `\n</tool-output>\n\n`;
                    
        //             yield { tool_output: printable, success: true };
        //             return;
        //         }
        //     }
        // }

        const today = new Date().toISOString().split('T')[0];
        const system = [
            `Today is ${today}.`,
            `Map the task to exactly one tool call and execute it.`,
            `Use only provided tools. Do not invent tools or parameters.`,
        ].join('\n');

        const goalConfig = getCurrentGoalModelConfig();
        
        // Start generateText in background and poll for progress messages
        const generatePromise = generateText({
            model: resolveProvider(goalConfig, providerMap),
            system,
            prompt: `Task: ${String(task ?? '')}`,
            tools: aiTools,
            toolChoice: 'required',
            temperature: goalConfig.temperature,
            abortSignal: abortSignal,
        });
        
        // Track which tool was called
        let toolName = null;
        
        // Poll for progress messages while generateText is running
        let resp;
        while (true) {
            // Yield any queued messages
            while (messageQueue.length > 0) {
                const msg = messageQueue.shift();
                yield `<log>${msg}</log>\n`;
            }
            
            // Check if generateText has completed
            const result = await Promise.race([
                generatePromise,
                new Promise(resolve => setTimeout(() => resolve(null), 100))
            ]);
            
            if (result !== null) {
                resp = result;
                break;
            }
        }
        
        // Final flush of any remaining messages
        while (messageQueue.length > 0) {
            const msg = messageQueue.shift();
            yield `<log>${msg}</log>\n`;
        }

        let resultValue;
        if (resp && Array.isArray(resp.toolResults) && resp.toolResults.length > 0) {
            resultValue = resp.toolResults[0].output;
            toolName = resp.toolResults[0].toolName || resp.toolCalls?.[0]?.toolName || 'unknown_tool';
        } else if (resp && Array.isArray(resp.toolCalls) && resp.toolCalls.length > 0) {
            // Manual fallback: execute the first tool call (shouldn't reach here normally)
            const call = resp.toolCalls[0];
            toolName = call.toolName || call.tool || 'unknown_tool';
            const toolDef = aiTools[toolName];
            if (!toolDef || typeof toolDef.execute !== 'function') {
                throw new Error(`Tool "${toolName}" is not executable`);
            }

            debugLog(`Executing tool ${toolName} with args:`, call.args || call.arguments || {});
            resultValue = await toolDef.execute(call.args || call.arguments || {});
            
            // Flush any messages generated during manual execution
            while (messageQueue.length > 0) {
                const msg = messageQueue.shift();
                yield msg + '\n';
            }
        } else {
            throw new Error('No tool call result returned by LLM');
        }

        const printable = typeof resultValue === 'string' ? resultValue : JSON.stringify(resultValue, null, 2);
        
        // Wrap tool output with markers for frontend badge rendering
        // Use hyphenated tag name for valid HTML/JSX (tool-output instead of tool_output)
        yield `\n<tool-output tool="${toolName || 'tool'}">\n`;
        yield printable;
        yield `\n</tool-output>\n\n`;

        yield { tool_output: printable, success: true };
    } catch (error) {
        const msg = `Error: ${error.message}`;
        yield msg;
        yield { tool_output: msg, success: false };
    }
}

/**
 * Execute agentic loop using Vercel AI SDK tools.
 * Loops until the agent outputs a Prolog result term.
 */
export async function* agentLoop(prompt, resultTerm, options, session, abortSignal, dmlCode) {

    try {

        let messages = [];
        const resultTerm_ = resultTerm;

        if (!GLOBAL_TOOLS || GLOBAL_TOOLS.length === 0) {
            const { DEFAULT_TOOLS } = await import('./tools.js');
            GLOBAL_TOOLS = DEFAULT_TOOLS.slice();
        }

        // Use a shared message queue that can be accessed during tool execution
        const messageQueue = [];
        let queueResolver = null;
        
        // Create a progress callback that signals new messages
        const progressCallback = function(message) {
            messageQueue.push(message);
            // Notify any waiting consumers
            //if (queueResolver) {
            //    queueResolver = null;
            //    resolve();
            //}
        };

        let resultTermExtracted = resultTerm;

        // Build the AI SDK tools map with progress callback
        const { buildAiTools } = await import('./tools.js');
        const aiToolsBase = await buildAiTools(session, progressCallback);

        // Merge MCP tools (without wrapping, as they don't have progress callbacks)
        const aiTools = { ...aiToolsBase, ...MCP_TOOL_MAP };

        //filter tools: only use the ones in options[0].tools[0]
        const filteredTools = {};
        if (options && options.length > 0 && options[0].tools && options[0].tools.length > 0) {
            const allowedTools = new Set(options[0].tools[0][0]);
            for (const [name, tool] of Object.entries(aiTools)) {
                if (allowedTools.has(name)) {
                    filteredTools[name] = tool;
                }
            }
        } else {
            Object.assign(filteredTools, aiToolsBase);
        }

        let responseText = '';
        let finalAnswer = ""
        filteredTools["final_answer"] =  aiTool({
            description: "Provide the final answer to the user's request. Use this when you have completed the task and want to deliver your final response. This will end the agent's execution.",
            inputSchema: z.object({ 
                message: z.string().describe("The final answer or summary to present to the user")
            }),
            execute: async ({ message }) => {
                finalAnswer = message;
                responseText += message
                return "\n\n"+message;
            }
        });
        

        const today = new Date().toISOString().split('T')[0];
        const maxSteps = options?.max_steps || 10;
        
        const system = [
            `Today is ${today}.`,
`### SYSTEM INSTRUCTIONS

**ROLE:**
You are a specialized Sub-Agent designed to execute specific tasks. You do not interact directly with the user; you receive tasks from a Supervisor Agent and report results back to them.

**OBJECTIVE:**
Your goal is to complete the assigned task efficiently using ONLY the tools provided to you. Do not rely on your internal knowledge base for factual queries if a tool exists to retrieve that data.

**OPERATIONAL RULES:**
1. **Tool Priority:** Always check if a tool can solve the problem before attempting to answer directly.
2. **Argument Validation:** Before calling a tool, ensure you have all required arguments. If arguments are missing, return a failure message to the Supervisor explaining what is missing.
3. **No Hallucination:** Do not make up tool outputs. If a tool fails or returns empty data, state that clearly.
4. **Iterative Problem Solving:** If a tool output requires further processing using another tool, do so. 
5. **Final Output:** When the task is complete, provide a concise summary of the result.
6. **Finish Condition:** If the task is complete, then call the final_answer tool with the result.

**FAILURE PROTOCOL:**
If you cannot complete the task with the available tools, do not guess. Return a response starting with "UNABLE_TO_COMPLETE:" followed by the reason (e.g., missing tool, API error, ambiguous request) and pass this to the final answer tool.

**YOUR PROCESS:**
1. Analyze the input task.
2. Determine which tool(s) are necessary.
3. Formulate the tool call(s).
4. Analyze the tool output.
5. Formulate the final response to the Supervisor and call the final_answer tool.`
        ].join('\n');

        debugLog('agent_loop system prompt:', system)

        const goalConfig = getCurrentGoalModelConfig();
        
        // Agentic loop
        let currentMessages = Array.isArray(messages) ? [...messages] : [];
        currentMessages.push({ role: "user", content: String(prompt ?? '') });
        
        

        const agentConfig = getAgentConfig();
        // Start streamText for this step
        const streamResult = await streamText({
            model: resolveProvider(getAgentModelConfig(), providerMap),
            system,
            messages: currentMessages,
            tools: filteredTools,
            stopWhen: [
                hasToolCall("final_answer"),
                stepCountIs(options?.max_steps || 20), // Maximum 20 steps
            ],
            temperature: agentConfig.temperature,
            //abortSignal: abortSignal,
        });
    
        
        // Stream the response and check for result terms
        for await (const chunk of streamResult.fullStream) {
            // Check abort signal
            if (abortSignal?.aborted) {
                yield `<log>Agent step aborted</log>\n`;
                break;
            }
            
            // Yield any queued messages
            while (messageQueue.length > 0) {
                const msg = messageQueue.shift();
                yield `<log>${msg}</log>\n`;
            }
            
            if (chunk.type === 'text-delta') {
                const text = chunk.text || '';
                if (text) {
                    responseText += text;
                    yield text; // Stream text in real-time
                    
                }

            } else if (chunk.type === 'tool-call') {

                if (filteredTools[chunk.toolName]) {
                    yield `<log>Executing tool ${chunk.toolName}</log>\n`;
                }


            }
        }
        
        // Final flush of any remaining messages
        while (messageQueue.length > 0) {
            const msg = messageQueue.shift();
            yield `<log>${msg}</log>\n`;
        }
        
        debugLog('Agent loop completed with response:', responseText);

        yield { result_term: responseText, output: responseText,success: true };

    } catch (error) {
        const msg = `Error: ${error.message}`;
        yield msg;
        yield { result_term: `result(error("${error.message}"))`, success: false };
    }
}

/**
 * Execute instruction using LLM
 */
export async function* instruction(task, attempt, messages, abortSignal = null) {
    try {
        const msgs = Array.isArray(messages) ? [...messages] : [];
        msgs.push({ role: "user", content: String(task ?? '') });

        const goalConfig = getCurrentGoalModelConfig();
        const result = await streamText({
            model: resolveProvider(goalConfig, providerMap),
            messages: msgs,
            temperature: SUMMARY_MODEL_TEMP,
            abortSignal: abortSignal,
        });

        let all = '';

        //output an avatar emoji before the llm response
        //yield '\n🤖 Processing instruction "' + String(task ?? '') + '..."\n';

        for await (const chunk of result.textStream) {
            const piece = typeof chunk === 'string' ? chunk : (chunk?.text ?? '');
            if (!piece) continue;
            all += piece;
            yield piece;
        }

        yield { all_output: all, success: true };
    } catch (error) {
        yield { all_output: `Error: ${error.message}`, success: false };
    }
}

/**
 * Evaluate a prolog goal using an LLM
 */
export async function* evaluateGoal(swipl, goal, goalInContext, goalList, origGoalList, origBindings, ruleExplanation, text, slowdown = 1, maxAttempts = 3) {
    try {
        const args = goalList.slice(1);
        const argsDef = origGoalList.slice(1);

        const newArgs = [];
        for (let i = 0; i < args.length; i++) {
            const a = String(args[i]);
            const b = String(argsDef[i]);
            if (a.startsWith('_') && !a.includes('{')) { //dicts have tags with vars that start with _
                newArgs.push(b.replace(/'/g, ''));
            } else {
                newArgs.push(a);
            }
        }

        const newGoal = goalList[0] + '(' + newArgs.join(',') + ')';
        const functorName = goalList[0];

        // Identify which arguments are unbound variables (need values) vs constants/bound vars (use _ placeholder)
        const hasUnboundVars = newArgs.some(arg => {
            const argStr = String(arg);
            return argStr.startsWith('_') && !argStr.includes('{');
        });
        
        const argDescriptions = newArgs.map(arg => {
            const argStr = String(arg);
            if (argStr.startsWith('_') && !argStr.includes('{')) {
                return argStr; // Unbound variable - needs assignment
            } else {
                return '_'; // Bound argument - use placeholder in output
            }
        });
        
        const outputTemplate = functorName + '(' + argDescriptions.join(', ') + ')';

        const today = new Date().toISOString().split('T')[0];
        
        // Build bound variables information block
        const boundVarsInfo = [];
        for (let i = 0; i < newArgs.length; i++) {
            const argStr = String(newArgs[i]);
            const originalArgStr = String(argsDef[i]);
            if (!(argStr.startsWith('_') && !argStr.includes('{'))) {
                // This is a bound variable/constant
                boundVarsInfo.push({
                    position: i + 1,
                    name: originalArgStr.replace(/'/g, ''),
                    value: argStr
                });
            }
        }
        
        let systemPrompt;
        
        if (!hasUnboundVars) {
            // All arguments are grounded - just need true/false evaluation
            systemPrompt = `${today}

You are an expert reasoning engine evaluating Prolog goals against text.

Given:
- A text (in triple backticks) - this includes bound variable values
- A Prolog goal: ${outputTemplate}
- Goal explanation: ${ruleExplanation === "na" ? goalInContext : ruleExplanation}

Your task: Determine if the goal is TRUE or FALSE based on the text.

The text section contains both the main content and a "BOUND VARIABLES" section that lists the values already assigned to certain arguments. Use these bound values when evaluating the goal.

Instructions:
1. Analyze the text and bound variables to determine if the goal is satisfied
2. Return TRUE if the goal holds, FALSE otherwise

Output format:
First, explain your reasoning briefly starting with "Reasoning: "
Then on a new line, output either:
TRUE
or
FALSE

Example:
Reasoning: The text mentions that Python is a programming language created by Guido van Rossum, which matches the goal statement.
TRUE

Another example:
Reasoning: The text does not contain any information about Java's creator, so the goal cannot be verified.
FALSE
`;
        } else {
            // Has unbound variables - need to generate terms with bindings
            systemPrompt = `${today}

You are an expert reasoning engine evaluating Prolog goals against text.

Given:
- A text (in triple backticks) - this includes bound variable values
- A Prolog goal: ${outputTemplate}
- Goal explanation: ${ruleExplanation === "na" ? goalInContext : ruleExplanation}

Your task: Generate a list of Prolog terms that satisfy the goal.

The text section contains both the main content and a "BOUND VARIABLES" section. The bound variables have already been assigned values - you should use "_" as placeholder for these in your output and ONLY assign values to the unbound variables (those starting with _ in the goal template).

CRITICAL INSTRUCTIONS FOR OUTPUT FORMAT:
1. Each term MUST be complete and valid Prolog syntax on its own
2. DO NOT split a single term across multiple "---" separators
3. DO NOT use "---" inside quasi-quotations, lists, or term structures
4. The "---" separator ONLY appears BETWEEN complete, independent terms

CRITICAL INSTRUCTIONS FOR BOUND VS UNBOUND VARIABLES:
${boundVarsInfo.length > 0 ? 
`1. The following arguments are ALREADY BOUND (see BOUND VARIABLES in the text):
${boundVarsInfo.map(v => `   - Argument ${v.position} (${v.name})`).join('\n')}
   For these arguments, ALWAYS use the underscore placeholder "_" in your output.
   DO NOT repeat their values in your output terms.
` : ''}2. Variables starting with underscore in the goal template (${outputTemplate}) are UNBOUND.
   These are the ONLY variables you should assign values to.
3. Each result term should follow this template: ${outputTemplate}
   Replace each unbound variable (starting with _) with a value from the text.
   Keep "_" as placeholder for all bound arguments.

${boundVarsInfo.length > 0 ? `
Example with bound arguments:
If the goal template is: process(_Output, _Status) and Arguments 3-5 are bound,
Your output should be: process("extracted value", "success", _, _, _)
NOT: process("extracted value", "success", "repeated bound value", ...)
` : ''}

FORMATTING RULES FOR LISTS:
When a variable should be bound to a LIST of items:
- The ENTIRE list must be in ONE term, using [...] Prolog list syntax
- DO NOT separate list items with "---"
- DO NOT put "---" between list elements

CORRECT example for a list result:
Goal: search(_Results, "query")
Output: search(["item1", "item2", "item3"], _)

WRONG (DO NOT DO THIS):
search(["item1"
---
"item2"
---
"item3"], _)

Instructions:
1. Identify if the goal represents an instruction (e.g., extract_data, search, parse). If so, execute it and assign ONLY the unbound variables.
2. Otherwise, convert the text to Prolog facts and verify if the goal holds. Assign ONLY the unbound variables based on facts from the text.
3. Return ONLY valid Prolog terms that can be parsed by SWI-Prolog.
4. Use double-quoted strings, not atoms with single quotes.
5. For complex/long strings with special characters, use quasi-quotations: {|string|| text here |}
6. Do NOT include the input text in your output - use _ for bound arguments

Output format:
First, explain your reasoning briefly.
Then output "TERMS:" on a new line.
After that, output each COMPLETE Prolog term separated by a line containing only "---"

IMPORTANT: 
- The "---" separator appears BETWEEN different terms, NOT inside quasi-quotations, NOT inside lists, NOT inside term structures
- If a quasi-quotation contains multiple lines, that's fine - just don't use "---" within it
- If a list contains multiple items, that's fine - just don't use "---" between the items
- Each term must be syntactically complete and parseable on its own

Example with MULTIPLE INDEPENDENT TERMS:
Reasoning: Found three separate facts in the text...

TERMS:
person("John", 30)
---
person("Jane", 25)
---
person("Bob", 35)

Example with ONE term containing a LIST:
Reasoning: Extracting all names into a single list...

TERMS:
extract_names(_, ["John", "Jane", "Bob"])

Example with ONE term containing a multi-line quasi-quotation:
Reasoning: Extracting paper content from the long text...

TERMS:
process_paper(_, {|string||
This is the summary
of the paper with
multiple lines
and no --- separators inside
because this is ONE single term
|})

Example with TWO terms, each with quasi-quotations:
Reasoning: Found two separate papers...

TERMS:
process_paper(_, {|string||
First paper summary
with multiple lines
|})
---
process_paper(_, {|string||
Second paper summary
also with multiple lines
|})

Example with structured term containing a list:
Reasoning: Extracting metadata with multiple tags...

TERMS:
extract_metadata(_, metadata("Title", ["tag1", "tag2", "tag3"], "2024-01-01"))

Remember:
- Use "_" as placeholder for all bound arguments (constants or already-provided values)
- Only assign values to unbound variables (those starting with _)
- Use quasi-quotations {|string|| ... |} for long text, code, LaTeX, or text with many escape sequences
- Quasi-quotations end with |} (only ONE | before })
- The "---" separator is ONLY used BETWEEN different terms, never inside a quasi-quotation, never inside a list
- Each term must be complete and parseable independently
- Return valid SWI-Prolog terms that can be parsed with read_term_from_atom/2
- DO NOT repeat long input strings in output
`;
        }

        // Build the text block with bound variables information
        let textWithBoundVars = text;
        if (boundVarsInfo.length > 0) {
            const boundVarsBlock = "\n\n--- BOUND VARIABLES (already have values - use _ as placeholder in output) ---\n" +
                boundVarsInfo.map(info => {
                    const truncatedValue = info.value.length > 10000 
                        ? info.value.substring(0, 10000) + "... [truncated]"
                        : info.value;
                    return `Argument ${info.position} (${info.name}): ${truncatedValue}`;
                }).join('\n') + 
                "\n--- END BOUND VARIABLES ---";
            textWithBoundVars = text + boundVarsBlock;
        }

        const userPrompt = `Text:\n\`\`\`\n${textWithBoundVars}\n\`\`\`\n\nGoal: ${outputTemplate}\nExplanation: ${ruleExplanation === "na" ? goalInContext : ruleExplanation}`;

        debugLog('Goal eval system prompt:', systemPrompt);
        debugLog('Goal eval user prompt:', userPrompt);
        
        let allTerms = [];
        let reasoning = "";
        const errors = [];

        // Open reasoning block once at the start
        yield `<reasoning>`;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            yield `Attempting to evaluate goal (${attempt + 1}/${maxAttempts})...\n`;

            try {
                const goalConfig = getCurrentGoalModelConfig();
                const result = await streamText({
                    model: resolveProvider(goalConfig, providerMap),
                    system: systemPrompt,
                    prompt: userPrompt,
                    temperature: goalConfig.temperature + attempt * 0.1,
                    maxTokens: 65535,
                });

                let fullText = "";
                
                // Stream the output
                for await (const chunk of result.textStream) {
                    fullText += chunk;
                    yield chunk; // Stream to user
                }
                
                yield `\n`; // Add newline after streaming

                if (process.env.DEBUG) {
                    debugLog('Goal eval raw output:', fullText);
                }

                // Parse the output based on whether we have unbound variables
                if (!hasUnboundVars) {
                    // Fully grounded goal - parse TRUE/FALSE response
                    const lines = fullText.split('\n').map(l => l.trim()).filter(l => l);
                    
                    // Extract reasoning
                    const reasoningLine = lines.find(l => l.toLowerCase().startsWith('reasoning:'));
                    if (reasoningLine) {
                        reasoning = reasoningLine.substring('reasoning:'.length).trim();
                    }
                    
                    // Find TRUE or FALSE
                    const resultLine = lines.find(l => l === 'TRUE' || l === 'FALSE');
                    const isTrue = resultLine === 'TRUE';
                    
                    // For grounded goals, use special markers:
                    // - '_grounded_true_' if true (goal holds with given bindings)
                    // - '_grounded_false_' if false (goal does not hold)
                    allTerms = isTrue ? ['_grounded_true_'] : ['_grounded_false_'];
                    
                } else {
                    // Has unbound variables - parse terms
                    // Extract reasoning (everything before "TERMS:")
                    const termsMarkerIndex = fullText.indexOf('TERMS:');
                    if (termsMarkerIndex !== -1) {
                        reasoning = fullText.substring(0, termsMarkerIndex).trim();
                        // Remove "Reasoning:" prefix if present
                        if (reasoning.toLowerCase().startsWith('reasoning:')) {
                            reasoning = reasoning.substring('reasoning:'.length).trim();
                        }
                    }

                    // Extract terms - everything after "TERMS:" split by "---"
                    let termsSection = termsMarkerIndex !== -1 
                        ? fullText.substring(termsMarkerIndex + 6).trim() 
                        : fullText;
                    
                    // Smart split that respects quasi-quotation boundaries
                    // We need to avoid splitting on "---" that appears inside {|string|| ... |}
                    const termLines = [];
                    let currentTerm = '';
                    let inQuasiQuotation = false;
                    const lines = termsSection.split('\n');
                    
                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        
                        // Track quasi-quotation state
                        // Look for {|string|| to enter quasi-quotation
                        if (line.includes('{|string||')) {
                            inQuasiQuotation = true;
                        }
                        // Look for |} to exit quasi-quotation (must have single | before })
                        if (inQuasiQuotation && line.includes('|}')) {
                            inQuasiQuotation = false;
                        }
                        
                        // Check if this line is a separator (only if not in quasi-quotation)
                        if (!inQuasiQuotation && line.trim().match(/^-+$/)) {
                            // This is a separator - save current term if non-empty
                            const trimmed = currentTerm.trim();
                            if (trimmed && !trimmed.toLowerCase().startsWith('reasoning')) {
                                termLines.push(trimmed);
                            }
                            currentTerm = '';
                        } else {
                            // Add this line to current term
                            currentTerm += (currentTerm ? '\n' : '') + line;
                        }
                    }
                    
                    // Don't forget the last term
                    const trimmed = currentTerm.trim();
                    if (trimmed && !trimmed.toLowerCase().startsWith('reasoning')) {
                        termLines.push(trimmed);
                    }
                    
                    if (termLines.length === 0) {
                        throw new Error('No valid Prolog terms generated');
                    }

                    // Validate each term with Prolog
                    const validatedTerms = [];
                    for (const termStr of termLines) {
                        const correctedTerm = await validateAndCorrectTerm(swipl, termStr, 'goal_term');
                        
                        if (correctedTerm.error) {
                            debugLog(`Term validation failed: ${correctedTerm.error}`);
                            continue; // Skip invalid terms
                        }
                        
                        validatedTerms.push(correctedTerm.term);
                    }

                    if (validatedTerms.length === 0) {
                        throw new Error('All generated terms failed Prolog validation');
                    }

                    allTerms = validatedTerms;
                }
                
                break; // Success!

            } catch (error) {
                debugLog(error);
                errors.push(error.message || String(error));

                if (attempt == maxAttempts - 1) {
                    yield `\n<log>Final attempt failed: ${error.message}</log>\n`;
                    break;
                } else {
                    if (process.env.DEBUG) {
                        debugLog(`Goal eval attempt ${attempt + 1} failed:`, error);
                    }
                    yield `\n<log>Attempt ${attempt + 1} failed: ${error.message}</log>\n`;
                    yield '<log>Retrying...</log>\n\n';
                }
            }
        }

        // Close reasoning block once at the end
        yield `</reasoning>\n`;

        if (allTerms.length === 0) {
            throw new Error(`LLM Goal eval failed: ${errors.join(', ')}`);
        }

        // Parse terms to extract variable assignments
        const newVars = [];
        
        // Check if this is a grounded goal that evaluated to true or false
        if (!hasUnboundVars && (allTerms[0] === '_grounded_true_' || allTerms[0] === '_grounded_false_')) {
            // For fully grounded goals:
            // - If TRUE, push empty array (succeeded with no new bindings)
            // - If FALSE, don't push anything (failed, so newVars.length will be 0)
            if (allTerms[0] === '_grounded_true_') {
                newVars.push([]);
            }
            // If _grounded_false_, leave newVars empty so result will be false
        } else {
            // Parse terms with unbound variables
            for (const termStr of allTerms) {
                // Extract arguments from the term
                // Simple parser: find content between first ( and last )
                const openParen = termStr.indexOf('(');
                const closeParen = termStr.lastIndexOf(')');
                
                if (openParen === -1 || closeParen === -1) {
                    debugLog(`Invalid term format: ${termStr}`);
                    continue;
                }

                const argsStr = termStr.substring(openParen + 1, closeParen);
                
                // Write term to a temp file and parse with Prolog to extract arguments
                try {
                    const tempTermFile = `/tmp/term_parse_${Date.now()}_${Math.random().toString(36).substring(7)}.pl`;
                    const termWithDot = `${functorName}(${argsStr}).`;
                    
                    // Write the term to file
                    swipl.FS.writeFile(tempTermFile, termWithDot);

                    if (process.env.DEBUG) {
                         const tempTermFile = `term_parse_${Date.now()}_${Math.random().toString(36).substring(7)}.pl`;
                         const termWithDot = `${functorName}(${argsStr}).`;
                    
                        // Write the term to file
                        fs.writeFileSync(tempTermFile, termWithDot);
                    }
                    
                    // Read and parse the term from file
                    const parseQuery = `readutil:read_file_to_string('${tempTermFile}', TermStr, []), 
                                       read_term_from_atom(TermStr, Term, []), 
                                       Term =.. [_Functor|Args]`;
                    const parseResult = await swipl.prolog.query(parseQuery, {}).next();
                    
                    // Clean up temp file
                    try {
                        swipl.FS.unlink(tempTermFile);
                    } catch (e) {
                        // Ignore cleanup errors
                    }
                    
                    if (parseResult && parseResult.value && parseResult.value.Args) {
                        let args = parseResult.value.Args;
                        
                        // Recursively unwrap nested list structures that result from SWIPL WASM binding
                        const unwrapNestedLists = (obj) => {
                            if (Array.isArray(obj)) {
                                // If it's an array with a single element that is also an array, unwrap it
                                if (obj.length === 1 && Array.isArray(obj[0])) {
                                    return unwrapNestedLists(obj[0]);
                                }
                                // Otherwise, recursively process each element
                                return obj.map(unwrapNestedLists);
                            } else if (obj && typeof obj === 'object') {
                                // For objects (like Prolog terms), recursively process all properties
                                const result = {};
                                for (const [key, value] of Object.entries(obj)) {
                                    result[key] = unwrapNestedLists(value);
                                }
                                return result;
                            }
                            // Base case: primitive values
                            return obj;
                        };
                        
                        args = unwrapNestedLists(args);
                        newVars.push(args);
                    } else {
                        // Fallback: use the term as-is
                        debugLog(`Prolog parsing returned no Args, using term as-is: ${termStr}`);
                        newVars.push([termStr]);
                    }
                } catch (parseError) {
                    debugLog(`Failed to parse term with Prolog: ${termStr}`, parseError);
                    // On error, use the entire term as a single element
                    newVars.push([termStr]);
                }
            }
        }

        const response = {
            result: newVars.length > 0,
            summary: reasoning || "Goal evaluation completed",
            variable_assignments: newVars,
            goal: goal,
            sources: [],
            llm_result: ""
        };

        if (process.env.DEBUG === '1') {
            debugLog('Processed goal eval response:', response);
        }

        yield '\n<log>Goal evaluation finished.</log>\n';
        yield response;

    } catch (error) {
        debugLog('Goal evaluation error:', error);
        yield {
            result: false,
            summary: `An error occurred: ${error.message}`,
            variable_assignments: [[]],
            sources: []
        };
    }
}

/**
 * Generate DML code from a user question
 */
export async function* questionToProlog(question, attempt, exampleDir = null, swipl = null, attempts = 3) {
    try {
        let examples = "";

        if (!exampleDir) {
            // Use database examples (would need PostgreSQL implementation)
            debugLog("Using database examples (not implemented in JS version)");
        } else {
            // Read examples from directory
            if (fs.existsSync(exampleDir)) {
                const files = fs.readdirSync(exampleDir);
                for (const filename of files) {
                    if (filename.endsWith('.dml')) {
                        // ...existing code...
                        const dmlPath = path.join(exampleDir, filename);
                        const dmlCode = fs.readFileSync(dmlPath, 'utf-8');
                        const questionFilename = filename.replace('.dml', '.txt');
                        const questionPath = path.join(exampleDir, questionFilename);
                        let exQuestion = "Check below code for question:";
                        if (fs.existsSync(questionPath)) {
                            exQuestion = fs.readFileSync(questionPath, 'utf-8').trim();
                        }
                        examples += `<example>:\nInput: "${exQuestion}"\nOutput:\n\`\`\`prolog\n${dmlCode}\n\`\`\`\n</example>\n`;
                    }
                }
            }
        }

        // --- NEW: contextual web search before prompt construction ---
        let searchContext = "";
        try {
            // Determine which search tool to use based on settings
            const cfg = loadSettingsConfig();
            const toolConfig = cfg.defaultTools;
            
            // Find a search tool from GLOBAL_TOOLS based on configuration
            let searchTool = null;
            let searchToolName = null;
            
            if (toolConfig) {
                if (toolConfig.brave_search) {
                    searchToolName = 'brave_search';
                } else if (toolConfig.you_search) {
                    searchToolName = 'you_search';
                } else if (toolConfig.google_search) {
                    searchToolName = 'web_search'; // Google uses 'web_search' as name
                }
            }
            
            // Find the tool in GLOBAL_TOOLS
            if (searchToolName && GLOBAL_TOOLS && GLOBAL_TOOLS.length > 0) {
                searchTool = GLOBAL_TOOLS.find(t => t.name === searchToolName);
            }
            
            // Fallback: find any search tool, prefer brave_search
            if (!searchTool && GLOBAL_TOOLS && GLOBAL_TOOLS.length > 0) {
                searchTool = GLOBAL_TOOLS.find(t => 
                    t.name === 'brave_search' || 
                    t.name === 'web_search' || 
                    t.name === 'you_search'
                );
            }
            
            // Perform search if we found a search tool
            if (searchTool && typeof searchTool.forward === 'function') {
                const searchQuery = String(question).slice(0, 400);
                
                // Validate search query
                if (!searchQuery || searchQuery.trim().length === 0) {
                    yield `<log>Skipping web search - empty query</log>`;
                } else {
                    try {
                        // Call forward with appropriate parameters based on tool type
                        let rawSearch;
                        if (searchTool.name === 'brave_search') {
                            // Brave search expects: forward(query, searchType, count, country, safesearch, freshness)
                            // Note: count must be at least 10 for web/news searches
                            rawSearch = await searchTool.forward(searchQuery, "web", 10, "us", "moderate", null);
                        } else if (searchTool.name === 'web_search') {
                            // Google search expects: forward(query, progressCallback, numResults)
                            rawSearch = await searchTool.forward(searchQuery, null, 8);
                        } else {
                            // You.com search expects: forward(query, progressCallback, numResults)
                            rawSearch = await searchTool.forward(searchQuery, null, 8);
                        }
                        
                        if (rawSearch && typeof rawSearch === 'string' && rawSearch.length > 0) {
                            searchContext = rawSearch.length > 5000 ? rawSearch.slice(0, 2500) + "\n...\n" + rawSearch.slice(-2000) : rawSearch;
                            yield `<log>Performed initial web search for additional context using ${searchTool.name}</log>`;
                        } else {
                            yield `<log>Web search returned no results</log>`;
                        }
                    } catch (searchError) {
                        // Log search failure but continue without it
                        debugLog(`Web search failed: ${searchError.message}`);
                        yield `<log>Web search unavailable, proceeding without additional context</log>`;
                    }
                }
            } else {
                yield `<log>No search tool available for context gathering</log>`;
            }
        } catch (e) {
            // Outer catch for configuration errors - don't treat as fatal
            debugLog(`Search configuration error: ${e.message}`);
            yield `<log>Skipping web search due to configuration issue</log>`;
        }
        // ------------------------------------------------------------

        // Use global tools description
        let toolsDesc = GLOBAL_TOOLS_DESCRIPTION;
        if (!toolsDesc) {
            const { DEFAULT_TOOLS } = await import('./tools.js');
            toolsDesc = "";
            for (const tool of DEFAULT_TOOLS) {
                toolsDesc += `Name: ${tool.name}\nDescription: ${tool.description}\nInputs: ${JSON.stringify(tool.inputs)}\nOutput type: ${tool.output_type}\n\n`;
                yield `Found tool - ${tool.name}\n`;
            }
        } 

        const today = new Date().toISOString().split('T')[0];
        const systemPrompt = conversionPrompt
            .replace('{todays_date}', `Today is ${today}.`)
            .replace('{tools}', toolsDesc)
            .replace('{examples}', examples);

        // We'll use a messages array so we can append error feedback on retries
        // --- MODIFIED: append search context if available ---
        const baseUserMsg = `Now please convert the following query into prolog code: ${question}${
            searchContext
                ? `\n\nAdditional context from a recent web search (markdown):\n${searchContext}\n\nUse this context only if relevant; do not copy irrelevant snippets.\nDepending on this context, try to understand the complexity of the user query and either create a DML that represents a simple straightforward plan or attempt to create a more complex plan that e.g. performs deeper searches or implements other complex logic.`
                : ''
        }`;
        // ----------------------------------------------------
        let messages = [{ role: 'user', content: baseUserMsg }];

        //yield "**Generating DML code**\n\n I am now generating the final DML code for your query. This may take a few seconds.\n\n";

        let lastError = null;
        let lastCode = null;

        // Helper: ensure Prolog modules loaded once
        async function ensurePrologModulesLoaded() {
            if (!swipl || swipl.__dmlModulesLoaded) return;
            try {
                const resolver = getResourceResolver();
                let cmdlineLoad = resolver ? resolver.readDmlCore('cmdline.pl') : fs.readFileSync('src/dml-core/cmdline.pl');
                let dml_stringsLoad = resolver ? resolver.readDmlCore('dml_strings.pl') : fs.readFileSync('src/dml-core/dml_strings.pl');
                let plogchainLoad = resolver ? resolver.readDmlCore('plogchain.pl') : fs.readFileSync('src/dml-core/plogchain.pl');
                await swipl.prolog.load_string(cmdlineLoad.toString(), '/wasm/cmdline.pl');
                await swipl.prolog.load_string(plogchainLoad.toString(), '/wasm/plogchain.pl');
                await swipl.prolog.load_string(dml_stringsLoad.toString(), '/wasm/dml_strings.pl');
                swipl.__dmlModulesLoaded = true;
            } catch (e) {
                lastError = `Failed loading Prolog modules: ${e.message}`;
            }
        }

        // Helper: validate code by initializing cooperative engine
        async function validateProlog(code) {
            if (!swipl) return { ok: true, message: 'No SWIPL provided, skipping validation.' };
            if (!code || !code.trim()) return { ok: false, message: 'Empty code produced.' };
            await ensurePrologModulesLoaded();
            if (lastError && !swipl.__dmlModulesLoaded) {
                return { ok: false, message: lastError };
            }
            try {
                const tmpPath = `/tmp/validate_${Date.now()}_${Math.random().toString(36).slice(2)}.dml`;
                swipl.FS.writeFile(tmpPath, code);
                const q = `
                    use_module(library(readutil)),
                    use_module(library(quasi_quotations)),
                    use_module(library(strings)),
                    use_module(library(lists)),
                    readutil:read_file_to_string('${tmpPath}', DMLCode, []),
                    cmdline:init_cooperative_engine(DMLCode, 'validate_engine', 'validate_mem', [], py{}, Success, Error)
                `;
                const initResult = await swipl.prolog.query(q).next();
                if (!initResult || initResult.value.Success == 'false') {
                    return {
                        ok: false,
                        message: initResult?.value?.Error ? initResult.value.Error.toString() : 'Unknown init error'
                    };
                }
                return { ok: true, message: 'Validation succeeded' };
            } catch (e) {
                return { ok: false, message: e.message };
            }
        }

        for (let i = 0; i < attempts; i++) {
            if (i > 0) {
                yield `<log>task="Retrying code generation attempt ${i + 1}/${attempts}"</log>`;
            }

            // Stream reasoning + code
            const converterConfig = getCurrentConverterModelConfig();
            const result = await streamText({
                model: resolveProvider(converterConfig, providerMap),
                system: systemPrompt,
                messages,
                temperature: converterConfig.temperature+i*0.1,
                reasoning: { reasoningSummary: 'auto' },
                config: { thinkingConfig: { includeThoughts: true, thinkingBudget: 8192 } },
                providerOptions: {
                    google: { includeThoughts: true, thinkingBudget: 8192 }
                },
                maxTokens: 65535,
            });

            let responseText = "";
            for await (const part of result.fullStream) {
                if (part.type === 'text' || part.type === 'text-delta') {
                    const t = part.text || part.delta || "";
                    if (t) {
                        responseText += t;
                        yield t;
                    }
                } else if (part.type === 'reasoning') {
                    const r = typeof part.reasoning === 'string' ? part.reasoning : JSON.stringify(part.reasoning);
                    if (r) yield r;
                }
            }

            // Extract code block
            const extractCode = (t) => {
                const prologStartTag = '```prolog';
                const startIdx = t.indexOf(prologStartTag);
                if (startIdx !== -1) {
                    const endTag = '```';
                    const endIdx = t.lastIndexOf(endTag);
                    // Ensure the last ``` is after the ```prolog and not the same one
                    if (endIdx > startIdx) {
                        const codeStart = startIdx + prologStartTag.length;

                        //Hack
                        return t.substring(codeStart, endIdx).replaceAll("||}", "|}").trim();
                    }
                }

                // Fallback for any fenced block if ```prolog is not found
                const anyStartTag = '```';
                const anyStartIdx = t.indexOf(anyStartTag);
                if (anyStartIdx !== -1) {
                    const endTag = '```';
                    const endIdx = t.lastIndexOf(endTag);
                    if (endIdx > anyStartIdx) {
                        const codeStart = anyStartIdx + anyStartTag.length;
                        return t.substring(codeStart, endIdx).trim();
                    }
                }

                //Hack
                t = t.replaceAll("||}", "|}")

                return t.trim(); // No block found, return the whole text trimmed
            };
            const code = extractCode(responseText);
            lastCode = code;

            if (!code) {
                lastError = "No code extracted.";
                messages.push({
                    role: 'user',
                    content: `The previous response did not contain extractable code. Error: ${lastError}. Please regenerate only a valid \`\`\`prolog ...\`\`\` block.`
                });
                continue;
            }

            // Step 1: Semantic validation using LLM
            yield `<log>task="Analyzing code quality and DML compliance"</log>`;
            /*const semanticValidation = await validatePrologCode(code, question);
            
            if (!semanticValidation.valid) {
                lastError = "Code analysis found issues:\n" + semanticValidation.issues.join('\n\n');
                yield `<log>task="Code analysis failed with ${semanticValidation.issues.length} issues"</log>`;
                
                // Log issues to console for debugging
                debugLog('\n⚠️  Code Validation Issues Found:');
                debugLog('═'.repeat(80));
                semanticValidation.issues.forEach((issue, idx) => {
                    debugLog(`\nIssue ${idx + 1}:`);
                    debugLog(issue);
                });
                debugLog('═'.repeat(80) + '\n');
                
                // Provide detailed feedback for regeneration
                messages.push({
                    role: 'user',
                    content: `The generated code has the following issues that need to be fixed:\n\n${semanticValidation.issues.join('\n\n')}\n\nPlease regenerate the code addressing ALL of these issues. Return ONLY corrected Prolog code inside a single \`\`\`prolog block. Do not add explanations outside the block.`
                });
                continue;
            } else {
                debugLog('✅ Code validation passed - no issues found');
                yield `<log>task="Code analysis passed"</log>`;
            }*/

            // Step 2: Syntax validation using swipl
            const validation = await validateProlog(code);
            if (validation.ok) {
                if (i > 0) {
                    yield `<log>task="Validation succeeded on attempt ${i + 1}"</log>`;
                }
                yield { code, attempts_used: i + 1, success: true };
                return;
            } else {
                lastError = validation.message;
                yield `<log>task="Syntax validation failed: ${lastError}"</log>`;
                messages.push({
                    role: 'user',
                    content: `The generated Prolog code failed to initialize with this error:\n${lastError}\n\nPlease fix the issues and regenerate ONLY corrected Prolog code inside a single \`\`\`prolog block. Do not add explanations outside the block.`
                });
            }
        }

        // Exhausted attempts
        yield {
            code: lastCode || "",
            success: false,
            attempts_used: attempts,
            error: lastError || "Unknown error after retries"
        };

    } catch (error) {
        yield { error: "Conversion failed", detail: error.message };
    }
}

/**
 * Rich console printing with formatting
 */
// ANSI color codes for terminal styling
const ANSI = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    // Colors
    black: '\x1b[30m',
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
    // Background colors
    bgBlack: '\x1b[40m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
    bgWhite: '\x1b[47m',
    // Cursor control
    clearLine: '\x1b[2K',
    cursorToStart: '\r',
    saveCursor: '\x1b[s',
    restoreCursor: '\x1b[u',
    hideCursor: '\x1b[?25l',
    showCursor: '\x1b[?25h',
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

// State for single-line streaming mode
let isInDmlExecution = false;
let lastStreamLine = '';

// State for accumulating tool output across streamed chunks
let isAccumulatingToolOutput = false;
let accumulatedToolOutput = '';
let accumulatedToolName = '';

// State for accumulating reasoning across streamed chunks
let isAccumulatingReasoning = false;
let accumulatedReasoning = '';

// State for buffering streamed text to avoid fragmented output
let streamBuffer = '';
let streamFlushTimer = null;
const STREAM_FLUSH_DELAY = 50; // ms to wait before flushing buffer

/**
 * Flush the stream buffer to stdout
 */
function flushStreamBuffer() {
    if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
        streamFlushTimer = null;
    }
    if (streamBuffer) {
        process.stdout.write(streamBuffer);
        streamBuffer = '';
    }
}

/**
 * Add text to stream buffer with debounced flush
 */
function bufferStreamText(text) {
    streamBuffer += text;
    
    // Flush immediately if we have a complete sentence or paragraph
    if (text.match(/[.!?]\s*$/) || text.includes('\n\n') || streamBuffer.length > 300) {
        flushStreamBuffer();
        return;
    }
    
    // Otherwise debounce the flush
    if (streamFlushTimer) {
        clearTimeout(streamFlushTimer);
    }
    streamFlushTimer = setTimeout(flushStreamBuffer, STREAM_FLUSH_DELAY);
}

/**
 * Format tool output for display - truncate and clean up
 */
function formatToolOutput(content, maxLines = 15, maxLineLength = 100) {
    const lines = content.split('\n');
    let result = [];
    let truncatedLines = 0;
    
    for (let i = 0; i < lines.length && result.length < maxLines; i++) {
        let line = lines[i];
        // Truncate long lines
        if (line.length > maxLineLength) {
            line = line.substring(0, maxLineLength - 3) + '...';
        }
        result.push(line);
    }
    
    if (lines.length > maxLines) {
        truncatedLines = lines.length - maxLines;
        result.push(`${ANSI.dim}... ${truncatedLines} more lines${ANSI.reset}`);
    }
    
    return result.join('\n');
}

/**
 * Create a compact tool output display
 */
function createCompactToolOutput(toolName, content, maxLength = 500) {
    const termWidth = process.stdout.columns || 80;
    const displayWidth = Math.min(termWidth - 4, 100);
    
    // Truncate content
    let displayContent = content;
    let wasTruncated = false;
    if (content.length > maxLength) {
        displayContent = content.substring(0, maxLength);
        wasTruncated = true;
    }
    
    // Format as compact output
    const formatted = formatToolOutput(displayContent, 12, displayWidth - 4);
    
    let result = `\n${ANSI.blue}${ANSI.bold}📤 ${toolName}${ANSI.reset}\n`;
    result += `${ANSI.dim}${'─'.repeat(Math.min(toolName.length + 4, displayWidth))}${ANSI.reset}\n`;
    result += `${ANSI.brightBlack}${formatted}${ANSI.reset}\n`;
    if (wasTruncated) {
        result += `${ANSI.dim}[truncated ${content.length - maxLength} chars]${ANSI.reset}\n`;
    }
    
    return result;
}

/**
 * Write a single-line status update (overwrites previous line)
 */
function writeSingleLineStatus(text, prefix = '⚡') {
    const termWidth = process.stdout.columns || 80;
    const maxLen = termWidth - 10;
    
    // Clean text - remove newlines and truncate
    let cleanText = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleanText.length > maxLen) {
        cleanText = cleanText.substring(0, maxLen - 3) + '...';
    }
    
    // Clear line and write new content
    process.stdout.write(`${ANSI.clearLine}${ANSI.cursorToStart}${ANSI.yellow}${prefix}${ANSI.reset} ${ANSI.dim}${cleanText}${ANSI.reset}`);
    lastStreamLine = cleanText;
}

/**
 * End single-line streaming mode and move to new line
 */
function endSingleLineMode() {
    // Also flush any pending stream buffer
    flushStreamBuffer();
    
    if (isInDmlExecution) {
        process.stdout.write('\n');
        isInDmlExecution = false;
        lastStreamLine = '';
    }
}

/**
 * Create a styled box around content
 */
function createBox(content, { title = '', color = ANSI.cyan, width = null, icon = '' } = {}) {
    const termWidth = process.stdout.columns || 80;
    const maxWidth = width || Math.min(termWidth - 4, 100);
    
    // Split content into lines and wrap
    const lines = content.split('\n');
    const wrappedLines = [];
    for (const line of lines) {
        if (line.length <= maxWidth - 4) {
            wrappedLines.push(line);
        } else {
            // Word wrap long lines
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
    
    // Calculate actual width needed
    const contentWidth = Math.max(...wrappedLines.map(l => l.length), (title.length + icon.length + 2)) + 2;
    const boxWidth = Math.min(Math.max(contentWidth + 2, 20), maxWidth);
    
    let result = '';
    
    // Top border with optional title
    const titleText = icon ? `${icon} ${title}` : title;
    if (titleText) {
        const titlePadded = ` ${titleText} `;
        const leftPad = 2;
        const rightPad = Math.max(0, boxWidth - leftPad - titlePadded.length - 2);
        result += `${color}${BOX.topLeft}${BOX.horizontal.repeat(leftPad)}${ANSI.bold}${titlePadded}${ANSI.reset}${color}${BOX.horizontal.repeat(rightPad)}${BOX.topRight}${ANSI.reset}\n`;
    } else {
        result += `${color}${BOX.topLeft}${BOX.horizontal.repeat(boxWidth - 2)}${BOX.topRight}${ANSI.reset}\n`;
    }
    
    // Content lines
    for (const line of wrappedLines) {
        const padding = Math.max(0, boxWidth - line.length - 4);
        result += `${color}${BOX.vertical}${ANSI.reset} ${line}${' '.repeat(padding)} ${color}${BOX.vertical}${ANSI.reset}\n`;
    }
    
    // Bottom border
    result += `${color}${BOX.bottomLeft}${BOX.horizontal.repeat(boxWidth - 2)}${BOX.bottomRight}${ANSI.reset}\n`;
    
    return result;
}

/**
 * Create a simple inline badge/tag
 */
function createBadge(text, color = ANSI.cyan) {
    return `${color}${ANSI.bold}[${text}]${ANSI.reset}`;
}

/**
 * End single-line streaming mode (exported for use by CLI)
 */
export { endSingleLineMode, flushStreamBuffer };

/**
 * Verbose mode flag - when false, filters out "Executing goal:" messages
 */
let verboseMode = false;

export function setVerbose(value) {
    verboseMode = !!value;
}

export function isVerbose() {
    return verboseMode;
}

/**
 * Rich console printing with TUI-style formatting
 */
export function richPrint(text) {
    marked.use(markedTerminal());
    
    try {
        // Handle <log> tags - styled as info badges
        if (text.includes('<log>task=')) {
            endSingleLineMode();
            const logText = text.replace(/<log>/g, '').replace(/<\/log>/g, '').replace(/task=/g, '').replace(/"/g, '').trim();
            process.stdout.write(`\n${ANSI.yellow}${ANSI.bold}⚡ TASK${ANSI.reset} ${ANSI.dim}│${ANSI.reset} ${logText}\n`);
            return;
        }

        if (text.includes('<log>error=')) {
            endSingleLineMode();
            const logText = text.replace(/<log>/g, '').replace(/<\/log>/g, '').replace(/error=/g, '').replace(/"/g, '').trim();
            process.stdout.write(`\n${ANSI.red}${ANSI.bold}✖ ERROR${ANSI.reset} ${ANSI.dim}│${ANSI.reset} ${logText}\n`);
            return;
        }

        if (text.includes('<log>')) {
            const logText = text.replace(/<log>/g, '').replace(/<\/log>/g, '').trim();
            // Check if it's a tool call
            if (logText.startsWith('Calling tool:')) {
                endSingleLineMode();
                const toolName = logText.replace('Calling tool:', '').trim();
                process.stdout.write(`\n${ANSI.cyan}${ANSI.bold}🔧 TOOL${ANSI.reset} ${ANSI.dim}│${ANSI.reset} ${ANSI.brightCyan}${toolName}${ANSI.reset}\n`);
            } else if (logText.startsWith('Executing goal:')) {
                // Only show "Executing goal:" messages in verbose mode
                if (verboseMode) {
                    if (isInDmlExecution) {
                        writeSingleLineStatus(logText, '▸');
                    } else {
                        process.stdout.write(`${ANSI.brightBlack}▸${ANSI.reset} ${ANSI.dim}${logText}${ANSI.reset}\n`);
                    }
                }
            } else {
                // Use single-line mode for regular log messages during DML execution
                if (isInDmlExecution) {
                    writeSingleLineStatus(logText, '▸');
                } else {
                    process.stdout.write(`${ANSI.brightBlack}▸${ANSI.reset} ${ANSI.dim}${logText}${ANSI.reset}\n`);
                }
            }
            return;
        }

        // Handle <input> tags - user input prompts
        if (text.includes('<input>')) {
            endSingleLineMode();
            const inputText = text.replace(/<input>/g, '').replace(/<\/input>/g, '').trim();
            process.stdout.write(`\n${createBox(inputText, { title: 'INPUT REQUIRED', color: ANSI.yellow, icon: '📝' })}`);
            return;
        }

        // Handle <dml-execution> tags - DML execution notifications - START single-line mode
        if (text.includes('<dml-execution>')) {
            endSingleLineMode();
            const execText = text.replace(/<dml-execution>/g, '').replace(/<\/dml-execution>/g, '').trim();
            process.stdout.write(`\n${ANSI.green}${ANSI.bold}▶ EXECUTING${ANSI.reset} ${ANSI.dim}│${ANSI.reset} ${ANSI.brightGreen}${execText}${ANSI.reset}\n`);
            isInDmlExecution = true;
            return;
        }

        // Handle <dml-code> tags - show DML code in a nice box
        if (text.includes('<dml-code>')) {
            endSingleLineMode();
            const codeText = text.replace(/<dml-code>/g, '').replace(/<\/dml-code>/g, '').trim();
            // Extract code from markdown code block if present
            const codeMatch = codeText.match(/```(?:prolog)?\n?([\s\S]*?)```/);
            const code = codeMatch ? codeMatch[1].trim() : codeText;
            process.stdout.write(`\n${createBox(code, { title: 'DML CODE', color: ANSI.magenta, icon: '📜' })}`);
            return;
        }

        // Handle <tool-output> tags - show tool output in compact format
        // First, check if we're starting to accumulate tool output (streaming case)
        const toolOutputStartMatch = text.match(/<tool-output\s+tool="([^"]+)">/);
        if (toolOutputStartMatch && !text.includes('</tool-output>')) {
            // Starting a new tool output accumulation
            isAccumulatingToolOutput = true;
            accumulatedToolName = toolOutputStartMatch[1];
            accumulatedToolOutput = text.replace(/<tool-output\s+tool="[^"]+">\n?/, '');
            return;
        }
        
        // If we're accumulating and see the end tag, render the complete output
        if (isAccumulatingToolOutput && text.includes('</tool-output>')) {
            endSingleLineMode();
            accumulatedToolOutput += text.replace(/<\/tool-output>\n?/, '');
            process.stdout.write(createCompactToolOutput(accumulatedToolName, accumulatedToolOutput.trim(), 800));
            // Reset accumulation state
            isAccumulatingToolOutput = false;
            accumulatedToolOutput = '';
            accumulatedToolName = '';
            return;
        }
        
        // If we're accumulating, just add to the buffer
        if (isAccumulatingToolOutput) {
            accumulatedToolOutput += text;
            return;
        }
        
        // Handle complete <tool-output> tags in a single chunk (non-streaming case)
        const toolOutputMatch = text.match(/<tool-output\s+tool="([^"]+)">([\s\S]*?)<\/tool-output>/);
        if (toolOutputMatch) {
            endSingleLineMode();
            const toolName = toolOutputMatch[1];
            const toolOutput = toolOutputMatch[2].trim();
            process.stdout.write(createCompactToolOutput(toolName, toolOutput, 800));
            return;
        }

        // Handle <reasoning> tags - stream on single line with accumulation
        // Check for opening tag (start accumulating)
        const reasoningOpenMatch = text.match(/<reasoning>([\s\S]*)$/);
        if (reasoningOpenMatch && !text.includes('</reasoning>')) {
            isAccumulatingReasoning = true;
            accumulatedReasoning = reasoningOpenMatch[1] || '';
            // Show initial status
            if (accumulatedReasoning.trim()) {
                writeSingleLineStatus(accumulatedReasoning.trim(), '💭');
            }
            return;
        }
        
        // Check for closing tag (finish accumulating)
        if (text.includes('</reasoning>')) {
            if (isAccumulatingReasoning) {
                // Add final content before closing tag
                const finalContent = text.replace('</reasoning>', '').replace(/\s+/g, ' ').trim();
                if (finalContent) {
                    accumulatedReasoning += finalContent;
                    // Show final update on single line
                    const cleanText = accumulatedReasoning.replace(/\n/g, ' ').trim();
                    if (cleanText) {
                        writeSingleLineStatus(cleanText, '💭');
                    }
                }
            }
            // End single-line mode (moves to next line)
            endSingleLineMode();
            // Reset accumulation state
            isAccumulatingReasoning = false;
            accumulatedReasoning = '';
            return;
        }
        
        // If we're accumulating reasoning, stream on single line
        if (isAccumulatingReasoning) {
            accumulatedReasoning += text;
            // Stream the latest content on a single line
            const cleanText = accumulatedReasoning.replace(/\n/g, ' ').trim();
            if (cleanText) {
                writeSingleLineStatus(cleanText, '💭');
            }
            return;
        }
        
        // Handle complete <reasoning> tags in a single chunk (non-streaming case)
        if (text.includes('<reasoning>')) {
            const reasoningText = text.replace(/<reasoning>/g, '').replace(/<\/reasoning>/g, '').trim();
            endSingleLineMode();
            const maxLen = 120;
            const abbreviated = reasoningText.length > maxLen 
                ? reasoningText.substring(0, maxLen) + '...'
                : reasoningText;
            process.stdout.write(`${ANSI.dim}${ANSI.magenta}💭 ${abbreviated}${ANSI.reset}\n`);
            return;
        }

        // Handle generation attempt markers
        if (text.includes('</generation_attempt>')) {
            return;
        }

        if (text.includes('<generation_attempt')) {
            endSingleLineMode();
            process.stdout.write(`\n${ANSI.yellow}${ANSI.bold}⚙️  Generating DML code...${ANSI.reset}\n`);
            return;
        }

        if (text.includes('<end_thinking>')) {
            return;
        }

        // Handle START/END OF TOOL OUTPUT markers
        if (text.includes('<START OF TOOL OUTPUT')) {
            isInDmlExecution = true;
            return; // Skip these internal markers
        }
        if (text.includes('<END OF TOOL OUTPUT')) {
            endSingleLineMode();
            return; // Skip these internal markers
        }

        // Handle goal/step output during DML execution - single line mode
        if (isInDmlExecution && text.trim()) {
            // Check if it looks like goal evaluation output or step output
            const cleanText = text.replace(/<[^>]+>/g, '').trim();
            if (cleanText && !cleanText.startsWith('#')) {
                writeSingleLineStatus(cleanText, '⚡');
                return;
            }
        }

        // Default: buffer streamed text to avoid fragmented output
        endSingleLineMode();
        
        // Skip completely empty chunks
        if (!text) {
            return;
        }
        
        // Buffer the text for smooth output
        bufferStreamText(text);

    } catch (error) {
        debugLog("Logging error:", error);
        process.stdout.write(text);
    }
}

/**
 * Get tools description for use in prompts
 */
export function getToolsDescription(mcpServers = []) {
    return GLOBAL_TOOLS_DESCRIPTION || "";
}

/**
 * Get the globally initialized tools list
 */
export function getGlobalTools() {
    if (GLOBAL_TOOLS && GLOBAL_TOOLS.length > 0) {
        return [...GLOBAL_TOOLS];
    } else {
        debugLog("Warning: Global tools not initialized, returning default tools");
        return [];
    }
}

/**
 * Get MCP tool names
 */
export function getMcpToolNames() {
    return Object.keys(MCP_TOOL_MAP);
}

/**
 * Test helper to set global tools and description.
 */
export function __setGlobalToolsForTest(tools, desc = "") {
    GLOBAL_TOOLS = Array.isArray(tools) ? [...tools] : [];
    GLOBAL_TOOLS_DESCRIPTION = desc || GLOBAL_TOOLS.map(t =>
        `Name: ${t.name}\nDescription: ${t.description}\nInputs: ${JSON.stringify(t.inputs)}\nOutput type: ${t.output_type}\n\n`
    ).join('');
}

// Initialize the bridge module with MCP servers and set up global tools
export async function init(mcpServers = []) {

    // Guard against double initialization
    if (INITIALIZED) {
        debugLog('[Bridge] Already initialized, skipping...');
        return;
    }
    INITIALIZED = true;

    // Start with default tools
    const { DEFAULT_TOOLS } = await import('./tools.js');
    GLOBAL_TOOLS = [...DEFAULT_TOOLS];
    let toolsDesc = "";

    // Add descriptions for default tools
    for (const tool of DEFAULT_TOOLS) {
        toolsDesc += `Name: ${tool.name}\nDescription: ${tool.description}\nInputs: ${JSON.stringify(tool.inputs)}\nOutput type: ${tool.output_type}\n\n`;
    }

    // Load config-defined MCP servers if not explicitly provided
    if (!mcpServers || mcpServers.length === 0) {
        const cfg = loadSettingsConfig();
        if (cfg.mcp_servers && Array.isArray(cfg.mcp_servers)) {
            mcpServers = cfg.mcp_servers;
        }
    }

    if (mcpServers && mcpServers.length > 0) {
        debugLog(`Loading ${mcpServers.length} MCP server(s) from configuration...`);
        const results = await Promise.all(mcpServers.map(connectMcpServer));
        const ok = results.filter(r => r);
        
    } else if (MCP_SERVER) {
        debugLog(`(Deprecated) Single MCP_SERVER env detected: ${MCP_SERVER}`);
        await connectMcpServer({ name: 'env_server', type: 'http', url: MCP_SERVER });
    }

    // Enhance global description with MCP tool names
    if (Object.keys(MCP_TOOL_MAP).length > 0) {
        //toolsDesc += "\nMCP Provided Tools:\n";
        for (const name of Object.keys(MCP_TOOL_MAP)) {
            const tool = MCP_TOOL_MAP[name];
            toolsDesc += `Name: ${name}\nDescription: ${tool.description}\nParameters:${JSON.stringify(tool.inputSchema.jsonSchema.properties)}\n`;
            // Mark as MCP tool for identification
            GLOBAL_TOOLS.push({ ...tool, name, fromMcp: true });

            debugLog(`Loaded MCP tool: ${name}`);
        }
    }

    GLOBAL_TOOLS_DESCRIPTION = toolsDesc;
    debugLog(`Initialized with ${GLOBAL_TOOLS.length} default tools + ${Object.keys(MCP_TOOL_MAP).length} MCP tools`);
}

/**
 * Asynchronously run DML code using SWIPL cooperative yielding
 * @param {Function} swiplFactory - Optional factory function to create fresh SWIPL instances for sub-DMLs
 */
export async function* runDmlAsync(dmlCode, sessionId = null, parameters = null, workspaceDir = "./workspace", swipl = null, inputCallback = null, memory = [], abortSignal = null, swiplFactory = null) {
    
    debugLog('[ABORT] runDmlAsync started with abort signal:', abortSignal ? 'provided' : 'null');
    if (abortSignal) {
        debugLog('[ABORT] Initial abort signal state:', abortSignal.aborted);
    }
    
    try {
        if (!sessionId) {
            sessionId = `async_${new Date().toISOString().replaceAll('-', '')}`;
        }

        if (!parameters) {
            parameters = {};
        }

        if (workspaceDir) {
            parameters.workspace_path = "/workspace";
            
            // Set environment variable for session workspace
            // This is used by tools like LinuxVMTool to mount the correct workspace
            process.env.DML_CLI_WORKSPACE = workspaceDir;
            debugLog(`[Session ${sessionId}] Set DML_CLI_WORKSPACE to: ${workspaceDir}`);
        }

        // Prepare per-session file logging
        let logFilePath = null;
        try {
            const logsDir = path.join(workspaceDir || "./workspace", "logs");
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }
            // sanitize sessionId for filenames
            const safeSession = String(sessionId).replace(/[^\w.-]/g, '_');
            logFilePath = path.join(logsDir, `${safeSession}.log`);
            const header = [
                `=== DML Session Start ===`,
                `Session: ${sessionId}`,
                `Started: ${new Date().toISOString()}`,
                `Workspace: ${path.resolve(workspaceDir || "./workspace")}`,
                `==========================`,
                ''
            ].join('\n');
            fs.writeFileSync(logFilePath, header, 'utf-8');
        } catch (e) {
            // If logging setup fails, continue without failing execution
        }
        const writeLog = (msg) => {
            if (!logFilePath) return;
            try {
                const line = `[${new Date().toISOString()}] ${typeof msg === 'string' ? msg : JSON.stringify(msg)}\n`;
                fs.appendFileSync(logFilePath, line, 'utf-8');
            } catch {}
        };

        // Check if SWIPL module is available
        if (!swipl) {
            const err = "Error: SWIPL module not provided. Cannot execute DML code.\n";
            if (logFilePath) writeLog(err);
            yield err;
            return;
        }

        // Mount workspace if not already mounted (avoid re-mounting in sub-DML calls)
        try {
            // Check if /workspace already exists and is mounted
            const stat = swipl.FS.stat('/workspace');
            writeLog('/workspace already exists, skipping mount');
        } catch (e) {
            // /workspace doesn't exist, create and mount it
            try {
                await swipl.FS.mkdir('/workspace');
                await swipl.FS.mount(swipl.FS.filesystems.NODEFS, { root: workspaceDir }, '/workspace');
                writeLog('Created and mounted /workspace');
            } catch (mountErr) {
                writeLog(`Error mounting workspace: ${mountErr.message}`);
            }
        }

        // Announce log file path to caller
        if (logFilePath) {
            yield `<log>Session log file: ${logFilePath}</log>\n`;
            writeLog('Mounted /workspace and announced log file path.');
        }

        await swipl.prolog.query('assertz(cmdline:tools_description(X))', {X : getToolsDescription()}).next();

        yield `<log>Starting DML execution for session ${sessionId}...</log>\n`;
        writeLog(`Starting DML execution for session ${sessionId}`);

        // Create unique IDs for this session
        const engineId = `engine_${sessionId}`;
        const memoryId = `mem_${sessionId}`;

        try {
            // Convert parameters to Prolog format
            const escapedParams = JSON.stringify(parameters).replaceAll('"', "'");
            writeLog(`Parameters: ${escapedParams}`);
  
            // Write DML code to temporary file
            const tempFile = `/tmp/${sessionId}.dml`;
            
            try {
                swipl.FS.writeFile(tempFile, dmlCode);
                writeLog(`Wrote DML code to ${tempFile}`);
            } catch (fsError) {
                const msg = `Error writing DML code to temporary file: ${fsError}\n`;
                writeLog(msg);
                yield msg;
                return;
            }


            
            // if dev env: save the current state using qsave_program 
            // and copy it to src/dml-core/mi.qsave
            if (process.env.DML_DEV_MODE) {

                //read all prolog modules
                const resolver = getResourceResolver();
                let cmdlineLoad = resolver ? resolver.readDmlCore('cmdline.pl') : fs.readFileSync('src/dml-core/cmdline.pl');
                let dml_stringsLoad = resolver ? resolver.readDmlCore('dml_strings.pl') : fs.readFileSync('src/dml-core/dml_strings.pl');
                let plogchainLoad = resolver ? resolver.readDmlCore('plogchain.pl') : fs.readFileSync('src/dml-core/plogchain.pl');

                
                await swipl.prolog.load_string(cmdlineLoad.toString(), '/wasm/cmdline.pl');
                await swipl.prolog.load_string(plogchainLoad.toString(), '/wasm/plogchain.pl');
                await swipl.prolog.load_string(dml_stringsLoad.toString(), '/wasm/dml_strings.pl');

                
                writeLog('Loaded Prolog modules in DML_DEV_MODE.');
                debugLog('DML_DEV_MODE: Loaded Prolog modules.');

            } 
            writeLog('Loaded Prolog modules.');

            if (process.env.DML_DEV_MODE) {
                try {
                    writeLog('DML_DEV_MODE is true, saving current Prolog state to mi.qsave');
                   
                    const saveResult = await swipl.prolog.query("qsave_program('mi.qsave', [autoload(true), verbose(true)]).    ").next();
                    writeLog('DML_DEV_MODE: Saved Prolog state to mi.qsave.');
                    debugLog('DML_DEV_MODE: Saved Prolog state to mi.qsave.');
                    
                    const miData = swipl.FS.readFile('mi.qsave');
                    fs.writeFileSync('src/electron/initial_workspace/mi.qsave', miData);

                    writeLog('Saved current Prolog state to src/electron/initial_workspace/mi.qsave');
                    debugLog('DML_DEV_MODE: Saved current Prolog state to src/electron/initial_workspace/mi.qsave');

                } catch (e) {
                    const msg = `Error saving Prolog state to src/electron/initial_workspace/mi.qsave: ${e.message}\n`;
                    writeLog(msg);
                    debugLog(msg);
                    yield msg;
                    return;
                }
            }

            // Initialize cooperative execution engine using SWIPL
            const initQuery = `
                use_module(library(readutil)),
                use_module(library(clpfd)),
                use_module(library(clpr)),
                use_module(library(quasi_quotations)),
                use_module(library(strings)),
                use_module(library(lists)),
                use_module(library(random)),
                use_module(library(http/json)),
                use_module(library(dicts)),
                use_module(library(sort)),
                use_module(library(dcg/basics)),
                use_module(library(pcre)),
    
                readutil:read_file_to_string('${tempFile}', DMLCode, []),
                writeln("Read code"),
                %writeln(DMLCode),
                cmdline:init_cooperative_engine(DMLCode, '${engineId}', '${memoryId}', Memory,  Params, Success, Error).
                
            `;

            writeLog(`Initialization query issued for engineId=${engineId}, memoryId=${memoryId}`);

            // Initialize cooperative execution engine
            
            const initResult = await swipl.prolog.query(initQuery, {Memory: memory, Params: parameters}).next();

            if (!initResult || initResult.value.Success == 'false') {
                const errorMsg = initResult?.value?.Error || 'Unknown initialization error';
                const msg = `Failed to initialize DML execution: ${errorMsg}\n`;
                writeLog(msg);
                yield msg;
                return;
            }

            yield "<log>DML engine initialized, starting cooperative execution...</log>\n";
            writeLog("DML engine initialized.");



            // Main cooperative loop
            let iteration = 0;
            const maxIterations = 100000; // Safety limit
            let finished = false;

            while (!finished && iteration < maxIterations) {
                // Check abort signal at start of each iteration
                if (abortSignal?.aborted) {
                    debugLog('[ABORT] Abort signal detected in runDmlAsync main loop');
                    writeLog('Aborting DML execution due to abort signal');
                    yield '<log>⏹️ Execution aborted by user</log>\n';
                    break;
                }
                
                iteration++;
                
                if (iteration % 10 === 0) {
                    debugLog(`[ABORT] Iteration ${iteration}, abort signal:`, abortSignal?.aborted);
                }

                try {
                    // Get next step from Prolog engine
                    const stepResult = await swipl.prolog.query(`
                        cmdline:step_cooperative_engine('${engineId}', Status, Output)
                    `).once();

                    if (!stepResult) {
                        const msg = "DML execution completed (no result).\n";
                        writeLog(msg.trim());
                        yield msg;
                        break;
                    }

                    const status = stepResult.Status;
                    const output = stepResult.Output;

                    writeLog(`Iteration ${iteration}, Status: ${status}, Output: ${typeof output === 'string' ? output : JSON.stringify(output)}`);

                    // Process the output based on status
                    if (status === 'output') {
                        if (output) {
                            const outStr = output.toString();
                            writeLog(`Output: ${outStr}`);
                            yield outStr;
                        }

                    } else if (status === 'wait_input') {
                        // Get input from user via callback or use default
                        let userInput = "default_response";
                        let promptText = output ? output.toString() : "Enter input: ";
                        writeLog(`Waiting for input. Prompt: ${promptText}`);

                        // Check if prompt contains type information (format: "description|||key|||typeSpec")
                        let inputType = 'text';
                        let inputKey = null;
                        let typeSpec = null;
                        let inputOptions = null;
                        
                        const typeMatch = promptText.match(/^(.+)\|\|\|(.+)\|\|\|(.+)$/);
                        if (typeMatch) {
                            const [, description, key, typeSpecStr] = typeMatch;
                            promptText = description;
                            inputKey = key;
                            typeSpec = typeSpecStr;
                            
                            // Parse type specification
                            if (typeSpecStr === 'file') {
                                inputType = 'file';
                            } else if (typeSpecStr.startsWith('select(') && typeSpecStr.endsWith(')')) {
                                inputType = 'select';
                                const optionsStr = typeSpecStr.slice(7, -1);
                                inputOptions = optionsStr.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);
                            } else if (typeSpecStr.startsWith('multiselect(') && typeSpecStr.endsWith(')')) {
                                inputType = 'multiselect';
                                const optionsStr = typeSpecStr.slice(12, -1);
                                inputOptions = optionsStr.split(',').map(opt => opt.trim()).filter(opt => opt.length > 0);
                            }
                        }

                        // --- new: inform UI that input is requested (pauses spinner) ---
                        try {
                            const inputData = {
                                promptText,
                                inputType,
                                inputKey,
                                options: inputOptions
                            };
                            yield `<input>${JSON.stringify(inputData)}</input>\n`;
                        } catch (_) {}
                        // --- end new ---

                        if (inputCallback && typeof inputCallback === 'function') {
                            try {
                                userInput = await inputCallback(promptText, inputType, inputOptions);
                            } catch (callbackError) {
                                const em = `Error getting user input: ${callbackError.message}\n`;
                                writeLog(em.trim());
                                yield em;
                                userInput = "default_response";
                            }
                        }
                        writeLog(`User input: ${userInput}`);

                        await swipl.prolog.query(`
                            cmdline:send_input_to_engine('${engineId}', '${userInput}')
                        `).once();

                    } else if (status === 'request_call') {

                        let func = output[':'][0][1].functor;
                        let args = output[':'][0][1][func][0];

                        writeLog(`External function call requested: ${func}`);

                        if (func === 'tool_agent') {
                            const task = args[0];
                            const attempt = parseInt(args[1]);
                            const messages = args[2];
                            const mcpServers = args[3] || [];

                            const toolGen = toolAgent(task, attempt, messages, {}, mcpServers, abortSignal);
                            let toolOutput = "";
                            for await (const part of toolGen) {
                                // Check abort signal
                                if (abortSignal?.aborted) {
                                    writeLog('Aborting tool_agent due to abort signal');
                                    break;
                                }
                                
                                if (typeof part === 'string') {
                                    yield part; // Stream tool intermediate text directly
                                } else if (part && typeof part === 'object' && part.tool_output !== undefined) {
                                    toolOutput += part.tool_output.toString();
                                }
                            }

                            writeLog(`tool_agent output length=${toolOutput.length}`);

                            await swipl.prolog.query(`
                                cmdline:send_input_to_engine('${engineId}', ToolOutput)
                            `, {ToolOutput: {tool_output: toolOutput, success: true}}
                            ).once();

                        } else if (func === 'instruction') {
                            const task = args[0];
                            const attempt = parseInt(args[1]);

                            let messages = [];
                            for (let i = 0; i < args[2].list.length; i++) {
                                messages.push({
                                    role: args[2].list[i].role,
                                    content: args[2].list[i].content.v
                                });
                            }

                            const instrGen = instruction(task, attempt, messages, abortSignal);
                            let instrOutput = "";
                            for await (const part of instrGen) {
                                // Check abort signal
                                if (abortSignal?.aborted) {
                                    writeLog('Aborting instruction due to abort signal');
                                    break;
                                }
                                
                                if (typeof part === 'string') {
                                    instrOutput += part;

                                    yield part; // Stream instruction text directly

                                } /*else if (part && typeof part === 'object' && part.all_output !== undefined) {
                                    instrOutput += `\nInstruction output: ${part.all_output}\n`;
                                }*/
                            }

                            writeLog(`instruction output length=${instrOutput.length}`);

                            await swipl.prolog.query(`
                                cmdline:send_input_to_engine('${engineId}', InstructionOutput)
                            `, {InstructionOutput: {all_output:instrOutput}}).once();

                        } else if (func === 'generation') {
                            // same as instruction, but silent without streaming
                            const task = args[0];
                            const attempt = parseInt(args[1]);

                            let messages = [];
                            for (let i = 0; i < args[2].list.length; i++) {
                                messages.push({
                                    role: args[2].list[i].role,
                                    content: args[2].list[i].content.v
                                });
                            }

                            const instrGen = instruction(task, attempt, messages, abortSignal);
                            let instrOutput = "";
                            for await (const part of instrGen) {
                                // Check abort signal
                                if (abortSignal?.aborted) {
                                    writeLog('Aborting generation due to abort signal');
                                    break;
                                }
                                
                                if (typeof part === 'string') {
                                    instrOutput += part;

                                    //yield part; // Stream instruction text directly

                                } else if (part && typeof part === 'object' && part.all_output !== undefined) {
                                    instrOutput = `\n${part.all_output}\n`;
                                }
                            }

                            writeLog(`instruction output length=${instrOutput.length}`);

                            await swipl.prolog.query(`
                                cmdline:send_input_to_engine('${engineId}', InstructionOutput)
                            `, {InstructionOutput: {all_output:instrOutput}}).once();

                        }
                        else if (func === 'evaluate_goal') {
                            const goal = args[0].v;
                            const goalInContext = args[1].v;
                            const goalList = args[2];
                            const origGoalList = args[3];
                            const origBindings = args[4];
                            const ruleExplanation = args[5].v;
                            const text = args[6].v;
                            const slowdown = parseInt(args[7]) || 1;

                            writeLog(`evaluate_goal invoked for goal=${goal}`);

                            const evalGen = evaluateGoal(swipl, goal, goalInContext, goalList, origGoalList, origBindings, ruleExplanation, text, slowdown);
                            let evalResult = null;
                            for await (const part of evalGen) {
                                if (typeof part === 'string') {
                                    writeLog(`evaluate_goal stream: ${part.replace(/\n/g, ' ')}`);
                                    yield part; // Stream evaluation text directly
                                } else if (part && typeof part === 'object' && part.result !== undefined) {
                                    evalResult = part;
                                }
                            }

                            writeLog(`evaluate_goal result: ${evalResult ? JSON.stringify({ result: evalResult.result }) : 'null'}`);

                            await swipl.prolog.query(`
                                cmdline:send_input_to_engine('${engineId}', EvalResult)
                            `, {EvalResult: evalResult}).once();

                        } else if (func === 'agentLoop') {

                            debugLog('agentLoop function invoked from Prolog');

                            
                            const prompt = args[0];
                            const resultTerm = args[1].toString();
                            const options = args[2] || {};
                            const variableNames = args[3] || [];

                            writeLog(`agentLoop invoked with prompt=${prompt}`);

                            const agentGen = agentLoop(prompt, resultTerm, options, sessionId, abortSignal, dmlCode);
                            let agentResult = null;
                            for await (const part of agentGen) {
                                if (typeof part === 'string') {
                                    writeLog(`agentLoop stream: ${part.replace(/\n/g, ' ')}`);
                                    yield part; // Stream agent text directly
                                } else if (part && typeof part === 'object' && part.result_term !== undefined) {
                                    agentResult = part;
                                }
                            }

                            writeLog(`agentLoop result: ${agentResult ? JSON.stringify(agentResult) : 'null'}`);

                            debugLog(`agentLoop completed, sending result back to Prolog: ${JSON.stringify(agentResult)}`);

                            await swipl.prolog.query(`
                                cmdline:send_input_to_engine('${engineId}', AgentResult)
                            `, {AgentResult: agentResult}).once();

                        } else if (func === 'get_tools_description') {
                            let toolsDesc = getToolsDescription();
                            await swipl.prolog.query(`
                                cmdline:send_input_to_engine('${engineId}', ToolsDesc)
                            `, {ToolsDesc: toolsDesc}).once();

                        } else if (func === 'run_sub_dml') {
                            // Execute inline DML code as a sub-session with a fresh SWIPL instance
                            // Convert from PrologString to JS string if needed
                            const subDmlCode = args[0]?.toString ? args[0].toString() : String(args[0]);
                            
                            // Convert subParams from Prolog dict to plain JS object
                            // args[1] may be a Prolog dict object that needs conversion
                            let subParams = parameters; // Default to parent params
                            if (args[1] !== undefined && args[1] !== null) {
                                writeLog(`run_sub_dml args[1] type: ${typeof args[1]}, value: ${JSON.stringify(args[1])}`);
                                if (typeof args[1] === 'object') {
                                    // It's already an object (swipl-wasm converted it)
                                    subParams = args[1];
                                } else if (args[1]?.toJSON) {
                                    subParams = args[1].toJSON();
                                } else {
                                    subParams = args[1];
                                }
                            }
                            
                            writeLog(`run_sub_dml invoked, code length=${subDmlCode?.length || 0}, params=${JSON.stringify(subParams)}`);
                            yield `<log>Starting sub-DML execution...</log>\n`;
                            
                            // Generate unique sub-session ID
                            const subSessionId = `sub_${sessionId}_${Date.now()}`;
                            
                            // Collect all output from sub-DML
                            let subOutput = "";
                            let subSwipl = null;
                            try {
                                // Create fresh SWIPL instance for sub-DML if factory is available
                                if (swiplFactory) {
                                    writeLog('Creating fresh SWIPL instance for sub-DML');
                                    subSwipl = await swiplFactory();
                                } else {
                                    writeLog('No SWIPL factory available, reusing parent instance (may cause issues)');
                                    subSwipl = swipl;
                                }
                                
                                for await (const part of runDmlAsync(subDmlCode, subSessionId, subParams, workspaceDir, subSwipl, inputCallback, [], abortSignal, swiplFactory)) {
                                    if (abortSignal?.aborted) {
                                        writeLog('Aborting sub-DML due to abort signal');
                                        break;
                                    }
                                    if (typeof part === 'string') {
                                        // Filter out log messages from sub-DML output, optionally stream them
                                        if (part.startsWith('<log>')) {
                                            yield part; // Stream log messages to parent
                                        } else {
                                            subOutput += part;
                                        }
                                    }
                                }
                            } catch (subDmlError) {
                                subOutput = `Sub-DML Error: ${subDmlError.message}`;
                                writeLog(`run_sub_dml error: ${subDmlError.message}`);
                            }
                            
                            // Clean sub-DML output: remove metadata like <end_thinking>, status lines, <log> tags, etc.
                            let cleanOutput = subOutput
                                .replace(/<end_thinking>/g, '')
                                .replace(/<log>.*?<\/log>/gs, '')  // Remove all <log>...</log> tags
                                .replace(/:- \*\*Agent.*?\*\*/g, '')
                                .replace(/DML execution completed.*?\.log/g, '')
                                .replace(/Log saved to:.*?\.log/g, '')
                                .trim();
                            
                            writeLog(`run_sub_dml completed, raw output length=${subOutput.length}, clean output length=${cleanOutput.length}`);
                            yield `<log>Sub-DML execution completed.</log>\n`;
                            
                            await swipl.prolog.query(`
                                cmdline:send_input_to_engine('${engineId}', SubDmlOutput)
                            `, {SubDmlOutput: {output: cleanOutput, success: true}}).once();

                        } else if (func === 'run_sub_dml_file') {
                            // Execute a DML file as a sub-session
                            // Convert from PrologString to JS string if needed
                            const filename = args[0]?.toString ? args[0].toString() : String(args[0]);
                            
                            // Convert subParams from Prolog dict to plain JS object
                            let subParams = parameters; // Default to parent params
                            if (args[1] !== undefined && args[1] !== null) {
                                writeLog(`run_sub_dml_file args[1] type: ${typeof args[1]}, value: ${JSON.stringify(args[1])}`);
                                if (typeof args[1] === 'object') {
                                    subParams = args[1];
                                } else if (args[1]?.toJSON) {
                                    subParams = args[1].toJSON();
                                } else {
                                    subParams = args[1];
                                }
                            }
                            
                            writeLog(`run_sub_dml_file invoked for file: ${filename}, params=${JSON.stringify(subParams)}`);
                            yield `<log>Loading DML file: ${filename}</log>\n`;
                            
                            // Search for file in standard locations
                            const searchPaths = [
                                filename,
                                path.join(workspaceDir, filename),
                                path.join(workspaceDir, 'dml_examples', filename),
                                path.join(workspaceDir, 'dml_examples', 'learned', filename),
                                `dml_examples/${filename}`,
                                `dml_examples/learned/${filename}`
                            ];
                            
                            // Also check ~/.deepclause/dml_examples paths
                            const homeDir = os.homedir();
                            searchPaths.push(
                                path.join(homeDir, '.deepclause', 'dml_examples', filename),
                                path.join(homeDir, '.deepclause', 'dml_examples', 'learned', filename)
                            );
                            
                            let subDmlCode = null;
                            let foundPath = null;
                            for (const searchPath of searchPaths) {
                                try {
                                    if (fs.existsSync(searchPath)) {
                                        subDmlCode = fs.readFileSync(searchPath, 'utf-8');
                                        foundPath = searchPath;
                                        break;
                                    }
                                } catch (e) {
                                    // Continue searching
                                }
                            }
                            
                            let subOutput = "";
                            if (!subDmlCode) {
                                subOutput = `DML file not found: ${filename}. Searched in: ${searchPaths.join(', ')}`;
                                writeLog(subOutput);
                                yield `<log>Error: ${subOutput}</log>\n`;
                            } else {
                                writeLog(`Found DML file at: ${foundPath}`);
                                yield `<log>Found DML file: ${foundPath}</log>\n`;
                                
                                // Generate unique sub-session ID
                                const subSessionId = `sub_${sessionId}_${path.basename(filename, '.dml')}_${Date.now()}`;
                                
                                let subSwipl = null;
                                try {
                                    // Create fresh SWIPL instance for sub-DML if factory is available
                                    if (swiplFactory) {
                                        writeLog('Creating fresh SWIPL instance for sub-DML file');
                                        subSwipl = await swiplFactory();
                                    } else {
                                        writeLog('No SWIPL factory available, reusing parent instance (may cause issues)');
                                        subSwipl = swipl;
                                    }
                                    
                                    for await (const part of runDmlAsync(subDmlCode, subSessionId, subParams, workspaceDir, subSwipl, inputCallback, [], abortSignal, swiplFactory)) {
                                        if (abortSignal?.aborted) {
                                            writeLog('Aborting sub-DML file due to abort signal');
                                            break;
                                        }
                                        if (typeof part === 'string') {
                                            if (part.startsWith('<log>')) {
                                                yield part; // Stream log messages to parent
                                            } else {
                                                subOutput += part;
                                            }
                                        }
                                    }
                                } catch (subDmlError) {
                                    subOutput = `Sub-DML File Error: ${subDmlError.message}`;
                                    writeLog(`run_sub_dml_file error: ${subDmlError.message}`);
                                }
                            }
                            
                            // Clean sub-DML output: remove metadata like <end_thinking>, status lines, <log> tags, etc.
                            let cleanOutput = subOutput
                                .replace(/<end_thinking>/g, '')
                                .replace(/<log>.*?<\/log>/gs, '')  // Remove all <log>...</log> tags
                                .replace(/:- \*\*Agent.*?\*\*/g, '')
                                .replace(/DML execution completed.*?\.log/g, '')
                                .replace(/Log saved to:.*?\.log/g, '')
                                .trim();
                            
                            writeLog(`run_sub_dml_file completed, raw output length=${subOutput.length}, clean output length=${cleanOutput.length}`);
                            yield `<log>DML file execution completed.</log>\n`;
                            
                            await swipl.prolog.query(`
                                cmdline:send_input_to_engine('${engineId}', SubDmlOutput)
                            `, {SubDmlOutput: {output: cleanOutput, success: subDmlCode !== null}}).once();

                        } /*else if (func == 'get_dml_files_description') {
                            let desc = "DML files are text files with .dml extension containing DML code.";
                            await swipl.prolog.query(`
                                cmdline:send_input_to_engine('${engineId}', FilesDesc)
                            `, {FilesDesc: desc}).once();

                        }*/
                    }
                    else if (status === 'finished') {
                        if (output) {
                            const outStr = output.toString();
                            writeLog(`Finished with output: ${outStr}`);
                            yield outStr;
                        }
                        const msg = "DML execution completed successfully.\n";
                        writeLog(msg.trim());
                        //yield msg;
                        finished = true;

                    } else if (status === 'error') {
                        const msg = `DML execution error: ${output}\n`;
                        writeLog(msg.trim());
                        yield msg;
                        finished = true;

                    } else if (status === 'no_more') {
                        const msg = "DML execution completed (no more steps).\n";
                        writeLog(msg.trim());
                        yield msg;
                        finished = true;

                    } else {
                        const msg = `Unknown status: ${status}, output: ${output}\n`;
                        writeLog(msg.trim());
                        yield msg;
                    }

                } catch (stepError) {
                    const msg = `Error in cooperative step: ${stepError.message}\n`;
                    writeLog(msg.trim());
                    yield msg;
                    break;
                }
            }

            if (iteration >= maxIterations) {
                const msg = "<log>error=DML execution stopped due to iteration limit.</log>\n";
                writeLog(msg.trim());
                yield msg;
            }

        } catch (error) {
            const msg = `<log>error=Error during cooperative execution: ${error.message}</log>\n`;
            writeLog(msg.trim());
            yield msg;
        } finally {

            writeLog("Cleaning up...");

            // Clean up the Prolog session
            try {
                await swipl.prolog.query(`
                    cmdline:cleanup_cooperative_engine('${engineId}', '${memoryId}')
                `).once();
                writeLog("Cleanup complete.");
            } catch (cleanupError) {
                const msg = `Warning: Cleanup error: ${cleanupError.message}\n`;
                writeLog(msg.trim());
                yield msg;
            }

            // Clean up temporary file
            try {
                const tempFile = path.join(os.tmpdir(), `${sessionId}.dml`);
                if (fs.existsSync(tempFile)) {
                    fs.unlinkSync(tempFile);
                }
            } catch (cleanupError) {
                const msg = `Warning: File cleanup error: ${cleanupError.message}\n`;
                writeLog(msg.trim());
                yield msg;
            }
        }

        const doneMsg = `\n<log>DML execution completed for session ${sessionId}.</log>\n` + (logFilePath ? `<log>Log saved to: ${logFilePath}</log>\n` : '');
        writeLog(`DML execution completed for session ${sessionId}`);
        yield doneMsg;

    } catch (error) {
        let errorMsg = 'Unknown error';
        if (error instanceof Error) {
            errorMsg = error.message;
        } else if (typeof error === 'string') {
            errorMsg = error;
        } else if (error && typeof error === 'object') {
            // Try to get meaningful info from error object
            errorMsg = error.message || error.error || error.reason || JSON.stringify(error);
        } else {
            errorMsg = String(error);
        }
        
        const msg = `<log>Error during DML execution: ${errorMsg}</log>\n`;
        debugLog('DML execution error:', error);
        
        // Best-effort log write
        try {
            const logsDir = path.join(workspaceDir || "./workspace", "logs");
            if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
            const safeSession = String(sessionId || 'unknown').replace(/[^\w.-]/g, '_');
            const emergencyLog = path.join(logsDir, `${safeSession}_fatal.log`);
            fs.appendFileSync(emergencyLog, `[${new Date().toISOString()}] ${msg}\nFull error: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}\n`, 'utf-8');
        } catch {}
        yield msg;
    }
}

/**
 * Synchronous wrapper for runDmlAsync that collects all output
 */
export async function runDmlSync(dmlCode, sessionId = null, parameters = null, swipl = null, inputCallback = null) {
    const outputLines = [];

    for await (const line of runDmlAsync(dmlCode, sessionId, parameters, "./workspace", swipl, inputCallback)) {
        outputLines.push(line);
    }

    return outputLines.join('');
}

// Helper: load config/settings.json
function loadSettingsConfig() {
    try {
        const configPath = getMcpConfigPath(); // Get path lazily
        if (fs.existsSync(configPath)) {
            const raw = fs.readFileSync(configPath, 'utf-8');
            const json = JSON.parse(raw);
            return json || {};
        } else {
            debugLog(`MCP config file not found at ${configPath}`);
        }
    } catch (e) {
        debugLog(`Failed to read MCP config: ${e.message}`);
    }
    return {};
}

// Helper: connect single MCP server definition
async function connectMcpServer(def) {
    let transport;
    try {
        const type = (def.type || '').toLowerCase();
        if (type === 'stdio') {
            if (!def.command) throw new Error('Missing command for stdio server');
            transport = new StdioClientTransport({
                command: def.command,
                args: Array.isArray(def.args) ? def.args : [],
            });
        } else if (type === 'http' || type === 'streamable-http') {
            if (!def.url) throw new Error('Missing url for http server');
            transport = new StreamableHTTPClientTransport(new URL(def.url));
        } else if (type === 'sse') {
            if (!def.url) throw new Error('Missing url for sse server');
            transport = new SSEClientTransport(new URL(def.url));
        } else {
            throw new Error(`Unsupported MCP server type: ${def.type}`);
        }

        const client = await experimental_createMCPClient({ transport });
        MCP_CLIENTS.push(client);

        // Fetch tools
        const toolSet = await client.tools();
        for (const [name, tDef] of Object.entries(toolSet || {})) {
            // Avoid silent override: keep first by default
            if (MCP_TOOL_MAP[name]) {
                debugLog(`MCP tool name collision: ${name} (keeping first instance)`);
                continue;
            }
            const desc = tDef?.description || `MCP tool ${name}`;
            MCP_TOOL_MAP[name] = tDef

            debugLog(`Found MCP tool: ${name}`);
        }

        return {
            name: def.name || def.type,
            toolCount: Object.keys(toolSet || {}).length
        };

    } catch (err) {
        debugLog(`Error connecting MCP server (${def.name || def.type}): ${err.message}`);
        return null;
    }
}

// Shutdown / cleanup MCP clients
export async function shutdownMcpClients() {
    for (const c of MCP_CLIENTS) {
        try {
            await c.close();
        } catch (_) {}
    }
    MCP_CLIENTS = [];
    MCP_TOOL_MAP = {};
    INITIALIZED = false; // Reset initialization flag
}

// Reload MCP servers (shutdown and reinitialize)
export async function reloadMcpServers() {
    debugLog('[MCP] Reloading MCP servers...');
    
    // Shutdown existing clients (this also resets INITIALIZED flag)
    await shutdownMcpClients();
    
    // Clear cached config path to force reload
    MCP_CONFIG_PATH = null;
    
    // Reinitialize with fresh config
    await init();
    
    debugLog(`[MCP] Reloaded. Now have ${Object.keys(MCP_TOOL_MAP).length} MCP tools available.`);
}

// Export all functions
export default {
    toolAgent,
    instruction,
    evaluateGoal,
    questionToProlog,
    richPrint,
    endSingleLineMode,
    getToolsDescription,
    getGlobalTools,
    getMcpToolNames,
    init,
    runDmlAsync,
    runDmlSync,
    shutdownMcpClients,
    reloadMcpServers,
    // test hooks

    __setGlobalToolsForTest,
};