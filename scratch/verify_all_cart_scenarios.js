const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Load shop-products.js
const code = fs.readFileSync(path.join(__dirname, '..', 'js', 'shop-products.js'), 'utf-8');

// Mock browser environment
const localStorageStore = {};
global.localStorage = {
    getItem: (k) => localStorageStore[k] || null,
    setItem: (k, v) => { localStorageStore[k] = String(v); },
    removeItem: (k) => { delete localStorageStore[k]; },
    clear: () => { Object.keys(localStorageStore).forEach(k => delete localStorageStore[k]); }
};

global.document = {
    addEventListener: () => {},
    getElementById: (id) => ({
        id,
        textContent: '',
        style: {},
        innerHTML: '',
        classList: { add: () => {}, remove: () => {} }
    }),
    querySelectorAll: () => [],
    createElement: () => ({
        id: '',
        style: {},
        className: '',
        classList: { add: () => {}, remove: () => {} },
        setAttribute: () => {},
        removeAttribute: () => {},
        appendChild: () => {},
        remove: () => {}
    }),
    body: {
        appendChild: () => {},
        style: {}
    },
    documentElement: { style: {} }
};

global.window = {
    location: { search: '?shop=test_shop' },
    addEventListener: () => {}
};

const vm = require('vm');
vm.runInThisContext(code);

const app = new ShopProductsViewer();
app.shopId = 'test_shop';

// Test Product 1: The user's exact case - Base product "Full slaves (M)" with metadata specifications color = White
const userBaseProduct = {
    id: 'prod_123',
    product_name: 'Full slaves (M)',
    selling_price: 20.00,
    product_image: 'assets/full-slaves.jpg',
    metadata: {
        attributes: {
            color: 'White',
            brand: 'Zara',
            fabric_type: 'cotton',
            age: '18+'
        }
    }
};

app.products = [userBaseProduct];

console.log('--- Test Scenario 1: Default Color Detection ---');
const detectedColor = app.getProductDefaultColor(userBaseProduct);
console.log('Detected Color:', detectedColor);
assert.strictEqual(detectedColor, 'White', 'Default color should be White');

console.log('--- Test Scenario 2: addToCart (card grid or modal fallback) ---');
app.cart = [];
app.addToCart(userBaseProduct.id);
console.log('Cart items after addToCart:', JSON.stringify(app.cart, null, 2));
assert.strictEqual(app.cart.length, 1);
assert.strictEqual(app.cart[0].name, 'Full slaves (M) - White', 'Cart item name should be "Full slaves (M) - White"');

console.log('--- Test Scenario 3: addToCartWithOptions (modal Add to Cart with no explicit color picked) ---');
app.cart = [];
app.addToCartWithOptions(userBaseProduct, null, null, null, 20.00);
console.log('Cart items after addToCartWithOptions (null, null):', JSON.stringify(app.cart, null, 2));
assert.strictEqual(app.cart.length, 1);
assert.strictEqual(app.cart[0].name, 'Full slaves (M) - White');

console.log('--- Test Scenario 4: addToCartWithOptions with explicit color "White" ---');
app.cart = [];
app.addToCartWithOptions(userBaseProduct, 'White', 'M', null, 20.00);
console.log('Cart items after addToCartWithOptions (White, M):', JSON.stringify(app.cart, null, 2));
assert.strictEqual(app.cart.length, 1);
assert.strictEqual(app.cart[0].name, 'Full slaves (M) - White');

console.log('--- Test Scenario 5: Existing stale cart item in localStorage sanitized on load ---');
localStorage.clear();
// Simulate stale cart stored previously where name was just "Full slaves (M)"
localStorage.setItem('cart_test_shop', JSON.stringify([
    { id: 'prod_123', name: 'Full slaves (M)', price: 20.00, quantity: 1 }
]));

app.cart = [];
app.loadCartFromStorage();
console.log('Cart items after loadCartFromStorage:', JSON.stringify(app.cart, null, 2));
assert.strictEqual(app.cart[0].name, 'Full slaves (M) - White', 'Stale cart item should be sanitized to "Full slaves (M) - White"');

console.log('--- Test Scenario 6: addToCartWithVariant formatting ---');
app.cart = [];
const variant = { id: 'var_1', variant_name: 'White', price: 20.00, stock: 10 };
app.addToCartWithVariant(userBaseProduct, variant, null, { size: 'M' });
console.log('Cart items after addToCartWithVariant:', JSON.stringify(app.cart, null, 2));
assert.strictEqual(app.cart[0].name, 'Full slaves (M) - White', 'Variant cart item should format cleanly as "Full slaves (M) - White"');

console.log('\n========================================');
console.log(' ALL 6 SCENARIOS PASSED WITH FLYING COLORS!');
console.log('========================================');
