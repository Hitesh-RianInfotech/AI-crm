import { getCurrentUser } from './auth'
import {
  ROUTE_ACCESS,
  ROUTE_PERMISSIONS,
  PUBLIC_ROUTES,
  ROLES,
  isRole,
  normalizeRole,
} from './constants'

// CallCenter renamed from HumanQueue — honor either key until all roles are re-saved.
const MODULE_ALIASES = {
  CallCenter: ['HumanQueue'],
  HumanQueue: ['CallCenter'],
}

// "Edit" was merged into "Write" in the role editor, but roles saved before
// that merge can still hold { write: false, edit: true }. Treat the pair as one
// action in both directions so a legacy role isn't silently stripped of the
// buttons its admin believes it has (the roles list already displays them as one).
const ACTION_ALIASES = {
  write: ['edit'],
  edit: ['write'],
}

function actionKeys(type) {
  return [type, ...(ACTION_ALIASES[type] || [])]
}

const BASE_ACTIONS = ['read', 'write', 'edit', 'delete']

// `type` is either a base action (read/write/edit/delete) or a catalog-defined
// subPermission key for the module (e.g. 'assign', 'export') — checked
// independently of the base actions, mirroring the backend's userHasPermission.
function moduleGrants(mod, type) {
  if (!mod) return false
  if (BASE_ACTIONS.includes(type)) {
    return actionKeys(type).some((action) => mod[action])
  }
  return Boolean(mod.subPermissions?.[type])
}

export function hasPermission(category, module, type, options = {}) {
  const { allowAliases = true } = options
  const user = getCurrentUser()
  if (!user) return false
  if (isRole(user.role, ROLES.SUPER_ADMIN)) return true
  // "All Permissions" master switch: master.* grants the requested action on
  // every resource, mirroring the backend's roleMiddleware. Checked first so a
  // Master-granted role sees the menus and routes it can actually access.
  // Master has no per-module subPermissions of its own, so a sub-permission
  // check falls back to master.write — matching the backend's userHasPermission.
  const master = user.permissions?.master?.permissions?.['*']
  if (BASE_ACTIONS.includes(type) ? moduleGrants(master, type) : master?.write) return true
  const modules = user.permissions?.[category]?.permissions
  if (!modules) return false
  const keys = allowAliases ? [module, ...(MODULE_ALIASES[module] || [])] : [module]
  return keys.some((key) => moduleGrants(modules[key], type))
}

export const SCOPE_ALL = 'all'
export const SCOPE_OWN = 'own'

/**
 * Data scope for a module: 'all' (every record in the studio) or 'own' (only
 * records assigned to this user).
 *
 * Mirrors the backend's resolveScope exactly, including the rule that makes the
 * whole feature safe to roll out: only an explicit 'own' narrows. A role saved
 * before scoping existed has no scope key and must keep seeing everything.
 *
 * This is a UI hint only — the server is what actually restricts the data.
 */
export function getScope(category, module, options = {}) {
  const { allowAliases = true } = options
  const user = getCurrentUser()
  if (!user) return SCOPE_ALL
  if (isRole(user.role, ROLES.SUPER_ADMIN)) return SCOPE_ALL

  const master = user.permissions?.master?.permissions?.['*']
  if (master && (master.read || master.write || master.edit || master.delete)) {
    return SCOPE_ALL
  }

  const modules = user.permissions?.[category]?.permissions
  if (!modules) return SCOPE_ALL

  const keys = allowAliases ? [module, ...(MODULE_ALIASES[module] || [])] : [module]
  const present = keys.map((key) => modules[key]).filter(Boolean)
  if (present.length === 0) return SCOPE_ALL

  // Widest wins across aliases, matching the backend.
  return present.every((mod) => mod.scope === SCOPE_OWN) ? SCOPE_OWN : SCOPE_ALL
}

export function isOwnScope(category, module) {
  return getScope(category, module) === SCOPE_OWN
}

/** Call Center write — ignores legacy HumanQueue keys. */
export function canManageCallCenter() {
  return hasPermission('inbox', 'CallCenter', 'write', { allowAliases: false })
}

