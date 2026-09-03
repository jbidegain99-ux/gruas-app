'use client';

import { useState } from 'react';
import { Upload, Download, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { createClient } from '@/shared/lib/supabase/client';
import { useToast } from '@/shared/components/FeedbackProvider';
import { parseCsv, mapearAfiliados, CSV_PLANTILLA, type MemberRow } from './csv';

// Importación de padrón por CSV (B-10). Deliberadamente en dos pasos —revisar y
// luego confirmar—: quien sube un archivo de cientos de filas necesita ver qué
// entendió el sistema ANTES de escribir en la base, no después.

type ResultadoImport = {
  inserted: number;
  updated: number;
  failed: number;
  errors: { row: number; document_number: string; message: string }[];
};

export function MemberImportModal({
  policyId,
  onClose,
  onImported,
}: {
  policyId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [ignoradas, setIgnoradas] = useState<string[]>([]);
  const [faltantes, setFaltantes] = useState<string[]>([]);
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImport | null>(null);
  const toast = useToast();

  // Filas que la base rechazaría igual; se marcan aquí para no gastar un viaje.
  const invalidas = (members ?? []).filter((m) => !m.document_number || !m.full_name);
  const validas = (members ?? []).length - invalidas.length;

  const leerArchivo = async (file: File) => {
    setResultado(null);
    setNombreArchivo(file.name);
    const texto = await file.text();
    const { members: filas, columnasIgnoradas, faltantes: falt } = mapearAfiliados(parseCsv(texto));
    setMembers(filas);
    setIgnoradas(columnasIgnoradas);
    setFaltantes(falt);
  };

  const descargarPlantilla = () => {
    const blob = new Blob(['﻿' + CSV_PLANTILLA], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_afiliados.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importar = async () => {
    if (!members) return;
    setCargando(true);
    const supabase = createClient();
    // Se envían también las filas inválidas: la base devuelve el motivo por
    // fila y así el informe final es uno solo, no dos listas que cuadrar.
    const { data, error } = await supabase.rpc('import_policy_members', {
      p_policy_id: policyId,
      p_members: members,
    });
    setCargando(false);

    if (error) {
      toast.error('No se pudo importar el padrón.');
      return;
    }
    const r = data as unknown as ResultadoImport;
    setResultado(r);
    if (r.inserted + r.updated > 0) {
      toast.success(`${r.inserted} altas y ${r.updated} actualizaciones.`);
      onImported();
    } else {
      toast.error('No se importó ninguna fila.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" aria-hidden="true" onClick={onClose} />
      <div className="relative z-50 max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="font-heading text-lg font-bold text-zinc-900 dark:text-white">
          Importar padrón por CSV
        </h2>

        {!resultado && (
          <>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Se aceptan cabeceras en español o inglés, en cualquier orden. Obligatorias:{' '}
              <strong>documento</strong> y <strong>nombre</strong>. Opcionales: teléfono, relación,
              alta y baja.
            </p>

            <button
              onClick={descargarPlantilla}
              className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-budi-primary-600 hover:underline dark:text-budi-primary-400"
            >
              <Download className="h-4 w-4" />
              Descargar plantilla
            </button>

            <label className="mt-4 flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-300 p-6 text-center hover:border-budi-primary-400 dark:border-zinc-700">
              <Upload className="h-6 w-6 text-zinc-400" />
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                {nombreArchivo || 'Elegí un archivo .csv'}
              </span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) leerArchivo(f);
                }}
              />
            </label>

            {faltantes.length > 0 && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/50 dark:bg-red-900/20">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                <p className="text-sm text-red-800 dark:text-red-300">
                  No se encontró la columna de <strong>{faltantes.join('</strong> ni la de <strong>')}</strong>.
                  Revisá la primera fila del archivo.
                </p>
              </div>
            )}

            {members && faltantes.length === 0 && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-4 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    <strong>{members.length}</strong> filas leídas
                  </span>
                  <span className="text-green-700 dark:text-green-400">
                    <strong>{validas}</strong> listas para importar
                  </span>
                  {invalidas.length > 0 && (
                    <span className="text-amber-700 dark:text-amber-400">
                      <strong>{invalidas.length}</strong> sin documento o sin nombre
                    </span>
                  )}
                </div>

                {ignoradas.length > 0 && (
                  <p className="text-xs text-zinc-500">
                    Columnas no reconocidas (se ignoran): {ignoradas.join(', ')}
                  </p>
                )}

                {members.length > 0 && (
                  <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-zinc-200 bg-zinc-50 uppercase text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/50">
                        <tr>
                          <th className="px-3 py-2">Documento</th>
                          <th className="px-3 py-2">Nombre</th>
                          <th className="px-3 py-2">Teléfono</th>
                          <th className="px-3 py-2">Relación</th>
                          <th className="px-3 py-2">Alta</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                        {members.slice(0, 5).map((m, i) => (
                          <tr key={i} className={!m.document_number || !m.full_name ? 'bg-amber-50 dark:bg-amber-900/20' : ''}>
                            <td className="px-3 py-2 font-mono">{m.document_number || '—'}</td>
                            <td className="px-3 py-2">{m.full_name || '—'}</td>
                            <td className="px-3 py-2">{m.phone || '—'}</td>
                            <td className="px-3 py-2">{m.relationship || 'beneficiary'}</td>
                            <td className="px-3 py-2">{m.starts_on || 'hoy'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {members.length > 5 && (
                      <p className="border-t border-zinc-200 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
                        y {members.length - 5} filas más…
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {resultado && (
          <div className="mt-4 space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-900/50 dark:bg-green-900/20">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
              <p className="text-sm text-green-800 dark:text-green-300">
                <strong>{resultado.inserted}</strong> afiliados nuevos y{' '}
                <strong>{resultado.updated}</strong> actualizados.
              </p>
            </div>

            {resultado.failed > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
                <p className="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300">
                  {resultado.failed} fila{resultado.failed === 1 ? '' : 's'} sin importar:
                </p>
                <ul className="max-h-48 space-y-1 overflow-y-auto">
                  {resultado.errors.map((e, i) => (
                    <li key={i} className="text-xs text-amber-800 dark:text-amber-300">
                      Fila {e.row}
                      {e.document_number && ` (${e.document_number})`}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {resultado ? 'Cerrar' : 'Cancelar'}
          </button>
          {!resultado && (
            <button
              onClick={importar}
              disabled={cargando || !members || validas === 0 || faltantes.length > 0}
              className="rounded-lg bg-budi-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-budi-primary-600 disabled:opacity-50"
            >
              {cargando ? 'Importando…' : `Importar ${validas} afiliado${validas === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
