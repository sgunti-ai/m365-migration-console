import { useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type MigrationEvent = {
  type?: string;
  jobId?: string;
  detail?: string;
};

export function useMigrationRealtime(enabled: boolean) {
  const utils = trpc.useUtils();

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/events`);
    socket.onmessage = event => {
      try {
        const message = JSON.parse(event.data) as MigrationEvent;
        if (!message.type?.startsWith("job.")) return;
        void utils.migration.jobs.list.invalidate();
        if (message.type === "job.paused") toast.info("Migration job paused", { description: message.jobId });
        if (message.type === "job.resumed") toast.success("Migration job resumed", { description: message.jobId });
        if (message.type === "job.failed") toast.error("Migration job failed", { description: message.detail ?? message.jobId });
      } catch {
        // Ignore malformed event frames; the next polling cycle will reconcile state.
      }
    };
    socket.onerror = () => socket.close();
    return () => socket.close();
  }, [enabled, utils]);
}
