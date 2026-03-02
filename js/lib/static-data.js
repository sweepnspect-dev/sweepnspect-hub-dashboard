// ══════════════════════════════════════════════════════════
// Static Data Layer — GitHub Pages offline fallback
// Loads JSON snapshots when Hub server is unreachable
// ══════════════════════════════════════════════════════════
const StaticData = {
  _cache: {},
  _loaded: false,
  _syncTime: null,

  async load() {
    const files = ['subscribers', 'tickets', 'alerts', 'revenue', 'commands', 'livechat-sessions', 'snapshot'];
    const results = await Promise.allSettled(
      files.map(f => fetch(`data/${f}.json?_=${Date.now()}`).then(r => r.json()))
    );
    files.forEach((name, i) => {
      if (results[i].status === 'fulfilled') {
        this._cache[name] = results[i].value;
      } else {
        this._cache[name] = name === 'commands' ? { tasks: [], schedule: [] } : [];
      }
    });
    this._syncTime = this._cache.snapshot?.timestamp || null;
    this._loaded = true;
  },

  resolve(path) {
    const qIdx = path.indexOf('?');
    const base = qIdx >= 0 ? path.slice(0, qIdx) : path;
    const params = new URLSearchParams(qIdx >= 0 ? path.slice(qIdx + 1) : '');
    const parts = base.split('/');

    // subscribers
    if (parts[0] === 'subscribers' && parts.length === 1) {
      let subs = this._cache.subscribers || [];
      const status = params.get('status');
      if (status) subs = subs.filter(s => s.status === status);
      return subs;
    }

    // subscribers/:id/care
    if (parts[0] === 'subscribers' && parts[2] === 'care') {
      return this._computeCare(parts[1]);
    }

    // subscribers/:id
    if (parts[0] === 'subscribers' && parts.length === 2) {
      return (this._cache.subscribers || []).find(s => s.id === parts[1]) || null;
    }

    // tickets
    if (parts[0] === 'tickets' && parts.length === 1) {
      let tickets = this._cache.tickets || [];
      const status = params.get('status');
      if (status) tickets = tickets.filter(t => t.status === status);
      return tickets;
    }

    // tickets/:id
    if (parts[0] === 'tickets' && parts.length === 2) {
      return (this._cache.tickets || []).find(t => t.id === parts[1]) || null;
    }

    // alerts
    if (parts[0] === 'alerts') {
      const limit = parseInt(params.get('limit')) || 20;
      return (this._cache.alerts || []).slice(0, limit);
    }

    // revenue
    if (parts[0] === 'revenue') return this._cache.revenue || [];

    // clauser/status
    if (base === 'clauser/status') return { status: 'offline', ticketsProcessed: 0, uptime: 0 };

    // commands
    if (parts[0] === 'commands') return this._cache.commands || { tasks: [], schedule: [] };

    // stats
    if (parts[0] === 'stats') return this._cache.snapshot || {};

    // search
    if (parts[0] === 'search') {
      return this._search(params.get('q') || '');
    }

    return [];
  },

  _computeCare(subId) {
    const sub = (this._cache.subscribers || []).find(s => s.id === subId);
    if (!sub) return null;

    const tickets = (this._cache.tickets || []).filter(t => t.subscriberId === subId);
    const revenue = (this._cache.revenue || []).filter(r => r.subscriberId === subId);
    const openTickets = tickets.filter(t => !['resolved', 'closed'].includes(t.status));
    const totalRevenue = revenue.filter(r => r.type !== 'refund').reduce((s, r) => s + (r.amount || 0), 0);
    const refunds = revenue.filter(r => r.type === 'refund').reduce((s, r) => s + (r.amount || 0), 0);

    const timeline = [];
    tickets.forEach(t => timeline.push({
      type: t.status === 'resolved' ? 'resolved' : 'ticket',
      text: t.subject, date: t.createdAt, priority: t.priority, status: t.status
    }));
    revenue.forEach(r => timeline.push({
      type: 'revenue', text: `$${r.amount} ${r.type}`, date: r.date, amount: r.amount
    }));
    if (sub.startDate) {
      timeline.push({ type: 'subscriber', text: `${sub.name} joined`, date: sub.startDate });
    }
    timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

    const score = openTickets.length > 2 ? 40 : openTickets.length > 0 ? 70 : 100;
    const label = score <= 40 ? 'at-risk' : score <= 70 ? 'needs-attention' : 'healthy';

    return {
      subscriber: sub,
      health: { score, label },
      tickets: { total: tickets.length, open: openTickets.length, items: tickets },
      revenue: { mrr: sub.mrr || 0, total: totalRevenue, refunds, items: revenue },
      comms: { total: 0, items: [] },
      timeline
    };
  },

  _search(q) {
    q = (q || '').toLowerCase();
    if (q.length < 2) return { results: [], total: 0 };
    const results = [];

    (this._cache.subscribers || []).forEach(s => {
      if ((s.name || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q)) {
        results.push({ type: 'subscriber', title: s.name, subtitle: s.email, route: `#customers/${s.id}` });
      }
    });

    (this._cache.tickets || []).forEach(t => {
      if ((t.subject || '').toLowerCase().includes(q) || (t.description || '').toLowerCase().includes(q)) {
        results.push({ type: 'ticket', title: t.subject, subtitle: t.id, route: `#tickets/${t.id}` });
      }
    });

    return { results: results.slice(0, 15), total: results.length };
  }
};
