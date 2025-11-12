import { useEffect, useRef } from 'react';
import { useChatStore } from '../../stores/useChatStore';
import { Message, StreamingMessage } from './Message';

export function MessageList() {
  const messages = useChatStore((state) => state.messages);
  const streamingMessage = useChatStore((state) => state.streamingMessage);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTimeoutRef = useRef<number | null>(null);

  // Auto-scroll when messages change or streaming content updates
  // Use throttled scrolling to avoid performance issues with rapid updates
  useEffect(() => {
    // Clear any pending scroll
    if (scrollTimeoutRef.current) {
      cancelAnimationFrame(scrollTimeoutRef.current);
    }

    // Schedule scroll for next animation frame (throttles to ~60fps max)
    scrollTimeoutRef.current = requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });

    return () => {
      if (scrollTimeoutRef.current) {
        cancelAnimationFrame(scrollTimeoutRef.current);
      }
    };
  }, [messages.length, streamingMessage]); // Only react to message count and streaming state, not content

  if (messages.length === 0) {
    return (
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
        <WelcomeMessage />
      </div>
    );
  }

  return (
    <div 
      ref={scrollRef} 
      className="flex-1 overflow-y-auto px-6 py-6"
      style={{ 
        scrollBehavior: 'auto',
        overflowAnchor: 'auto'
      }}
    >
      <div className="max-w-5xl mx-auto streaming-container">
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
        <StreamingMessage />
      </div>
    </div>
  );
}

function WelcomeMessage() {
  return (
    <div className="max-w-3xl mx-auto my-8 animate-fade-in-up">
      <div className="text-center mb-10">
        <img
          src="assets/logo_only.png"
          alt="DeepClause"
          className="h-24 mx-auto mb-6 grayscale contrast-125 opacity-90"
        />
        <h2 className="text-4xl font-bold text-deepclause-primary mb-3">
          Welcome to DeepClause
        </h2>
        <p className="text-lg text-text-secondary">
          The Missing Logic Agent
        </p>
      </div>

      <div className="bg-bg-medium/30 border border-border/30 rounded-2xl p-6 shadow-lg backdrop-blur-sm">
        <h3 className="text-base font-semibold mb-4 text-text-primary flex items-center gap-2">
          <span className="text-xl">💡</span>
          <span>Quick Start</span>
        </h3>

        <div className="space-y-2">
          <div className="flex items-start gap-2.5 p-2.5 bg-bg-darkest/50 rounded-lg border border-border/20 hover:border-deepclause-primary/30 transition-colors">
            <span className="text-deepclause-primary font-bold text-base mt-0.5 shrink-0">→</span>
            <span className="text-sm leading-relaxed">I am a logic agent that uses neurosymbolic AI. All my skills are encoded as DML (DeepClause Meta Language) code. When you ask me to do something I will look for existing DML code that matches your request or create new DML code on the fly. Enter any natural language request to get started and explore. You can also ask me to modify existing skills or add them to my skill creation context, so that they may be reused when I create new skills.</span>
          </div>
          <div className="flex items-start gap-2.5 p-2.5 bg-bg-darkest/50 rounded-lg border border-border/20 hover:border-deepclause-primary/30 transition-colors">
            <span className="text-deepclause-primary font-bold text-base mt-0.5 shrink-0">→</span>
            <span className="text-sm leading-relaxed">If you want to create a new skill directly, you can use the <code>/create [prompt]</code> command, e.g. /create build a tool to help me find clinical trial data for a given diseases and trial phase. You can also write a prompt in a .md file first and then run <code>/create :[filename]</code></span>
          </div>
          <div className="flex items-start gap-2.5 p-2.5 bg-bg-darkest/50 rounded-lg border border-border/20 hover:border-deepclause-primary/30 transition-colors">
            <span className="text-deepclause-primary font-bold text-base mt-0.5 shrink-0">→</span>
            <span className="text-sm leading-relaxed">
              Use <code className="bg-bg-darkest px-1.5 py-0.5 rounded text-xs font-mono border border-border/50 text-deepclause-primary">/run [dml_file]</code> to directly use a skill.
            </span>
          </div>
          <div className="flex items-start gap-2.5 p-2.5 bg-bg-darkest/50 rounded-lg border border-border/20 hover:border-deepclause-primary/30 transition-colors">
            <span className="text-deepclause-primary font-bold text-base mt-0.5 shrink-0">→</span>
            <span className="text-sm leading-relaxed">
              Use <code className="bg-bg-darkest px-1.5 py-0.5 rounded text-xs font-mono border border-border/50 text-deepclause-primary">/explain</code> after running a skill to get a plain-English explanation of what happened, including which decisions were made by symbolic logic vs AI.
            </span>
          </div>
          <div className="flex items-start gap-2.5 p-2.5 bg-bg-darkest/50 rounded-lg border border-border/20 hover:border-deepclause-primary/30 transition-colors">
            <span className="text-deepclause-primary font-bold text-base mt-0.5 shrink-0">→</span>
            <span className="text-sm leading-relaxed">
              Use <code className="bg-bg-darkest px-1.5 py-0.5 rounded text-xs font-mono border border-border/50 text-deepclause-primary">/learn [dml_file]</code> to make a skill become part of my context when I create new skills.
            </span>
          </div>
          <div className="flex items-start gap-2.5 p-2.5 bg-bg-darkest/50 rounded-lg border border-border/20 hover:border-deepclause-primary/30 transition-colors">
            <span className="text-deepclause-primary font-bold text-base mt-0.5 shrink-0">→</span>
            <span className="text-sm leading-relaxed">Click files in the sidebars to interact with them. On the left you can view and edit all available DML skills. On the right hand side you can find the workspace directory, where I can read and write files. You can also view and edit markdown files in the workspace.</span>
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-border/30 text-center">
          <p className="text-xs text-text-secondary">
            Type <code className="bg-bg-darkest px-1.5 py-0.5 rounded text-xs font-mono border border-border/50">/help</code> for more commands
          </p>
        </div>
      </div>
    </div>
  );
}
