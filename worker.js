import { DurableObject } from "cloudflare:workers";

const DEFAULT_FIELDS = 5;
const MAX_FIELDS = 30;
const MAX_NAME = 50;
const MAX_TEXT = 20000;

function defaultPayload() {
  return {
    memo: "",
    phrases: [],
    history: [],
    fields: Array.from({ length: DEFAULT_FIELDS }, (_, i) => ({
      id: crypto.randomUUID(),
      name: `フィールド${i + 1}`,
      text: "",
      color: ""
    })),
    updatedAt: ""
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function roomNameFromKey(key) {
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function validatePayload(input) {
  if (!input || !Array.isArray(input.fields)) throw new Error("fields が必要です");
  if (input.fields.length > MAX_FIELDS) throw new Error(`フィールドは最大${MAX_FIELDS}個です`);

  const fields = input.fields.map((f, i) => {
    const name = String(f?.name ?? `フィールド${i + 1}`).slice(0, MAX_NAME);
    const text = String(f?.text ?? "").slice(0, MAX_TEXT);
    const color = String(f?.color ?? "").slice(0, 20);
    const id = String(f?.id ?? crypto.randomUUID()).slice(0, 100);
    return { id, name, text, color };
  });

  const memo = String(input?.memo ?? "").slice(0, 5000);
  const phrases = Array.isArray(input?.phrases) ? input.phrases.slice(0,100).map((p,i)=>({
    id:String(p?.id ?? crypto.randomUUID()).slice(0,100),
    name:String(p?.name ?? `定型文${i+1}`).slice(0,50),
    text:String(p?.text ?? "").slice(0,5000)
  })) : [];
  const history = Array.isArray(input?.history) ? input.history.slice(0,20) : [];
  return { memo, phrases, history, fields, updatedAt: new Date().toISOString() };
}

export class ClipboardRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
  }

  async fetch(request) {
    const method = request.method.toUpperCase();

    if (method === "GET") {
      const saved = await this.ctx.storage.get("clipboard");
      return json(saved || defaultPayload());
    }

    if (method === "PUT") {
      try {
        const body = await request.json();
        const payload = validatePayload(body);
        await this.ctx.storage.put("clipboard", payload);
        return json(payload);
      } catch (e) {
        return json({ error: e?.message || "保存できませんでした" }, 400);
      }
    }

    return json({ error: "Method not allowed" }, 405);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/clipboard") {
      const shareKey = request.headers.get("X-Share-Key")?.trim() || "";
      if (shareKey.length < 8 || shareKey.length > 200) {
        return json({ error: "共有キーは8文字以上で設定してください" }, 401);
      }

      const roomName = await roomNameFromKey(shareKey);
      const id = env.CLIPBOARD_ROOMS.idFromName(roomName);
      const stub = env.CLIPBOARD_ROOMS.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  }
};
