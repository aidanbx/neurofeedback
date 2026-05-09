import * as fs from 'fs';
import * as path from 'path';

type PortConfig = {
  host: string;
  frontend: number;
  backend: number;
};

function loadPortConfig(): PortConfig {
  const configPath = path.join(__dirname, '..', 'config', 'ports.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw) as PortConfig;
}

const portConfig = loadPortConfig();

export const APP_HOST = portConfig.host;
export const FRONTEND_PORT = portConfig.frontend;
export const BACKEND_PORT = portConfig.backend;
export const DEV_SERVER_URL = `http://${APP_HOST}:${FRONTEND_PORT}`;