// Longest-prefix lookup so a mapping on a parent route (e.g. the customers
// list) also covers its dynamic children (/…/customers/:id), mirroring the
// ROUTE_ACCESS matching further down.
function matchRoutePrefix(map, route) {
  if (map[route]) return map[route]
  let bestKey = null
  for (const key of Object.keys(map)) {
    if (route.startsWith(`${key}/`) && (!bestKey || key.length > bestKey.length)) {
      bestKey = key
    }
  }
  return bestKey ? map[bestKey] : null
}

export function isPublicRoute(route) {
  return PUBLIC_ROUTES.some((key) => route === key || route.startsWith(`${key}/`))
}

export function canAccessRoute(route) {
  if (isPublicRoute(route)) return true

  const user = getCurrentUser()
  if (!user) return false
  if (isRole(user.role, ROLES.SUPER_ADMIN)) return true

  // Real backend-enforced permission check takes priority over the legacy
  // role-array system, for any route the backend actually gates.
  const permissionEntry = matchRoutePrefix(ROUTE_PERMISSIONS, route)
  if (permissionEntry) {
    const modules = Array.isArray(permissionEntry.module)
      ? permissionEntry.module
      : [permissionEntry.module]
    const action = permissionEntry.action || 'read'
    return modules.some((module) => hasPermission(permissionEntry.category, module, action))
  }

  // Exact match first; if not found, fall back to the longest matching prefix route.
  // This supports dynamic segments like `/ai-automation/workflows/:id` without needing to list every id.
  let allowedRoles = ROUTE_ACCESS[route]
  if (!allowedRoles) {
    let bestMatch = null
    for (const key of Object.keys(ROUTE_ACCESS)) {
      if (route === key || route.startsWith(`${key}/`)) {
        if (!bestMatch || key.length > bestMatch.length) bestMatch = key
      }
    }
    if (bestMatch) allowedRoles = ROUTE_ACCESS[bestMatch]
  }

  // Fail closed. A route mapped in neither table is denied rather than opened
  // to every authenticated user — otherwise every new page under app/ ships
  // world-readable by default, and nothing catches it. Add public pages to
  // PUBLIC_ROUTES and gated ones to ROUTE_PERMISSIONS.
  if (!allowedRoles) return false

  return allowedRoles.some((allowed) => isRole(user.role, allowed))
}

export function isSuperAdmin() {
  return isRole(getCurrentUser()?.role, ROLES.SUPER_ADMIN)
}

/** Create / edit / delete / mark shared default workflow templates. */
export function canManageDefaultWorkflows() {
  return hasPermission('AiAndAutomation', 'workflows', 'defaultWorkflows')
}

export function isAdmin() {
  return isRole(getCurrentUser()?.role, ROLES.ADMIN)
}

export function isStaff() {
  return isRole(getCurrentUser()?.role, ROLES.STAFF)
}

// Landing pages in preference order. getDefaultRedirect walks these and returns
// the first the user can actually reach.
const LANDING_CANDIDATES = [
  '/dashboard',
  '/inbox',
  '/inbox/human-queue',
  '/calendar',
  '/leads',
  '/settings/studio',
  '/settings/users-roles/customers',
  '/reports',
]

export function getDefaultRedirect() {
  const user = getCurrentUser()
  if (!user) return '/auth/login'

  // Never return a route that fails its own canAccessRoute check. The previous
  // version hardcoded staff → /inbox and admin → /, which meant a role holding
  // only inbox.CallCenter (i.e. a call-center agent) was pushed to /inbox,
  // denied there, pushed again — an infinite redirect loop, with MainLayout
  // firing a fresh error toast on every pass.
  const landing = LANDING_CANDIDATES.find((route) => canAccessRoute(route))
  if (landing) return landing

  // Genuinely nothing to show. /no-access explains that and offers a logout,
  // which is the only honest end state for a role with no permissions.
  return '/no-access'
}

export { normalizeRole, isRole }
