// Format message content - clean up tags and technical output
export function formatMessage(text: string): { content: string; logs: string[] } {
  const logs: string[] = [];
  
  // Parse the content into segments
  const segments: Array<{ type: 'text' | 'log' | 'tool-output'; content: string; tool?: string }> = [];
  
  const logRegex = /<log>(.*?)<\/log>/gs;
  const toolOutputRegex = /<tool-output\s+tool="([^"]+)">(.*?)<\/tool-output>/gs;
  
  // Find all tags and their positions
  const allMatches: Array<{ start: number; end: number; type: 'log' | 'tool-output'; content: string; tool?: string }> = [];
  
  // Find all log tags
  let match;
  while ((match = logRegex.exec(text)) !== null) {
    allMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      type: 'log',
      content: match[1].trim()
    });
  }
  
  // Find all tool-output tags
  while ((match = toolOutputRegex.exec(text)) !== null) {
    allMatches.push({
      start: match.index,
      end: match.index + match[0].length,
      type: 'tool-output',
      tool: match[1],
      content: match[2].trim()
    });
  }
  
  // Sort by position
  allMatches.sort((a, b) => a.start - b.start);
  
  // Build segments
  let currentPos = 0;
  for (const match of allMatches) {
    // Add text before this match
    if (match.start > currentPos) {
      const textBefore = text.substring(currentPos, match.start).trim();
      if (textBefore) {
        segments.push({ type: 'text', content: textBefore });
      }
    }
    
    // Add the match
    segments.push({
      type: match.type,
      content: match.content,
      tool: match.tool
    });
    
    if (match.type === 'log') {
      logs.push(match.content);
    }
    
    currentPos = match.end;
  }
  
  // Add remaining text
  if (currentPos < text.length) {
    const textAfter = text.substring(currentPos).trim();
    if (textAfter) {
      segments.push({ type: 'text', content: textAfter });
    }
  }
  
  // Rebuild content with proper tags
  const rebuilt = segments.map(seg => {
    if (seg.type === 'log') {
      return `<log>${seg.content}</log>`;
    } else if (seg.type === 'tool-output') {
      return `<tool-output tool="${seg.tool}">${seg.content}</tool-output>`;
    } else {
      // Clean up text segments
      let cleaned = seg.content;
      // Remove <input>...</input> lines (parameter descriptions)
      cleaned = cleaned.replace(/<input>.*?<\/input>/g, '');
      // Remove end_thinking tags
      cleaned = cleaned.replace(/<end_thinking>/g, '');
      // Remove Prolog stream operations
      cleaned = cleaned.replace(/open=\([^)]+\)[^\s]*/g, '');
      cleaned = cleaned.replace(/close=<stream>\([^)]+\)/g, '');
      // Remove technical markers
      cleaned = cleaned.replace(/^:-\s*/gm, '');
      // Remove status lines
      cleaned = cleaned.replace(/\*\*Agent exited normally\.\*\*/g, '');
      cleaned = cleaned.replace(/DML execution completed successfully\./g, '');
      return cleaned;
    }
  }).join('\n\n');
  
  // Final cleanup
  const processed = rebuilt
    .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
    .replace(/[ \t]+\n/g, '\n') // Remove trailing spaces
    .trim();

  return {
    content: processed,
    logs
  };
}

// Escape HTML
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Format file size
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Format relative date
export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

// Get file icon based on extension
export function getFileIcon(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const iconMap: Record<string, string> = {
    dml: '📝',
    txt: '📄',
    md: '📋',
    json: '⚙️',
    pdf: '📕',
    png: '🖼️',
    jpg: '🖼️',
    jpeg: '🖼️',
    gif: '🖼️',
    py: '🐍',
    js: '📜',
    ts: '📜',
    html: '🌐',
    css: '🎨',
    zip: '📦',
    tar: '📦',
    gz: '📦',
  };
  return iconMap[ext] || '📄';
}
