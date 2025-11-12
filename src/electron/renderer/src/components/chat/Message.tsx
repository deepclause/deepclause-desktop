import { useChatStore } from '../../stores/useChatStore';
import { useFileStore } from '../../stores/useFileStore';
import { useMarkdownViewerStore } from '../../stores/useMarkdownViewerStore';
import { formatMessage, escapeHtml } from '../../utils/formatting';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MermaidDiagram } from '../ui/MermaidDiagram';
import { ToolOutput } from '../ui/ToolOutput';
import { CollapsibleCode } from '../ui/CollapsibleCode';
import { useState, useEffect, useMemo } from 'react';
import { Play, ChevronDown, ChevronRight } from 'lucide-react';

interface MessageProps {
  message: {
    id: string;
    type: 'user' | 'agent' | 'system' | 'error' | 'streaming';
    content: string;
    timestamp: Date;
    raw?: boolean;
  };
}

// Collapsible reasoning component
function CollapsibleReasoning({ content }: { content: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <div className="w-full mb-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-start gap-2 bg-purple-500/5 border border-purple-500/20 rounded-lg px-3 py-2 text-sm font-mono text-text-primary shadow-sm hover:bg-purple-500/10 transition-colors cursor-pointer"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-purple-500/70 mt-0.5 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-purple-500/70 mt-0.5 flex-shrink-0" />
        )}
        <span className="text-purple-500/70 mt-0.5 flex-shrink-0">💭</span>
        <span className="leading-tight text-left flex-1 break-words overflow-hidden">
          {isExpanded ? (
            <span className="whitespace-pre-wrap break-all">{content}</span>
          ) : (
            <span className="line-clamp-1">Reasoning...</span>
          )}
        </span>
      </button>
    </div>
  );
}


// Helper to convert workspace relative paths to workspace:// URLs
async function getImageUrl(src: string): Promise<string> {
  // If it's already an absolute URL (http/https/data), return as-is
  if (src.match(/^(https?:|data:)/i)) {
    return src;
  }
  
  // If it's already a workspace:// URL, return as-is
  if (src.startsWith('workspace://')) {
    return src;
  }
  
  // Otherwise, treat as workspace-relative path
  // Remove leading slash or ./ if present
  const cleanPath = src.replace(/^\.?\//, '');
  return `workspace://${cleanPath}`;
}

// Custom image component that resolves workspace paths
function WorkspaceImage({ src, alt }: { src?: string; alt?: string }) {
  const [resolvedSrc, setResolvedSrc] = useState<string>('');
  const [error, setError] = useState(false);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isSvg = src?.toLowerCase().endsWith('.svg');
  
  useEffect(() => {
    if (src) {
      setIsLoading(true);
      getImageUrl(src).then(async (url) => {
        setResolvedSrc(url);
        
        // For SVG files from workspace, fetch and render inline for better support
        if (isSvg && url.startsWith('workspace://')) {
          try {
            const path = url.replace('workspace://', '');
            const workspaceResult = await window.electronAPI.getPaths();
            if (workspaceResult.success && workspaceResult.paths) {
              const fullPath = `${workspaceResult.paths.workspace}/${path}`;
              const fileResult = await window.electronAPI.readFile(fullPath);
              if (fileResult.success && fileResult.content) {
                setSvgContent(fileResult.content);
                setIsLoading(false);
              }
            }
          } catch (err) {
            // Fall back to img tag if inline rendering fails
            console.warn('Failed to load SVG inline, using img tag:', err);
            setIsLoading(false);
          }
        } else {
          setIsLoading(false);
        }
      }).catch(() => {
        setError(true);
        setIsLoading(false);
      });
    }
  }, [src, isSvg]);
  
  if (error) {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-2 bg-red-900/20 border border-red-500/30 rounded text-sm text-red-400">
        <span>⚠️</span>
        <span>Failed to load image: {alt || src}</span>
      </span>
    );
  }
  
  // Render inline SVG for better support (scaling, interactivity)
  if (svgContent) {
    return (
      <span 
        className="max-w-full my-2 rounded-lg border border-border shadow-md bg-white p-2 inline-block"
        dangerouslySetInnerHTML={{ __html: svgContent }}
        title={alt || ''}
      />
    );
  }
  
  // Don't render img until we have resolved the URL
  if (isLoading || !resolvedSrc) {
    return null;
  }
  
  return (
    <img
      src={resolvedSrc}
      alt={alt || ''}
      className="max-w-full h-auto rounded-lg border border-border shadow-md my-2"
      onError={() => setError(true)}
    />
  );
}

