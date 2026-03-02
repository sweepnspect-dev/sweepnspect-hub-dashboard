// WebSocket wrapper with auto-reconnect and static fallback
class HubSocket {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.queue = [];
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.connected = false;
    this.staticMode = false;
    this._failCount = 0;

    // On GitHub Pages (or any non-Hub host), go straight to static mode
    if (location.hostname.includes('github.io') || location.hostname.includes('pages.dev')) {
      this.enterStaticMode();
    } else {
      this.connect();
    }
  }

  connect() {
    if (this._failCount >= 3) {
      this.enterStaticMode();
      return;
    }

    try {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.ws = new WebSocket(`${proto}//${location.host}/ws`);
    } catch (e) {
      this._failCount++;
      this.enterStaticMode();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      this._failCount = 0;
      this.reconnectDelay = 1000;
      this.emit('_connected');
      while (this.queue.length) {
        this.ws.send(JSON.stringify(this.queue.shift()));
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        this.emit(msg.type, msg.data, msg);
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._failCount++;
      this.emit('_disconnected');
      if (this._failCount >= 3) {
        this.enterStaticMode();
      } else {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      }
    };

    this.ws.onerror = () => {};
  }

  async enterStaticMode() {
    if (this.staticMode) return;
    this.staticMode = true;
    console.log('[Hub] Static mode — loading cached data from GitHub Pages');

    if (typeof StaticData !== 'undefined') {
      await StaticData.load();
      const stats = StaticData.resolve('stats');
      if (stats && stats.timestamp) this.emit('init', stats);
      this.emit('_static_mode', StaticData._syncTime);
    }
  }

  send(type, data) {
    if (this.staticMode) return;
    const msg = { type, data };
    if (this.connected && this.ws?.readyState === 1) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  on(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
    return () => { this.listeners[type] = this.listeners[type].filter(f => f !== fn); };
  }

  emit(type, ...args) {
    (this.listeners[type] || []).forEach(fn => fn(...args));
    (this.listeners['*'] || []).forEach(fn => fn(type, ...args));
  }
}

window.hubSocket = new HubSocket();
