'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { pathToFileURL } = require('url');


// ---------- Ajustes ----------
const NOMBRE = 'SYSTEM VENTAS PRO';
const SERVIDOR_ACTUALIZACIONES = process.env.SVP_UPDATE_URL || ''; // vacío = usa GitHub (ver package.json > build.publish)
const DIR_APP = path.join(__dirname, 'app');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

if (!app.requestSingleInstanceLock()) { app.quit(); }

let ventana = null;
const rutaConfig = () => path.join(app.getPath('userData'), 'config.json');
function leerConfig() { try { return JSON.parse(fs.readFileSync(rutaConfig(), 'utf8')); } catch (e) { return {}; } }
function guardarConfig(c) { try { fs.mkdirSync(path.dirname(rutaConfig()), { recursive: true }); fs.writeFileSync(rutaConfig(), JSON.stringify(c, null, 2)); } catch (e) {} }

function carpetaPrincipal() {
  const dir = process.env.SVP_RESPALDOS || path.join(app.getPath('documents'), 'SystemVentasPro', 'Respaldos');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function carpetaExtra() {
  const c = leerConfig();
  return c.carpetaExtra && fs.existsSync(c.carpetaExtra) ? c.carpetaExtra : (c.carpetaExtra || null);
}
const reNombre = /^SystemVentasPro_(ACTUAL|\d{4}-\d{2}-\d{2})\.json$/;

function escribirAtomico(ruta, texto) {
  const tmp = ruta + '.tmp';
  fs.writeFileSync(tmp, texto, 'utf8');
  fs.renameSync(tmp, ruta);
}
function limpiarDiarias(dir, conservar) {
  try {
    const diarias = fs.readdirSync(dir).filter(n => /^SystemVentasPro_\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
    for (const n of diarias.slice(0, Math.max(0, diarias.length - Math.max(1, conservar | 0)))) { try { fs.unlinkSync(path.join(dir, n)); } catch (e) {} }
  } catch (e) {}
}

// ---------- Protocolo app:// (origen fijo: los datos no se pierden al actualizar) ----------
function registrarProtocolo() {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const abs = path.normalize(path.join(DIR_APP, rel));
    if (!abs.startsWith(DIR_APP)) return new Response('No permitido', { status: 403 });
    return net.fetch(pathToFileURL(abs).toString());
  });
}

// ---------- Ventana ----------
function crearVentana() {
  ventana = new BrowserWindow({
    width: 1366, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#0b0f1a', title: NOMBRE, show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  Menu.setApplicationMenu(null);
  ventana.on('page-title-updated', (e) => e.preventDefault());
  ventana.setTitle(NOMBRE);
  ventana.once('ready-to-show', () => { ventana.show(); if (process.env.SVP_MAXIMIZAR !== '0') ventana.maximize(); });
  ventana.loadURL('app://local/index.html');
  // enlaces externos al navegador; impresión y ventanas propias de la app se permiten
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  ventana.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  ventana.on('closed', () => { ventana = null; });
}

// ---------- IPC: respaldos ----------
ipcMain.handle('svp:info', () => ({ carpetaPrincipal: carpetaPrincipal(), carpetaExtra: carpetaExtra(), plataforma: process.platform, version: app.getVersion() }));

ipcMain.handle('svp:guardar-respaldo', (_e, texto, fechaISO, dias) => {
  const rutas = [], errores = [];
  if (typeof texto !== 'string' || texto.length < 20) return { ok: false, error: 'respaldo vacío' };
  const fecha = /^\d{4}-\d{2}-\d{2}$/.test(fechaISO || '') ? fechaISO : new Date().toISOString().slice(0, 10);
  const destinos = [carpetaPrincipal()];
  const ex = carpetaExtra(); if (ex) destinos.push(ex);
  destinos.forEach((dir, i) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      escribirAtomico(path.join(dir, 'SystemVentasPro_ACTUAL.json'), texto);
      escribirAtomico(path.join(dir, 'SystemVentasPro_' + fecha + '.json'), texto);
      limpiarDiarias(dir, dias || 30);
      rutas.push(dir);
    } catch (err) { if (i === 0) errores.push(String(err.message || err)); }
  });
  if (!rutas.length) return { ok: false, error: errores[0] || 'no se pudo guardar' };
  return { ok: true, rutas };
});

