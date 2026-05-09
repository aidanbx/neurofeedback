import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { APP_HOST, BACKEND_PORT } from './appConfig';

let proc: ChildProcess | null = null;

export function startPython(projectRoot: string): void {
  // __dirname when compiled is electron-dist/, so projectRoot = eeg/
  const backendDir = path.join(projectRoot, 'backend');
  proc = spawn(
    'conda',
    ['run', '-n', 'eeg', 'uvicorn', 'eeg_backend.api.main:app', '--host', APP_HOST, '--port', String(BACKEND_PORT)],
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
