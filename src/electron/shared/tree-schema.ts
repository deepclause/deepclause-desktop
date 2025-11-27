/**
 * Tree structure schema for DML visual builder
 * 
 * This defines the JSON format for storing DML programs as trees.
 * The tree structure represents agent_main with branches, steps, and alternatives.
 */

/**
 * Base interface for all tree nodes
 */
export interface DmlTreeNode {
  type: 'main' | 'branch' | 'step' | 'step-branch';
  id: string;
  description: string;
  metadata?: {
    generatedPredicate?: string;
    isLLMTask?: boolean;
    variables?: string[];
  };
}

/**
 * Branch node - represents one agent_main clause
 * Branches are tried in order (backtracking/fallback)
 */
export interface DmlTreeBranch extends DmlTreeNode {
  type: 'branch';
  steps: DmlTreeStep[];
}

/**
 * Step node - represents one operation/predicate call within a branch
 */
export interface DmlTreeStep extends DmlTreeNode {
  type: 'step';
  branches: DmlTreeStepBranch[]; // Alternatives (choice points)
}

/**
 * Alternative branch within a step (sub-branch)
 */
export interface DmlTreeStepBranch extends DmlTreeNode {
  type: 'step-branch';
}

/**
 * Root tree structure
 */
export interface DmlTree {
  version: '1.0';
  type: 'main';
  goal?: string; // Agent goal/title (defaults to 'agent_main')
  branches: DmlTreeBranch[];
  metadata?: {
    created: string;
    lastModified: string;
    author?: string;
    description?: string;
  };
}

/**
 * Result of tree compilation
 */
export interface CompilationResult {
  success: boolean;
  dml?: string;
  error?: string;
  warnings?: string[];
}

/**
 * Result of tree validation
 */
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  warnings?: string[];
}
