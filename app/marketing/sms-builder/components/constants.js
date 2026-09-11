import {
  ADMIN_TEMPLATE_VARIABLES,
  STUDIO_TEMPLATE_VARIABLES,
} from '@/lib/template-scope'

export const SMS_VARIABLES = [
  { name: '{{name}}', description: 'Contact name' },
  { name: '{{first_name}}', description: 'Contact first name' },
  { name: '{{location}}', description: 'Branch location' },
  ...STUDIO_TEMPLATE_VARIABLES,
  ...ADMIN_TEMPLATE_VARIABLES,
]

export function previewMessage(message = '') {
  return String(message || '')
    .replaceAll('{{name}}', 'John Doe')
    .replaceAll('{{first_name}}', 'John')
    .replaceAll('{{location}}', 'Stamford')
    .replaceAll('{{studio_name}}', 'Acme Studio')
    .replaceAll('{{studio_phone}}', '(555) 010-1234')
    .replaceAll('{{studio_email}}', 'hello@acmestudio.com')
    .replaceAll('{{studio_website}}', 'www.acmestudio.com')
    .replaceAll('{{studio_address}}', '123 Main St')
    .replaceAll('{{studio_city}}', 'Stamford')
    .replaceAll('{{studio_state}}', 'CT')
    .replaceAll('{{studio_zip}}', '06901')
    .replaceAll('{{admin_name}}', 'Jane Admin')
    .replaceAll('{{admin_first_name}}', 'Jane')
    .replaceAll('{{admin_last_name}}', 'Admin')
}
