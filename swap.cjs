const fs = require('fs');
let content = fs.readFileSync('src/components/migration/EnterpriseAnalysisPanel.tsx', 'utf-8');

// 1. Remove columnTypeEdits from the API call
content = content.replace(
  'etlQvsText, \n        columnTypeEdits,\n        setGeneratingMsg',
  'etlQvsText, \n        undefined,\n        setGeneratingMsg'
);

// 2. Swap the blocks
const p4Start = '<div className=\"surface-card p-4 border border-border\">';
const p4End = '</div>\n\n      <div className=\"surface-card p-6 border border-border\">';
const p6Start = '<div className=\"surface-card p-6 border border-border\">';
const p6End = '</div>\n    </div>\n  );';

const i1 = content.indexOf(p4Start);
const i2 = content.indexOf(p4End);
const i3 = content.indexOf(p6End);

if (i1 !== -1 && i2 !== -1 && i3 !== -1) {
  const beforeP4 = content.substring(0, i1);
  const p4Block = content.substring(i1, i2 + 6); // include closing </div>
  const p6Block = content.substring(i2 + 14, i3 + 6); // skip '\n\n      ' and include closing </div>
  const afterP6 = content.substring(i3 + 6);
  
  // Also change the description text while we are here:
  const newP6Block = p6Block.replace('Data types explicitly selected above are injected into the AI compiler.', 'No templates are utilized.');

  const newContent = beforeP4 + newP6Block + '\n\n      ' + p4Block + afterP6;
  fs.writeFileSync('src/components/migration/EnterpriseAnalysisPanel.tsx', newContent);
  console.log('Swapped and updated successfully');
} else {
  console.log('Indices not found:', i1, i2, i3);
}

