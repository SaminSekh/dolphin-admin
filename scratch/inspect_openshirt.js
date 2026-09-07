const SUPABASE_URL = 'https://uzpujtaqzuzjtqecbzto.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-AG7Cn5lImdpWk6yS62tVw_WZax4Yas';

async function check() {
    const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` };
    
    // Find product openshirt
    const res = await fetch(`${SUPABASE_URL}/rest/v1/products?product_name=ilike.*openshirt*`, { headers });
    const prods = await res.json();
    console.log('--- PRODUCTS MATCHING openshirt ---');
    console.log(JSON.stringify(prods, null, 2));

    if (prods.length > 0) {
        const prodId = prods[0].id;
        const vRes = await fetch(`${SUPABASE_URL}/rest/v1/product_variants?product_id=eq.${prodId}`, { headers });
        const variants = await vRes.json();
        console.log('\n--- VARIANTS ---');
        console.log(JSON.stringify(variants, null, 2));
    }
}
check();
