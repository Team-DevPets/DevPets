// 설정 창(컨트롤센터) 전용 연결. 펫 창의 preload.js 와 따로 두어 필요한 기능만 연다.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('settings', {
  reportError: message => ipcRenderer.send('pet:error', 'settings', String(message)),
  getState: () => ipcRenderer.invoke('settings:get-state'),
  getSprite: () => ipcRenderer.invoke('settings:get-sprite'),
  action: (name, ...args) => ipcRenderer.invoke('settings:action', name, args),
  onState: handler => ipcRenderer.on('settings:state', (_, state) => handler(state)),
  onNavigate: handler => ipcRenderer.on('settings:navigate', (_, page) => handler(page)),
})
