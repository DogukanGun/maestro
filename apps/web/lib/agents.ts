export interface AgentStyle {
  color: string;
  bubbleBorder: string;
  bubbleBg: string;
  ring: string;
  initials: string;
  emoji: string;
  displayName: string;
}

const PALETTE: Record<string, Omit<AgentStyle, 'initials' | 'displayName'>> = {
  amber: {
    color: 'text-amber-300',
    bubbleBorder: 'border-amber-400/30',
    bubbleBg: 'bg-amber-500/10',
    ring: 'ring-amber-400/40',
    emoji: '👑',
  },
  rose: {
    color: 'text-rose-300',
    bubbleBorder: 'border-rose-400/30',
    bubbleBg: 'bg-rose-500/10',
    ring: 'ring-rose-400/40',
    emoji: '🛡️',
  },
  sky: {
    color: 'text-sky-300',
    bubbleBorder: 'border-sky-400/30',
    bubbleBg: 'bg-sky-500/10',
    ring: 'ring-sky-400/40',
    emoji: '⚖️',
  },
  violet: {
    color: 'text-violet-300',
    bubbleBorder: 'border-violet-400/30',
    bubbleBg: 'bg-violet-500/10',
    ring: 'ring-violet-400/40',
    emoji: '🤖',
  },
  emerald: {
    color: 'text-emerald-300',
    bubbleBorder: 'border-emerald-400/30',
    bubbleBg: 'bg-emerald-500/10',
    ring: 'ring-emerald-400/40',
    emoji: '🧠',
  },
};

const KNOWN: Record<string, { paletteKey: keyof typeof PALETTE; displayName: string; initialsOverride?: string }> = {
  leader: { paletteKey: 'amber', displayName: 'Coordinator' },
  risk: { paletteKey: 'rose', displayName: 'Critic' },
  compliance: { paletteKey: 'sky', displayName: 'Strategist' },
  market: { paletteKey: 'violet', displayName: 'Analyst' },
  user: { paletteKey: 'emerald', displayName: 'You', initialsOverride: 'U' },
};

const FALLBACK_KEYS: (keyof typeof PALETTE)[] = ['violet', 'emerald', 'amber', 'rose', 'sky'];

const stableHash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const styleFor = (agentId: string): AgentStyle => {
  const known = KNOWN[agentId];
  const initials = known?.initialsOverride ?? (agentId.match(/[A-Za-z0-9]/g) ?? ['?'])[0]!.toUpperCase();
  if (known) {
    return { ...PALETTE[known.paletteKey]!, initials, displayName: known.displayName };
  }
  const key = FALLBACK_KEYS[stableHash(agentId) % FALLBACK_KEYS.length]!;
  return { ...PALETTE[key]!, initials, displayName: agentId };
};
