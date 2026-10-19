// Proxy Vercel -> panel Katabump (évite le blocage https -> http)
const TARGET = process.env.PANEL_URL || "http://51.68.234.157:20261";

module.exports = async (req, res) => {
  const p = [].concat(req.query.path || []).join("/");
  try {
    const r = await fetch(`${TARGET}/api/${p}`, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body: req.method === "POST" ? JSON.stringify(req.body || {}) : undefined,
      signal: AbortSignal.timeout(25000),
    });
    const txt = await r.text();
    res.status(r.status);
    res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.send(txt);
  } catch (e) {
    res.status(502).json({ error: "Panel injoignable (" + ((e.cause && e.cause.code) || e.name) + ") : " + e.message });
  }
};
