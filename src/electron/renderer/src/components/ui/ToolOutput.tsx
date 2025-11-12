import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';

interface ToolOutputProps {
  content: string;
}

export function ToolOutput({ content }: ToolOutputProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  // Memoize parsing to prevent recalculation during streaming
  const { toolName, actualContent, summary, hasMoreContent } = useMemo(() => {
    // Parse content - look for "**toolname**" pattern at start
    const lines = content.split('\n');
    let name = 'Tool Output';
    let contentText = content;
    
    // Check if first line is a tool name (e.g., "**web_search**" or "**diagram_generator**")
    const toolNameMatch = lines[0].match(/^\*\*([^*]+)\*\*$/);
    if (toolNameMatch) {
      name = toolNameMatch[1].trim();
      contentText = lines.slice(1).join('\n').trim();
    }
    
    // Create summary from actual content - strip markdown for preview
    const plainText = contentText
      .replace(/^##\s+/gm, '') // Remove markdown headers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links, keep text
      .replace(/[*_`]/g, '') // Remove formatting
      .trim();
    
    const firstNonEmpty = plainText.split('\n').find(line => line.trim()) || '';
    const summaryText = firstNonEmpty.length > 80 ? firstNonEmpty.substring(0, 80) + '...' : firstNonEmpty;
    const hasMore = plainText.length > 100; // Show expand if content is substantial
    
    return {
      toolName: name,
      actualContent: contentText,
      summary: summaryText,
      hasMoreContent: hasMore
    };
  }, [content]);
  
  return (
    <div className="w-full mb-3" style={{ willChange: 'contents' }}>
      <div className="bg-blue-50 border border-blue-200 rounded-lg overflow-hidden shadow-sm">
        {/* Header - always visible */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-blue-100/50 transition-colors text-left"
          disabled={!hasMoreContent}
        >
          {hasMoreContent && (
            isExpanded ? (
              <ChevronDown className="w-4 h-4 text-blue-600 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-blue-600 flex-shrink-0" />
            )
          )}
          <Wrench className="w-4 h-4 text-blue-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-blue-700 mb-0.5">
              {toolName}
            </div>
            <div className="text-sm text-blue-900 leading-tight truncate">
              {summary || 'Output available'}
            </div>
          </div>
          {hasMoreContent && !isExpanded && (
            <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded flex-shrink-0">
              View
            </span>
          )}
        </button>
        
        {/* Expanded content - render as plain text (no markdown or HTML) */}
        {isExpanded && hasMoreContent && (
          <div className="border-t border-blue-200 bg-white">
            <pre className="px-4 py-3 text-sm text-gray-800 whitespace-pre-wrap font-mono overflow-x-auto">
              {actualContent}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
