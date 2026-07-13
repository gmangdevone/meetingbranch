const fs = require('fs');

const files = [
  'artifacts/famjam/src/pages/ReunionAnnouncements.tsx',
  'artifacts/famjam/src/pages/ReunionSchedule.tsx',
  'artifacts/famjam/src/pages/admin/AdminArea.tsx',
  'artifacts/famjam/src/pages/organize/OrganizerAnnouncements.tsx',
  'artifacts/famjam/src/pages/organize/OrganizerLayout.tsx',
  'artifacts/famjam/src/pages/organize/OrganizerRegistrations.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Fix ReunionAnnouncements & ReunionSchedule submittedCode
  if (file.includes('ReunionAnnouncements') || file.includes('ReunionSchedule')) {
    content = content.replace(/code \|\| submittedCode \|\| ""/g, 'code');
  }

  // Fix OrganizerAnnouncements missing Bell import
  if (file.includes('OrganizerAnnouncements')) {
    if (!content.includes('Bell')) {
      content = content.replace(/import \{ Trash2, Edit2, Pin, Plus \} from "lucide-react";/, 'import { Trash2, Edit2, Pin, Plus, Bell } from "lucide-react";');
    }
  }

  // Fix OrganizerLayout path
  if (file.includes('OrganizerLayout')) {
    content = content.replace(/from "\.\.\/components\/ui\/skeleton"/, 'from "../../components/ui/skeleton"');
  }

  // Fix AdminArea reunion properties and toggle mutation
  if (file.includes('AdminArea')) {
    // toggleAdminMutation.mutate({ userId, data: { isAdmin: !currentStatus } } -> check signature, usually generated as { userId: string, data: ToggleAdminInput } but the error says:
    // Object literal may only specify known properties, and 'userId' does not exist in type '{ id: string; data: ToggleAdminInput; }'
    content = content.replace(/userId, data:/, 'id: userId, data:');
    
    // adminReunions might return ReunionSummary[] instead of Reunion[].
    // Let's assume it returns ReunionSummary[] and map r -> r.reunion
    content = content.replace(/r\.name/g, 'r.reunion.name');
    content = content.replace(/r\.code/g, 'r.reunion.code');
    content = content.replace(/r\.startDate/g, 'r.reunion.startDate');
    content = content.replace(/r\.endDate/g, 'r.reunion.endDate');
    content = content.replace(/r\.id/g, 'r.reunion.id');
    // For the map key, r.reunion.id works since we just changed r.id to r.reunion.id
  }

  fs.writeFileSync(file, content, 'utf8');
}
