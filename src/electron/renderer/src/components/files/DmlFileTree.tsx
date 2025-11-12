import { useState } from 'react';
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen, Brain, Edit2, Trash2 } from 'lucide-react';
import type { DmlFile } from '../../types/dml';

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  files: DmlFile[];
}

interface DmlFileTreeProps {
  files: DmlFile[];
  onFileClick: (filename: string) => void;
  onFileEdit?: (filename: string) => void;
  onFileDelete?: (filename: string) => void;
}

export function DmlFileTree({ files, onFileClick, onFileEdit, onFileDelete }: DmlFileTreeProps) {
  // Build tree structure from flat file list
  const buildTree = (fileList: DmlFile[]): TreeNode => {
    const root: TreeNode = { name: 'root', path: '', children: [], files: [] };

    for (const file of fileList) {
      const parts = file.name.split('.');
      let current = root;

      // Navigate/create directory structure (all parts except last)
      for (let i = 0; i < parts.length - 1; i++) {
        const dirName = parts[i];
        let child = current.children.find((c) => c.name === dirName);
        if (!child) {
          child = {
            name: dirName,
            path: parts.slice(0, i + 1).join('.'),
            children: [],
            files: [],
          };
          current.children.push(child);
        }
        current = child;
      }

      // Add file to the appropriate directory
      current.files.push(file);
    }

    return root;
  };

  const tree = buildTree(files);

  return (
    <div className="space-y-1">
      {tree.children.map((node) => (
        <TreeNodeComponent
          key={node.path}
          node={node}
          onFileClick={onFileClick}
          onFileEdit={onFileEdit}
          onFileDelete={onFileDelete}
          level={0}
        />
      ))}
      {tree.files.map((file) => (
        <FileComponent
          key={file.name}
          file={file}
          onFileClick={onFileClick}
          onFileEdit={onFileEdit}
          onFileDelete={onFileDelete}
          level={0}
        />
      ))}
    </div>
  );
}

interface TreeNodeComponentProps {
  node: TreeNode;
  onFileClick: (filename: string) => void;
  onFileEdit?: (filename: string) => void;
  onFileDelete?: (filename: string) => void;
  level: number;
}

function TreeNodeComponent({ node, onFileClick, onFileEdit, onFileDelete, level }: TreeNodeComponentProps) {
  const [isExpanded, setIsExpanded] = useState(false); // All folders collapsed by default
  const isLearnedFolder = node.name === 'learned';

  return (
    <div>
      {/* Directory */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1 py-1 px-2 cursor-pointer hover:bg-bg-light rounded transition-colors group"
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-text-secondary flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-secondary flex-shrink-0" />
        )}
        {isLearnedFolder ? (
          <Brain className="w-4 h-4 text-purple-500 flex-shrink-0" />
        ) : isExpanded ? (
          <FolderOpen className="w-4 h-4 text-deepclause-primary flex-shrink-0" />
        ) : (
          <Folder className="w-4 h-4 text-text-secondary group-hover:text-deepclause-primary flex-shrink-0" />
        )}
        <span className={`text-sm font-medium truncate ${isLearnedFolder ? 'text-purple-500' : 'text-text-primary'}`}>
          {isLearnedFolder ? "Core" : node.name}
          {isLearnedFolder && <span className="ml-1 text-xs opacity-70">(Learned Examples)</span>}
        </span>
      </div>

      {/* Children */}
      {isExpanded && (
        <div>
          {node.children.map((child) => (
            <TreeNodeComponent
              key={child.path}
              node={child}
              onFileClick={onFileClick}
              onFileEdit={onFileEdit}
              onFileDelete={onFileDelete}
              level={level + 1}
            />
          ))}
          {node.files.map((file) => (
            <FileComponent
              key={file.name}
              file={file}
              onFileClick={onFileClick}
              onFileEdit={onFileEdit}
              onFileDelete={onFileDelete}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileComponentProps {
  file: DmlFile;
  onFileClick: (filename: string) => void;
  onFileEdit?: (filename: string) => void;
  onFileDelete?: (filename: string) => void;
  level: number;
}

function FileComponent({ file, onFileClick, onFileEdit, onFileDelete, level }: FileComponentProps) {
  const fileName = file.name.split('.').pop() || file.name;

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFileEdit?.(file.name);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFileDelete?.(file.name);
  };
  
  return (
    <div
      className="flex items-start gap-1 py-1.5 px-2 cursor-pointer hover:bg-bg-light rounded transition-colors group border-l-2 border-transparent hover:border-deepclause-primary"
      style={{ paddingLeft: `${level * 12 + 24}px` }}
      title={file.description || file.name}
    >
      <FileText className="w-4 h-4 text-text-secondary group-hover:text-deepclause-primary flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0" onClick={() => onFileClick(file.name)}>
        <div className="text-sm text-text-primary font-medium truncate">{fileName}</div>
        {file.description && (
          <div className="text-xs text-text-secondary truncate mt-0.5">{file.description}</div>
        )}
        {file.parameters.length > 0 && (
          <div className="text-xs text-deepclause-primary font-mono mt-0.5 truncate">
            {file.parameters.join(', ')}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleEdit}
          className="p-1 hover:bg-bg-primary rounded text-text-secondary hover:text-deepclause-primary transition-colors"
          title="Edit file"
        >
          <Edit2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleDelete}
          className="p-1 hover:bg-bg-primary rounded text-text-secondary hover:text-red-500 transition-colors"
          title="Delete file"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