ipcMain.handle('svp:listar-respaldos', () => {
  const dir = carpetaPrincipal();
  return fs.readdirSync(dir).filter(n => reNombre.test(n)).sort().map(n => {
    const st = fs.statSync(path.join(dir, n));
    return { nombre: n, fecha: st.mtime.toISOString(), bytes: st.size };
  });
});
ipcMain.handle('svp:leer-respaldo', (_e, nombre) => {
  if (!reNombre.test(String(nombre))) throw new Error('nombre no válido');
  return fs.readFileSync(path.join(carpetaPrincipal(), nombre), 'utf8');
});
ipcMain.handle('svp:elegir-extra', async () => {
  const r = await dialog.showOpenDialog(ventana, { title: 'Carpeta adicional para respaldos', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const c = leerConfig(); c.carpetaExtra = r.filePaths[0]; guardarConfig(c);
  return { ok: true, carpeta: r.filePaths[0] };
});
ipcMain.handle('svp:quitar-extra', () => { const c = leerConfig(); delete c.carpetaExtra; guardarConfig(c); });
ipcMain.handle('svp:abrir-carpeta', () => shell.openPath(carpetaPrincipal()));

// ---------- IPC: licencia / huella ----------
const rutaLic = () => path.join(app.getPath('userData'), 'estado.dat');
ipcMain.handle('svp:lic-leer', () => { try { return fs.readFileSync(rutaLic(), 'utf8'); } catch (e) { return null; } });
ipcMain.handle('svp:lic-guardar', (_e, txt) => { try { escribirAtomico(rutaLic(), String(txt)); return true; } catch (e) { return false; } });
ipcMain.handle('svp:huella', () => {
  const macs = Object.values(os.networkInterfaces()).flat().filter(i => i && !i.internal && i.mac && i.mac !== '00:00:00:00:00:00').map(i => i.mac).sort();
  const base = [os.hostname(), os.platform(), os.arch(), (os.cpus()[0] || {}).model || '', macs[0] || '', os.userInfo().username].join('|');
  return crypto.createHash('sha256').update('svp|' + base).digest('hex');
});

// ---------- Actualizaciones (estilo tienda de apps) ----------
let autoUpdater = null;
let estadoUpd = { estado: 'inactivo', version: app.getVersion() };
function emitirUpd(s) { estadoUpd = Object.assign({}, estadoUpd, s); if (ventana && !ventana.isDestroyed()) ventana.webContents.send('svp:upd', estadoUpd); }

function iniciarActualizador() {
  if (!app.isPackaged && !process.env.SVP_FORZAR_UPDATER) return;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  if (SERVIDOR_ACTUALIZACIONES) autoUpdater.setFeedURL({ provider: 'generic', url: SERVIDOR_ACTUALIZACIONES });
  autoUpdater.on('checking-for-update', () => emitirUpd({ estado: 'buscando' }));
  autoUpdater.on('update-available', (i) => emitirUpd({ estado: 'descargando', nueva: i.version, progreso: 0 }));
  autoUpdater.on('update-not-available', () => emitirUpd({ estado: 'al-dia' }));
  autoUpdater.on('download-progress', (p) => emitirUpd({ estado: 'descargando', progreso: Math.round(p.percent || 0) }));
  autoUpdater.on('update-downloaded', (i) => emitirUpd({ estado: 'lista', nueva: i.version }));
  autoUpdater.on('error', (err) => emitirUpd({ estado: 'error', error: String(err && err.message || err) }));
  const buscar = () => { try { autoUpdater.checkForUpdates().catch(() => {}); } catch (e) {} };
  setTimeout(buscar, 8000);
  setInterval(buscar, 4 * 60 * 60 * 1000);
}
ipcMain.handle('svp:version', () => app.getVersion());
ipcMain.handle('svp:upd-estado', () => estadoUpd);
ipcMain.handle('svp:upd-buscar', () => { if (!autoUpdater) { emitirUpd({ estado: 'al-dia' }); return estadoUpd; } try { autoUpdater.checkForUpdates().catch(() => {}); } catch (e) {} return estadoUpd; });
ipcMain.handle('svp:upd-instalar', async () => {
  if (!autoUpdater || estadoUpd.estado !== 'lista') return false;
  // 1) pedir a la app que haga un respaldo completo; 2) esperar (máx. 8 s); 3) instalar y reabrir
  await new Promise((resolve) => {
    const fin = () => { clearTimeout(t); ipcMain.removeListener('svp:actualizacion-lista', fin); resolve(); };
    const t = setTimeout(fin, 8000);
    ipcMain.once('svp:actualizacion-lista', fin);
    if (ventana && !ventana.isDestroyed()) ventana.webContents.send('svp:preparar-actualizacion'); else fin();
  });
  autoUpdater.quitAndInstall(false, true);
  return true;
});

app.on('second-instance', () => { if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); } });
app.whenReady().then(() => {
  registrarProtocolo();
  crearVentana();
  iniciarActualizador();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) crearVentana(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
