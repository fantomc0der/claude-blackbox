import { join, resolve, sep } from "node:path";
import { Recorder } from "./recorder";
import { object } from "./normalize";
import type { IndexProgress } from "../shared/types";

export interface HttpOptions { recorder: Recorder; webDir?: string; development?: boolean }

const security = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { ...security, "Cache-Control": "no-store" } });
}

function localHostname(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export function createHandler(options: HttpOptions): (request: Request) => Promise<Response> {
  const { recorder } = options;
  const { queries } = recorder;
  const webDir = resolve(options.webDir || join(import.meta.dir, "../../dist"));
  let revision = 0;

  const respond = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (!localHostname(url.hostname)) return json({ error: "Only loopback hosts are allowed." }, 403);
    const origin = request.headers.get("origin");
    const allowed = new Set([url.origin]);
    if (options.development) { allowed.add("http://127.0.0.1:12000"); allowed.add("http://localhost:12000"); }
    if ((origin && !allowed.has(origin)) || request.headers.get("sec-fetch-site") === "cross-site") {
      return json({ error: "Cross-origin access is disabled." }, 403);
    }
    if (!["GET", "HEAD"].includes(request.method)) {
      if (!origin || !request.headers.get("content-type")?.startsWith("application/json")) {
        return json({ error: "Mutations require same-origin JSON requests." }, 403);
      }
      if (Number(request.headers.get("content-length")) > 16384) return json({ error: "Request too large." }, 413);
    }
    const body = async () => {
      const text = await request.text();
      if (text.length > 16384) throw new Error("Request too large.");
      return object(JSON.parse(text));
    };
    try {
      if (request.method === "GET" && url.pathname === "/api/catalog") return json(await queries.catalog());
      if (request.method === "GET" && url.pathname === "/api/sessions") return json(queries.list(url.searchParams));
      if (request.method === "POST" && url.pathname === "/api/refresh") {
        await recorder.scan();
        return json(await queries.catalog());
      }
      if (request.method === "GET" && url.pathname === "/api/live") {
        let release = () => {};
        let flush = () => {};
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            let closed = false;
            let pendingChange: string[] | null = null;
            let pendingNumber = 0;
            let pendingProgress: IndexProgress | null = null;
            flush = () => {
              if (closed || (controller.desiredSize ?? 1) <= 0) return;
              if (pendingChange) {
                controller.enqueue(encoder.encode(`event: change\nid: ${++revision}\ndata: ${JSON.stringify({ version: 1, ids: pendingChange, change: pendingNumber })}\n\n`));
                pendingChange = null;
              }
              if (pendingProgress && (controller.desiredSize ?? 1) > 0) {
                controller.enqueue(encoder.encode(`event: indexing\ndata: ${JSON.stringify(pendingProgress)}\n\n`));
                pendingProgress = null;
              }
            };
            const send = (ids: string[]) => {
              pendingChange = pendingChange === null ? ids : [];
              pendingNumber = recorder.changes;
              flush();
            };
            const progress = (state: IndexProgress) => {
              pendingProgress = state;
              flush();
            };
            const heartbeat = setInterval(() => {
              if (!closed && (controller.desiredSize ?? 1) > 0) controller.enqueue(encoder.encode(": heartbeat\n\n"));
            }, 15000);
            const abort = () => { release(); try { controller.close(); } catch {} };
            release = () => {
              if (closed) return;
              closed = true;
              pendingChange = null;
              pendingProgress = null;
              clearInterval(heartbeat);
              recorder.listeners.delete(send);
              recorder.progressListeners.delete(progress);
              request.signal.removeEventListener("abort", abort);
            };
            recorder.listeners.add(send);
            recorder.progressListeners.add(progress);
            request.signal.addEventListener("abort", abort, { once: true });
            send([]);
            progress(recorder.indexing);
          },
          pull() { flush(); },
          cancel() { release(); },
        });
        return new Response(stream, { headers: { ...security, "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
      }
      if (request.method === "POST" && url.pathname === "/api/groups") return json(queries.saveGroup(await body()), 201);
      const groupRoute = url.pathname.match(/^\/api\/groups\/([\w-]+)$/);
      if (groupRoute && request.method === "DELETE") { queries.deleteGroup(groupRoute[1]); return json({ ok: true }); }
      const route = url.pathname.match(/^\/api\/sessions\/([a-f0-9]{24})(?:\/(events|matches|timeline|summary|bookmark|export|subagents|family))?$/);
      if (route) {
        const session = queries.getSession(route[1]);
        if (!session) return json({ error: "This recording is no longer available." }, 404);
        if (request.method === "GET" && !route[2]) return json(session);
        if (request.method === "GET" && route[2] === "subagents") return json(queries.subagents(session.id));
        if (request.method === "GET" && route[2] === "family") return json(queries.family(session.id));
        if (request.method === "GET" && route[2] === "timeline") return json(queries.timeline(session.id, url.searchParams));
        if (request.method === "GET" && route[2] === "matches") return json(queries.matches(session.id, url.searchParams));
        if (request.method === "GET" && route[2] === "summary") return json(queries.summary(session.id, url.searchParams));
        if (request.method === "GET" && route[2] === "events") {
          const page = queries.events(session.id, url.searchParams);
          const toolIds = page.items.flatMap(event => event.blocks.filter(block => block.type === "tool_use").map(block => block.id || ""));
          const resultIds = page.items.flatMap(event => event.blocks.filter(block => block.type === "tool_result").map(block => block.tool_use_id || ""));
          return json({ ...page, results: queries.results(session.id, toolIds), calls: queries.calls(session.id, resultIds) });
        }
        if (request.method === "PUT" && route[2] === "bookmark") {
          const value = await body();
          if (typeof value.bookmarked !== "boolean") return json({ error: "bookmarked must be a boolean" }, 400);
          queries.bookmark(session.id, value.bookmarked);
          return json(queries.getSession(session.id));
        }
        if (request.method === "GET" && route[2] === "export") {
          const rows = recorder.db.query<{ raw: string }, [string]>("SELECT raw FROM events WHERE session_id=? ORDER BY sequence").iterate(session.id);
          const encoder = new TextEncoder();
          return new Response(new ReadableStream<Uint8Array>({
            pull(controller) {
              const next = rows.next();
              if (next.done) controller.close();
              else controller.enqueue(encoder.encode(next.value.raw + "\n"));
            },
            cancel() { rows.return?.(); },
          }), { headers: { ...security, "Cache-Control": "no-store", "Content-Type": "application/x-ndjson", "Content-Disposition": `attachment; filename="blackbox-${session.id}.jsonl"` } });
        }
      }
      if (url.pathname.startsWith("/api/")) return json({ error: "Endpoint not found." }, 404);
      if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "Method not allowed." }, 405);
      const assetPath = resolve(webDir, "." + decodeURIComponent(url.pathname));
      if (!assetPath.startsWith(webDir + sep) && assetPath !== webDir) return json({ error: "Invalid asset path." }, 403);
      const file = Bun.file(url.pathname === "/" ? join(webDir, "index.html") : assetPath);
      if (await file.exists()) return new Response(request.method === "HEAD" ? null : file, { headers: {
        ...security, "Content-Type": file.type,
        "Cache-Control": url.pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      } });
      return new Response("UI not found. Run bun run build, then bun start.", { status: 404, headers: security });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unable to read the recording." }, 400);
    }
  };

  // A mutation's response names the last change announced before it was answered, its own among them, so the client
  // knows that its refresh after the response covers that change's notice even when the notice arrives later. A
  // rejected request changed nothing, so its response names nothing.
  return async request => {
    const response = await respond(request);
    if (response.ok && request.method !== "GET" && request.method !== "HEAD") response.headers.set("X-Blackbox-Change", String(recorder.changes));
    return response;
  };
}
