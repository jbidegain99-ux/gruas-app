'use client';

import { createContext, useContext } from 'react';
import type { Database } from '@gruas-app/shared';

export type PanelRole = Database['public']['Enums']['user_role'];

// Por defecto el rol más restringido: fuera del provider no se muestra nada de escritura.
const AdminRoleContext = createContext<PanelRole>('SUPPORT');

/** El rol de quien usa el panel, para ocultar lo que no le corresponde. */
export function AdminRoleProvider({ role, children }: { role: PanelRole; children: React.ReactNode }) {
  return <AdminRoleContext.Provider value={role}>{children}</AdminRoleContext.Provider>;
}

/**
 * true si quien mira puede cambiar configuración (solo ADMIN).
 *
 * Es solo para no mostrar botones que igual fallarían: la base rechaza la
 * escritura de soporte por su cuenta (RLS + guards, migr. 00104).
 */
export function useCanConfigure(): boolean {
  return useContext(AdminRoleContext) === 'ADMIN';
}

export function useAdminRole(): PanelRole {
  return useContext(AdminRoleContext);
}
