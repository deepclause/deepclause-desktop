import { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';

interface MermaidDiagramProps {
  chart: string;
  id?: string;
}

// Initialize mermaid once
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
});

export function MermaidDiagram({ chart, id }: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const diagramId = id || `mermaid-${Math.random().toString(36).substr(2, 9)}`;

  useEffect(() => {
    if (!containerRef.current || !chart) return;

    const renderDiagram = async () => {
      try {
        setError(null);
        // Clear previous content
        containerRef.current!.innerHTML = '';
        
        // Render new diagram
        const { svg } = await mermaid.render(diagramId, chart);
        containerRef.current!.innerHTML = svg;
      } catch (err) {
        console.error('Mermaid rendering error:', err);
        setError(err instanceof Error ? err.message : 'Failed to render diagram');
      }
    };

    renderDiagram();
  }, [chart, diagramId]);

  if (error) {
    return (
      <div className="p-4 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
        <strong>Diagram Error:</strong> {error}
      </div>
    );
  }

  return <div ref={containerRef} className="mermaid-diagram my-4" />;
}
