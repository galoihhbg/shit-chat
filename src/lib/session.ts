import { supabase } from './supabase';
import { getDeviceId, randomNickname } from './identity';

export const SESSION_MINUTES = 15;

export type ToiletSession = {
  id: string;
  nickname: string;
  expiresAt: number;
  roomId: string | null;
  partnerNickname: string | null;
};

export type ChatMessage = {
  id: number;
  senderSession: string;
  nickname: string;
  body: string;
  createdAt: string;
};

type SessionRow = {
  id: string;
  nickname: string;
  expires_at: string;
  room_id: string | null;
  partner_nickname: string | null;
};

function toSession(row: SessionRow): ToiletSession {
  return {
    id: row.id,
    nickname: row.nickname,
    expiresAt: new Date(row.expires_at).getTime(),
    roomId: row.room_id,
    partnerNickname: row.partner_nickname,
  };
}

/** Called only after the proof passed. Starts the 15 minute clock. */
export async function startSession(): Promise<ToiletSession> {
  const deviceId = await getDeviceId();
  const expiresAt = new Date(Date.now() + SESSION_MINUTES * 60_000).toISOString();

  // One live session per phone. Replace any previous one.
  await supabase.from('sessions').delete().eq('device_id', deviceId);

  const { data, error } = await supabase
    .from('sessions')
    .insert({ device_id: deviceId, nickname: randomNickname(), expires_at: expiresAt })
    .select('id, nickname, expires_at, room_id, partner_nickname')
    .single();

  if (error) throw error;
  return toSession(data as SessionRow);
}

export async function endSession(sessionId: string): Promise<void> {
  await supabase.from('sessions').delete().eq('id', sessionId);
}

export async function getActiveCount(): Promise<number> {
  const { data, error } = await supabase.rpc('active_count');
  if (error) throw error;
  return (data as number) ?? 0;
}

/** Re-read my own row, mostly to notice that someone matched with me. */
export async function refreshSession(sessionId: string): Promise<ToiletSession | null> {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, nickname, expires_at, room_id, partner_nickname')
    .eq('id', sessionId)
    .maybeSingle();

  if (error || !data) return null;
  return toSession(data as SessionRow);
}

export type MatchResult = { roomId: string; partnerNickname: string } | null;

export async function findMatch(sessionId: string): Promise<MatchResult> {
  const { data, error } = await supabase.rpc('find_match', { p_session: sessionId });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.room_id) return null;

  return { roomId: row.room_id, partnerNickname: row.partner_nickname ?? 'Someone' };
}

/**
 * Leave the current room but stay on the toilet.
 *
 * Clears the room on both sides and abandons any game still running there.
 * The session row itself survives, so the clock keeps going and no
 * re-verification is needed.
 */
export async function leaveRoom(sessionId: string): Promise<ToiletSession> {
  const { data, error } = await supabase.rpc('leave_room', { p_session: sessionId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return toSession(row as SessionRow);
}

/**
 * Watch my own session row.
 *
 * Two things arrive this way: somebody matching with me (room_id appears) and
 * my partner walking out (room_id disappears). The caller decides which is
 * which -- this just reports the row.
 */
export function watchSession(sessionId: string, onChange: (s: ToiletSession) => void) {
  const channel = supabase
    .channel(`session:${sessionId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
      (payload) => {
        const row = payload.new as SessionRow;
        if (row?.id) onChange(toSession(row));
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

export async function fetchMessages(roomId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, sender_session, nickname, body, created_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(200);

  if (error) throw error;

  return (data ?? []).map((m: any) => ({
    id: m.id,
    senderSession: m.sender_session,
    nickname: m.nickname,
    body: m.body,
    createdAt: m.created_at,
  }));
}

export async function sendMessage(
  roomId: string,
  session: ToiletSession,
  body: string
): Promise<void> {
  const trimmed = body.trim().slice(0, 500);
  if (!trimmed) return;

  const { error } = await supabase.from('messages').insert({
    room_id: roomId,
    sender_session: session.id,
    nickname: session.nickname,
    body: trimmed,
  });

  if (error) throw error;
}

export function subscribeToRoom(roomId: string, onMessage: (m: ChatMessage) => void) {
  const channel = supabase
    .channel(`room:${roomId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
      (payload) => {
        const m = payload.new as any;
        onMessage({
          id: m.id,
          senderSession: m.sender_session,
          nickname: m.nickname,
          body: m.body,
          createdAt: m.created_at,
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
