const fs = require('fs');

const file = 'artifacts/famjam/src/pages/organize/OrganizerRegistrations.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/const exportMutation = useExportReunionRegistrations\(\);/, 
  'const { refetch: fetchExport, isFetching: isExporting } = useExportReunionRegistrations(reunionId, { query: { enabled: false } });');

content = content.replace(/exportMutation\.isPending/g, 'isExporting');

const oldHandleExport = `  const handleExport = () => {
    exportMutation.mutate({ reunionId }, {
      onSuccess: (csvText) => {
        const blob = new Blob([csvText as string], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", \`reunion-\${reunionId}-registrations.csv\`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    });
  };`;

const newHandleExport = `  const handleExport = async () => {
    const res = await fetchExport();
    if (res.data) {
      const blob = new Blob([res.data as string], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute("download", \`reunion-\${reunionId}-registrations.csv\`);
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };`;

content = content.replace(oldHandleExport, newHandleExport);
fs.writeFileSync(file, content, 'utf8');
