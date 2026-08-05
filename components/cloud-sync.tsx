"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth-context";

const PREFIX = "juntos-";
const LOCAL_ONLY = new Set([
  "juntos-theme", "juntos-profile", "juntos-session-only",
  "juntos-sync-client", "juntos-sync-queue", "juntos-active-workspace",
]);
const DOCUMENT_TYPES = new Set(["balances", "settings", "dashboard-prefs", "space"]);
const recordKey = (entityType: string, entityId: string) => `${entityType}::${entityId}`;
const storageKey = (entityType: string) => `${PREFIX}${entityType}`;
const safeParse = (value: string | null): unknown => {
  if (value === null) return null;
  try { return JSON.parse(value); } catch { return null; }
};
const syncedStorageKeys = () => Object.keys(localStorage)
  .filter(key => key.startsWith(PREFIX) && !LOCAL_ONLY.has(key));

type LocalRecord = { entity_type: string; entity_id: string; data: unknown };
type Change = LocalRecord & { deleted?: boolean };
type RemoteRecord = LocalRecord & { deleted_at: string | null; revision: number; updated_at: string };
type Queue = Record<string, Change>;

function scanLocal(): Map<string, LocalRecord> {
  const records = new Map<string, LocalRecord>();
  syncedStorageKeys().forEach(key => {
    const entityType = key.slice(PREFIX.length);
    const value = safeParse(localStorage.getItem(key));
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const candidate = item as { id?: string | number };
        const entityId = String(candidate?.id ?? `index-${index}`);
        records.set(recordKey(entityType, entityId), { entity_type: entityType, entity_id: entityId, data: item });
      });
    } else if (value !== null) {
      records.set(recordKey(entityType, "singleton"), { entity_type: entityType, entity_id: "singleton", data: value });
    }
  });
  return records;
}

const loadQueue = (): Queue => {
  const value = safeParse(localStorage.getItem("juntos-sync-queue"));
  return value && !Array.isArray(value) && typeof value === "object" ? value as Queue : {};
};
const saveQueue = (queue: Queue) => localStorage.setItem("juntos-sync-queue", JSON.stringify(queue));

