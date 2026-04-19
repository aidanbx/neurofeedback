"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPython = startPython;
exports.stopPython = stopPython;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
let proc = null;
function startPython(projectRoot) {
    // __dirname when compiled is electron-dist/, so projectRoot = eeg/
    const backendDir = path.join(projectRoot, 'backend');
    proc = (0, child_process_1.spawn)('conda', ['run', '-n', 'eeg', 'uvicorn', 'eeg_backend.api.main:app', '--host', '127.0.0.1', '--port', '8765'], {
        cwd: backendDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
    });
    proc.stdout?.on('data', (d) => console.log('[python]', d.toString().trim()));
    proc.stderr?.on('data', (d) => console.error('[python]', d.toString().trim()));
    proc.on('exit', (code) => console.log('[python] exited', code));
}
function stopPython() {
    if (proc && !proc.killed) {
        proc.kill('SIGTERM');
        proc = null;
    }
}
