const fs = require('fs');
const path = require('path');

function searchDir(dir) {
    const files = fs.readdirSync(dir);
    for (const f of files) {
        const full = path.join(dir, f);
        const stat = fs.statSync(full);
        if (stat.isDirectory() && f !== 'node_modules' && f !== '.git') {
            searchDir(full);
        } else if (f.endsWith('.js') || f.endsWith('.html')) {
            const content = fs.readFileSync(full, 'utf8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
                if (line.includes("from('profiles')") || line.includes('from("profiles")')) {
                    console.log(`${full}:${idx + 1}: ${line.trim()}`);
                }
            });
        }
    }
}

searchDir('.');
