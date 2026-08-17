const fs = require('fs');
const path = require('path');

function search(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' || dir === '.') {
                search(fullPath);
            }
        } else if (file.endsWith('.js') || file.endsWith('.mjs')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            if (content.includes('import.meta')) {
                console.log(fullPath);
            }
        }
    }
}

try {
    search('./node_modules');
} catch (e) {
    console.error(e);
}
