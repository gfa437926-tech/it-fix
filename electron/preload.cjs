// Minimal, isolated preload bridge for the desktop shell.
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('itFixDesktop', Object.freeze({ platform: process.platform }));