// Helper to detect and make markdown filenames clickable
function ClickableText({ text }: { text: string }) {
  const { workspaceFiles } = useFileStore();
  const { openMarkdownFile } = useMarkdownViewerStore();
  
  // Pattern to match .md filenames
  const mdFilePattern = /(\w+\.md)/g;
  
  // Find all .md files in workspace
  const workspaceMdFiles = new Set(
    workspaceFiles
      .filter(f => f.type === 'file' && f.name.endsWith('.md'))
      .map(f => f.name)
  );
  
  // Split text by .md filenames
  const parts = text.split(mdFilePattern);
  
  return (
    <>
      {parts.map((part, index) => {
        // Check if this part is a markdown file that exists in workspace
        if (mdFilePattern.test(part) && workspaceMdFiles.has(part)) {
          const file = workspaceFiles.find(f => f.name === part);
          return (
            <button
              key={index}
              onClick={() => file && openMarkdownFile(file.fullPath || file.path, file.name)}
              className="text-deepclause-primary hover:underline font-medium cursor-pointer"
            >
              {part}
            </button>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

export function Message({ message }: MessageProps) {
  const isUser = message.type === 'user';
  const isError = message.type === 'error';
  const isSystem = message.type === 'system';

  // Handle raw output (no markdown processing, no log extraction)
  if (message.raw) {
    const formattedContent = escapeHtml(message.content).replace(/\n/g, '<br>');
    
    if (isUser) {
      return (
        <div className="flex justify-end mb-6 animate-fade-in-up">
          <div className="max-w-2xl">
            <div className="bg-deepclause-primary text-white rounded-2xl rounded-tr-sm px-5 py-3 shadow-lg">
              <div
                className="leading-relaxed font-mono text-sm whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: formattedContent }}
              />
            </div>
            <span className="block text-xs text-text-secondary mt-1.5 text-right">
              {message.timestamp.toLocaleTimeString()}
            </span>
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-start mb-6 animate-fade-in-up">
        <div className="max-w-3xl">
          <div
            className={`rounded-2xl rounded-tl-sm px-5 py-3.5 shadow-md ${
              isError
                ? 'bg-red-900/20 border border-red-500/30'
                : isSystem
                ? 'bg-bg-medium/50 border border-border/30'
                : 'bg-bg-medium border border-border/30'
            }`}
          >
            <div
              className="leading-relaxed font-mono text-sm whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: formattedContent }}
            />
          </div>
          <span className="block text-xs text-text-secondary mt-1.5">
            {message.timestamp.toLocaleTimeString()}
          </span>
        </div>
      </div>
    );
  }

  // Process message with markdown and log extraction
  const { content } = formatMessage(message.content);

  // Parse content into segments for manual rendering
  // This prevents ReactMarkdown from processing tool-output content twice
  const parseContentSegments = (text: string) => {
    const segments: Array<{ type: 'text' | 'log' | 'tool-output' | 'dml-code' | 'svg' | 'dml-execution' | 'reasoning'; content: string; tool?: string }> = [];
    
    const logRegex = /<log>(.*?)<\/log>/gs;
    const toolOutputRegex = /<tool-output\s+tool="([^"]+)">(.*?)<\/tool-output>/gs;
    const dmlCodeRegex = /<dml-code>(.*?)<\/dml-code>/gs;
    const svgRegex = /(<svg[\s\S]*?<\/svg>)/gs;
    const dmlExecutionRegex = /<dml-execution>(.*?)<\/dml-execution>/gs;
    // Match both closed and unclosed reasoning tags (for streaming)
    const reasoningRegex = /<reasoning>(.*?)(?:<\/reasoning>|$)/gs;
    
    const allMatches: Array<{ start: number; end: number; type: 'log' | 'tool-output' | 'dml-code' | 'svg' | 'dml-execution' | 'reasoning'; content: string; tool?: string }> = [];
    
    let match;
    while ((match = logRegex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'log',
        content: match[1].trim()
      });
    }
    
    while ((match = toolOutputRegex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'tool-output',
        tool: match[1],
        content: match[2].trim()
      });
    }
    
    while ((match = dmlCodeRegex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'dml-code',
        content: match[1].trim()
      });
    }
    
    while ((match = svgRegex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'svg',
        content: match[1].trim()
      });
    }
    
    while ((match = dmlExecutionRegex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'dml-execution',
        content: match[1].trim()
      });
    }
    
    while ((match = reasoningRegex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'reasoning',
        content: match[1].trim()
      });
    }
    
    allMatches.sort((a, b) => a.start - b.start);
    
    let currentPos = 0;
    for (const m of allMatches) {
      if (m.start > currentPos) {
        const textBefore = text.substring(currentPos, m.start).trim();
        if (textBefore) {
          segments.push({ type: 'text', content: textBefore });
        }
      }
      segments.push({ type: m.type, content: m.content, tool: m.tool });
      currentPos = m.end;
    }
    
    if (currentPos < text.length) {
      const textAfter = text.substring(currentPos).trim();
      if (textAfter) {
        segments.push({ type: 'text', content: textAfter });
      }
    }
    
    return segments;
  };

  const contentSegments = useMemo(() => parseContentSegments(content), [content]);

  if (isUser) {
    return (
      <div className="flex justify-end mb-6 animate-fade-in-up">
        <div className="max-w-2xl">
          <div className="bg-deepclause-primary text-white rounded-2xl rounded-tr-sm px-5 py-3 shadow-lg">
            <div className="leading-relaxed prose prose-invert prose-sm max-w-none">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          </div>
          <span className="block text-xs text-text-secondary mt-1.5 text-right">
            {message.timestamp.toLocaleTimeString()}
          </span>
        </div>
      </div>
    );
  }

  console.log(message.content)

  return (
    <div className="flex justify-start mb-6 animate-fade-in-up">
      <div className="max-w-3xl">
        <div
          className={`rounded-2xl rounded-tl-sm px-5 py-3.5 shadow-md ${
            isError
              ? 'bg-red-900/20 border border-red-500/30'
              : isSystem
              ? 'bg-bg-medium/50 border border-border/30'
              : 'bg-bg-medium border border-border/30'
          }`}
        >
          {/* Render segments manually to prevent double rendering of tool-output content */}
          <div className="leading-relaxed prose prose-sm max-w-none prose-headings:text-text-primary prose-p:text-text-primary prose-strong:text-text-primary prose-ul:text-text-primary prose-ol:text-text-primary prose-li:text-text-primary prose-code:text-text-primary prose-code:bg-transparent prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0">
            {contentSegments.map((segment, index) => {
              if (segment.type === 'log') {
                return (
                  <div key={index} className="w-full mb-2">
                    <div className="flex items-center gap-2 bg-deepclause-primary/5 border border-deepclause-primary/10 rounded-lg px-3 py-2 text-sm font-mono text-text-primary shadow-sm">
                      <span className="text-deepclause-primary/70">▸</span>
                      <span className="leading-tight">
                        <ClickableText text={segment.content} />
                      </span>
                    </div>
                  </div>
                );
              } else if (segment.type === 'reasoning') {
                return <CollapsibleReasoning key={index} content={segment.content} />;
              } else if (segment.type === 'dml-execution') {
                return (
                  <div key={index} className="w-full mb-3">
                    <div className="flex items-center gap-2.5 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-lg px-4 py-2.5 shadow-sm">
                      <Play className="w-4 h-4 text-green-600 fill-green-600 flex-shrink-0" />
                      <span className="text-sm font-semibold text-green-700">
                        {segment.content}
                      </span>
                    </div>
                  </div>
                );
              } else if (segment.type === 'tool-output') {
                return <ToolOutput key={index} content={`**${segment.tool}**\n${segment.content}`} />;
              } else if (segment.type === 'dml-code') {
                // Extract code from markdown code block if present
                const codeMatch = segment.content.match(/```(?:prolog)?\n?([\s\S]*?)```/);
                const code = codeMatch ? codeMatch[1].trim() : segment.content.trim();
                return <CollapsibleCode key={index} code={code} />;
              } else if (segment.type === 'svg') {
                // Render inline SVG
                return (
                  <div 
                    key={index}
                    className="max-w-full my-3 rounded-lg border border-border shadow-md bg-white p-3 inline-block"
                    dangerouslySetInnerHTML={{ __html: segment.content }}
                  />
                );
              } else {
                // Regular text - render with ReactMarkdown
                return (
                  <ReactMarkdown
                    key={index}
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }: any) => <>{children}</>,
                      img: ({ src, alt }: any) => <WorkspaceImage src={src} alt={alt} />,
                      code: ({ node, className, children, ...props }: any) => {
                        const match = /language-(\w+)/.exec(className || '');
                        const lang = match?.[1];
                        const isInline = !className?.includes('language-');
                        
                        if (lang === 'mermaid') {
                          const code = String(children).replace(/\n$/, '');
                          return <MermaidDiagram chart={code} />;
                        }
                        
                        return isInline ? (
                          <code className="bg-bg-light px-1.5 py-0.5 rounded text-xs font-mono border border-border text-deepclause-primary" {...props}>
                            {children}
                          </code>
                        ) : (
                          <code className="block bg-white p-4 rounded-lg text-sm font-mono border border-border overflow-x-auto text-text-primary whitespace-pre shadow-sm" {...props}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {segment.content}
                  </ReactMarkdown>
                );
              }
            })}
          </div>
        </div>
        <span className="block text-xs text-text-secondary mt-1.5">
          {message.timestamp.toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

export function StreamingMessage() {
  const streamingMessage = useChatStore((state) => state.streamingMessage);

  // Process streaming content with markdown and log extraction
  const content = streamingMessage ? formatMessage(streamingMessage.content).content : '';

  console.log("StreamingMessage.content:", content);

  // Parse content into segments for manual rendering
  const parseContentSegments = (text: string) => {
    const segments: Array<{ type: 'text' | 'log' | 'tool-output' | 'dml-code' | 'svg' | 'dml-execution' | 'reasoning'; content: string; tool?: string }> = [];
    
    const logRegex = /<log>(.*?)<\/log>/gs;
    const toolOutputRegex = /<tool-output\s+tool="([^"]+)">(.*?)<\/tool-output>/gs;
    const dmlCodeRegex = /<dml-code>(.*?)<\/dml-code>/gs;
    const svgRegex = /(<svg[\s\S]*?<\/svg>)/gs;
    const dmlExecutionRegex = /<dml-execution>(.*?)<\/dml-execution>/gs;
    // Match both closed and unclosed reasoning tags (for streaming)
    const reasoningRegex = /<reasoning>(.*?)(?:<\/reasoning>|$)/gs;
    
    const allMatches: Array<{ start: number; end: number; type: 'log' | 'tool-output' | 'dml-code' | 'svg' | 'dml-execution' | 'reasoning'; content: string; tool?: string }> = [];
    
    let match;
    while ((match = logRegex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'log',
        content: match[1].trim()
      });
    }
    
    while ((match = toolOutputRegex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'tool-output',
        tool: match[1],
        content: match[2].trim()
      });
    }
    
    while ((match = dmlCodeRegex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'dml-code',
        content: match[1].trim()
      });
    }
    
    while ((match = svgRegex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'svg',
        content: match[1].trim()
      });
    }
    
    while ((match = dmlExecutionRegex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'dml-execution',
        content: match[1].trim()
      });
    }
    
    while ((match = reasoningRegex.exec(text)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        type: 'reasoning',
        content: match[1].trim()
      });
    }
    
    allMatches.sort((a, b) => a.start - b.start);
    
    let currentPos = 0;
    for (const m of allMatches) {
      if (m.start > currentPos) {
        const textBefore = text.substring(currentPos, m.start).trim();
        if (textBefore) {
          segments.push({ type: 'text', content: textBefore });
        }
      }
      segments.push({ type: m.type, content: m.content, tool: m.tool });
      currentPos = m.end;
    }
    
    if (currentPos < text.length) {
      const textAfter = text.substring(currentPos).trim();
      if (textAfter) {
        segments.push({ type: 'text', content: textAfter });
      }
    }
    
    return segments;
  };

  const contentSegments = useMemo(() => parseContentSegments(content), [content]);

  // Early return after all hooks have been called
  if (!streamingMessage) return null;

  return (
    <div className="flex justify-start mb-6" style={{ willChange: 'contents' }}>
      <div className="max-w-3xl">
        <div className="rounded-2xl rounded-tl-sm px-5 py-3.5 bg-bg-medium border-2 border-deepclause-primary/50 shadow-lg relative">
          {/* Render segments manually */}
          <div className="leading-relaxed prose prose-sm max-w-none prose-headings:text-text-primary prose-p:text-text-primary prose-strong:text-text-primary prose-ul:text-text-primary prose-ol:text-text-primary prose-li:text-text-primary prose-code:text-text-primary prose-code:bg-transparent prose-pre:bg-transparent prose-pre:p-0 prose-pre:m-0">
            {contentSegments.map((segment, index) => {
              if (segment.type === 'log') {
                return (
                  <div key={index} className="w-full mb-2">
                    <div className="flex items-center gap-2 bg-deepclause-primary/5 border border-deepclause-primary/10 rounded-lg px-3 py-2 text-sm font-mono text-text-primary shadow-sm">
                      <span className="text-deepclause-primary/70">▸</span>
                      <span className="leading-tight">
                        <ClickableText text={segment.content} />
                      </span>
                    </div>
                  </div>
                );
              } else if (segment.type === 'reasoning') {
                return <CollapsibleReasoning key={index} content={segment.content} />;
              } else if (segment.type === 'dml-execution') {
                return (
                  <div key={index} className="w-full mb-3">
                    <div className="flex items-center gap-2.5 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-lg px-4 py-2.5 shadow-sm">
                      <Play className="w-4 h-4 text-green-600 fill-green-600 flex-shrink-0" />
                      <span className="text-sm font-semibold text-green-700">
                        {segment.content}
                      </span>
                    </div>
                  </div>
                );
              } else if (segment.type === 'tool-output') {
                return <ToolOutput key={index} content={`**${segment.tool}**\n${segment.content}`} />;
              } else if (segment.type === 'dml-code') {
                // Extract code from markdown code block if present
                const codeMatch = segment.content.match(/```(?:prolog)?\n?([\s\S]*?)```/);
                const code = codeMatch ? codeMatch[1].trim() : segment.content.trim();
                return <CollapsibleCode key={index} code={code} />;
              } else if (segment.type === 'svg') {
                // Render inline SVG
                return (
                  <div 
                    key={index}
                    className="max-w-full my-3 rounded-lg border border-border shadow-md bg-white p-3 inline-block"
                    dangerouslySetInnerHTML={{ __html: segment.content }}
                  />
                );
              } else {
                // Regular text - render with ReactMarkdown
                return (
                  <ReactMarkdown
                    key={index}
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }: any) => <>{children}</>,
                      img: ({ src, alt }: any) => <WorkspaceImage src={src} alt={alt} />,
                      code: ({ node, className, children, ...props }: any) => {
                        const match = /language-(\w+)/.exec(className || '');
                        const lang = match?.[1];
                        const isInline = !className?.includes('language-');
                        
                        if (lang === 'mermaid') {
                          const code = String(children).replace(/\n$/, '');
                          return <MermaidDiagram chart={code} />;
                        }
                        
                        return isInline ? (
                          <code className="bg-bg-light px-1.5 py-0.5 rounded text-xs font-mono border border-border text-deepclause-primary" {...props}>
                            {children}
                          </code>
                        ) : (
                          <code className="block bg-white p-4 rounded-lg text-sm font-mono border border-border overflow-x-auto text-text-primary whitespace-pre shadow-sm" {...props}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {segment.content}
                  </ReactMarkdown>
                );
              }
            })}
          </div>
          
          <div className="flex items-center gap-1.5 mt-2">
            <div className="w-1.5 h-1.5 bg-deepclause-primary rounded-full animate-pulse" />
            <div className="w-1.5 h-1.5 bg-deepclause-primary rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
            <div className="w-1.5 h-1.5 bg-deepclause-primary rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
          </div>
        </div>
        <span className="block text-xs text-text-secondary mt-1.5">
          {streamingMessage.timestamp.toLocaleTimeString()} • Streaming...
        </span>
      </div>
    </div>
  );
}
