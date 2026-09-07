const SUPABASE_URL = 'https://uzpujtaqzuzjtqecbzto.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-AG7Cn5lImdpWk6yS62tVw_WZax4Yas';

async function inspect() {
    try {
        const headers = {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        };

        // 1. Get all shops
        const shopsRes = await fetch(`${SUPABASE_URL}/rest/v1/shops?select=id,shop_name,slug,phone,admin_phone,status`, { headers });
        const shops = await shopsRes.json();
        console.log('--- SHOPS ---');
        console.log(JSON.stringify(shops, null, 2));

        // 2. Get all profiles
        const profilesRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=id,username,full_name,role,shop_id,email`, { headers });
        const profiles = await profilesRes.json();
        console.log('\n--- PROFILES ---');
        console.log(JSON.stringify(profiles, null, 2));

        // 3. Get shop settings
        const settingsRes = await fetch(`${SUPABASE_URL}/rest/v1/shop_settings?select=id,shop_id,whatsapp_number,extra_contacts`, { headers });
        const settings = await settingsRes.json();
        console.log('\n--- SHOP SETTINGS ---');
        console.log(JSON.stringify(settings, null, 2));

    } catch (err) {
        console.error('Error inspecting:', err);
    }
}

inspect();
