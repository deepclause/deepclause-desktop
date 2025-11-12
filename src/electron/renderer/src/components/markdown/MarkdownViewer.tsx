import { useState, useEffect } from 'react';
import { X, Edit2, Save, Eye, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { MermaidDiagram } from '../ui/MermaidDiagram';

interface MarkdownViewerProps {
  filePath: string;
  fileName: string;
  onClose: () => void;
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
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isSvg = src?.toLowerCase().endsWith('.svg');
  
  useEffect(() => {
    if (src) {
      console.log('[WorkspaceImage] Loading image:', src);
      setIsLoading(true);
      getImageUrl(src).then(async (url) => {
        console.log('[WorkspaceImage] Resolved URL:', url);
        setResolvedSrc(url);
        
        // For SVG files from workspace, fetch and render inline for better support
        if (isSvg && url.startsWith('workspace://')) {
          try {
            const path = url.replace('workspace://', '');
            console.log('[WorkspaceImage] Fetching SVG from path:', path);
            const workspaceResult = await window.electronAPI.getPaths();
            if (workspaceResult.success && workspaceResult.paths) {
              const fullPath = `${workspaceResult.paths.workspace}/${path}`;
              console.log('[WorkspaceImage] Full path:', fullPath);
              const fileResult = await window.electronAPI.readFile(fullPath);
              if (fileResult.success && fileResult.content) {
                setSvgContent(fileResult.content);
                setIsLoading(false);
              } else {
                console.error('[WorkspaceImage] Failed to read SVG:', fileResult.error);
                setError(true);
                setErrorMessage(fileResult.error || 'Failed to read SVG file');
                setIsLoading(false);
              }
            }
          } catch (err) {
            // Fall back to img tag if inline rendering fails
            console.warn('[WorkspaceImage] Failed to load SVG inline, using img tag:', err);
            setError(true);
            setErrorMessage(err instanceof Error ? err.message : 'Unknown error');
            setIsLoading(false);
          }
        } else {
          setIsLoading(false);
        }
      }).catch((err) => {
        console.error('[WorkspaceImage] Failed to resolve image URL:', err);
        setError(true);
        setErrorMessage(err instanceof Error ? err.message : 'Failed to resolve image URL');
        setIsLoading(false);
      });
    }
  }, [src, isSvg]);
  
  if (error) {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-2 bg-red-900/20 border border-red-500/30 rounded text-sm text-red-400">
        <span>⚠️</span>
        <span>Failed to load image: {alt || src}</span>
        {errorMessage && <span className="text-xs">({errorMessage})</span>}
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
    return <span className="text-text-secondary">Loading image...</span>;
  }
  
  return (
    <img
      src={resolvedSrc}
      alt={alt || ''}
      className="max-w-full h-auto rounded-lg border border-border shadow-md my-2"
      onError={(e) => {
        console.error('[WorkspaceImage] Image load error for:', resolvedSrc, e);
        setError(true);
        setErrorMessage('Failed to load image');
      }}
    />
  );
}

export function MarkdownViewer({ filePath, fileName, onClose }: MarkdownViewerProps) {
  const [content, setContent] = useState<string>('');
  const [editedContent, setEditedContent] = useState<string>('');
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load file content
  useEffect(() => {
    loadContent();
  }, [filePath]);

  const loadContent = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI.readFile(filePath);
      if (result.success) {
        setContent(result.content ?? '');
        setEditedContent(result.content ?? '');
      } else {
        setError(result.error || 'Failed to load file');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const result = await window.electronAPI.writeFile(filePath, editedContent);
      if (result.success) {
        setContent(editedContent);
        setIsEditing(false);
      } else {
        setError(result.error || 'Failed to save file');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setEditedContent(content);
    setIsEditing(false);
    setError(null);
  };

  const handleExportPDF = () => {
    // Trigger print dialog
    window.print();
  };

  return (
    <>
      {/* Print-specific styles */}
      <style>{`
        @media print {
          /* Reset page margins */
          @page {
            margin: 1cm;
            size: auto;
          }
          
          /* Hide everything on the page */
          body * {
            visibility: hidden;
          }
          
          /* Show only the print container and its contents */
          .markdown-viewer-print-container,
          .markdown-viewer-print-container * {
            visibility: visible;
          }
          
          /* Position print container at top */
          .markdown-viewer-print-container {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
            background: transparent !important;
            display: block !important;
          }
          
          /* Remove modal styling for print */
          .markdown-viewer-container {
            position: static !important;
            width: 100% !important;
            height: auto !important;
            max-width: 100% !important;
            max-height: none !important;
            background: white !important;
            border: none !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            display: block !important;
            overflow: visible !important;
          }
          
          /* Hide header with buttons */
          .markdown-viewer-header {
            display: none !important;
          }
          
          /* Hide error messages during print */
          .markdown-viewer-error {
            display: none !important;
          }
          
          /* Style content for print - remove ALL overflow constraints */
          .markdown-viewer-content {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
            padding: 0 !important;
            background: white !important;
            display: block !important;
          }
          
          /* Remove scrolling container constraints */
          .markdown-viewer-content > div {
            overflow: visible !important;
            height: auto !important;
            max-height: none !important;
          }
          
          /* Ensure good typography for print */
          .prose {
            max-width: 100% !important;
            color: black !important;
            padding: 1rem !important;
          }
          
          .prose * {
            color: black !important;
          }
          
          /* Print-friendly code blocks */
          .prose code {
            background: #f5f5f5 !important;
            border: 1px solid #ddd !important;
          }
          
          /* Prevent page breaks inside elements */
          .prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6 {
            page-break-after: avoid;
            break-after: avoid;
            page-break-inside: avoid;
            break-inside: avoid;
          }
          
          .prose pre, .prose img, .prose table {
            page-break-inside: avoid;
            break-inside: avoid;
          }
          
          /* Allow page breaks in long code blocks if needed */
          .prose pre code {
            white-space: pre-wrap !important;
            word-wrap: break-word !important;
          }
        }
      `}</style>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm markdown-viewer-print-container">
      <div className="w-[90vw] h-[90vh] max-w-6xl bg-bg-darkest border-2 border-deepclause-primary rounded-lg shadow-2xl flex flex-col markdown-viewer-container">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-bg-medium markdown-viewer-header">
          <div className="flex items-center gap-3">
            <span className="text-2xl">📄</span>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">{fileName}</h2>
              <p className="text-xs text-text-secondary">{filePath}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            {!isEditing ? (
              <>
                <button
                  onClick={handleExportPDF}
                  className="flex items-center gap-2 px-4 py-2 bg-bg-light text-text-primary rounded hover:bg-bg-hover transition-colors"
                  title="Export to PDF"
                >
                  <Download className="w-4 h-4" />
                  Export PDF
                </button>
                <button
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-deepclause-primary text-white rounded hover:bg-deepclause-primary-dark transition-colors"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-2 px-4 py-2 bg-bg-light text-text-primary rounded hover:bg-bg-hover transition-colors"
                >
                  <Eye className="w-4 h-4" />
                  Preview
                </button>
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-4 py-2 bg-deepclause-primary text-white rounded hover:bg-deepclause-primary-dark transition-colors disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-2 hover:bg-bg-light rounded transition-colors"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-200 text-red-700 text-sm markdown-viewer-error">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden markdown-viewer-content">
          {isLoading ? (
            <div className="flex items-center justify-center h-full text-text-secondary">
              Loading...
            </div>
          ) : isEditing ? (
            <textarea
              value={editedContent}
              onChange={(e) => setEditedContent(e.target.value)}
              className="w-full h-full p-6 bg-bg-darkest text-text-primary font-mono text-sm resize-none focus:outline-none"
              style={{ tabSize: 2 }}
            />
          ) : (
            <div className="h-full overflow-y-auto px-6 py-6">
              <div className="max-w-4xl mx-auto prose prose-sm prose-headings:text-text-primary prose-p:text-text-primary prose-strong:text-text-primary prose-ul:text-text-primary prose-ol:text-text-primary prose-li:text-text-primary prose-code:text-text-primary prose-a:text-deepclause-primary prose-blockquote:text-text-secondary">
                <ReactMarkdown
                  rehypePlugins={[rehypeRaw]}
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({ src, alt }: any) => <WorkspaceImage src={src} alt={alt} />,
                    code: ({ node, className, children, ...props }: any) => {
                      const match = /language-(\w+)/.exec(className || '');
                      const lang = match?.[1];
                      const isInline = !className?.includes('language-');
                      
                      // Render Mermaid diagrams
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
                  {content}
                </ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
