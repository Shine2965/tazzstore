let requests = {};
let burst = {};
let blacklist = new Set();

// ===== CONFIG =====
const MAX_REQUEST = 3;              // Maksimal request per menit
const WINDOW_MS = 60 * 1000;         // 1 menit

const BURST_LIMIT = 3;              // Maksimal request cepat
const BURST_WINDOW = 5000;           // 5 detik

// ===== TELEGRAM =====
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// ===== CLOUDFLARE =====
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ZONE_ID = "ff68faf37e1fcf258de1def5a8210848";

// ===== GET IP =====
function getIP(req) {
  return (
    req.headers["cf-connecting-ip"] ||
    req.headers["x-real-ip"] ||
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

// ===== TELEGRAM =====
async function sendTelegram(message) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message
      })
    });
  } catch (err) {
    console.error("Telegram error:", err);
  }
}

// ===== CLOUDFLARE BLOCK =====
async function blockIPCloudflare(ip) {
  if (!CF_API_TOKEN) return;

  try {
    await fetch(
      `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/firewall/access_rules/rules`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${CF_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          mode: "block",
          configuration: {
            target: "ip",
            value: ip
          },
          notes: "Auto blocked by Security Tazz Store"
        })
      }
    );

    console.log("Cloudflare blocked:", ip);
  } catch (err) {
    console.error("Cloudflare error:", err);
  }
}

// ===== HANDLER =====
export default async function handler(req, res) {
  const ip = getIP(req);
  const now = Date.now();

  const ua = req.headers["user-agent"] || "Unknown";
  const url = req.url || "/";

  // ===== RATE LIMIT =====
  if (!requests[ip]) requests[ip] = [];

  requests[ip].push(now);

  requests[ip] = requests[ip].filter(
    t => now - t < WINDOW_MS
  );

  if (requests[ip].length > MAX_REQUEST) {
    blacklist.add(ip);

    await blockIPCloudflare(ip);

    await sendTelegram(
`🚫 RATE LIMIT

IP: ${ip}
Request: ${requests[ip].length}/menit

URL:
${url}

User-Agent:
${ua}`
    );

    return res.status(429).json({
      status: "limit",
      message: "Rate limit"
    });
  }

  // ===== BURST DETECTION =====
  if (!burst[ip]) burst[ip] = [];

  burst[ip].push(now);

  burst[ip] = burst[ip].filter(
    t => now - t < BURST_WINDOW
  );

  if (burst[ip].length > BURST_LIMIT) {
    blacklist.add(ip);

    await blockIPCloudflare(ip);

    await sendTelegram(
`🔥 DDOS DETECTED

IP: ${ip}
Burst: ${burst[ip].length}/5 detik

URL:
${url}

User-Agent:
${ua}`
    );

    return res.status(403).json({
      status: "ddos",
      message: "DDoS detected"
    });
  }

  // ===== CLEANUP MEMORY =====
  if (Math.random() < 0.01) {
    const limit = now - WINDOW_MS;

    for (const key in requests) {
      requests[key] = requests[key].filter(t => t > limit);
      if (requests[key].length === 0) delete requests[key];
    }

    for (const key in burst) {
      burst[key] = burst[key].filter(t => now - t < BURST_WINDOW);
      if (burst[key].length === 0) delete burst[key];
    }
  }

  // ===== RESPONSE =====
  return res.status(200).json({
    status: "ok",
    ip
  });
}
