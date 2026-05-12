'use client';
import { useEffect, useState } from 'react';

interface Props {
  running: boolean;
  status: { active: string | null; label: string } | null;
  onSubmit: (task: string) => Promise<void>;
  onChat: (message: string) => Promise<void>;
  hasRun: boolean;
}

type Mode = 'task' | 'chat';

export default function CommandBar({ running, status, onSubmit, onChat, hasRun }: Props): JSX.Element {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>('task');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!running) setBusy(false);
  }, [running]);

  const send = async () => {
    const t = input.trim();
    if (!t || busy || running) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'task') {
        await onSubmit(t);
      } else {
        await onChat(t);
      }
      setInput('');
    } catch (e: any) {
      setError(e?.message ?? 'request failed');
    } finally {
      // Always release the local lock once the POST returns. The live `running`
      // flag from polling takes over as the in-flight indicator.
      setBusy(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); }
  };

  const isDisabled = running || busy;
  const placeholder =
    mode === 'task'
      ? 'Ask anything or describe a task — the full swarm will deliberate…'
      : 'Quick follow-up — only the current leader replies…';

  const buttonLabel =
    running ? 'running…' :
    busy && mode === 'chat' ? 'thinking…' :
    busy ? 'starting…' :
    'Send →';

  const buttonClass =
    mode === 'task'
      ? 'bg-warn/20 text-warn border-warn/40 hover:bg-warn/30'
      : 'bg-sky-500/20 text-sky-300 border-sky-400/40 hover:bg-sky-500/30';

  return (
    <div className="border-t border-white/5 bg-panel/40 px-5 py-4">
      {/* Live status indicator */}
      {(running || (busy && mode === 'task')) && status && (
        <div className="mb-3 text-xs text-warn flex items-center gap-2">
          <span className="inline-flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-warn animate-pulse" />
            <span className="w-1 h-1 rounded-full bg-warn animate-pulse [animation-delay:120ms]" />
            <span className="w-1 h-1 rounded-full bg-warn animate-pulse [animation-delay:240ms]" />
          </span>
          {status.label}
        </div>
      )}

      {/* Chat thinking indicator */}
      {busy && mode === 'chat' && (
        <div className="mb-3 text-xs text-sky-400 flex items-center gap-2">
          <span className="inline-flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-sky-400 animate-pulse" />
            <span className="w-1 h-1 rounded-full bg-sky-400 animate-pulse [animation-delay:120ms]" />
            <span className="w-1 h-1 rounded-full bg-sky-400 animate-pulse [animation-delay:240ms]" />
          </span>
          Agents are responding…
        </div>
      )}

      {/* Mode tabs — only shown when there's a choice to make (after first run) */}
      {!running && hasRun && (
        <div className="flex gap-1 mb-3">
          <button
            onClick={() => { setMode('task'); setError(null); }}
            className={`text-[11px] px-3 py-1 rounded-full border transition ${
              mode === 'task'
                ? 'bg-warn/20 text-warn border-warn/40'
                : 'bg-white/5 text-white/40 border-white/10 hover:text-white/70'
            }`}
            title="Full swarm deliberation — all agents talk"
          >
            Full swarm
          </button>
          <button
            onClick={() => { setMode('chat'); setError(null); }}
            className={`text-[11px] px-3 py-1 rounded-full border transition ${
              mode === 'chat'
                ? 'bg-sky-500/20 text-sky-300 border-sky-400/40'
                : 'bg-white/5 text-white/40 border-white/10 hover:text-white/70'
            }`}
            title="Quick follow-up — only the current leader replies"
          >
            Quick ask
          </button>
        </div>
      )}

      {/* Input */}
      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          disabled={isDisabled}
          rows={2}
          className="flex-1 resize-none bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-white/90 placeholder:text-white/30 focus:outline-none focus:border-white/30 disabled:opacity-40 transition"
        />
        <button
          onClick={() => void send()}
          disabled={!input.trim() || isDisabled}
          className={`text-sm px-4 py-2.5 rounded-lg border transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap ${buttonClass}`}
        >
          {buttonLabel}
        </button>
      </div>

      {error && <div className="mt-2 text-xs text-bad">{error}</div>}
    </div>
  );
}
