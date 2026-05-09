import portConfig from '../../../config/ports.json';

export const APP_HOST = portConfig.host;
export const FRONTEND_PORT = portConfig.frontend;
export const BACKEND_PORT = portConfig.backend;
export const BACKEND_HTTP_ORIGIN = `http://${APP_HOST}:${BACKEND_PORT}`;
export const BACKEND_WS_ORIGIN = `ws://${APP_HOST}:${BACKEND_PORT}`;
