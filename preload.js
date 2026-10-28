'use strict';
// Puente seguro entre la aplicación (pantalla) y el sistema de la computadora.
const { contextBridge, ipcRenderer } = require('electron');

let alPrepararActualizacion = null;
ipcRenderer.on('svp:preparar-actualizacion', async () => {
  try { if (alPrepararActualizacion) await alPrepararActualizacion(); } catch (e) {}
  ipcRenderer.send('svp:actualizacion-lista');
});

contextBridge.exposeInMainWorld('svpNative', {
  esEscritorio: true,
  info: () => ipcRenderer.invoke('svp:info'),
  guardarRespaldo: (texto, fechaISO, dias) => ipcRenderer.invoke('svp:guardar-respaldo', texto, fechaISO, dias),
  listarRespaldos: () => ipcRenderer.invoke('svp:listar-respaldos'),
  leerRespaldo: (nombre) => ipcRenderer.invoke('svp:leer-respaldo', nombre),
  elegirCarpetaExtra: () => ipcRenderer.invoke('svp:elegir-extra'),
  quitarCarpetaExtra: () => ipcRenderer.invoke('svp:quitar-extra'),
  abrirCarpetaRespaldos: () => ipcRenderer.invoke('svp:abrir-carpeta'),
  leerEstadoLicencia: () => ipcRenderer.invoke('svp:lic-leer'),
  guardarEstadoLicencia: (txt) => ipcRenderer.invoke('svp:lic-guardar', txt),
  huellaEquipo: () => ipcRenderer.invoke('svp:huella'),
  // ---- actualizaciones ----
  version: () => ipcRenderer.invoke('svp:version'),
  estadoActualizacion: () => ipcRenderer.invoke('svp:upd-estado'),
  buscarActualizacion: () => ipcRenderer.invoke('svp:upd-buscar'),
  instalarActualizacion: () => ipcRenderer.invoke('svp:upd-instalar'),
  onActualizacion: (cb) => { ipcRenderer.on('svp:upd', (_e, s) => { try { cb(s); } catch (e) {} }); },
  // la app registra aquí cómo hacer su respaldo justo antes de actualizarse
  antesDeActualizar: (fn) => { alPrepararActualizacion = fn; }
});
