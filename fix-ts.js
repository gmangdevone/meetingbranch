const fs = require('fs');

const files = [
  'artifacts/famjam/src/pages/CreateReunion.tsx',
  'artifacts/famjam/src/pages/JoinReunion.tsx',
  'artifacts/famjam/src/pages/RegistrationDetail.tsx',
  'artifacts/famjam/src/pages/ReunionAnnouncements.tsx',
  'artifacts/famjam/src/pages/ReunionHub.tsx',
  'artifacts/famjam/src/pages/ReunionRegister.tsx',
  'artifacts/famjam/src/pages/ReunionSchedule.tsx',
  'artifacts/famjam/src/pages/admin/AdminArea.tsx',
  'artifacts/famjam/src/pages/organize/OrganizerAnnouncements.tsx',
  'artifacts/famjam/src/pages/organize/OrganizerBranches.tsx',
  'artifacts/famjam/src/pages/organize/OrganizerLayout.tsx',
  'artifacts/famjam/src/pages/organize/OrganizerOverview.tsx',
  'artifacts/famjam/src/pages/organize/OrganizerRegistrations.tsx',
  'artifacts/famjam/src/pages/organize/OrganizerReports.tsx',
  'artifacts/famjam/src/pages/organize/OrganizerSchedule.tsx',
  'artifacts/famjam/src/pages/organize/OrganizerSettings.tsx'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');

  // Fix error TS2339 in CreateReunion.tsx
  if (file.includes('CreateReunion')) {
    content = content.replace(/err\?\.error/g, '(err as any)?.error');
  }
  if (file.includes('ReunionRegister')) {
    content = content.replace(/err\?\.error/g, '(err as any)?.error');
  }

  // Add queryKey to useGetReunionByCode
  if (content.includes('useGetReunionByCode(')) {
    if (!content.includes('getGetReunionByCodeQueryKey')) {
      content = content.replace(/useGetReunionByCode(,?)/, 'useGetReunionByCode, getGetReunionByCodeQueryKey$1');
    }
    content = content.replace(/query:\s*\{([^}]*enabled:[^}]*)\}/g, (match, p1) => {
      if (match.includes('queryKey')) return match;
      return `query: { ${p1}, queryKey: getGetReunionByCodeQueryKey(code || submittedCode || "") }`;
    });
  }

  // Fix RegistrationDetail
  if (file.includes('RegistrationDetail')) {
    if (!content.includes('getGetRegistrationQueryKey')) {
      content = content.replace(/useGetRegistration/, 'useGetRegistration, getGetRegistrationQueryKey');
    }
    content = content.replace(/query:\s*\{\s*enabled:\s*!isNaN\(id\),\s*retry:\s*false\s*\}/, 'query: { enabled: !isNaN(id), retry: false, queryKey: getGetRegistrationQueryKey(id) }');
  }

  // Fix ReunionAnnouncements
  if (file.includes('ReunionAnnouncements')) {
    if (!content.includes('getListReunionAnnouncementsQueryKey')) {
      content = content.replace(/useListReunionAnnouncements/, 'useListReunionAnnouncements, getListReunionAnnouncementsQueryKey');
    }
    content = content.replace(/query:\s*\{\s*enabled:\s*!!reunion\?\.id\s*\}/, 'query: { enabled: !!reunion?.id, queryKey: getListReunionAnnouncementsQueryKey(reunion?.id ?? 0) }');
    content = content.replace(/queryKey: getGetReunionByCodeQueryKey\(code \|\| submittedCode \|\| ""\)/, 'queryKey: getGetReunionByCodeQueryKey(code)');
  }

  // Fix ReunionHub
  if (file.includes('ReunionHub')) {
    content = content.replace(/queryKey: getGetReunionByCodeQueryKey\(code \|\| submittedCode \|\| ""\)/, 'queryKey: getGetReunionByCodeQueryKey(code)');
  }
  
  // Fix JoinReunion
  if (file.includes('JoinReunion')) {
    content = content.replace(/queryKey: getGetReunionByCodeQueryKey\(code \|\| submittedCode \|\| ""\)/, 'queryKey: getGetReunionByCodeQueryKey(submittedCode)');
  }

  // Fix ReunionRegister
  if (file.includes('ReunionRegister')) {
    content = content.replace(/queryKey: getGetReunionByCodeQueryKey\(code \|\| submittedCode \|\| ""\)/, 'queryKey: getGetReunionByCodeQueryKey(code)');
  }

  // Fix ReunionSchedule
  if (file.includes('ReunionSchedule')) {
    if (!content.includes('getListReunionScheduleQueryKey')) {
      content = content.replace(/useListReunionSchedule/, 'useListReunionSchedule, getListReunionScheduleQueryKey');
    }
    content = content.replace(/query:\s*\{\s*enabled:\s*!!reunion\?\.id\s*\}/, 'query: { enabled: !!reunion?.id, queryKey: getListReunionScheduleQueryKey(reunion?.id ?? 0) }');
    content = content.replace(/queryKey: getGetReunionByCodeQueryKey\(code \|\| submittedCode \|\| ""\)/, 'queryKey: getGetReunionByCodeQueryKey(code)');
  }

  // Fix AdminArea
  if (file.includes('AdminArea')) {
    if (!content.includes('getAdminListReunionsQueryKey')) {
      content = content.replace(/useAdminListReunions/, 'useAdminListReunions, getAdminListReunionsQueryKey');
    }
    content = content.replace(/query:\s*\{\s*retry:\s*false\s*\}/, 'query: { retry: false, queryKey: getAdminListReunionsQueryKey() }');
    content = content.replace(/query:\s*\{\s*enabled:\s*!!adminReunions\s*\}/, 'query: { enabled: !!adminReunions, queryKey: getAdminListUsersQueryKey() }');
  }

  // Fix OrganizerAnnouncements
  if (file.includes('OrganizerAnnouncements')) {
    content = content.replace(/query:\s*\{\s*enabled:\s*!isNaN\(reunionId\)\s*\}/, 'query: { enabled: !isNaN(reunionId), queryKey: getListReunionAnnouncementsQueryKey(reunionId) }');
  }

  // Fix OrganizerBranches
  if (file.includes('OrganizerBranches')) {
    content = content.replace(/query:\s*\{\s*enabled:\s*!isNaN\(reunionId\)\s*\}/, 'query: { enabled: !isNaN(reunionId), queryKey: getGetReunionQueryKey(reunionId) }');
  }

  // Fix OrganizerLayout
  if (file.includes('OrganizerLayout')) {
    if (!content.includes('getGetReunionQueryKey')) {
      content = content.replace(/useGetReunion/, 'useGetReunion, getGetReunionQueryKey');
    }
    content = content.replace(/query:\s*\{\s*enabled:\s*!!reunionId,\s*retry:\s*false\s*\}/, 'query: { enabled: !!reunionId, retry: false, queryKey: getGetReunionQueryKey(reunionId) }');
  }

  // Fix OrganizerOverview
  if (file.includes('OrganizerOverview')) {
    if (!content.includes('getGetReunionQueryKey')) {
      content = content.replace(/useGetReunion/, 'useGetReunion, getGetReunionQueryKey');
    }
    content = content.replace(/query:\s*\{\s*enabled:\s*!isNaN\(reunionId\)\s*\}/, 'query: { enabled: !isNaN(reunionId), queryKey: getGetReunionQueryKey(reunionId) }');
  }

  // Fix OrganizerRegistrations
  if (file.includes('OrganizerRegistrations')) {
    content = content.replace(/query:\s*\{\s*enabled:\s*!isNaN\(reunionId\)\s*\}/, 'query: { enabled: !isNaN(reunionId), queryKey: getListReunionRegistrationsQueryKey(reunionId) }');
  }

  // Fix OrganizerReports
  if (file.includes('OrganizerReports')) {
    if (!content.includes('getGetReunionReportsQueryKey')) {
      content = content.replace(/useGetReunionReports/, 'useGetReunionReports, getGetReunionReportsQueryKey');
    }
    content = content.replace(/query:\s*\{\s*enabled:\s*!isNaN\(reunionId\)\s*\}/, 'query: { enabled: !isNaN(reunionId), queryKey: getGetReunionReportsQueryKey(reunionId) }');
  }

  // Fix OrganizerSchedule
  if (file.includes('OrganizerSchedule')) {
    content = content.replace(/query:\s*\{\s*enabled:\s*!isNaN\(reunionId\)\s*\}/, 'query: { enabled: !isNaN(reunionId), queryKey: getListReunionScheduleQueryKey(reunionId) }');
    content = content.replace(/scheduleItemId/g, 'scheduleId');
  }

  // Fix OrganizerSettings
  if (file.includes('OrganizerSettings')) {
    content = content.replace(/query:\s*\{\s*enabled:\s*!isNaN\(reunionId\)\s*\}/, 'query: { enabled: !isNaN(reunionId), queryKey: getGetReunionQueryKey(reunionId) }');
  }

  fs.writeFileSync(file, content, 'utf8');
}
