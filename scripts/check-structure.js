const fs = require('fs');
const required = [
  'app/page.jsx',
  'app/layout.jsx',
  'app/globals.css',
  'app/api/auth/route.js',
  'app/api/summary/route.js',
  'app/api/ai-chat/route.js',
  'app/api/settings/route.js',
  'lib/sampleData.js',
  'lib/analytics.js',
  'lib/aiBrain.js',
  'lib/telegram.js',
  'lib/supabaseServer.js',
  'package.json'
];

const missing = required.filter((path) => !fs.existsSync(path));
if (missing.length) {
  console.error('Missing files:');
  missing.forEach((path) => console.error(`- ${path}`));
  process.exit(1);
}

console.log('Structure OK for Vercel deploy.');
