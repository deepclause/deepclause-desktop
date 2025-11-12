import { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';
import { getFileIcon, formatFileSize, formatDate } from '../../utils/formatting';

interface WorkspaceFile {
  name: string;
  path: string;
  type: string;
  size?: number;
  modified?: string;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'directory';
  children: TreeNode[];
  files: WorkspaceFile[];
}

interface WorkspaceFileTreeProps {
  files: WorkspaceFile[];
  onFileClick: (file: WorkspaceFile) => void;
}

export function WorkspaceFileTree({ files, onFileClick }: WorkspaceFileTreeProps) {
  // Build tree structure from flat file list
  const buildTree = (fileList: WorkspaceFile[]): TreeNode => {
    const root: TreeNode = { 
      name: 'root', 
      path: '', 
      type: 'directory',
      children: [], 
      files: [] 
    };

    // First pass: create all directories
    for (const file of fileList) {
      if (file.type === 'directory') {
        const pathParts = file.path.split('/');
        let current = root;

        // Navigate/create directory structure
        for (let i = 0; i < pathParts.length; i++) {
          const dirName = pathParts[i];
          if (!dirName) continue;
          
          let child = current.children.find((c) => c.name === dirName);
          if (!child) {
            child = {
              name: dirName,
              path: pathParts.slice(0, i + 1).join('/'),
              type: 'directory',
              children: [],
              files: [],
            };
            current.children.push(child);
          }
          current = child;
        }
      }
    }

    // Second pass: add files to their directories
    for (const file of fileList) {
      if (file.type === 'file') {
        const pathParts = file.path.split('/');
        const dirParts = pathParts.slice(0, -1);
        let current = root;

        // Navigate to the directory
        for (let i = 0; i < dirParts.length; i++) {
          const dirName = dirParts[i];
          if (!dirName) continue;
          
          let child = current.children.find((c) => c.name === dirName);
          if (!child) {
            child = {
              name: dirName,
              path: dirParts.slice(0, i + 1).join('/'),
              type: 'directory',
              children: [],
              files: [],
            };
            current.children.push(child);
          }
          current = child;
        }

        // Add file to the directory
        current.files.push(file);
      }
    }

    return root;
  };

  const tree = buildTree(files);

  return (
    <div className="space-y-0.5">
      {tree.children.map((node) => (
        <TreeNodeComponent
          key={node.path}
          node={node}
          onFileClick={onFileClick}
          level={0}
        />
      ))}
      {tree.files.map((file) => (
        <FileComponent
          key={file.path}
          file={file}
          onFileClick={onFileClick}
          level={0}
        />
      ))}
    </div>
  );
}

interface TreeNodeComponentProps {
  node: TreeNode;
  onFileClick: (file: WorkspaceFile) => void;
  level: number;
}

function TreeNodeComponent({ node, onFileClick, level }: TreeNodeComponentProps) {
  const [isExpanded, setIsExpanded] = useState(false); // Folders collapsed by default

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
        {isExpanded ? (
          <FolderOpen className="w-4 h-4 text-deepclause-primary flex-shrink-0" />
        ) : (
          <Folder className="w-4 h-4 text-text-secondary group-hover:text-deepclause-primary flex-shrink-0" />
        )}
        <span className="text-sm font-medium truncate text-text-primary">
          {node.name}
        </span>
        <span className="text-xs text-text-secondary ml-auto">
          {node.files.length + node.children.length}
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
              level={level + 1}
            />
          ))}
          {node.files.map((file) => (
            <FileComponent
              key={file.path}
              file={file}
              onFileClick={onFileClick}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileComponentProps {
  file: WorkspaceFile;
  onFileClick: (file: WorkspaceFile) => void;
  level: number;
}

function FileComponent({ file, onFileClick, level }: FileComponentProps) {
  const icon = getFileIcon(file.name);
  
  return (
    <div
      onClick={() => onFileClick(file)}
      className="flex items-center gap-1 py-1.5 px-2 cursor-pointer hover:bg-bg-light rounded transition-colors group border-l-2 border-transparent hover:border-deepclause-primary"
      style={{ paddingLeft: `${level * 12 + 24}px` }}
      title={file.path}
    >
      <span className="w-4 h-4 flex-shrink-0 text-center">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{file.name}</div>
        {file.size !== undefined && file.modified && (
          <div className="text-xs text-text-secondary truncate">
            {formatFileSize(file.size)} • {formatDate(file.modified)}
          </div>
        )}
      </div>
    </div>
  );
}
