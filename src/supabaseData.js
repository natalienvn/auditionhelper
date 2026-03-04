import { supabase } from "./supabaseClient";

// ── Auditions ──────────────────────────────────────────

export async function fetchAuditions() {
  var { data, error } = await supabase
    .from("auditions")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(function(row) {
    return {
      id: row.id,
      orchestra: row.orchestra || "",
      shortName: row.short_name || "",
      date: row.date || "",
      location: row.location || "",
      status: row.status || "Preparing",
      round: row.round || "",
      notes: row.notes || "",
      excerpts: row.excerpts || [],
    };
  });
}

export async function upsertAudition(userId, a) {
  var { error } = await supabase.from("auditions").upsert({
    id: a.id,
    user_id: userId,
    orchestra: a.orchestra,
    short_name: a.shortName || "",
    date: a.date || null,
    location: a.location || "",
    status: a.status || "Preparing",
    round: a.round || "",
    notes: a.notes || "",
    excerpts: a.excerpts || [],
  });
  if (error) throw error;
}

export async function deleteAuditionDB(id) {
  var { error } = await supabase.from("auditions").delete().eq("id", id);
  if (error) throw error;
}

// ── Practice Log ───────────────────────────────────────

export async function fetchPracticeLog() {
  var { data, error } = await supabase
    .from("practice_log")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(function(row) {
    return {
      id: row.id,
      excerptId: row.excerpt_id || "",
      auditionId: row.audition_id || "",
      label: row.label || "",
      orchestra: row.orchestra || "",
      short: row.short_name || "",
      minutes: row.minutes || 0,
      note: row.note || "",
      date: row.date || "",
    };
  });
}

export async function insertPractice(userId, p) {
  var { error } = await supabase.from("practice_log").insert({
    id: p.id,
    user_id: userId,
    excerpt_id: p.excerptId,
    audition_id: p.auditionId,
    label: p.label,
    orchestra: p.orchestra,
    short_name: p.short || "",
    minutes: p.minutes,
    note: p.note || "",
    date: p.date,
  });
  if (error) throw error;
}

export async function deletePracticeDB(id) {
  var { error } = await supabase.from("practice_log").delete().eq("id", id);
  if (error) throw error;
}

// ── Readiness ──────────────────────────────────────────

export async function fetchReadiness() {
  var { data, error } = await supabase.from("readiness").select("*");
  if (error) throw error;
  var map = {};
  (data || []).forEach(function(row) {
    map[row.excerpt_key] = row.level;
  });
  return map;
}

export async function upsertReadiness(userId, key, level) {
  var { error } = await supabase.from("readiness").upsert(
    { user_id: userId, excerpt_key: key, level: level },
    { onConflict: "user_id,excerpt_key" }
  );
  if (error) throw error;
}

// ── Settings ───────────────────────────────────────────

export async function fetchSettings() {
  var { data, error } = await supabase
    .from("user_settings")
    .select("settings")
    .maybeSingle();
  if (error) throw error;
  return data ? data.settings : null;
}

export async function upsertSettings(userId, settings) {
  var { error } = await supabase.from("user_settings").upsert({
    user_id: userId,
    settings: settings,
  });
  if (error) throw error;
}
