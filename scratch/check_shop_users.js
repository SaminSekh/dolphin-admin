const SUPABASE_URL = 'https://uzpujtaqzuzjtqecbzto.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-AG7Cn5lImdpWk6yS62tVw_WZax4Yas';

async function run() {
    const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,username,full_name,role,shop_id,created_at,created_by&order=created_at.asc`, { headers });
    const users = await res.json();
    const shopsRes = await fetch(`${SUPABASE_URL}/rest/v1/shops?select=id,shop_name`, { headers });
    const shops = await shopsRes.json();
    const shopMap = {};
    shops.forEach(s => shopMap[s.id] = s.shop_name);

    console.log(users.map(u => ({
        username: u.username,
        full_name: u.full_name,
        role: u.role,
        shop: shopMap[u.shop_id] || 'NO SHOP (' + u.shop_id + ')',
        created_at: u.created_at
    })));
}
run();
