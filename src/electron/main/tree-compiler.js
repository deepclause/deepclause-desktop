/**
 * Tree to DML Compiler
 * 
 * Converts tree-structured DML specifications into natural language prompts
 * that can be fed to the existing questionToProlog() function in bridge.js.
 * 
 * This leverages the battle-tested DML generation pipeline with:
 * - Automatic web search for context
 * - Built-in SWI-Prolog validation
 * - Retry logic with LLM-based error correction
 * - Progress streaming to UI
 */

/**
 * Convert tree JSON to a structured natural language prompt for DML generation.
 * 
 * @param {Object} tree - The tree structure from the visual editor
 * @returns {string} - Structured prompt for questionToProlog()
 */
export function treeToStructuredPrompt(tree) {
  const goal = tree.metadata?.goal || 'Process the user request through multiple fallback strategies';
  
  let prompt = `Create a DML agent with the following goal: ${goal}\n\n`;
  
  // Build hierarchical description of branches and steps
  tree.branches.forEach((branch, bIdx) => {
    const branchNum = bIdx + 1;
    const branchType = getBranchType(bIdx, tree.branches.length);
    
    prompt += `\n${branchType} (Branch ${branchNum}):\n`;
    prompt += formatBranchDescription(branch);
    
    if (branch.steps && branch.steps.length > 0) {
      prompt += `\nSteps:\n`;
      branch.steps.forEach((step, sIdx) => {
        prompt += formatStep(step, sIdx + 1);
      });
    }
  });

  prompt += buildImplementationGuidelines();
  
  return prompt;
}

/**
 * Determine the type/role of a branch based on its position
 */
function getBranchType(index, totalBranches) {
  if (index === 0) {
    return 'PRIMARY APPROACH';
  } else if (index === totalBranches - 1) {
    return 'FINAL FALLBACK';
  } else {
    return `FALLBACK ${index}`;
  }
}

/**
 * Format a branch description with proper indentation
 */
function formatBranchDescription(branch) {
  const desc = branch.description || 'Alternative approach if previous branches fail';
  return `  ${desc}\n`;
}

/**
 * Format a step with its variables and alternatives
 */
function formatStep(step, stepNum) {
  const vars = extractVariables(step.description);
  let output = `  ${stepNum}. ${step.description}`;
  
  // Add variable information
  if (vars.length > 0) {
    output += ` [Variables: ${vars.map(v => `@${v}`).join(', ')}]`;
  }
  output += '\n';
  
  // Handle step alternatives (sub-branches for this step)
  if (step.branches && step.branches.length > 0) {
    output += formatStepAlternatives(step.branches);
  }
  
  return output;
}

/**
 * Format alternative approaches for a single step
 */
function formatStepAlternatives(alternatives) {
  let output = `     Try these alternatives in order:\n`;
  
  alternatives.forEach((alt, aIdx) => {
    const altVars = extractVariables(alt.description);
    const letter = String.fromCharCode(97 + aIdx); // a, b, c, ...
    
    output += `     ${letter}. ${alt.description}`;
    if (altVars.length > 0) {
      output += ` [Variables: ${altVars.map(v => `@${v}`).join(', ')}]`;
    }
    output += '\n';
  });
  
  return output;
}

/**
 * Extract @variable references from text
 * 
 * @param {string} text - Text containing @variable markers
 * @returns {string[]} - Array of variable names (without @ prefix)
 */
function extractVariables(text) {
  if (!text) return [];
  const matches = text.matchAll(/@(\w+)/g);
  return Array.from(matches, m => m[1]);
}

/**
 * Build implementation guidelines section
 */
function buildImplementationGuidelines() {
  return `
IMPLEMENTATION REQUIREMENTS:

1. **Multiple Branches**: Each branch should be a separate agent_main clause for backtracking
   - First branch: Most sophisticated approach
   - Middle branches: Moderate complexity fallbacks
   - Last branch: Simple error handling/apology

2. **Predicate Selection**:
   - Use @-predicates for tasks requiring understanding, extraction, analysis, or summarization
   - Use tool() predicates for web searches, file operations, and external APIs
   - Use regular Prolog predicates for logic, control flow, and data manipulation

3. **Variables**: 
   - Variables marked with @ in descriptions should become predicate arguments
   - Use descriptive variable names that match the @markers
   - Example: "@SearchResults" → predicate argument SearchResults

4. **Step Alternatives**:
   - Implement as choice points using (pred1 ; pred2 ; pred3)
   - Order from most specific to most general
   - Include fallbacks for robustness

5. **Error Handling & Logging**:
   - Add log() calls to show progress to the user
   - Validate tool outputs before proceeding
   - Include verification steps after complex operations
   - Final branch should handle failure gracefully

6. **Code Quality**:
   - Use explicit, self-documenting predicate names
   - One step per predicate call (or simple Prolog expression)
   - Add comments explaining each section
   - Follow DML best practices from the examples

Generate complete, executable DML code following these specifications.
`;
}

/**
 * Generate a default tree structure (useful for testing/examples)
 */
export function createDefaultTree() {
  return {
    version: '1.0',
    type: 'main',
    branches: [
      {
        type: 'branch',
        id: 'branch_1',
        description: 'Main approach: comprehensive solution',
        steps: [
          {
            type: 'step',
            id: 'step_1',
            description: 'Gather initial data from @Source',
            branches: []
          },
          {
            type: 'step',
            id: 'step_2',
            description: 'Process @Data and extract @Results',
            branches: []
          },
          {
            type: 'step',
            id: 'step_3',
            description: 'Present @Results to user',
            branches: []
          }
        ]
      },
      {
        type: 'branch',
        id: 'branch_2',
        description: 'Fallback: simpler approach if main fails',
        steps: [
          {
            type: 'step',
            id: 'step_4',
            description: 'Use basic search to find @Information',
            branches: []
          },
          {
            type: 'step',
            id: 'step_5',
            description: 'Summarize @Information for user',
            branches: []
          }
        ]
      },
      {
        type: 'branch',
        id: 'branch_3',
        description: 'Final fallback: apologize if all else fails',
        steps: [
          {
            type: 'step',
            id: 'step_6',
            description: 'Provide helpful error message to user',
            branches: []
          }
        ]
      }
    ],
    metadata: {
      created: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      goal: 'Provide information to the user with fallback strategies'
    }
  };
}

/**
 * Validate tree structure before compilation
 * 
 * @param {Object} tree - Tree to validate
 * @returns {Object} - { valid: boolean, errors: string[] }
 */
export function validateTree(tree) {
  const errors = [];
  
  if (!tree || typeof tree !== 'object') {
    errors.push('Tree must be an object');
    return { valid: false, errors };
  }
  
  if (!tree.branches || !Array.isArray(tree.branches)) {
    errors.push('Tree must have a branches array');
  }
  
  if (tree.branches && tree.branches.length === 0) {
    errors.push('Tree must have at least one branch');
  }
  
  // Validate each branch
  tree.branches?.forEach((branch, idx) => {
    if (!branch.steps || !Array.isArray(branch.steps)) {
      errors.push(`Branch ${idx + 1} must have a steps array`);
    }
    
    if (branch.steps && branch.steps.length === 0) {
      errors.push(`Branch ${idx + 1} must have at least one step`);
    }
  });
  
  return {
    valid: errors.length === 0,
    errors
  };
}
