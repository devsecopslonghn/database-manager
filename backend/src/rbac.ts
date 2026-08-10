import { rolePermissions, type Actor, type Permission } from './domain.js';

export class AuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(message = 'The actor is not allowed to perform this action') {
    super(message);
  }
}

export function actorFromClaims(id: string, claims: Record<string, unknown>): Actor {
  const realmAccess = claims.realm_access as { roles?: unknown } | undefined;
  const resourceAccess = claims.resource_access as Record<string, { roles?: unknown }> | undefined;
  const roles = [
    ...(Array.isArray(realmAccess?.roles) ? realmAccess.roles.filter((role): role is string => typeof role === 'string') : []),
    ...(Array.isArray(resourceAccess?.['database-manager-api']?.roles) ? resourceAccess['database-manager-api'].roles.filter((role): role is string => typeof role === 'string') : []),
  ];
  return { id, roles: [...new Set(roles)] };
}

export function can(actor: Actor, permission: Permission): boolean {
  if (actor.roles.includes('database-manager-admin') || actor.roles.includes('TENANT_ADMIN') || actor.roles.includes('tenant-admin')) return true;
  return actor.roles.some((role) => {
    const normalized = role.toUpperCase().replaceAll('-', '_');
    return rolePermissions[normalized as keyof typeof rolePermissions]?.includes(permission) ?? false;
  });
}

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!can(actor, permission)) throw new AuthorizationError(`Missing permission: ${permission}`);
}
