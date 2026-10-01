import type { Role } from './types';

export const ROLE_LABEL: Record<Role, string> = {
  po: 'Product Owner',
  pm: 'Project Manager',
  registration: 'Registration team',
  crowd: 'Crowd team',
};

// One place that decides who can do what in the UI.
// Firestore rules enforce the same matrix on the server.
const PERMISSIONS = {
  viewOverview: ['po', 'pm', 'registration', 'crowd'],
  manageRegistrations: ['po', 'pm', 'registration'],
  operatePickup: ['po', 'pm', 'crowd'],
  manageTours: ['po', 'pm'],
  manageTeam: ['po'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined, permission: Permission) {
  return !!role && (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
