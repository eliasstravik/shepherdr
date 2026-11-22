declare module '@novnc/novnc' {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string | WebSocket, options?: { credentials?: { password?: string }; wsProtocols?: string[] })
    viewOnly: boolean
    scaleViewport: boolean
    clipViewport: boolean
    dragViewport: boolean
    resizeSession: boolean
    background: string
    focusOnClick: boolean
    disconnect(): void
    focus(): void
    blur(): void
    sendKey(keysym: number, code: string | null, down?: boolean): void
    sendCtrlAltDel(): void
    clipboardPasteFrom(text: string): void
    toDataURL(type?: string, quality?: number): string
  }
}
