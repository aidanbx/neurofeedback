import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const portConfigPath = path.join(__dirname, '..', 'config', 'ports.json');
const portConfig = JSON.parse(fs.readFileSync(portConfigPath, 'utf8'));
const HOST = portConfig.host;
const PORT = portConfig.backend;
const backendDir = path.join(__dirname, '..', 'backend');
const uvicornArgs = [
  'run', '-n', 'eeg',
  'uvicorn', 'eeg_backend.api.main:app',
  '--host', HOST,
  '--port', String(PORT),
  '--reload',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: HOST, port: PORT });
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function backendHealthy() {
  try {
    const response = await fetch(`http://${HOST}:${PORT}/api/state`, { signal: AbortSignal.timeout(500) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForPortRelease(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await canConnect())) return true;
    await sleep(250);
  }
  return !(await canConnect());
}

function waitUntilKilled() {
  return new Promise((resolve) => {
    const stop = () => resolve();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

async function reuseRunningBackend() {
  console.log(`[dev-backend] Reusing backend already running at http://${HOST}:${PORT}.`);
  await waitUntilKilled();
}

async function launchBackend() {
  let retriedAfterPortConflict = false;

  while (true) {
    const child = spawn('conda', uvicornArgs, {
      cwd: backendDir,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stderr = '';

    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
      process.stderr.write(chunk);
    });

    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
      process.once('SIGINT', () => child.kill('SIGINT'));
      process.once('SIGTERM', () => child.kill('SIGTERM'));
    });

    const addressInUse = stderr.includes('Address already in use');
    if (!addressInUse) {
      process.exit(exitCode ?? 0);
    }

    if (await backendHealthy()) {
      await reuseRunningBackend();
      process.exit(0);
    }

    if (!retriedAfterPortConflict) {
      console.warn(`[dev-backend] Port ${PORT} is busy but not serving the backend yet. Waiting briefly and retrying.`);
      const released = await waitForPortRelease();
      if (released) {
        retriedAfterPortConflict = true;
        continue;
      }
    }

    console.error(`[dev-backend] Port ${PORT} is still unavailable. Stop the process using it and try again.`);
    process.exit(exitCode ?? 1);
  }
}

if (await backendHealthy()) {
  await reuseRunningBackend();
} else {
  await launchBackend();
}
