import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

let proc: ChildProcess | null = null;

export function startPython(projectRoot: string): void {
  const backendDir = path.join(projectRoot, 'backend');
  proc = spawn(
    'conda',
    ['run', '-n', 'eeg', 'uvicorn', 'eeg_backend.api.main:app', '--host', '127.0.0.1', '--port', '8765'],
    {
      cwd: backendDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    },
  );

  proc.stdout?.on('data', (d: Buffer) => console.log('[python]', d.toString().trim()));
  proc.stderr?.on('data', (d: Buffer) => console.error('[python]', d.toString().trim()));
  proc.on('exit', (code) => console.log('[python] exited', code));
}

export function stopPython(): void {
  if (proc && !proc.killed) {
    proc.kill('SIGTERM');
    proc = null;
  }
}
