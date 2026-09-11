// User Roles
export const ROLES = {
  SUPER_ADMIN: 'superadmin',
  ADMIN: 'admin',
  STAFF: 'staff',
}

// Role names are free text — they come from the /api/role collection, so the
// same role can be stored as 'superadmin', 'SuperAdmin', or 'Super Admin'.
// Every comparison against ROLES must go through these, or a miscased
// superadmin silently loses their blanket access and gets scoped to one branch.
export function normalizeRole(role) {
  return typeof role === 'string' ? role.trim().toLowerCase().replace(/[\s_-]/g, '') : ''
}

export function isRole(role, target) {
  return normalizeRole(role) === normalizeRole(target)
}

// Routes reachable without a session. canAccessRoute fails closed, so anything
// not covered by ROUTE_PERMISSIONS/ROUTE_ACCESS is denied unless listed here.
export const PUBLIC_ROUTES = [
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
  '/auth/reset-password',
  '/pay',
  '/sign-contract',
  '/unsubscribe',
  '/no-access',
]

// Route Access
export const ROUTE_ACCESS = {
  '/': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/dashboard': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/inbox': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
  '/inbox/all-messages': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
  '/inbox/human-queue': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
  '/inbox/calls': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
  '/inbox/talk-to-assistant': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
  '/leads': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/calendar': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
  '/reports': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/marketing/form-builder': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/marketing/campaigns': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/marketing/email-builder': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/marketing/text-email': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/marketing/unsubscribed': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/marketing/sms-builder': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/ai-automation/make-calls': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/ai-automation/ai-calling': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/ai-automation/ai-messaging': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/ai-automation/followup-settings': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/ai-automation/workflows': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/workflow': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/ai-automation/dynamic-lists': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/dynamic-list': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/ai-automation/ai-calling-data': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/ai-automation/training': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/settings': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
  '/settings/studio': [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.STAFF],
  '/settings/users-roles': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/settings/users-roles/users': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/settings/users-roles/roles': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/settings/users-roles/teachers': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/settings/users-roles/ai-booking-priority': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/settings/integrations': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/settings/phone': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/settings/billing': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/settings/payments': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/settings/activity-log': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/settings/curriculum': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
  '/settings/goals': [ROLES.SUPER_ADMIN, ROLES.ADMIN],
}

