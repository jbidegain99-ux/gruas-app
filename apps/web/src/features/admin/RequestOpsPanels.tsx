'use client';

// Herramientas de la guardia en el detalle de una solicitud (migr. 00120,
// faltantes del runbook de operación): PIN bloqueado, notas internas, chat y
// recorrido GPS. Las usan ADMIN y SUPPORT.

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { KeyRound, MapPin, MessageSquare, StickyNote } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { formatDateTime } from '@/shared/lib/format';
import type { TrailPoint } from './TrailMap';

const TrailMap = dynamic(() => import('./TrailMap'), {
  ssr: false,
  loading: () => <div className="h-[220px] animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />,
});

const card = 'rounded-lg border border-zinc-200 p-4 dark:border-zinc-700';
const title = 'mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-white';

// ─── PIN ────────────────────────────────────────────────────────────────────
type PinStatus = { recent_failures: number; locked: boolean; unlocks_at: string | null; regenerated: number };

export function RequestPinPanel({ requestId, status }: { requestId: string; status: string }) {
  const [pin, setPin] = useState<PinStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const toast = useToast();
  const relevant = status === 'assigned' || status === 'en_route';

  useEffect(() => {
    if (!relevant) return;
    let alive = true;
    createClient()
      .rpc('staff_pin_status', { p_request_id: requestId })
      .then(({ data }) => alive && setPin(data as unknown as PinStatus));
    return () => {
      alive = false;
    };
  }, [requestId, relevant, refresh]);

  if (!relevant || !pin) return null;
  if (!pin.locked && pin.recent_failures === 0 && pin.regenerated === 0) return null;

  const unlock = async () => {
    setBusy(true);
    const { error } = await createClient().rpc('staff_reset_pin_lockout', { p_request_id: requestId, p_note: note });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success('PIN desbloqueado. El socio ya puede volver a intentarlo.');
    setNote('');
    setRefresh((k) => k + 1);
  };

  return (
    <div className={`${card} ${pin.locked ? 'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40' : ''}`}>
      <h3 className={title}>
        <KeyRound className="h-4 w-4" /> PIN de confirmación
      </h3>
      <p className="text-sm text-zinc-700 dark:text-zinc-300">
        {pin.locked
          ? `Bloqueado: ${pin.recent_failures} intentos fallidos. Se desbloquea solo ${pin.unlocks_at ? `a las ${new Date(pin.unlocks_at).toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/El_Salvador' })}` : 'en 15 min'}.`
          : `${pin.recent_failures} ${pin.recent_failures === 1 ? 'intento fallido' : 'intentos fallidos'} en los últimos 15 min.`}
        {pin.regenerated > 0 && ` El Usuario generó ${pin.regenerated} PIN nuevo${pin.regenerated > 1 ? 's' : ''}.`}
      </p>
      {pin.locked && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            Desbloquea solo si confirmaste por teléfono que el Usuario está con el socio. Si perdió el PIN, puede generar uno
            nuevo desde su app (“¿Perdiste el PIN?”).
          </p>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Qué confirmaste (queda registrado)"
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
          />
          <button
            onClick={unlock}
            disabled={busy || !note.trim()}
            className="w-full rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Desbloquear PIN
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Notas internas ─────────────────────────────────────────────────────────
type Note = { id: string; body: string; created_at: string; author_name: string; author_role: string };

export function RequestNotes({ requestId }: { requestId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    createClient()
      .rpc('staff_request_notes', { p_request_id: requestId })
      .then(({ data }) => alive && setNotes((data as Note[]) ?? []));
    return () => {
      alive = false;
    };
  }, [requestId, refresh]);

  const add = async () => {
    setBusy(true);
    const { error } = await createClient().rpc('staff_add_request_note', { p_request_id: requestId, p_body: draft });
    setBusy(false);
    if (error) return toast.error(error.message);
    setDraft('');
    setRefresh((k) => k + 1);
  };

  return (
    <div className={card}>
      <h3 className={title}>
        <StickyNote className="h-4 w-4" /> Notas internas
      </h3>
      {notes.length === 0 ? (
        <p className="mb-3 text-xs text-zinc-500">Sin notas. Solo las ve el equipo de Budi.</p>
      ) : (
        <ul className="mb-3 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-md bg-zinc-50 p-2 text-sm dark:bg-zinc-800">
              <p className="whitespace-pre-wrap text-zinc-800 dark:text-zinc-200">{n.body}</p>
              <p className="mt-1 text-xs text-zinc-500">
                {n.author_name} · {n.author_role === 'SUPPORT' ? 'Soporte' : 'Administración'} · {formatDateTime(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="Llamadas, acuerdos, incidentes… (no se puede editar después)"
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
      />
      <button
        onClick={add}
        disabled={busy || !draft.trim()}
        className="mt-2 w-full rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
      >
        Agregar nota
      </button>
    </div>
  );
}

// ─── Chat ───────────────────────────────────────────────────────────────────
type Message = { id: string; sender_id: string; message: string; created_at: string };

export function RequestChatLog({ requestId, userId, operatorId }: { requestId: string; userId: string | null; operatorId: string | null }) {
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    createClient()
      .from('request_messages')
      .select('id, sender_id, message, created_at')
      .eq('request_id', requestId)
      .order('created_at')
      .then(({ data }) => alive && setMessages(data ?? []));
    return () => {
      alive = false;
    };
  }, [requestId, open]);

  const who = (id: string) => (id === userId ? 'Usuario' : id === operatorId ? 'Socio operador' : 'Otro');

  return (
    <div className={card}>
      <button onClick={() => setOpen((o) => !o)} className={`${title} mb-0 w-full`} aria-expanded={open}>
        <MessageSquare className="h-4 w-4" /> Chat del servicio
        <span className="ml-auto text-xs font-normal text-zinc-500">{open ? 'Ocultar' : 'Ver'}</span>
      </button>
      {open && (
        <div className="mt-3">
          {messages === null ? (
            <p className="text-xs text-zinc-500">Cargando…</p>
          ) : messages.length === 0 ? (
            <p className="text-xs text-zinc-500">No hubo mensajes.</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {messages.map((m) => (
                <li key={m.id} className="text-sm">
                  <span className="font-medium text-zinc-900 dark:text-white">{who(m.sender_id)}</span>
                  <span className="ml-2 text-xs text-zinc-500">{formatDateTime(m.created_at)}</span>
                  <p className="text-zinc-700 dark:text-zinc-300">{m.message}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Recorrido GPS ──────────────────────────────────────────────────────────
type Pin = { lat: number; lng: number } | null;

export function RequestTrail({ requestId, pickup, dropoff }: { requestId: string; pickup: Pin; dropoff: Pin }) {
  const [trail, setTrail] = useState<TrailPoint[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    createClient()
      .from('service_location_trail')
      .select('lat, lng, recorded_at')
      .eq('request_id', requestId)
      .order('recorded_at')
      .limit(2000)
      .then(({ data }) => alive && setTrail((data as TrailPoint[]) ?? []));
    return () => {
      alive = false;
    };
  }, [requestId, open]);

  return (
    <div className={card}>
      <button onClick={() => setOpen((o) => !o)} className={`${title} mb-0 w-full`} aria-expanded={open}>
        <MapPin className="h-4 w-4" /> Recorrido del socio
        <span className="ml-auto text-xs font-normal text-zinc-500">{open ? 'Ocultar' : 'Ver'}</span>
      </button>
      {open && (
        <div className="mt-3">
          {trail === null ? (
            <p className="text-xs text-zinc-500">Cargando…</p>
          ) : trail.length === 0 ? (
            <p className="text-xs text-zinc-500">No hay puntos GPS grabados para este servicio.</p>
          ) : (
            <>
              <TrailMap trail={trail} pickup={pickup} dropoff={dropoff} />
              <p className="mt-2 text-xs text-zinc-500">
                {trail.length} puntos · de {formatDateTime(trail[0].recorded_at)} a {formatDateTime(trail[trail.length - 1].recorded_at)}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
