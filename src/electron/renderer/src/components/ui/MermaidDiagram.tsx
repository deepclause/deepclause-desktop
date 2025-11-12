import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidDiagramProps {
  chart: string;
}

// Initialize mermaid with configuration
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  themeVariables: {
    primaryColor: '#E8E8E8',
    primaryTextColor: '#1A1A1A',
    primaryBorderColor: '#1A1A1A',
    lineColor: '#666666',
    secondaryColor: '#F5F5F5',
    tertiaryColor: '#FAFAFA',
    background: '#FFFFFF',
    mainBkg: '#F5F5F5',
    secondBkg: '#FAFAFA',
    textColor: '#1A1A1A',
    fontSize: '14px',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  },
  securityLevel: 'loose',
  flowchart: {
    useMaxWidth: true,
    htmlLabels: true,
    curve: 'basis',
  },
});

export function MermaidDiagram({ chart }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const diagramRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [svg, setSvg] = useState<string>('');
  const [scale, setScale] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const renderDiagram = async () => {
      if (!diagramRef.current) return;
      
      try {
        setError(null);
        
        // Generate unique ID for this diagram
        const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
        
        // Render the diagram
        const { svg: renderedSvg } = await mermaid.render(id, chart);
        setSvg(renderedSvg);
      } catch (err) {
        console.error('Mermaid rendering error:', err);
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
      }
    };

    renderDiagram();
  }, [chart]);

  // Zoom handlers
  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.1, 3));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(prev - 0.1, 0.3));
  };

  const handleZoomReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  // Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left mouse button
    setIsPanning(true);
    setStartPos({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPosition({
      x: e.clientX - startPos.x,
      y: e.clientY - startPos.y,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  const handleMouseLeave = () => {
    setIsPanning(false);
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.05 : 0.05;
    setScale((prev) => Math.min(Math.max(prev + delta, 0.3), 3));
  };

  // Export handlers
  const handleExportSVG = () => {
    if (!diagramRef.current) return;
    
    const svgElement = diagramRef.current.querySelector('svg');
    if (!svgElement) return;

    const svgData = new XMLSerializer().serializeToString(svgElement);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `diagram-${Date.now()}.svg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportPNG = () => {
    if (!diagramRef.current) return;
    
    const svgElement = diagramRef.current.querySelector('svg');
    if (!svgElement) return;

    // Clone the SVG to avoid modifying the original
    const svgClone = svgElement.cloneNode(true) as SVGElement;
    
    // Get dimensions
    const bbox = svgElement.getBBox();
    const width = bbox.width || svgElement.clientWidth;
    const height = bbox.height || svgElement.clientHeight;

    // Set explicit dimensions on the clone
    svgClone.setAttribute('width', String(width));
    svgClone.setAttribute('height', String(height));

    // Create a canvas to convert SVG to PNG
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size to 2x for better quality
    canvas.width = width * 2;
    canvas.height = height * 2;
    ctx.scale(2, 2);
    
    // Fill white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const img = new Image();
    const svgData = new XMLSerializer().serializeToString(svgClone);
    
    // Use data URL instead of blob to avoid CORS/tainting issues
    const svgDataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));

    img.onload = () => {
      // Draw the image
      ctx.drawImage(img, 0, 0);

      // Convert to PNG and download
      canvas.toBlob((pngBlob) => {
        if (!pngBlob) return;
        
        const pngUrl = URL.createObjectURL(pngBlob);
        const link = document.createElement('a');
        link.href = pngUrl;
        link.download = `diagram-${Date.now()}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(pngUrl);
      }, 'image/png');
    };

    img.onerror = (err) => {
      console.error('Failed to load SVG for PNG export:', err);
    };

    img.src = svgDataUrl;
  };

  if (error) {
    return (
      <div className="my-4 p-4 bg-red-900/20 border border-red-500/30 rounded-lg">
        <p className="text-red-400 text-sm font-mono">
          <strong>Diagram Error:</strong> {error}
        </p>
        <details className="mt-2">
          <summary className="text-xs text-red-400/70 cursor-pointer hover:text-red-400">
            Show diagram source
          </summary>
          <pre className="mt-2 text-xs text-red-400/50 overflow-x-auto">
            {chart}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div className="my-4 relative group">
      {/* Zoom controls */}
      <div className="absolute top-2 right-2 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-1 border border-border">
        <button
          onClick={handleZoomIn}
          className="px-3 py-1.5 text-xs bg-bg-secondary hover:bg-bg-tertiary text-text-primary rounded transition-colors"
          title="Zoom In (Scroll Up)"
        >
          🔍+
        </button>
        <button
          onClick={handleZoomOut}
          className="px-3 py-1.5 text-xs bg-bg-secondary hover:bg-bg-tertiary text-text-primary rounded transition-colors"
          title="Zoom Out (Scroll Down)"
        >
          🔍−
        </button>
        <button
          onClick={handleZoomReset}
          className="px-3 py-1.5 text-xs bg-bg-secondary hover:bg-bg-tertiary text-text-primary rounded transition-colors"
          title="Reset View"
        >
          ↺
        </button>
        <div className="px-2 py-1.5 text-xs text-text-secondary flex items-center">
          {Math.round(scale * 100)}%
        </div>
        <div className="w-px bg-border mx-1" />
        <button
          onClick={handleExportSVG}
          className="px-3 py-1.5 text-xs bg-bg-secondary hover:bg-bg-tertiary text-text-primary rounded transition-colors"
          title="Export as SVG"
        >
          💾 SVG
        </button>
        <button
          onClick={handleExportPNG}
          className="px-3 py-1.5 text-xs bg-bg-secondary hover:bg-bg-tertiary text-text-primary rounded transition-colors"
          title="Export as PNG"
        >
          💾 PNG
        </button>
      </div>

      {/* Diagram container with pan & zoom */}
      <div
        ref={containerRef}
        className={`p-6 bg-white rounded-lg border border-border overflow-hidden shadow-sm ${
          isPanning ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        style={{ minHeight: '200px', position: 'relative' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
      >
        <div
          ref={diagramRef}
          className="mermaid-diagram inline-block transition-transform origin-center"
          style={{
            transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
            transformOrigin: 'center',
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      
      {/* Instructions hint */}
      <div className="mt-2 text-xs text-text-secondary/60 text-center opacity-0 group-hover:opacity-100 transition-opacity">
        💡 Drag to pan • Scroll to zoom • Hover top-right for controls
      </div>
    </div>
  );
}