export function CloudSync() {
  const { workspace } = useAuth();

  useEffect(() => {
    if (!workspace) return;

    const supabase = createClient();
    const canWrite = workspace.role === "owner" || workspace.role === "member";
    let stopped = false;
    let applying = false;
    let ready = false;
    let flushing = false;
    let baseline = new Map<string, LocalRecord>();
    let pullTimer: number | undefined;

    const emitStatus = (status: "syncing" | "synced" | "offline" | "error", error?: string) =>
      window.dispatchEvent(new CustomEvent("juntos-sync-status", { detail: { status, error } }));

    const notifyDataChanged = () => {
      ["juntos-transactions-updated", "juntos-goals-updated", "juntos-calendar-updated", "juntos-debts-updated"]
        .forEach(name => window.dispatchEvent(new Event(name)));
      window.dispatchEvent(new Event("juntos-cloud-synced"));
    };

    const pullAll = async (): Promise<RemoteRecord[]> => {
      const rows: RemoteRecord[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("workspace_records")
          .select("entity_type,entity_id,data,deleted_at,revision,updated_at")
          .eq("workspace_id", workspace.id).range(from, from + 999);
        if (error) throw error;
        rows.push(...((data || []) as RemoteRecord[]));
        if (!data || data.length < 1000) break;
      }
      return rows;
    };

    const applyRemote = (rows: RemoteRecord[], queue: Queue) => {
      applying = true;
      const before = JSON.stringify(Object.fromEntries(scanLocal()));
      const grouped = new Map<string, RemoteRecord[]>();
      rows.forEach(row => grouped.set(row.entity_type, [...(grouped.get(row.entity_type) || []), row]));

      grouped.forEach((entityRows, entityType) => {
        const key = storageKey(entityType);
        const localValue = safeParse(localStorage.getItem(key));
        const isDocument = DOCUMENT_TYPES.has(entityType) || entityRows.some(row => row.entity_id === "singleton");
        if (isDocument) {
          const pending = queue[recordKey(entityType, "singleton")];
          if (pending) return;
          const remote = entityRows.find(row => row.entity_id === "singleton");
          if (!remote || remote.deleted_at) localStorage.removeItem(key);
          else localStorage.setItem(key, JSON.stringify(remote.data));
          return;
        }

        const merged = new Map<string, unknown>();
        entityRows.filter(row => !row.deleted_at).forEach(row => merged.set(row.entity_id, row.data));
        Object.values(queue).filter(change => change.entity_type === entityType).forEach(change => {
          if (change.deleted) merged.delete(change.entity_id);
          else merged.set(change.entity_id, change.data);
        });
        if (merged.size || Array.isArray(localValue)) localStorage.setItem(key, JSON.stringify([...merged.values()]));
        else localStorage.removeItem(key);
      });

      baseline = scanLocal();
      applying = false;
      if (before !== JSON.stringify(Object.fromEntries(baseline))) notifyDataChanged();
    };

    const flush = async () => {
      if (!canWrite || !navigator.onLine) { emitStatus("offline"); return; }
      if (flushing) return;
      const queue = loadQueue();
      const pending = Object.entries(queue);
      if (!pending.length) { emitStatus("synced"); return; }
      flushing = true;
      emitStatus("syncing");
      try {
        for (let index = 0; index < pending.length; index += 200) {
          const batch = pending.slice(index, index + 200);
          const { error } = await supabase.rpc("apply_workspace_changes", {
            target_workspace: workspace.id,
            changes: batch.map(([, change]) => change),
          });
          if (error) throw error;
          const current = loadQueue();
          batch.forEach(([key, sent]) => {
            if (JSON.stringify(current[key]) === JSON.stringify(sent)) delete current[key];
          });
          saveQueue(current);
        }
        const rows = await pullAll();
        if (!stopped) applyRemote(rows, loadQueue());
        emitStatus("synced");
      } catch (reason) {
        emitStatus(navigator.onLine ? "error" : "offline", reason instanceof Error ? reason.message : "Falha na sincronização");
      } finally {
        flushing = false;
      }
    };

    const detectLocalChanges = () => {
      if (!ready || applying || !canWrite) return;
      const current = scanLocal();
      const queue = loadQueue();
      current.forEach((record, key) => {
        if (JSON.stringify(record.data) !== JSON.stringify(baseline.get(key)?.data)) queue[key] = record;
      });
      baseline.forEach((record, key) => {
        if (!current.has(key)) queue[key] = { ...record, data: null, deleted: true };
      });
      baseline = current;
      saveQueue(queue);
      void flush();
    };

    const pullAndApply = async () => {
      if (stopped) return;
      try {
        const rows = await pullAll();
        if (!stopped) applyRemote(rows, loadQueue());
        emitStatus("synced");
      } catch (reason) {
        emitStatus(navigator.onLine ? "error" : "offline", reason instanceof Error ? reason.message : "Falha na sincronização");
      }
    };

    void (async () => {
      emitStatus("syncing");
      try {
        let rows = await pullAll();
        if (!rows.length) {
          const { data: legacy } = await supabase.from("workspace_state").select("state")
            .eq("workspace_id", workspace.id).maybeSingle();
          const legacyState = legacy?.state as Record<string, string> | undefined;
          if (legacyState && Object.keys(legacyState).length) {
            applying = true;
            Object.entries(legacyState).forEach(([key, value]) => {
              if (key.startsWith(PREFIX) && !LOCAL_ONLY.has(key)) localStorage.setItem(key, value);
            });
            applying = false;
          }
          if (canWrite) {
            const queue = loadQueue();
            scanLocal().forEach((record, key) => { queue[key] = record; });
            saveQueue(queue);
            baseline = scanLocal();
            ready = true;
            await flush();
            rows = await pullAll();
          }
        } else {
          const local = scanLocal();
          const remoteKeys = new Set(rows.map(row => recordKey(row.entity_type, row.entity_id)));
          const queue = loadQueue();
          if (canWrite) local.forEach((record, key) => { if (!remoteKeys.has(key)) queue[key] = record; });
          saveQueue(queue);
          applyRemote(rows, queue);
        }
        baseline = scanLocal();
        ready = true;
        await flush();
        notifyDataChanged();
      } catch (reason) {
        baseline = scanLocal();
        ready = true;
        emitStatus(navigator.onLine ? "error" : "offline", reason instanceof Error ? reason.message : "Falha na sincronização");
      }
    })();

    const poll = window.setInterval(detectLocalChanges, 700);
    const online = () => { detectLocalChanges(); void flush(); };
    const storage = () => detectLocalChanges();
    window.addEventListener("online", online);
    window.addEventListener("storage", storage);
    window.addEventListener("juntos-sync-request", storage);

    const channel = supabase.channel(`workspace-records-${workspace.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "workspace_records", filter: `workspace_id=eq.${workspace.id}` }, () => {
        window.clearTimeout(pullTimer);
        pullTimer = window.setTimeout(() => void pullAndApply(), 120);
      }).subscribe();

    return () => {
      stopped = true;
      window.clearInterval(poll);
      window.clearTimeout(pullTimer);
      window.removeEventListener("online", online);
      window.removeEventListener("storage", storage);
      window.removeEventListener("juntos-sync-request", storage);
      void supabase.removeChannel(channel);
    };
  }, [workspace?.id, workspace?.role]);

  return null;
}