const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pet', {
  // 화면 오류를 감지 기록으로 보낸다 (문제 원인 확인용). 페이지 쪽에서 오류를 받아 넘겨 준다.
  reportError: message => ipcRenderer.send('pet:error', 'pet', String(message)),
  moveBy: (dx, dy) => ipcRenderer.send('pet:move-by', dx, dy),
  startDrag: () => ipcRenderer.send('pet:drag-start'),
  dragMove: () => ipcRenderer.send('pet:drag-move'),
  endDrag: () => ipcRenderer.send('pet:drag-end'),
  setInteractive: hit => ipcRenderer.send('pet:interactive', hit),
  focusProvider: provider => ipcRenderer.invoke('pet:focus-provider', provider),
  showMenu: () => ipcRenderer.send('pet:menu'),
  getConfig: () => ipcRenderer.invoke('pet:get-config'),
  onConfig: handler => ipcRenderer.on('pet:config', (_, config) => handler(config)),
  onWalk: handler => ipcRenderer.on('pet:walk', (_, dir) => handler(dir)),
  onStatus: handler => ipcRenderer.on('pet:status', (_, status) => handler(status)),
  onCursor: handler => ipcRenderer.on('pet:cursor', (_, c) => handler(c)),
  onViewport: handler => ipcRenderer.on('pet:viewport', (_, viewport) => handler(viewport)),
  rename: name => ipcRenderer.send('pet:rename', name),
  setNapping: value => ipcRenderer.send('pet:napping', value),
  setPlaying: value => ipcRenderer.send('pet:playing', value),
  onPlay: handler => ipcRenderer.on('pet:play', (_, id) => handler(id)),
  onIdle: handler => ipcRenderer.on('pet:idle', (_, seconds) => handler(seconds)),
})
