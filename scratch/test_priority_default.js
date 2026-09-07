const fs = require('fs');
const assert = require('assert');

// 1. Verify inventory.html
const html = fs.readFileSync('inventory.html', 'utf8');
assert(html.includes('id="productPriority" placeholder="1000" value="1000"'), 'inventory.html input should have placeholder="1000" and value="1000"');
assert(html.includes('src="js/inventory.js?v=8"'), 'inventory.html should load inventory.js?v=8');

// 2. Verify js/inventory.js
const js = fs.readFileSync('js/inventory.js', 'utf8');
assert(js.includes("document.getElementById('productPriority').value = 1000;"), 'showAddProductModal should set value to 1000');
assert(js.includes("const priority = rawPriority !== '' && !isNaN(parseInt(rawPriority)) ? parseInt(rawPriority) : 1000;"), 'saveProduct should default priority to 1000');

// 3. Verify supabase-schema.sql
const sql = fs.readFileSync('supabase-schema.sql', 'utf8');
assert(sql.includes('priority INTEGER DEFAULT 1000,'), 'supabase-schema.sql should have priority INTEGER DEFAULT 1000');

console.log('All priority default 1000 assertions passed successfully!');
