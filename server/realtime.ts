import type { Server as HttpServer } from "http";
import { WebSocket, WebSocketServer } from "ws";

export type MigrationEvent = {
  type: "job.created" | "job.updated" | "job.paused" | "job.resumed" | "job.completed" | "job.failed" | "job.cancelled";
  jobId: string;
  emittedAt: number;
  job?: Record<string, unknown>;
  detail?: string;
};

let socketServer: WebSocketServer | null = null;

export function registerRealtime(server: HttpServer) {
  socketServer = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/events") {
      socket.destroy();
      return;
    }
    socketServer?.handleUpgrade(request, socket, head, ws => {
      socketServer?.emit("connection", ws, request);
    });
  });
  socketServer.on("connection", ws => {
    ws.send(JSON.stringify({ type: "connection.ready", emittedAt: Date.now(), detail: "Migration event stream connected." }));
    ws.on("error", () => ws.close());
  });
}

export function broadcastMigrationEvent(event: MigrationEvent) {
  if (!socketServer) return;
  const payload = JSON.stringify(event);
  for (const client of Array.from(socketServer.clients)) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}
