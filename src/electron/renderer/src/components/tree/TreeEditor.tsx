import { useState, useRef, useEffect } from 'react';
import type { DmlTree } from '../../../../shared/tree-schema';
import styles from './TreeEditor.module.css';

interface TreeEditorProps {
  tree: DmlTree;
  onChange: (tree: DmlTree) => void;
}

export function TreeEditor({ tree, onChange }: TreeEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionPosition, setSuggestionPosition] = useState({ top: 0, left: 0 });
  const [currentVariable, setCurrentVariable] = useState('');
  const [suggestionType, setSuggestionType] = useState<'variable' | 'tool'>('variable');
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Fetch available tools on component mount
  useEffect(() => {
    const fetchTools = async () => {
      try {
        const result = await window.electronAPI.getAvailableTools();
        if (result.success && result.tools) {
          setAvailableTools(result.tools);
        }
      } catch (error) {
        console.error('Failed to fetch available tools:', error);
        // Fallback to default tools if fetch fails
        setAvailableTools([
          'web_search',
          'google_scholar_search',
          'brave_search',
          'visit_webpage',
          'workspace_reader',
          'file_downloader',
          'visualizer',
          'diagram_generator',
          'data_analyzer',
          'linux_vm_with_sh_and_python'
        ]);
      }
    };
    
    fetchTools();
  }, []);

  // List of available tools
  const getAvailableTools = (): string[] => {
    return availableTools;
  };

  // Extract all @Variables from the tree
  const extractVariables = (text: string): string[] => {
    const matches = text.match(/@\w+/g);
    return matches ? matches.map(v => v.substring(1)) : [];
  };

  const getAllVariables = (): string[] => {
    const variables = new Set<string>();
    tree.branches.forEach(branch => {
      extractVariables(branch.description).forEach(v => variables.add(v));
      branch.steps.forEach(step => {
        extractVariables(step.description).forEach(v => variables.add(v));
        step.branches.forEach(alt => {
          extractVariables(alt.description).forEach(v => variables.add(v));
        });
      });
    });
    return Array.from(variables).sort();
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>, updateFn: (val: string) => void) => {
    const value = e.target.value;
    updateFn(value);

    const cursorPos = e.target.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);
    
    // Check if we're typing a variable (@symbol)
    const variableMatch = textBeforeCursor.match(/@(\w*)$/);
    // Check if we're typing a tool ($symbol)
    const toolMatch = textBeforeCursor.match(/\$(\w*)$/);
    
    if (variableMatch) {
      const partialVar = variableMatch[1];
      setCurrentVariable(partialVar);
      setSuggestionType('variable');
      const allVars = getAllVariables();
      const filtered = allVars.filter(v => v.toLowerCase().startsWith(partialVar.toLowerCase()));
      
      if (filtered.length > 0) {
        const textarea = e.target;
        const lines = textBeforeCursor.split('\n');
        const currentLineNumber = lines.length - 1;
        const currentLineText = lines[currentLineNumber];
        
        const charWidth = 8;
        const lineHeight = 22;
        
        const charsInCurrentLine = currentLineText.length;
        const estimatedLeft = Math.min(charsInCurrentLine * charWidth, textarea.offsetWidth - 160);
        const top = (currentLineNumber + 1) * lineHeight + 10;
        
        setSuggestionPosition({ top, left: estimatedLeft });
        setShowSuggestions(true);
      } else {
        setShowSuggestions(false);
      }
    } else if (toolMatch) {
      const partialTool = toolMatch[1];
      setCurrentVariable(partialTool);
      setSuggestionType('tool');
      const allTools = getAvailableTools();
      const filtered = allTools.filter(t => t.toLowerCase().startsWith(partialTool.toLowerCase()));
      
      if (filtered.length > 0) {
        const textarea = e.target;
        const lines = textBeforeCursor.split('\n');
        const currentLineNumber = lines.length - 1;
        const currentLineText = lines[currentLineNumber];
        
        const charWidth = 8;
        const lineHeight = 22;
        
        const charsInCurrentLine = currentLineText.length;
        const estimatedLeft = Math.min(charsInCurrentLine * charWidth, textarea.offsetWidth - 160);
        const top = (currentLineNumber + 1) * lineHeight + 10;
        
        setSuggestionPosition({ top, left: estimatedLeft });
        setShowSuggestions(true);
      } else {
        setShowSuggestions(false);
      }
    } else {
      setShowSuggestions(false);
    }
  };

  const insertVariable = (varName: string) => {
    if (!textareaRef.current || !editingId) return;
    
    const textarea = textareaRef.current;
    const cursorPos = textarea.selectionStart;
    const value = textarea.value;
    const textBeforeCursor = value.substring(0, cursorPos);
    const textAfterCursor = value.substring(cursorPos);
    
    // Find the @ or $ symbol position
    const prefix = suggestionType === 'variable' ? '@' : '$';
    const symbolPos = textBeforeCursor.lastIndexOf(prefix);
    const newValue = value.substring(0, symbolPos) + prefix + varName + textAfterCursor;
    
    // Update the appropriate field based on editingId
    tree.branches.forEach(branch => {
      if (branch.id === editingId) {
        updateBranchDesc(branch.id, newValue);
      }
      branch.steps.forEach(step => {
        if (step.id === editingId) {
          updateStepDesc(branch.id, step.id, newValue);
        }
        step.branches.forEach(alt => {
          if (alt.id === editingId) {
            updateStepBranchDesc(branch.id, step.id, alt.id, newValue);
          }
        });
      });
    });
    
    setShowSuggestions(false);
    textarea.focus();
  };

  const formatTextWithVariables = (text: string) => {
    if (!text) return null;
    
    // Split on both @variables and $tools
    const parts = text.split(/(@\w+|\$\w+)/g);
    return parts.map((part, idx) => {
      if (part.startsWith('@')) {
        return (
          <span key={idx} className={styles.variable}>
            {part}
          </span>
        );
      } else if (part.startsWith('$')) {
        return (
          <span key={idx} className={styles.tool}>
            {part}
          </span>
        );
      }
      return part;
    });
  };

  const addBranch = () => {
    const newTree = { ...tree };
    newTree.branches = [
      ...newTree.branches,
      {
        type: 'branch' as const,
        id: Date.now().toString(),
        description: '',
        steps: []
      }
    ];
    onChange(newTree);
  };

  const deleteBranch = (branchId: string) => {
    if (tree.branches.length <= 1) return; // Keep at least one branch
    const newTree = { ...tree };
    newTree.branches = newTree.branches.filter(b => b.id !== branchId);
    onChange(newTree);
  };

  const updateBranchDesc = (branchId: string, description: string) => {
    const newTree = { ...tree };
    const branch = newTree.branches.find(b => b.id === branchId);
    if (branch) {
      branch.description = description;
      onChange(newTree);
    }
  };

  const addStep = (branchId: string) => {
    const newTree = { ...tree };
    const branch = newTree.branches.find(b => b.id === branchId);
    if (branch) {
      branch.steps.push({
        type: 'step' as const,
        id: Date.now().toString(),
        description: '',
        branches: []
      });
      onChange(newTree);
    }
  };

  const deleteStep = (branchId: string, stepId: string) => {
    const newTree = { ...tree };
    const branch = newTree.branches.find(b => b.id === branchId);
    if (branch) {
      branch.steps = branch.steps.filter(s => s.id !== stepId);
      onChange(newTree);
    }
  };

  const updateStepDesc = (branchId: string, stepId: string, description: string) => {
    const newTree = { ...tree };
    const branch = newTree.branches.find(b => b.id === branchId);
    if (branch) {
      const step = branch.steps.find(s => s.id === stepId);
      if (step) {
        step.description = description;
        onChange(newTree);
      }
    }
  };

  const addStepBranch = (branchId: string, stepId: string) => {
    const newTree = { ...tree };
    const branch = newTree.branches.find(b => b.id === branchId);
    if (branch) {
      const step = branch.steps.find(s => s.id === stepId);
      if (step) {
        step.branches.push({
          type: 'step-branch' as const,
          id: Date.now().toString(),
          description: ''
        });
        onChange(newTree);
      }
    }
  };

  const deleteStepBranch = (branchId: string, stepId: string, subBranchId: string) => {
    const newTree = { ...tree };
    const branch = newTree.branches.find(b => b.id === branchId);
    if (branch) {
      const step = branch.steps.find(s => s.id === stepId);
      if (step) {
        step.branches = step.branches.filter(sb => sb.id !== subBranchId);
        onChange(newTree);
      }
    }
  };

  const updateStepBranchDesc = (branchId: string, stepId: string, subBranchId: string, description: string) => {
    const newTree = { ...tree };
    const branch = newTree.branches.find(b => b.id === branchId);
    if (branch) {
      const step = branch.steps.find(s => s.id === stepId);
      if (step) {
        const subBranch = step.branches.find(sb => sb.id === subBranchId);
        if (subBranch) {
          subBranch.description = description;
          onChange(newTree);
        }
      }
    }
  };

  return (
    <div className={styles.treeEditor}>
      <div className={styles.treeContainer}>
        <div className={styles.treeHeader}>
          <p className={styles.introText}>
            Build your DML agent by describing what it should do in plain language. Start with <strong>branches</strong> (different approaches), 
            break each into <strong>steps</strong>, and add <strong>alternatives</strong> when multiple options exist. 
            Use <code className="bg-bg-light px-1.5 py-0.5 rounded text-xs font-mono border border-border text-deepclause-primary">@VariableName</code> to 
            mark inputs/outputs and <code className="bg-bg-light px-1.5 py-0.5 rounded text-xs font-mono border border-border text-blue-600">$tool_name</code> to 
            reference tools.
          </p>
        </div>

        {tree.branches.map((branch, bIdx) => (
          <div key={branch.id} className={`${styles.node} ${styles.nested}`}>
            <div className={styles.nodeContent}>
              <div className={styles.nodeHeader}>
                <span className={styles.branchNum}>Branch {bIdx + 1}</span>
                <button onClick={() => deleteBranch(branch.id)} className={styles.deleteBtn} title="Delete branch">
                  ×
                </button>
              </div>
              
              {editingId === branch.id ? (
                <div className={styles.textareaWrapper}>
                  <textarea
                    ref={textareaRef}
                    placeholder="Describe this approach... (e.g., 'Main solution: search web for @Query and extract @Results')"
                    value={branch.description}
                    onChange={(e) => handleTextChange(e, (val) => updateBranchDesc(branch.id, val))}
                    onBlur={() => setEditingId(null)}
                    autoFocus
                    rows={2}
                  />
                  {showSuggestions && (
                    <div 
                      className={styles.suggestions}
                      style={{ top: suggestionPosition.top, left: suggestionPosition.left }}
                    >
                      {suggestionType === 'variable' 
                        ? getAllVariables()
                            .filter(v => v.toLowerCase().startsWith(currentVariable.toLowerCase()))
                            .map(varName => (
                              <div
                                key={varName}
                                className={styles.suggestionItem}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  insertVariable(varName);
                                }}
                              >
                                @{varName}
                              </div>
                            ))
                        : getAvailableTools()
                            .filter(t => t.toLowerCase().startsWith(currentVariable.toLowerCase()))
                            .map(toolName => (
                              <div
                                key={toolName}
                                className={styles.suggestionItem}
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  insertVariable(toolName);
                                }}
                              >
                                ${toolName}
                              </div>
                            ))
                      }
                    </div>
                  )}
                </div>
              ) : (
                <div 
                  className={styles.textDisplay}
                  onClick={() => setEditingId(branch.id)}
                >
                  {branch.description ? formatTextWithVariables(branch.description) : <span className={styles.placeholder}>Click to describe this approach...</span>}
                </div>
              )}
              

              {branch.steps.map((step, sIdx) => (
                <div key={step.id} className={`${styles.node} ${styles.nested}`}>
                  <div className={styles.nodeContent}>
                    <div className={styles.nodeHeader}>
                      <span className={styles.stepNum}>Step {sIdx + 1}</span>
                      <button onClick={() => deleteStep(branch.id, step.id)} className={styles.deleteBtn} title="Delete step">
                        ×
                      </button>
                    </div>
                    
                    {editingId === step.id ? (
                      <div className={styles.textareaWrapper}>
                        <textarea
                          ref={textareaRef}
                          placeholder="Describe this step... (e.g., 'Extract key facts from @SearchResults')"
                          value={step.description}
                          onChange={(e) => handleTextChange(e, (val) => updateStepDesc(branch.id, step.id, val))}
                          onBlur={() => setEditingId(null)}
                          autoFocus
                          rows={2}
                        />
                        {showSuggestions && (
                          <div 
                            className={styles.suggestions}
                            style={{ top: suggestionPosition.top, left: suggestionPosition.left }}
                          >
                            {suggestionType === 'variable'
                              ? getAllVariables()
                                  .filter(v => v.toLowerCase().startsWith(currentVariable.toLowerCase()))
                                  .map(varName => (
                                    <div
                                      key={varName}
                                      className={styles.suggestionItem}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        insertVariable(varName);
                                      }}
                                    >
                                      @{varName}
                                    </div>
                                  ))
                              : getAvailableTools()
                                  .filter(t => t.toLowerCase().startsWith(currentVariable.toLowerCase()))
                                  .map(toolName => (
                                    <div
                                      key={toolName}
                                      className={styles.suggestionItem}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        insertVariable(toolName);
                                      }}
                                    >
                                      ${toolName}
                                    </div>
                                  ))
                            }
                          </div>
                        )}
                      </div>
                    ) : (
                      <div 
                        className={styles.textDisplay}
                        onClick={() => setEditingId(step.id)}
                      >
                        {step.description ? formatTextWithVariables(step.description) : <span className={styles.placeholder}>Click to describe this step...</span>}
                      </div>
                    )}

                    {step.branches && step.branches.length > 0 && (
                      <div className={styles.stepAlternatives}>
                        <div className={styles.alternativesLabel}>Alternatives:</div>
                        {step.branches.map((alt, aIdx) => (
                          <div key={alt.id} className={`${styles.node} ${styles.nested}`}>
                            <div className={styles.nodeContent}>
                              <div className={styles.nodeHeader}>
                                <span className={styles.altNum}>{String.fromCharCode(97 + aIdx)}.</span>
                                <button 
                                  onClick={() => deleteStepBranch(branch.id, step.id, alt.id)} 
                                  className={styles.deleteBtn} 
                                  title="Delete alternative"
                                >
                                  ×
                                </button>
                              </div>
                              
                              {editingId === alt.id ? (
                                <div className={styles.textareaWrapper}>
                                  <textarea
                                    ref={textareaRef}
                                    placeholder="Alternative approach..."
                                    value={alt.description}
                                    onChange={(e) => handleTextChange(e, (val) => updateStepBranchDesc(branch.id, step.id, alt.id, val))}
                                    onBlur={() => setEditingId(null)}
                                    autoFocus
                                    rows={1}
                                  />
                                  {showSuggestions && (
                                    <div 
                                      className={styles.suggestions}
                                      style={{ top: suggestionPosition.top, left: suggestionPosition.left }}
                                    >
                                      {suggestionType === 'variable'
                                        ? getAllVariables()
                                            .filter(v => v.toLowerCase().startsWith(currentVariable.toLowerCase()))
                                            .map(varName => (
                                              <div
                                                key={varName}
                                                className={styles.suggestionItem}
                                                onMouseDown={(e) => {
                                                  e.preventDefault();
                                                  insertVariable(varName);
                                                }}
                                              >
                                                @{varName}
                                              </div>
                                            ))
                                        : getAvailableTools()
                                            .filter(t => t.toLowerCase().startsWith(currentVariable.toLowerCase()))
                                            .map(toolName => (
                                              <div
                                                key={toolName}
                                                className={styles.suggestionItem}
                                                onMouseDown={(e) => {
                                                  e.preventDefault();
                                                  insertVariable(toolName);
                                                }}
                                              >
                                                ${toolName}
                                              </div>
                                            ))
                                      }
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div 
                                  className={styles.textDisplay}
                                  onClick={() => setEditingId(alt.id)}
                                >
                                  {alt.description ? formatTextWithVariables(alt.description) : <span className={styles.placeholder}>Click to add alternative...</span>}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <button onClick={() => addStepBranch(branch.id, step.id)} className={styles.addBtn}>
                      + Add Alternative
                    </button>
                  </div>
                </div>
              ))}

              <button onClick={() => addStep(branch.id)} className={styles.addBtn}>
                + Add Step
              </button>
            </div>
          </div>
        ))}

        <button onClick={addBranch} className={styles.addBtn}>
          + Add Branch (Fallback)
        </button>
      </div>
    </div>
  );
}
