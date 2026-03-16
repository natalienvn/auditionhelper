import { supabase } from "./supabaseClient";

// ── Auditions ──────────────────────────────────────────

export async function fetchAuditions() {
  var { data, error } = await supabase
    .from("auditions")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(function(row) {
    var rawDate = row.date || "";
    if (rawDate.length > 10) {
      var dt = new Date(rawDate);
      rawDate = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
    }
    return {
      id: row.id,
      orchestra: row.orchestra || "",
      shortName: row.short_name || "",
      date: rawDate,
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
    var rawDate = row.date || "";
    if (rawDate.length > 10) {
      var dt = new Date(rawDate);
      rawDate = dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
    }
    return {
      id: row.id,
      excerptId: row.excerpt_id || "",
      auditionId: row.audition_id || "",
      label: row.label || "",
      orchestra: row.orchestra || "",
      short: row.short_name || "",
      minutes: row.minutes || 0,
      note: row.note || "",
      date: rawDate,
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

export async function updatePracticeDB(id, fields) {
  var updateObj = {};
  if (fields.minutes !== undefined) updateObj.minutes = fields.minutes;
  if (fields.note !== undefined) updateObj.note = fields.note;
  var { error } = await supabase.from("practice_log").update(updateObj).eq("id", id);
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

// ══════════════════════════════════════════════════════
// ── FRIENDS FEATURE ──────────────────────────────────
// ══════════════════════════════════════════════════════

// ── Profile (public-facing info) ─────────────────────

export async function fetchMyProfile() {
  var { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, avatar_id, instrument, invite_code")
    .eq("id", (await supabase.auth.getUser()).data.user.id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function updateMyProfile(userId, fields) {
  var updateObj = {};
  if (fields.display_name !== undefined) updateObj.display_name = fields.display_name;
  if (fields.avatar_id !== undefined) updateObj.avatar_id = fields.avatar_id;
  if (fields.instrument !== undefined) updateObj.instrument = fields.instrument;
  var { error } = await supabase.from("profiles").update(updateObj).eq("id", userId);
  if (error) throw error;
}

export async function fetchProfileById(userId) {
  var { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, avatar_id, instrument, invite_code")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── Search for users (by email or invite code) ───────

export async function searchUserByEmail(email) {
  var { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, avatar_id, instrument")
    .ilike("email", email.trim())
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function searchUserByInviteCode(code) {
  var { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, avatar_id, instrument")
    .eq("invite_code", code.trim().toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── Friendships ──────────────────────────────────────

export async function fetchFriendships() {
  var { data, error } = await supabase
    .from("friendships")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function sendFriendRequest(requesterId, recipientId) {
  // Check if friendship already exists in either direction
  var { data: existing } = await supabase
    .from("friendships")
    .select("id, status")
    .or(
      "and(requester_id.eq." + requesterId + ",recipient_id.eq." + recipientId + ")," +
      "and(requester_id.eq." + recipientId + ",recipient_id.eq." + requesterId + ")"
    );
  if (existing && existing.length > 0) {
    var f = existing[0];
    if (f.status === "accepted") throw new Error("Already friends!");
    if (f.status === "pending") throw new Error("Friend request already pending.");
    if (f.status === "declined") {
      // Re-send: update to pending
      var { error: updateErr } = await supabase
        .from("friendships")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", f.id);
      if (updateErr) throw updateErr;
      return;
    }
  }
  var { error } = await supabase.from("friendships").insert({
    requester_id: requesterId,
    recipient_id: recipientId,
    status: "pending",
  });
  if (error) throw error;
}

export async function respondToFriendRequest(friendshipId, accept) {
  var { error } = await supabase
    .from("friendships")
    .update({
      status: accept ? "accepted" : "declined",
      updated_at: new Date().toISOString(),
    })
    .eq("id", friendshipId);
  if (error) throw error;
}

export async function removeFriendship(friendshipId) {
  var { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
  if (error) throw error;
}

// Get profiles for all friend user IDs
export async function fetchFriendProfiles(friendUserIds) {
  if (!friendUserIds || friendUserIds.length === 0) return [];
  var { data, error } = await supabase
    .from("profiles")
    .select("id, email, display_name, avatar_id, instrument")
    .in("id", friendUserIds);
  if (error) throw error;
  return data || [];
}

// ── Activity Feed ────────────────────────────────────

export async function logActivity(userId, eventType, eventData) {
  var { error } = await supabase.from("activity_feed").insert({
    user_id: userId,
    event_type: eventType,
    event_data: eventData || {},
  });
  // Don't throw — activity logging shouldn't break the main flow
  if (error) console.error("Activity log error:", error);
}

export async function fetchActivityFeed(limit) {
  var lim = limit || 50;
  var { data, error } = await supabase
    .from("activity_feed")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(lim);
  if (error) throw error;
  return data || [];
}

// ── Encouragements ───────────────────────────────────

export async function sendEncouragement(fromId, toId, message, auditionId) {
  var { error } = await supabase.from("encouragements").insert({
    from_id: fromId,
    to_id: toId,
    message: message,
    audition_id: auditionId || null,
  });
  if (error) throw error;
}

export async function fetchMyEncouragements() {
  var userId = (await supabase.auth.getUser()).data.user.id;
  var { data, error } = await supabase
    .from("encouragements")
    .select("*")
    .or("from_id.eq." + userId + ",to_id.eq." + userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data || [];
}

export async function markEncouragementRead(id) {
  var { error } = await supabase
    .from("encouragements")
    .update({ read: true })
    .eq("id", id);
  if (error) throw error;
}

export async function markAllEncouragmentsRead(userId) {
  var { error } = await supabase
    .from("encouragements")
    .update({ read: true })
    .eq("to_id", userId)
    .eq("read", false);
  if (error) throw error;
}
