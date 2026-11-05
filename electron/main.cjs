const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');

const isDev = !app.isPackaged;

function openExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return shell.openExternal(url.toString());
    }
  } catch {
    // Ignore malformed or unsupported URLs.
  }
  return Promise.resolve();
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: 'IT Fix - Asset Management',
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  });

  // Keep the application inside its trusted local/dev origin.
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    let isTrustedDevOrigin = false;
    try {
      isTrustedDevOrigin = isDev && new URL(navigationUrl).origin === 'http://localhost:3000';
    } catch {
      isTrustedDevOrigin = false;
    }
    if (!isTrustedDevOrigin) {
      event.preventDefault();
      void openExternalUrl(navigationUrl);
    }
  });

  // Block redirects as well as direct navigation outside the trusted app origin.
  win.webContents.on('will-redirect', (event, redirectUrl) => {
    let isTrustedDevOrigin = false;
    try {
      isTrustedDevOrigin = isDev && new URL(redirectUrl).origin === 'http://localhost:3000';
    } catch {
      isTrustedDevOrigin = false;
    }
    if (!isTrustedDevOrigin) {
      event.preventDefault();
      void openExternalUrl(redirectUrl);
    }
  });

  // Open ordinary web links in the user's default browser, never a new app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url);
    return { action: 'deny' };
  });

  if (isDev) {
    void win.loadURL('http://localhost:3000');
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