// Route → backend permission category/module, for routes with a real
// backend-enforced permission. Routes with no entry here fall back to
// ROUTE_ACCESS's role-array check (see canAccessRoute in lib/permissions.js).
//
// `action` defaults to 'read'. Set it explicitly when merely *viewing* the page
// implies a stronger permission than viewing the underlying data — see
// /settings/goals below.
export const ROUTE_PERMISSIONS = {
  // `module` is an array here because the dashboard page is visible if the
  // user can see ANY of its widgets — there's no single blanket dashboard
  // permission anymore (see PERMISSION in components/dashboard/widgets/registry.js
  // and components/owner-dashboard/widgets/registry.js). canAccessRoute treats
  // an array as "read on any of these modules passes".
  '/dashboard': {
    category: 'dashboard',
    module: [
      'leadConversion',
      'AiAnalytics',
      'OwnerOverviewStudentHealth',
      'OwnerOverviewRevenue',
      'OwnerOverviewLessons',
      'OwnerOverviewFunnel',
      'OwnerOverviewMarketing',
      'goals',
    ],
  },
  '/leads': { category: 'leads', module: 'manage' },
  '/calendar': { category: 'calendar', module: 'bookings' },
  '/marketing/form-builder': { category: 'marketing', module: 'forms' },
  '/marketing/campaigns': { category: 'marketing', module: 'campaigns' },
  '/marketing/email-builder': { category: 'marketing', module: 'emails' },
  '/marketing/text-email': { category: 'marketing', module: 'emails' },
  '/marketing/unsubscribed': { category: 'marketing', module: 'emails' },
  '/marketing/sms-builder': { category: 'marketing', module: 'sms' },
  '/ai-automation/make-calls': { category: 'AiAndAutomation', module: 'aiCalling' },
  '/ai-automation/ai-calling': { category: 'AiAndAutomation', module: 'aiCalling' },
  '/ai-automation/ai-calling-data': { category: 'AiAndAutomation', module: 'aiCalling' },
  '/ai-automation/ai-messaging': { category: 'AiAndAutomation', module: 'assistants' },
  '/ai-automation/followup-settings': { category: 'AiAndAutomation', module: 'assistants' },
  '/ai-automation/workflows': { category: 'AiAndAutomation', module: 'workflows' },
  '/workflow': { category: 'AiAndAutomation', module: 'workflows' },
  '/ai-automation/training': { category: 'AiAndAutomation', module: 'assistants' },
  '/ai-automation/dynamic-lists': { category: 'AiAndAutomation', module: 'dynamicLists' },
  '/dynamic-list': { category: 'AiAndAutomation', module: 'dynamicLists' },
  '/ai-automation/lead-statuses': { category: 'AiAndAutomation', module: 'leadStatuses' },
  '/inbox': { category: 'inbox', module: 'AllMessages' },
  '/inbox/all-messages': { category: 'inbox', module: 'AllMessages' },
  '/inbox/human-queue': { category: 'inbox', module: 'CallCenter' },
  '/reports': { category: 'reports', module: 'overview' },
  '/reports/teacher-commissions': { category: 'reports', module: 'teacherCommissions' },
  '/reports/callbacks': { category: 'reports', module: 'overview' },
  // The studio page *manages* locations (add/rename/delete) — it is not the
  // branch switcher, which reads GET /api/location directly and stays open to
  // every authenticated user. Leaving this ungated made it the one page every
  // role could reach, complete with Add and Delete Location buttons.
  '/settings/studio': { category: 'settings', module: 'locations' },
  '/settings/users-roles': { category: 'settings', module: 'users' },
  '/settings/users-roles/users': { category: 'settings', module: 'users' },
  '/settings/users-roles/roles': { category: 'settings', module: 'roles' },
  '/settings/users-roles/teachers': { category: 'calendar', module: 'teachers' },
  // Backend guards this route on calendar.teachers write/edit (or settings.users
  // write/edit) — see canManageAiBookingPriority in teachers.routes.js.
  '/settings/users-roles/ai-booking-priority': { category: 'calendar', module: 'teachers', action: 'write' },
  // Customers live under this path but are gated by their own permission, not
  // settings.users. Prefix matching in canAccessRoute extends this to the
  // detail route (/settings/users-roles/customers/:id) too.
  '/settings/users-roles/customers': { category: 'customers', module: 'manage' },
  '/settings/setup': { category: 'settings', module: 'setup' },
  '/settings/integrations': { category: 'settings', module: 'integration' },
  '/settings/phone': { category: 'settings', module: 'integration' },
  '/settings/billing': { category: 'settings', module: 'Billings' },
  '/settings/payments': { category: 'settings', module: 'payments' },
  '/settings/activity-log': { category: 'settings', module: 'activityLog' },
  '/settings/curriculum': { category: 'calendar', module: 'curriculum' },
  // `dashboard.goals` read is what shows the read-only Goals *widget*. Gating
  // this page on read too meant handing anyone with that tile the ability to
  // rewrite the studio's revenue and student targets. Require write instead.
  '/settings/goals': { category: 'dashboard', module: 'goals', action: 'write' },
}

// Lead Statuses
export const LEAD_STATUS = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
}

// Lead Health
export const LEAD_HEALTH = {
  COLD: 'Cold',
  CONTACTED: 'Contacted',
  CONVERTED: 'Converted',
}

// Appointment Types
export const APPOINTMENT_TYPES = {
  CALL: 'Call',
  MEETING: 'Meeting',
  DEMO: 'Demo',
  FOLLOW_UP: 'Follow-up',
}

// Contact Types
export const CONTACT_TYPES = {
  ALL: 'All',
  CUSTOMERS: 'Customers',
  LEADS: 'Leads',
  TEACHERS: 'Teachers',
}

// Communication Channels
export const CHANNELS = {
  ALL: 'All',
  EMAIL: 'Email',
  SMS: 'SMS',
  CALL: 'Call',
}

// Branch Statuses
export const BRANCH_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
}


