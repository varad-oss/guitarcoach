/**
 * The account backend (Supabase). Optional: without the two public settings
 * below, GuitarCoach runs exactly as before, on this device only.
 * The table and storage rules are in supabase/setup.sql.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Remote, RemoteRow } from "./engine";

/** Accepts the project URL with or without the "/rest/v1/" API path the dashboard also shows. */
export function projectUrl(raw: string | undefined): string | undefined {
  return raw?.trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "") || undefined;
}

// Literal references so Next.js inlines them at build time.
const URL = projectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

export const accountsEnabled = Boolean(URL && KEY);

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient | null {
  if (!accountsEnabled || typeof window === "undefined") return null;
  client ??= createClient(URL!, KEY!, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

/** Whether Google sign-in is switched on in the Supabase project (public settings). */
export async function googleSignInEnabled(): Promise<boolean> {
  if (!URL || !KEY) return false;
  try {
    const res = await fetch(`${URL}/auth/v1/settings`, { headers: { apikey: KEY } });
    const settings = (await res.json()) as { external?: { google?: boolean } };
    return settings.external?.google === true;
  } catch {
    return true; // can't tell: let Supabase answer
  }
}

const PAGE = 500;

export function supabaseRemote(sb: SupabaseClient, userId: string): Remote {
  const path = (id: string) => `${userId}/${id}`;
  return {
    userId,
    async pull(since) {
      const out: RemoteRow[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = sb.from("records").select("store,id,data,deleted,modified,updated_at").order("updated_at").order("store").order("id").range(from, from + PAGE - 1);
        if (since) q = q.gt("updated_at", since);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        out.push(...(data as RemoteRow[]));
        if (data.length < PAGE) return out;
      }
    },
    async push(rows) {
      const { error } = await sb.from("records").upsert(
        rows.map((r) => ({ ...r, user_id: userId })),
        { onConflict: "user_id,store,id" },
      );
      if (error) throw new Error(error.message);
    },
    async uploadAudio(id, blob) {
      const { error } = await sb.storage.from("audio").upload(path(id), blob, { upsert: true, contentType: blob.type || "application/octet-stream" });
      if (error) throw new Error(error.message);
    },
    async downloadAudio(id) {
      const { data, error } = await sb.storage.from("audio").download(path(id));
      if (error) return null;
      return data;
    },
    async removeAudio(ids) {
      const { error } = await sb.storage.from("audio").remove(ids.map(path));
      if (error) throw new Error(error.message);
    },
  };
}
