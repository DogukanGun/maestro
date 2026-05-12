import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function findDemoBin(): { script: string; cwd: string } | null {
  const fromEnv = process.env.AGENTRAFT_DEMO_BIN;
  if (fromEnv && existsSync(fromEnv)) {
    return { script: fromEnv, cwd: resolve(fromEnv, '..', '..') };
  }
  const candidates = [
    resolve(process.cwd(), '../treasury-demo/dist/index.js'),
    resolve(process.cwd(), '../../apps/treasury-demo/dist/index.js'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return { script: c, cwd: resolve(c, '..', '..') };
  }
  return null;
}

interface StartBody {
  task?: string;
  model?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'OPENAI_API_KEY is not set. Add it to your .env file and restart the server.',
      },
      { status: 400 }
    );
  }

  const bin = findDemoBin();
  if (!bin) {
    return NextResponse.json(
      { ok: false, error: 'demo binary not found — build treasury-demo first' },
      { status: 500 }
    );
  }

  let body: StartBody = {};
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  const task = (body.task ?? '').trim();
  if (!task) {
    return NextResponse.json({ ok: false, error: 'task is required' }, { status: 400 });
  }
  if (task.length > 500) {
    return NextResponse.json(
      { ok: false, error: 'task too long (max 500 chars)' },
      { status: 400 }
    );
  }

  const args: string[] = [bin.script, '--task', task];
  if (body.model) args.push('--model', body.model);

  const logDir = join(bin.cwd, 'runs');
  mkdirSync(logDir, { recursive: true });
  const logPath = join(logDir, '_spawner.log');

  // Open the log file as a real fd and pass it directly to the child as stdout/stderr.
  // This avoids tying the child's lifetime to this parent process via pipes —
  // SIGPIPE on parent death would otherwise kill the child mid-run.
  const logFd = openSync(logPath, 'a');
  const child = spawn(process.execPath, args, {
    cwd: bin.cwd,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  closeSync(logFd); // child has dup'd the fd; we no longer need it
  child.unref();

  return NextResponse.json({ ok: true, task, pid: child.pid });
}
