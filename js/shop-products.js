// Global variable to catch the install prompt early
let shopDeferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    shopDeferredPrompt = e;
});

// Set shop logo as favicon (works on public pages that don't load main.js)
function setFavicon(logoUrl) {
    if (!logoUrl) return;

    // If it's a base64 data URL (potentially large), resize it for favicon use
    if (logoUrl.startsWith('data:image')) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = function () {
            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, 32, 32);
            const smallIcon = canvas.toDataURL('image/png');
            applyFavicon(smallIcon, 'image/png');
        };
        img.onerror = function () {
            // Fallback: use original URL directly
            applyFavicon(logoUrl, 'image/png');
        };
        img.src = logoUrl;
    } else {
        // External URL - use directly
        applyFavicon(logoUrl, 'image/png');
    }
}

function applyFavicon(href, mimeType) {
    document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach(el => el.remove());

    const favicon = document.createElement('link');
    favicon.rel = 'icon';
    favicon.type = mimeType;
    favicon.href = href;
    document.head.appendChild(favicon);

    const shortcutIcon = document.createElement('link');
    shortcutIcon.rel = 'shortcut icon';
    shortcutIcon.type = mimeType;
    shortcutIcon.href = href;
    document.head.appendChild(shortcutIcon);

    const appleFavicon = document.createElement('link');
    appleFavicon.rel = 'apple-touch-icon';
    appleFavicon.href = href;
    document.head.appendChild(appleFavicon);
}

// Image compression cache to avoid re-compressing same images
const _imgCompressCache = {};

/**
 * Compress an image URL client-side via canvas.
 * Returns a promise that resolves to a compressed data URL.
 * @param {string} url - Original image URL
 * @param {number} maxWidth - Max width in pixels (height scales proportionally)
 * @param {number} quality - JPEG quality 0-1
 * @returns {Promise<string>} Compressed data URL
 */
function compressImageUrl(url, maxWidth, quality) {
    // Disabled client-side base64 conversion to improve performance.
    // Serving direct image URLs is much faster.
    return Promise.resolve(url);
}

/**
 * Apply lazy compressed images to all elements with data-compress-src attribute.
 * Replaces placeholder with compressed version once loaded.
 */
function applyCompressedImages() {
    const elements = document.querySelectorAll('[data-compress-src]');
    elements.forEach(el => {
        const originalUrl = el.getAttribute('data-compress-src');
        const maxW = parseInt(el.getAttribute('data-compress-width')) || 400;
        const qual = parseFloat(el.getAttribute('data-compress-quality')) || 0.6;

        // Set original URL immediately so image is visible right away
        el.setAttribute('data-original-url', originalUrl);
        el.src = originalUrl;
        // Remove attribute now so the CSS opacity:0.3 rule no longer applies
        el.removeAttribute('data-compress-src');

        // Then swap to compressed version in the background when ready
        compressImageUrl(originalUrl, maxW, qual).then(compressed => {
            // Only replace if the element still shows the original (not already changed)
            if (el.getAttribute('data-original-url') === originalUrl) {
                el.src = compressed;
            }
        });
    });
}

// Public Shop Products Logic with Carousel, Theme Support and Cart
class ShopProductsViewer {
    constructor() {
        this.shopId = null;
        this.shopData = null;
        this.shopSettings = null;
        this.products = [];
        this.filteredProducts = [];
        this.types = new Set();
        this.cart = [];
        this.appliedDiscount = null;
        this.selectedType = 'all';
        this.selectedOrderMethod = 'whatsapp';
        this.currentSlide = 0;
        this.deferredPrompt = shopDeferredPrompt;
        this.systemDomains = { mgmt: '', public: '' };
        this.assetBase = '';

        this.init();
    }

    getAssetUrl(path) {
        if (path && (path.startsWith('http') || path.startsWith('data:'))) return path;
        return `${this.assetBase}${path}`;
    }

    async init() {
        const urlParams = new URLSearchParams(window.location.search);
        let thisShopId = urlParams.get('id');
        let shopSlug = urlParams.get('u');

        // Check for "Short Style" URL (e.g. ?free)
        if (!thisShopId && !shopSlug && window.location.search.length > 1) {
            // Take the first parameter name as the slug
            shopSlug = window.location.search.substring(1).split('&')[0].split('=')[0];
        }

        if (!thisShopId && !shopSlug) {
            console.error('URL Search Params:', window.location.search);
            this.renderError('Could not identify the shop. The link appears to be incomplete (missing Shop ID or Unique Address).');
            return;
        }

        this.shopId = thisShopId;

        try {
            // Fetch Shop Data
            let shopQuery = supabaseClient.from('shops').select('*');

            if (shopSlug) {
                shopQuery = shopQuery.eq('slug', shopSlug);
            } else {
                shopQuery = shopQuery.eq('id', this.shopId);
            }

            const { data: shop, error: shopError } = await shopQuery.maybeSingle();

            if (shopError) {
                throw new Error(`Database Error: ${shopError.message}`);
            }

            if (!shop) {
                this.renderError('We couldn\'t find the shop you\'re looking for.');
                return;
            }

            // Check for restricted status (frozen or suspended)
            const status = shop.status || 'active';
            if (status.includes('frozen') || status.includes('suspended')) {
                const adminPhone = shop.admin_phone || '+91 00000 00000';
                const adminWA = shop.admin_whatsapp || adminPhone;
                const adminTG = shop.admin_telegram || '';

                const errorMsg = `
                    <div style="max-width: 600px; margin: 50px auto; background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); border-top: 6px solid #e74c3c;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 60px; color: #e74c3c; margin-bottom: 20px;"></i>
                        <h2 style="font-size: 24px; color: #333; margin-bottom: 15px;">Shop Temporarily Unavailable</h2>
                        <p style="color: #666; line-height: 1.6; margin-bottom: 30px;">
                            This shop has been suspended by the system administrator. 
                            Please contact the administrator directly using the options below:
                        </p>
                        <div style="display: grid; gap: 10px;">
                            <a href="tel:${adminPhone}" style="display: block; padding: 15px; background: #f8f9fa; color: #333; text-decoration: none; border-radius: 10px; font-weight: 700;">
                                <i class="fas fa-phone"></i> Call Admin: ${adminPhone}
                            </a>
                            <a href="https://wa.me/${adminWA.replace(/\D/g, '')}" target="_blank" style="display: block; padding: 15px; background: #e8f5e9; color: #2e7d32; text-decoration: none; border-radius: 10px; font-weight: 700;">
                                <i class="fab fa-whatsapp"></i> WhatsApp Admin
                            </a>
                            ${adminTG ? `
                                <a href="https://t.me/${adminTG.replace('@', '')}" target="_blank" style="display: block; padding: 15px; background: #e3f2fd; color: #1565c0; text-decoration: none; border-radius: 10px; font-weight: 700;">
                                    <i class="fab fa-telegram"></i> Telegram Admin
                                </a>
                            ` : ''}
                        </div>
                    </div>
                `;
                this.renderError(errorMsg);
                return;
            }
            this.shopData = shop;
            this.shopId = shop.id;

            // Load settings, system domains, and products in PARALLEL
            const [settingsResult, domainsResult, productsResult] = await Promise.all([
                supabaseClient.from('shop_settings').select('*').eq('shop_id', this.shopId).maybeSingle(),
                supabaseClient.from('system_configs').select('key, value').or('key.eq.mgmt_domain,key.eq.public_shop_domain'),
                this.fetchProducts()
            ]);

            // Process settings
            if (settingsResult.error) {
                console.warn('Settings load error (Non-critical):', settingsResult.error);
            }
            this.shopSettings = settingsResult.data || {};

            // Process system domains
            if (domainsResult.data) {
                domainsResult.data.forEach(cfg => {
                    const cleanValue = cfg.value ? cfg.value.replace(/^https?:\/\//, '').split('/')[0].trim() : '';
                    if (cfg.key === 'mgmt_domain') this.systemDomains.mgmt = cleanValue;
                    if (cfg.key === 'public_shop_domain') this.systemDomains.public = cleanValue;
                });

                if (this.systemDomains.mgmt) {
                    this.assetBase = `https://${this.systemDomains.mgmt}/`;
                }

                // Domain Enforcement
                if (this.systemDomains.mgmt && this.systemDomains.public && window.location.hostname === this.systemDomains.mgmt) {
                    const publicUrl = window.location.href.replace(this.systemDomains.mgmt, this.systemDomains.public);
                    window.location.replace(publicUrl);
                    return;
                }
            }

            // Process products
            this.products = productsResult || [];
            this.filteredProducts = [...this.products];
            this.products.forEach(p => { if (p.type) this.types.add(p.type); });

            // Apply theme and update UI
            this.applyTheme();
            this.updateUI();

            // Render products immediately
            this.renderTypes();
            this.renderMetadataKeys();
            this.renderProducts();

            // Non-blocking: load cart, setup events, init carousel
            this.loadCartFromStorage();
            this.setupEventListeners();
            this.initCarousel();

            const yearEl = document.getElementById('year');
            if (yearEl) yearEl.textContent = new Date().getFullYear();

        } catch (error) {
            console.error('Initialization error details:', error);
            this.renderError(`Something went wrong while loading the shop: ${error.message}`);
        }
    }

    async fetchProducts() {
        // Load configured types for this shop's business type
        if (this.shopData?.business_type && this.shopData.business_type !== 'general') {
            const bizType = this.shopData.business_type;
            const bizTypeStd = bizType.charAt(0).toUpperCase() + bizType.slice(1).toLowerCase();

            const { data: typeConfig } = await supabaseClient
                .from('system_configs')
                .select('value')
                .or(`key.eq.types_${bizType},key.eq.types_${bizTypeStd}`)
                .maybeSingle();

            if (typeConfig && typeConfig.value) {
                typeConfig.value.split(',').map(t => t.trim()).filter(t => t).forEach(t => this.types.add(t));
            }
        }

        const { data, error } = await supabaseClient
            .from('products')
            .select('*')
            .eq('shop_id', this.shopId)
            .neq('show_in_store', false)
            .gt('stock', 0)
            .order('priority', { ascending: true })
            .order('product_name', { ascending: true });

        if (error) throw error;
        const products = data || [];

        // Preload active variants so lowest price across DB variants is always known
        if (products.length > 0) {
            const productIds = products.map(p => p.id);
            try {
                const { data: variants } = await supabaseClient
                    .from('product_variants')
                    .select('id, product_id, price, attributes, stock, is_active')
                    .in('product_id', productIds)
                    .eq('is_active', true);

                if (variants && variants.length > 0) {
                    const variantMap = {};
                    variants.forEach(v => {
                        if (!variantMap[v.product_id]) variantMap[v.product_id] = [];
                        variantMap[v.product_id].push(v);
                    });
                    products.forEach(p => {
                        p._variants = variantMap[p.id] || [];
                    });
                }
            } catch (vErr) {
                console.warn('Could not preload variants for store:', vErr);
            }
        }

        return products;
    }

    applyTheme() {
        const primary = this.shopSettings.theme_color || '#0f6425';
        const layout = this.shopSettings.theme_layout || 'default';

        document.documentElement.style.setProperty('--public-primary', primary);
        const secondary = this.adjustColor(primary, -20);
        document.documentElement.style.setProperty('--public-secondary', secondary);

        // Reset defaults
        document.documentElement.style.setProperty('--public-radius', '12px');
        document.documentElement.style.setProperty('--public-font', "'Inter', sans-serif");
        document.body.style.background = '#f9f9f9';
        document.body.style.color = '#333';

        // Apply Layout Specific Styles
        switch (layout) {
            case 'ocean':
                document.documentElement.style.setProperty('--public-radius', '30px');
                break;
            case 'sunset':
                document.documentElement.style.setProperty('--public-radius', '15px');
                break;
            case 'neon':
                document.body.style.background = '#0a0a0a';
                document.body.style.color = '#fff';
                document.documentElement.style.setProperty('--public-radius', '4px');
                break;
            case 'minimal':
                document.documentElement.style.setProperty('--public-radius', '0px');
                document.body.style.background = '#ffffff';
                break;
            case 'luxe':
                document.documentElement.style.setProperty('--public-font', "'Playfair Display', serif");
                document.documentElement.style.setProperty('--public-radius', '0px');
                break;
            case 'berry':
                document.documentElement.style.setProperty('--public-radius', '20px');
                break;
            case 'eco':
                document.documentElement.style.setProperty('--public-radius', '8px');
                document.body.style.background = '#f0f4f0';
                break;
            case 'royal':
                document.documentElement.style.setProperty('--public-radius', '12px');
                break;
            case 'retro':
                document.documentElement.style.setProperty('--public-radius', '0px');
                document.documentElement.style.setProperty('--public-font', "'Space Mono', monospace");
                break;
        }

        // Add theme-specific class to body for CSS targeting
        document.body.className = `public-shop-body theme-${layout}`;
    }

    adjustColor(hex, amt) {
        let usePound = false;
        if (hex[0] == "#") {
            hex = hex.slice(1);
            usePound = true;
        }

        // Handle 3-digit hex
        if (hex.length === 3) {
            hex = hex.split('').map(char => char + char).join('');
        }

        let num = parseInt(hex, 16);
        let r = (num >> 16) + amt;
        if (r > 255) r = 255; else if (r < 0) r = 0;
        let g = ((num >> 8) & 0x00FF) + amt;
        if (g > 255) g = 255; else if (g < 0) g = 0;
        let b = (num & 0x0000FF) + amt;
        if (b > 255) b = 255; else if (b < 0) b = 0;

        const rr = r.toString(16).padStart(2, '0');
        const gg = g.toString(16).padStart(2, '0');
        const bb = b.toString(16).padStart(2, '0');

        return (usePound ? "#" : "") + rr + gg + bb;
    }

    updateUI() {
        const currentTitle = this.shopSettings.seo_title || `${this.shopData.shop_name} - Online Menu`;
        document.title = currentTitle;
        document.getElementById('publicHeaderName').textContent = this.shopData.shop_name;
        document.getElementById('footerShopName').textContent = this.shopData.shop_name;
        document.getElementById('publicHeroName').textContent = this.shopData.shop_name;
        document.getElementById('publicHeroAddress').textContent = this.shopData.address || 'Address not listed';

        // Update Canonical URL
        let canonical = document.querySelector('link[rel="canonical"]');
        if (canonical) {
            const slug = this.shopData.slug || this.shopData.id;
            let origin = window.location.origin;

            // Domain Mapping: Dynamic from Super Admin panel
            if (this.systemDomains.mgmt && this.systemDomains.public && window.location.hostname === this.systemDomains.mgmt) {
                origin = origin.replace(this.systemDomains.mgmt, this.systemDomains.public);
            }
            canonical.href = `${origin}/${slug}`;
        }

        // Update Meta Description
        let metaDesc = document.querySelector('meta[name="description"]');
        if (!metaDesc) {
            metaDesc = document.createElement('meta');
            metaDesc.name = "description";
            document.head.appendChild(metaDesc);
        }
        metaDesc.content = this.shopSettings.seo_description || this.shopSettings.about_us || `Welcome to ${this.shopData.shop_name}. Buy the best products online.`;

        // Update Open Graph & Twitter Tags
        let publicOrigin = window.location.origin;
        if (this.systemDomains.mgmt && this.systemDomains.public && window.location.hostname === this.systemDomains.mgmt) {
            publicOrigin = publicOrigin.replace(this.systemDomains.mgmt, this.systemDomains.public);
        }
        const shopUrl = `${publicOrigin}/${this.shopData.slug || this.shopData.id}`;
        const shopTitle = currentTitle;
        const shopDesc = metaDesc.content;
        const shopImage = this.shopData.shop_logo || '';

        const metaUpdates = {
            'og:title': shopTitle,
            'og:description': shopDesc,
            'og:url': shopUrl,
            'og:site_name': this.shopData.shop_name,
            'og:image': shopImage,
            'twitter:title': shopTitle,
            'twitter:description': shopDesc,
            'twitter:image': shopImage,
            'twitter:url': shopUrl
        };

        for (const [key, value] of Object.entries(metaUpdates)) {
            let el = document.querySelector(`meta[property="${key}"]`) || document.querySelector(`meta[name="${key}"]`);
            if (el) {
                el.content = value;
            } else if (value) {
                const newMeta = document.createElement('meta');
                if (key.startsWith('og:')) newMeta.setAttribute('property', key);
                else newMeta.setAttribute('name', key);
                newMeta.content = value;
                document.head.appendChild(newMeta);
            }
        }

        // Update APK Logo in Menu
        const apkLogo = document.getElementById('navApkLogo');
        if (apkLogo && this.shopData.shop_logo) {
            apkLogo.src = this.shopData.shop_logo;
        }

        // Generate Dynamic PWA Manifest
        this.updateDynamicManifest();

        // Footer & Links
        const addr = this.shopData.address || 'Address not listed';
        const phone = this.shopData.phone || 'N/A';
        const whatsapp = this.shopSettings.whatsapp_number || this.shopData.phone || '';

        document.getElementById('footerAbout').textContent = this.shopSettings.about_us || 'Experience the best shopping with us. High quality products and fast delivery.';
        document.getElementById('footerAddress').textContent = addr;
        document.getElementById('footerAddressLink').href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;

        document.getElementById('footerPhone').textContent = phone;
        document.getElementById('footerPhoneLink').href = `tel:${phone}`;

        document.getElementById('footerWA').textContent = whatsapp || 'N/A';
        if (whatsapp) {
            const cleanWA = whatsapp.replace(/\+/g, '').replace(/\s/g, '');
            document.getElementById('footerWALink').href = `https://wa.me/${cleanWA}`;
        }

        if (this.shopData.shop_logo) {
            document.getElementById('publicHeaderLogo').src = this.shopData.shop_logo;

            // Set shop logo as favicon
            setFavicon(this.shopData.shop_logo);
        }

        if (this.shopSettings.banner_text) {
            document.getElementById('popupText').textContent = this.shopSettings.banner_text;
            setTimeout(() => {
                const banner = document.getElementById('bannerPopup');
                if (banner) {
                    banner.style.display = 'flex';
                    document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden';
                }
            }, 1500); // Small delay for better UX
        }

        if (this.shopSettings.opening_hours) {
            document.getElementById('footerHours').textContent = this.shopSettings.opening_hours;
        }

        const mapsUrl = this.shopSettings.google_maps_url || this.shopSettings.maps_url;
        if (mapsUrl) {
            const container = document.getElementById('mapContainer');
            const iframe = document.getElementById('googleMap');
            if (container && iframe) {
                container.style.display = 'block';
                iframe.src = mapsUrl;
            }
        }

        if (this.shopSettings.facebook_url) document.getElementById('fbLink').href = this.shopSettings.facebook_url;
        else document.getElementById('fbLink').style.display = 'none';

        if (this.shopSettings.instagram_url) document.getElementById('igLink').href = this.shopSettings.instagram_url;
        else document.getElementById('igLink').style.display = 'none';

        // Nav Drawer Population
        document.getElementById('navShopName').textContent = this.shopData.shop_name;
        document.getElementById('navYear').textContent = new Date().getFullYear();
        if (this.shopSettings.facebook_url) document.getElementById('navFb').href = this.shopSettings.facebook_url;
        if (this.shopSettings.instagram_url) document.getElementById('navIg').href = this.shopSettings.instagram_url;

        // SEO Keywords
        if (this.shopSettings.seo_keywords) {
            let meta = document.querySelector('meta[name="keywords"]');
            if (!meta) {
                meta = document.createElement('meta');
                meta.name = "keywords";
                document.head.appendChild(meta);
            }
            meta.content = this.shopSettings.seo_keywords;
        }

        // Custom Scripts Injection (only allow scripts from trusted sources, not inline)
        if (this.shopSettings.custom_scripts) {
            // Sanitize: Only allow external script src, block inline scripts
            const div = document.createElement('div');
            div.innerHTML = this.shopSettings.custom_scripts;

            // Extract and execute only external scripts (with src attribute)
            Array.from(div.querySelectorAll('script')).forEach(oldScript => {
                if (oldScript.src) {
                    const newScript = document.createElement('script');
                    newScript.src = oldScript.src;
                    if (oldScript.async) newScript.async = true;
                    if (oldScript.defer) newScript.defer = true;
                    document.body.appendChild(newScript);
                }
                // Inline scripts are intentionally skipped for security
            });

            // Append non-script elements (like style or meta)
            Array.from(div.childNodes).forEach(node => {
                if (node.nodeName !== 'SCRIPT' && node.nodeType === 1) {
                    document.head.appendChild(node.cloneNode(true));
                }
            });
        }
    }

    updateDynamicManifest() {
        const manifest = {
            "name": this.shopData.shop_name,
            "short_name": this.shopData.shop_name.substring(0, 12),
            "description": this.shopSettings.about_us || `Order from ${this.shopData.shop_name} online.`,
            "start_url": window.location.href,
            "display": "standalone",
            "background_color": "#ffffff",
            "theme_color": this.shopSettings.theme_color || "#0f6425",
            "icons": [
                {
                    "src": this.getAssetUrl(this.shopData.shop_logo || "assets/default-shop-logo.png"),
                    "sizes": "192x192",
                    "type": "image/png",
                    "purpose": "any maskable"
                },
                {
                    "src": this.getAssetUrl(this.shopData.shop_logo || "assets/default-shop-logo.png"),
                    "sizes": "512x512",
                    "type": "image/png"
                }
            ]
        };

        const stringManifest = JSON.stringify(manifest);
        const blob = new Blob([stringManifest], { type: 'application/json' });
        const manifestURL = URL.createObjectURL(blob);

        // Remove existing manifest link and add new one
        let oldManifest = document.querySelector('link[rel="manifest"]');
        if (oldManifest) oldManifest.remove();

        const newLink = document.createElement('link');
        newLink.rel = 'manifest';
        newLink.href = manifestURL;
        document.head.appendChild(newLink);
    }
    initCarousel() {
        const carousel = document.getElementById('heroCarousel');
        const dotsContainer = document.getElementById('carouselDots');
        if (!carousel || !dotsContainer) return;

        let images = this.shopSettings.carousel_images || [];

        // Handle potential stringified JSON
        if (typeof images === 'string') {
            try { images = JSON.parse(images); } catch (e) { images = []; }
        }

        // Ensure images is actually an array
        if (!Array.isArray(images)) images = [];

        // If no custom images, the default one from HTML will stay (it has the IDs)
        if (images.length === 0) return;

        // Populate carousel
        carousel.innerHTML = images.map((src, index) => `
            <div class="public-carousel-item" style="background-image: url('${src}');">
                <div class="public-hero-overlay">
                    <h2 ${index === 0 ? 'id="publicHeroName"' : ''}>${this.shopData.shop_name}</h2>
                    <p ${index === 0 ? 'id="publicHeroAddress"' : ''}>${this.shopData.address || ''}</p>
                </div>
            </div>
        `).join('');

        // Populate dots
        dotsContainer.innerHTML = images.map((_, i) => `
            <div class="carousel-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></div>
        `).join('');

        // Reset slide
        this.currentSlide = 0;
        this.updateCarousel();

        // Clear existing interval
        if (this.carouselInterval) clearInterval(this.carouselInterval);

        if (images.length > 1) {
            this.carouselInterval = setInterval(() => {
                this.currentSlide = (this.currentSlide + 1) % images.length;
                this.updateCarousel();
            }, 5000);
        }

        dotsContainer.querySelectorAll('.carousel-dot').forEach(dot => {
            dot.onclick = () => {
                this.currentSlide = parseInt(dot.dataset.index);
                this.updateCarousel();
            };
        });
    }

    updateCarousel() {
        const carousel = document.getElementById('heroCarousel');
        const dots = document.querySelectorAll('.carousel-dot');
        carousel.style.transform = `translateX(-${this.currentSlide * 100}%)`;
        dots.forEach((dot, i) => dot.classList.toggle('active', i === this.currentSlide));
    }

    renderTypes() {
        const container = document.getElementById('typesContainer');
        if (!container) return;

        // Clear only generated buttons, keep the 'All' button (first child)
        // Actually easier to just rebuild or append. 
        // Let's clear everything but the first element if we want to preserve valid event listeners on "All", 
        // OR just rebuild "All" button too.
        // The safest way given the 'All' button is static in HTML is to find it or append after it.
        // But the previous code just appended. Let's stick to appending but robustly.

        // Clear strictly the dynamic ones if possible, but simplest is:
        const allBtn = container.querySelector('[data-type="all"]');

        // Remove all siblings of allBtn
        while (allBtn && allBtn.nextSibling) {
            allBtn.nextSibling.remove();
        }

        // Sort types based on category_order if defined
        let sortedTypes = Array.from(this.types);
        if (this.shopSettings.category_order) {
            const order = this.shopSettings.category_order.split(',').map(s => s.trim().toLowerCase());
            sortedTypes.sort((a, b) => {
                const indexA = order.indexOf(a.toLowerCase());
                const indexB = order.indexOf(b.toLowerCase());
                if (indexA === -1 && indexB === -1) return a.localeCompare(b);
                if (indexA === -1) return 1;
                if (indexB === -1) return -1;
                return indexA - indexB;
            });
        } else {
            sortedTypes.sort();
        }

        sortedTypes.forEach(type => {
            const btn = document.createElement('button');
            btn.className = 'public-cat-btn'; // Keep class for styling
            btn.textContent = type;
            btn.addEventListener('click', () => {
                document.querySelectorAll('.public-cat-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedType = type;

                // Clear metadata filters
                const k = document.getElementById('metaKeySelect');
                const v = document.getElementById('metaValueSelect');
                if (k) k.value = "";
                if (v) { v.innerHTML = '<option value="">Value</option>'; v.disabled = true; }

                this.handleFilter();
            });
            container.appendChild(btn);
        });

        if (allBtn) {
            allBtn.onclick = (e) => {
                document.querySelectorAll('.public-cat-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.selectedType = 'all';

                // Clear metadata filters
                const k = document.getElementById('metaKeySelect');
                const v = document.getElementById('metaValueSelect');
                if (k) k.value = "";
                if (v) { v.innerHTML = '<option value="">Value</option>'; v.disabled = true; }

                this.handleFilter();
            };
        }
    }

    setupEventListeners() {
        // Search, Sort and Price Filters
        const searchInput = document.getElementById('publicSearch');
        const sortSelect = document.getElementById('sortProducts');
        const minPriceInput = document.getElementById('minPrice');
        const maxPriceInput = document.getElementById('maxPrice');
        const applyPriceBtn = document.getElementById('applyPriceFilter');

        if (searchInput) searchInput.addEventListener('input', () => this.handleFilter());
        if (sortSelect) sortSelect.addEventListener('change', () => this.handleFilter());
        if (applyPriceBtn) applyPriceBtn.addEventListener('click', () => this.handleFilter());

        // Filter Toggle Button
        const filterToggle = document.getElementById('filterToggle');
        const filterBar = document.getElementById('filterBar');
        if (filterToggle && filterBar) {
            filterToggle.addEventListener('click', () => {
                const isActive = filterToggle.classList.contains('active');

                if (isActive) {
                    // Close the filter
                    filterBar.classList.remove('show');
                    filterToggle.classList.remove('active');
                    setTimeout(() => {
                        filterBar.style.display = 'none';
                    }, 300);
                } else {
                    // Open the filter
                    filterBar.style.display = 'flex';
                    filterToggle.classList.add('active');
                    setTimeout(() => {
                        filterBar.classList.add('show');
                    }, 10);
                }
            });
        }

        // Metadata Filters
        const metaKeySelect = document.getElementById('metaKeySelect');
        const metaValueSelect = document.getElementById('metaValueSelect');
        if (metaKeySelect) metaKeySelect.addEventListener('change', () => this.updateMetadataValues());
        if (metaValueSelect) metaValueSelect.addEventListener('change', () => this.handleFilter());

        // Navigation and Cart
        document.getElementById('cartToggle')?.addEventListener('click', () => this.toggleCart(true));
        document.getElementById('closeCart')?.addEventListener('click', () => this.toggleCart(false));
        document.getElementById('overlay')?.addEventListener('click', () => {
            this.toggleCart(false);
            this.toggleNav(false);
        });

        // Discount and Checkout
        document.getElementById('applyDiscountBtn')?.addEventListener('click', () => this.applyDiscount());
        document.getElementById('checkoutBtn')?.addEventListener('click', () => {
            if (this.cart.length === 0) return alert('Your basket is empty!');
            this.toggleOrderModal(true);
        });

        // Order Method selection
        document.querySelectorAll('.public-order-opt').forEach(opt => {
            opt.addEventListener('click', () => {
                document.querySelectorAll('.public-order-opt').forEach(o => o.classList.remove('active'));
                opt.classList.add('active');
                this.selectedOrderMethod = opt.dataset.method;
            });
        });

        document.getElementById('cancelOrder')?.addEventListener('click', () => this.toggleOrderModal(false));
        document.getElementById('confirmOrder')?.addEventListener('click', () => this.sendOrder());

        // Nav Drawer
        document.getElementById('navToggle')?.addEventListener('click', () => this.toggleNav(true));
        document.getElementById('closeNav')?.addEventListener('click', () => this.toggleNav(false));
        document.querySelectorAll('.nav-menu a').forEach(link => {
            link.addEventListener('click', () => this.toggleNav(false));
        });

        // PWA Install logic
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

        // Check again if prompt was captured globally while we were loading
        if (shopDeferredPrompt) this.deferredPrompt = shopDeferredPrompt;

        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            shopDeferredPrompt = e;
        });

        const installBtn = document.getElementById('installAppBtn');
        if (installBtn) {
            installBtn.addEventListener('click', async (e) => {
                e.preventDefault();

                if (isIOS) {
                    alert('To install this app on iPhone/iPad: Tap the "Share" icon (square with arrow up) in Safari and select "Add to Home Screen".');
                    return;
                }

                if (!this.deferredPrompt) {
                    alert('Installation prompt not available yet. If you see the install icon in the address bar, please wait a second or try again. You can also install via the browser menu (Settings > Install App).');
                    return;
                }

                try {
                    this.deferredPrompt.prompt();
                    const { outcome } = await this.deferredPrompt.userChoice;
                    console.log(`User response to install prompt: ${outcome}`);
                    this.deferredPrompt = null;
                    shopDeferredPrompt = null;
                } catch (err) {
                    console.error('Installation error:', err);
                    alert('Installation failed. Please try installing via the browser menu.');
                }
            });
        }

        // Popup Handlers
        const closePopup = document.getElementById('closePopup');
        const popupAction = document.getElementById('popupAction');
        const bannerPopup = document.getElementById('bannerPopup');

        const hidePopup = () => {
            if (bannerPopup) bannerPopup.style.display = 'none';
            document.body.style.overflow = ''; document.documentElement.style.overflow = '';
        };

        if (closePopup) closePopup.onclick = hidePopup;
        if (popupAction) popupAction.onclick = hidePopup;
        if (bannerPopup) {
            bannerPopup.onclick = (e) => {
                if (e.target === bannerPopup) hidePopup();
            };
        }

        // Product Detail Handlers
        // Product Detail Handlers
        const detailModal = document.getElementById('productDetailModal');
        const closeDetail = document.getElementById('closeProductDetail');
        if (closeDetail && detailModal) {
            closeDetail.onclick = () => {
                detailModal.classList.remove('active');
                setTimeout(() => detailModal.style.display = 'none', 300); // Wait for potential animation
                document.body.style.overflow = ''; document.documentElement.style.overflow = '';
            };
            detailModal.onclick = (e) => {
                if (e.target === detailModal) {
                    detailModal.classList.remove('active');
                    setTimeout(() => detailModal.style.display = 'none', 300);
                    document.body.style.overflow = ''; document.documentElement.style.overflow = '';
                }
            };
        }

        // Full Screen Image Overlay Handlers
        const fsOverlay = document.getElementById('fullScreenImageOverlay');
        const detailImageWrapper = document.getElementById('detailImageWrapper');
        if (fsOverlay && detailImageWrapper) {
            let isFsSwipe = false;
            let isWrapperSwipe = false;

            // Make images undraggable to allow mouse swipe
            const detailImg = document.getElementById('detailImage');
            if (detailImg) detailImg.draggable = false;
            const fsImgEl = fsOverlay.querySelector('img');
            if (fsImgEl) fsImgEl.draggable = false;

            const handleSwipe = (diffX, isFullScreen) => {
                const thumbs = document.getElementById('detailThumbnails');
                const thumbList = thumbs ? Array.from(thumbs.querySelectorAll('.detail-thumb')) : [];
                if (thumbList.length <= 1) return;
                
                const currentIndex = thumbList.findIndex(t => t.classList.contains('active'));
                if (currentIndex === -1) return;
                
                if (diffX < 0) { // Swipe Left
                    thumbList[(currentIndex + 1) % thumbList.length].click();
                } else if (diffX > 0) { // Swipe Right
                    thumbList[(currentIndex - 1 + thumbList.length) % thumbList.length].click();
                }
                
                if (isFullScreen) {
                    setTimeout(() => {
                        const img = document.getElementById('detailImage');
                        const fsImg = fsOverlay.querySelector('img');
                        if (img && fsImg) {
                            fsImg.src = img.getAttribute('data-original-src') || img.src;
                        }
                    }, 50);
                }
            };

            const attachSwipeEvents = (element, isFullScreen) => {
                const startDrag = (x) => {
                    element.dataset.startX = x;
                    if (isFullScreen) isFsSwipe = false;
                    else isWrapperSwipe = false;
                };
                
                const endDrag = (x) => {
                    const startX = parseFloat(element.dataset.startX);
                    if (isNaN(startX)) return;
                    const diffX = x - startX;
                    if (Math.abs(diffX) > 50) {
                        if (isFullScreen) isFsSwipe = true;
                        else isWrapperSwipe = true;
                        handleSwipe(diffX, isFullScreen);
                    }
                    delete element.dataset.startX;
                };

                element.addEventListener('touchstart', (e) => startDrag(e.changedTouches[0].screenX), { passive: true });
                element.addEventListener('touchend', (e) => endDrag(e.changedTouches[0].screenX), { passive: true });
                
                element.addEventListener('mousedown', (e) => startDrag(e.clientX));
                element.addEventListener('mouseup', (e) => endDrag(e.clientX));
                element.addEventListener('mouseleave', (e) => {
                    if (element.dataset.startX) endDrag(e.clientX);
                });
            };

            attachSwipeEvents(detailImageWrapper, false);
            attachSwipeEvents(fsOverlay, true);

            detailImageWrapper.onclick = () => {
                if (isWrapperSwipe) {
                    isWrapperSwipe = false;
                    return;
                }
                const img = document.getElementById('detailImage');
                if (img) {
                    // Show ORIGINAL uncompressed image in lightbox
                    const originalSrc = img.getAttribute('data-original-src') || img.src;
                    const fsImg = fsOverlay.querySelector('img');
                    if (fsImg) fsImg.src = originalSrc;
                    fsOverlay.classList.add('active');
                    const modal = document.getElementById('productDetailModal');
                    if (modal) modal.style.overflow = 'hidden';
                }
            };

            // Prevent background scrolling (scroll bleed) when interacting with the overlay
            fsOverlay.addEventListener('touchmove', (e) => { e.preventDefault(); }, { passive: false });
            fsOverlay.addEventListener('wheel', (e) => { e.preventDefault(); }, { passive: false });

            fsOverlay.onclick = (e) => {
                if (isFsSwipe) {
                    isFsSwipe = false;
                    return;
                }
                fsOverlay.classList.remove('active');
                const modal = document.getElementById('productDetailModal');
                if (modal) modal.style.overflow = '';
            };
        }

        // Initialize Drag Scroll for horizontal containers
        this.initDragScroll(document.getElementById('typesContainer'));
        this.initDragScroll(document.getElementById('detailThumbnails'));
    }

    initDragScroll(slider) {
        if (!slider) return;

        let isDown = false;
        let startX;
        let scrollLeft;

        slider.addEventListener('mousedown', (e) => {
            isDown = true;
            slider.classList.add('dragging');
            startX = e.pageX - slider.offsetLeft;
            scrollLeft = slider.scrollLeft;
            slider.style.cursor = 'grabbing';
            slider.style.userSelect = 'none';
        });

        slider.addEventListener('mouseleave', () => {
            isDown = false;
            slider.classList.remove('dragging');
            slider.style.cursor = '';
        });

        slider.addEventListener('mouseup', () => {
            isDown = false;
            slider.classList.remove('dragging');
            slider.style.cursor = '';
            slider.style.userSelect = '';
        });

        slider.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const x = e.pageX - slider.offsetLeft;
            const walk = (x - startX) * 2; // Scroll speed
            slider.scrollLeft = scrollLeft - walk;
        });
    }

    toggleNav(show) {
        document.getElementById('navDrawer').classList.toggle('active', show);
        document.getElementById('overlay').style.display = show ? 'block' : 'none';

        // Prevent body scroll
        document.body.style.overflow = show ? 'hidden' : ''; document.documentElement.style.overflow = show ? 'hidden' : '';
    }

    renderMetadataKeys(products = this.products) {
        const keySelect = document.getElementById('metaKeySelect');
        const valueSelect = document.getElementById('metaValueSelect');
        if (!keySelect) return;

        // Keep current selection if valid
        const currentKey = keySelect.value;

        // Reset
        keySelect.innerHTML = '<option value="">Filter</option>';

        // Collect keys
        const keys = new Set();
        products.forEach(p => {
            if (p.metadata && typeof p.metadata === 'object') {
                Object.keys(p.metadata).forEach(k => {
                    if (k !== 'product_images' && k !== 'product_image') keys.add(k);
                });
            } else if (typeof p.metadata === 'string') {
                try {
                    const meta = JSON.parse(p.metadata);
                    Object.keys(meta).forEach(k => {
                        if (k !== 'product_images' && k !== 'product_image') keys.add(k);
                    });
                } catch (e) { }
            }
        });

        Array.from(keys).sort().forEach(k => {
            const label = k.charAt(0).toUpperCase() + k.slice(1).replace(/([A-Z])/g, ' $1');
            const opt = document.createElement('option');
            opt.value = k;
            opt.textContent = label;
            keySelect.appendChild(opt);
        });

        // Restore if possible
        if (currentKey && keys.has(currentKey)) {
            keySelect.value = currentKey;
        } else {
            keySelect.value = "";
            valueSelect.innerHTML = '<option value="">Value</option>';
            valueSelect.disabled = true;
        }
    }

    updateMetadataValues() {
        const keySelect = document.getElementById('metaKeySelect');
        const valueSelect = document.getElementById('metaValueSelect');
        if (!keySelect || !valueSelect) return;

        const key = keySelect.value;
        if (!key) {
            valueSelect.innerHTML = '<option value="">Value</option>';
            valueSelect.disabled = true;
            this.handleFilter();
            return;
        }

        // Collect values for this key from ALL products (or currently filtered by type)
        // Better to use products filtered by type so we don't show irrelevant values
        const typeFiltered = this.selectedType === 'all'
            ? this.products
            : this.products.filter(p => p.type === this.selectedType);

        const values = new Set();
        typeFiltered.forEach(p => {
            let meta = p.metadata;
            if (typeof meta === 'string') {
                try { meta = JSON.parse(meta); } catch (e) { meta = null; }
            }
            if (meta && meta[key]) {
                values.add(meta[key]);
            }
        });

        valueSelect.innerHTML = '<option value="">Value</option>';
        Array.from(values).sort().forEach(v => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            valueSelect.appendChild(opt);
        });
        valueSelect.disabled = false;

        // Trigger filter to clear previous metadata value selection
        this.handleFilter();
    }

    handleFilter() {
        const searchTerm = document.getElementById('publicSearch').value.toLowerCase();
        const sortValue = document.getElementById('sortProducts').value;
        const minPrice = parseFloat(document.getElementById('minPrice').value) || 0;
        const maxPrice = parseFloat(document.getElementById('maxPrice').value) || Infinity;

        const metaKey = document.getElementById('metaKeySelect') ? document.getElementById('metaKeySelect').value : '';
        const metaValue = document.getElementById('metaValueSelect') ? document.getElementById('metaValueSelect').value : '';

        // 1. Filter
        this.filteredProducts = this.products.filter(p => {
            const name = (p.product_name || '').toLowerCase();
            const matchesSearch = name.includes(searchTerm);
            const matchesType = this.selectedType === 'all' || p.type === this.selectedType;

            const price = parseFloat(p.selling_price) || 0;
            const matchesPrice = price >= minPrice && price <= maxPrice;

            // Metadata Filter
            let matchesMeta = true;
            if (metaKey && metaValue) {
                let meta = p.metadata;
                if (typeof meta === 'string') {
                    try { meta = JSON.parse(meta); } catch (e) { meta = {}; }
                }
                matchesMeta = meta && meta[metaKey] == metaValue;
            }

            return matchesSearch && matchesType && matchesPrice && matchesMeta;
        });

        // 2. Sort
        this.filteredProducts.sort((a, b) => {
            const priceA = this.getProductLowestPrice(a);
            const priceB = this.getProductLowestPrice(b);
            const dateA = new Date(a.created_at || 0).getTime();
            const dateB = new Date(b.created_at || 0).getTime();

            switch (sortValue) {
                case 'price-low': return priceA - priceB;
                case 'price-high': return priceB - priceA;
                case 'oldest': return dateA - dateB;
                case 'newest':
                default:
                    return dateB - dateA;
            }
        });

        // Reset to page 1 when filter changes
        this.currentProductPage = 1;
        this._paginationTriggered = false;

        this.renderProducts();
    }

    renderProducts() {
        const grid = document.getElementById('productsGrid');
        const currency = this.shopSettings.currency || 'INR';

        if (this.filteredProducts.length === 0) {
            grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 50px;">No products found</div>';
            return;
        }

        // Pagination settings
        const perPage = 12;
        this.currentProductPage = this.currentProductPage || 1;
        const totalProducts = this.filteredProducts.length;
        const totalPages = Math.ceil(totalProducts / perPage);
        const showProducts = this.filteredProducts.slice(0, this.currentProductPage * perPage);

        grid.innerHTML = showProducts.map(product => {
            const imgUrl = this.getAssetUrl(product.product_image || 'assets/default-product.png');
            // Get clean description (strip specs/variant data)
            let descSnippet = '';
            if (product.description) {
                descSnippet = product.description.split('--SPECIFICATIONS--')[0].split('--VARIANT_DATA--')[0].trim();
                if (descSnippet.length > 80) descSnippet = descSnippet.substring(0, 80) + '...';
            }
            // Always show the lowest price across base product, sizes, and variants
            const lowestPrice = this.getProductLowestPrice(product);
            const cardPriceHtml = this.formatCurrency(lowestPrice, currency);

            return `
                <div class="public-product-card" onclick="app.openProductDetail('${product.id}')" style="cursor:pointer;">
                    <div class="public-product-img">
                        <img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Crect fill='%23f0f0f0' width='300' height='300'/%3E%3C/svg%3E" 
                             data-compress-src="${imgUrl}" 
                             data-compress-width="400" 
                             data-compress-quality="0.6" 
                             alt="${product.product_name}" 
                             style="transition:opacity 0.3s;">
                    </div>
                    <div class="public-product-details">
                        <span class="public-product-cat">${product.type || 'General'}</span>
                        <h3 class="public-product-name">${product.product_name}</h3>
                        ${descSnippet ? `<p class="public-product-desc">${descSnippet}</p>` : ''}
                        <div class="public-product-price">${cardPriceHtml}</div>
                        <button class="public-add-btn">
                            <i class="fas fa-eye"></i> View Details
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        // Apply compressed images after rendering
        applyCompressedImages();

        // Add pagination controls (same style as inventory)
        if (totalProducts > perPage) {
            const startItem = (this.currentProductPage - 1) * perPage + 1;
            const endItem = Math.min(this.currentProductPage * perPage, totalProducts);
            grid.innerHTML += `
                <div style="grid-column:1/-1;display:flex;justify-content:space-between;align-items:center;padding:14px 16px;background:white;border:1px solid #e2e8f0;border-radius:10px;margin-top:10px;">
                    <span style="font-size:0.8rem;color:#64748b;">Showing ${startItem}-${endItem} of ${totalProducts}</span>
                    <div style="display:flex;gap:4px;align-items:center;">
                        <button onclick="app.currentProductPage=1;app.renderProducts();" ${this.currentProductPage <= 1 ? 'disabled' : ''} style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;background:white;cursor:pointer;font-size:0.75rem;${this.currentProductPage <= 1 ? 'opacity:0.4;' : ''}"><i class="fas fa-angle-double-left"></i></button>
                        <button onclick="app.currentProductPage--;app.renderProducts();" ${this.currentProductPage <= 1 ? 'disabled' : ''} style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;background:white;cursor:pointer;font-size:0.75rem;${this.currentProductPage <= 1 ? 'opacity:0.4;' : ''}"><i class="fas fa-chevron-left"></i></button>
                        <span style="padding:6px 12px;background:var(--public-primary);color:white;border-radius:6px;font-size:0.75rem;font-weight:700;">${this.currentProductPage} / ${totalPages}</span>
                        <button onclick="app.currentProductPage++;app.renderProducts();" ${this.currentProductPage >= totalPages ? 'disabled' : ''} style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;background:white;cursor:pointer;font-size:0.75rem;${this.currentProductPage >= totalPages ? 'opacity:0.4;' : ''}"><i class="fas fa-chevron-right"></i></button>
                        <button onclick="app.currentProductPage=${totalPages};app.renderProducts();" ${this.currentProductPage >= totalPages ? 'disabled' : ''} style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;background:white;cursor:pointer;font-size:0.75rem;${this.currentProductPage >= totalPages ? 'opacity:0.4;' : ''}"><i class="fas fa-angle-double-right"></i></button>
                    </div>
                </div>
            `;
        }

        // Track pagination state
        this._paginationTriggered = true;
    }

    addToCart(productId, event) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        // --- Animation Logic ---
        const btn = event ? (event.currentTarget || event.target) : null;
        const cartIcon = document.getElementById('cartToggle');
        let productImg;

        const productCard = btn ? btn.closest('.public-product-card') : null;
        if (productCard) {
            productImg = productCard.querySelector('img');
        } else {
            // Fallback for Modal
            productImg = document.getElementById('detailImage');
        }

        if (productImg && cartIcon && productImg.getBoundingClientRect) {
            const flyingImg = document.createElement('img');
            flyingImg.src = productImg.src;
            flyingImg.className = 'flying-img';

            // Initial position
            const rect = productImg.getBoundingClientRect();
            flyingImg.style.top = `${rect.top}px`;
            flyingImg.style.left = `${rect.left}px`;
            flyingImg.style.width = `${rect.width}px`;
            flyingImg.style.height = `${rect.height}px`;

            document.body.appendChild(flyingImg);

            // Target position (cart icon)
            const cartRect = cartIcon.getBoundingClientRect ? cartIcon.getBoundingClientRect() : { top: 0, left: 0 };

            setTimeout(() => {
                flyingImg.style.top = `${cartRect.top + 10}px`;
                flyingImg.style.left = `${cartRect.left + 10}px`;
                flyingImg.style.width = '20px';
                flyingImg.style.height = '20px';
                flyingImg.style.opacity = '0.5';
            }, 10);

            // Clean up and bounce cart
            setTimeout(() => {
                flyingImg.remove();
                cartIcon.classList.add('cart-bounce');
                setTimeout(() => cartIcon.classList.remove('cart-bounce'), 400);
            }, 1200);
        }

        // Button feedback
        if (btn) {
            const originalContent = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> Added!';
            btn.classList.add('added');
            setTimeout(() => {
                btn.innerHTML = originalContent;
                btn.classList.remove('added');
            }, 1500);
        }
        // -------------------------

        const defColor = this.getProductDefaultColor(product);
        const defSize = this.getProductDefaultSize(product);
        const fullName = this.formatProductTitle(product.product_name, defColor, defSize);

        const existing = this.cart.find(item => item.id === productId || item.id === product.id);
        if (existing) {
            existing.name = fullName;
            existing.quantity++;
        } else {
            this.cart.push({ id: product.id, name: fullName, price: product.selling_price, image: product.product_image, quantity: 1 });
        }

        this.saveCartToStorage();
        this.updateCartUI();
    }

    updateCartUI() {
        this.sanitizeCartItems();
        const list = document.getElementById('cartItemsList');
        const count = document.getElementById('cartCount');
        const currency = (this.shopSettings && this.shopSettings.currency) || 'INR';

        const totalQty = this.cart.reduce((sum, item) => sum + item.quantity, 0);
        if (count) count.textContent = totalQty;
        const pdpBadge = document.getElementById('pdpCartBadge');
        if (pdpBadge) {
            pdpBadge.textContent = totalQty;
            pdpBadge.style.display = totalQty > 0 ? 'inline-flex' : 'none';
        }

        if (this.cart.length === 0) {
            list.innerHTML = '<div style="text-align: center; padding: 20px;">Empty</div>';
            this.updateTotals();
            return;
        }

        list.innerHTML = this.cart.map(item => `
            <div class="public-cart-item">
                <img src="${this.getAssetUrl(item.image || 'assets/default-product.png')}" alt="${item.name}">
                <div class="public-cart-item-info">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                        <h5 style="margin: 0;">${item.name}</h5>
                        <button class="delete-item-btn" onclick="app.removeFromCart('${item.id}')" style="background: none; border: none; color: #ff4757; cursor: pointer; padding: 0 5px;">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                    <div class="public-cart-item-price">${this.formatCurrency(item.price, currency)}</div>
                    <div class="public-cart-controls">
                        <button class="public-qty-btn" onclick="app.updateQty('${item.id}', -1)">-</button>
                        <span>${item.quantity}</span>
                        <button class="public-qty-btn" onclick="app.updateQty('${item.id}', 1)">+</button>
                    </div>
                </div>
            </div>
        `).join('');

        this.updateTotals();
    }

    removeFromCart(productId) {
        if (confirm('Remove this item from basket?')) {
            this.cart = this.cart.filter(i => i.id !== productId);
            this.saveCartToStorage();
            this.updateCartUI();
        }
    }

    updateQty(productId, delta) {
        const item = this.cart.find(i => i.id === productId);
        if (item) {
            item.quantity += delta;
            if (item.quantity <= 0) this.cart = this.cart.filter(i => i.id !== productId);
            this.saveCartToStorage();
            this.updateCartUI();
        }
    }

    updateTotals() {
        const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        let discount = 0;
        const currency = (this.shopSettings && this.shopSettings.currency) || 'INR';

        if (this.appliedDiscount) {
            const d = this.appliedDiscount;
            if (subtotal >= d.minOrder) {
                discount = d.type === 'percentage' ? (subtotal * d.value / 100) : d.value;
                document.getElementById('discountRow').style.display = 'flex';
                document.getElementById('discountVal').textContent = `- ${this.formatCurrency(discount, currency)}`;
                document.getElementById('discountMsg').textContent = `Applied: ${d.name}`;
                document.getElementById('discountMsg').style.color = '#14aa14';
            } else {
                this.appliedDiscount = null;
                document.getElementById('discountRow').style.display = 'none';
                document.getElementById('discountMsg').textContent = `Min order ${this.formatCurrency(d.minOrder, currency)} required.`;
                document.getElementById('discountMsg').style.color = 'red';
            }
        }

        document.getElementById('subtotalVal').textContent = this.formatCurrency(subtotal, currency);
        document.getElementById('totalVal').textContent = this.formatCurrency(subtotal - discount, currency);
    }

    applyDiscount() {
        const input = document.getElementById('discountCode');
        const code = input.value.trim().toUpperCase();

        if (!code) return;

        let discounts = this.shopSettings.discount_codes || [];

        // Handle potential stringified JSON from database
        if (typeof discounts === 'string') {
            try {
                discounts = JSON.parse(discounts);
            } catch (e) {
                console.error('Error parsing discount codes:', e);
                discounts = [];
            }
        }

        if (!Array.isArray(discounts)) discounts = [];

        const found = discounts.find(d =>
            d.name && d.name.toUpperCase() === code && d.status === 'active'
        );

        if (found) {
            this.appliedDiscount = found;
            this.updateTotals();
            input.value = ''; // Clear input
            console.log('Discount applied:', found);
        } else {
            document.getElementById('discountMsg').textContent = 'Invalid or expired code';
            document.getElementById('discountMsg').style.color = 'red';
        }
    }

    sendOrder() {
        const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const currency = this.shopSettings.currency || 'INR';
        let discount = 0;
        let discountNote = "";

        if (this.appliedDiscount) {
            const d = this.appliedDiscount;
            if (subtotal >= d.minOrder) {
                discount = d.type === 'percentage' ? (subtotal * d.value / 100) : d.value;
                discountNote = `\n*Discount (${d.name}): -${this.formatCurrency(discount, currency)}*`;
            }
        }

        const total = subtotal - discount;
        const shopName = this.shopData?.shop_name || 'Shop';

        let message = `🛒 *NEW ORDER — ${shopName}*\n`;
        message += `📅 ${new Date().toLocaleDateString('en-GB', {day:'2-digit', month:'short', year:'numeric'})} ${new Date().toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit', hour12:true})}\n`;
        message += `━━━━━━━━━━━━━━━━━━\n\n`;

        message += `📦 *ITEMS:*\n`;
        this.cart.forEach((item, idx) => {
            message += `${idx + 1}. *${item.name}*\n`;
            message += `   Qty: ${item.quantity} × ${this.formatCurrency(item.price, currency)} = ${this.formatCurrency(item.price * item.quantity, currency)}\n`;

            // Add specs for this item
            const productId = item.id.includes('_') ? item.id.split('_')[0] : item.id;
            const product = this.products.find(p => p.id === productId);
            if (product) {
                let meta = product.metadata;
                if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e) { meta = null; } }
                if (meta && typeof meta === 'object') {
                    const skip = ['product_images','product_image','variant_images','variant_group','variant_size','variant_color','variant_label','has_variants','base_stock'];
                    const specs = Object.entries(meta).filter(([k, v]) => v && !skip.includes(k) && !k.toLowerCase().includes('image') && !Array.isArray(v) && typeof v !== 'object' && !String(v).includes('://') && !String(v).startsWith('[') && !String(v).startsWith('data:'));
                    if (specs.length > 0) {
                        message += `   📋 ${specs.map(([k, v]) => `${k.replace(/_/g,' ')}: ${v}`).join(' | ')}\n`;
                    }
                }
            }
        });

        message += `\n━━━━━━━━━━━━━━━━━━\n`;
        message += `💰 Subtotal: ${this.formatCurrency(subtotal, currency)}\n`;
        if (discount > 0) message += `ðŸ·ï¸ Discount: -${this.formatCurrency(discount, currency)}\n`;
        message += `✅ *TOTAL: ${this.formatCurrency(total, currency)}*\n`;
        message += `━━━━━━━━━━━━━━━━━━\n\n`;
        message += `ðŸ“ _Sent from ${shopName} online store_`;

        if (this.selectedOrderMethod === 'whatsapp') {
            const num = (this.shopSettings.whatsapp_number || this.shopData.phone || '').replace(/\D/g, '');
            window.open(`https://wa.me/${num}?text=${encodeURIComponent(message)}`, '_blank');
        } else {
            const user = (this.shopSettings.telegram_id || '').replace('@', '');
            window.open(`https://t.me/${user}?text=${encodeURIComponent(message)}`, '_blank');
        }
    }

    toggleCart(show) { document.getElementById('cartSidebar').classList.toggle('active', show); document.getElementById('overlay').style.display = show ? 'block' : 'none'; }
    toggleOrderModal(show) {
        const modal = document.getElementById('orderModal');
        const googleSheetUrl = this.shopSettings?.google_sheet_url;

        if (show && googleSheetUrl) {
            // Show Google Sheet order form instead of WhatsApp/Telegram
            modal.querySelector('.public-modal-content').innerHTML = `
                <h3 style="text-align:center;margin-bottom:20px;font-size:1.1rem;">Complete Your Order</h3>
                <div style="display:flex;flex-direction:column;gap:12px;">
                    <div>
                        <label style="font-size:0.8rem;font-weight:600;color:#555;margin-bottom:4px;display:block;">Your Name *</label>
                        <input type="text" id="gsOrderName" placeholder="Enter your full name" style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:0.9rem;outline:none;" required>
                    </div>
                    <div>
                        <label style="font-size:0.8rem;font-weight:600;color:#555;margin-bottom:4px;display:block;">WhatsApp Number *</label>
                        <input type="tel" id="gsOrderPhone" placeholder="+880 1XXXXXXXXX" style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:0.9rem;outline:none;" required>
                    </div>
                    <div>
                        <label style="font-size:0.8rem;font-weight:600;color:#555;margin-bottom:4px;display:block;">Delivery Location *</label>
                        <textarea id="gsOrderLocation" placeholder="Enter your full address" rows="2" style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:0.9rem;outline:none;resize:vertical;"></textarea>
                        <button type="button" id="gsPickLocation" style="margin-top:6px;padding:6px 12px;background:#f0f0f0;border:1px solid #ddd;border-radius:6px;font-size:0.75rem;cursor:pointer;color:#555;">
                            <i class="fas fa-map-marker-alt"></i> Pick from Map
                        </button>
                    </div>
                    <div>
                        <label style="font-size:0.8rem;font-weight:600;color:#555;margin-bottom:4px;display:block;">Note (Optional)</label>
                        <input type="text" id="gsOrderNote" placeholder="Any special instructions" style="width:100%;padding:12px;border:1px solid #ddd;border-radius:8px;font-size:0.9rem;outline:none;">
                    </div>
                </div>
                <div id="gsOrderStatus" style="margin-top:10px;font-size:0.8rem;text-align:center;"></div>
                <div style="display:flex;gap:10px;margin-top:20px;">
                    <button class="btn btn-secondary" style="flex:1;padding:12px;border-radius:8px;border:1px solid #ddd;background:white;cursor:pointer;" id="cancelOrder">Cancel</button>
                    <button style="flex:2;padding:12px;border-radius:8px;border:none;background:var(--public-primary,#f85606);color:white;font-weight:700;cursor:pointer;font-size:0.9rem;" id="confirmOrder">
                        <i class="fas fa-check-circle"></i> Confirm Order
                    </button>
                </div>
            `;

            // Pick from map
            modal.querySelector('#gsPickLocation').addEventListener('click', () => {
                if (navigator.geolocation) {
                    navigator.geolocation.getCurrentPosition((pos) => {
                        const loc = `${pos.coords.latitude}, ${pos.coords.longitude}`;
                        document.getElementById('gsOrderLocation').value = loc;
                        window.open(`https://www.google.com/maps?q=${loc}`, '_blank');
                    }, () => { alert('Location access denied. Please enter manually.'); });
                } else {
                    alert('Geolocation not supported. Please enter manually.');
                }
            });

            // Cancel
            modal.querySelector('#cancelOrder').addEventListener('click', () => this.toggleOrderModal(false));

            // Confirm - send to Google Sheet
            modal.querySelector('#confirmOrder').addEventListener('click', () => this.sendGoogleSheetOrder(googleSheetUrl));

            modal.classList.add('active');
        } else if (show) {
            modal.classList.add('active');
        } else {
            modal.classList.remove('active');
        }
    }

    async sendGoogleSheetOrder(sheetUrl) {
        const name = document.getElementById('gsOrderName')?.value.trim();
        const phone = document.getElementById('gsOrderPhone')?.value.trim();
        const location = document.getElementById('gsOrderLocation')?.value.trim();
        const note = document.getElementById('gsOrderNote')?.value.trim();
        const statusEl = document.getElementById('gsOrderStatus');

        if (!name || !phone || !location) {
            if (statusEl) { statusEl.textContent = 'Please fill all required fields'; statusEl.style.color = '#dc2626'; }
            return;
        }

        const currency = this.shopSettings?.currency || 'INR';
        const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        let discount = 0;
        if (this.appliedDiscount) {
            const d = this.appliedDiscount;
            if (subtotal >= d.minOrder) {
                discount = d.type === 'percentage' ? (subtotal * d.value / 100) : d.value;
            }
        }
        const total = subtotal - discount;

        // Build items string
        const items = this.cart.map((item, idx) => `${idx+1}. ${item.name} x${item.quantity} = ${this.formatCurrency(item.price * item.quantity, currency)}`).join('\n');

        const orderData = {
            shop_name: this.shopData?.shop_name || '',
            shop_id: this.shopId,
            customer_name: name,
            customer_phone: phone,
            customer_location: location,
            customer_note: note,
            items: items,
            item_count: this.cart.length,
            subtotal: subtotal,
            discount: discount,
            total: total,
            currency: currency,
            order_date: new Date().toLocaleString(),
            timestamp: new Date().toISOString()
        };

        if (statusEl) { statusEl.textContent = 'Sending order...'; statusEl.style.color = '#666'; }

        try {
            const response = await fetch(sheetUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderData)
            });

            // no-cors means we can't read response, but if no error thrown, assume success
            if (statusEl) { statusEl.textContent = '✅ Order placed successfully!'; statusEl.style.color = '#16a34a'; }

            // Clear cart
            this.cart = [];
            this.saveCartToStorage();
            this.updateCartUI();

            setTimeout(() => {
                this.toggleOrderModal(false);
                alert('Your order has been placed! We will contact you on WhatsApp.');
            }, 1500);

        } catch (error) {
            console.error('Google Sheet order error:', error);
            if (statusEl) { statusEl.textContent = '❌ Failed to send order. Please try again.'; statusEl.style.color = '#dc2626'; }
        }
    }
    getProductLowestPrice(product) {
        if (!product) return 0;
        const prices = [];

        // 1. Base selling price
        const baseSp = parseFloat(product.selling_price);
        if (!isNaN(baseSp) && baseSp > 0) {
            prices.push(baseSp);
        }

        // 2. Parse metadata attributes and custom tag/size prices
        let meta = product.metadata || {};
        if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch(e) { meta = {}; }
        }
        let attrs = meta.attributes || {};
        if (typeof attrs === 'string') {
            try { attrs = JSON.parse(attrs); } catch(e) { attrs = {}; }
        }

        const priceKeys = ['size', 'storage', 'pack', 'portion', 'volume', 'color', 'shade', 'model', 'edition', 'variant'];
        priceKeys.forEach(k => {
            [
                meta[k + '_price'], meta[k + '_prices'],
                attrs[k + '_price'], attrs[k + '_prices']
            ].forEach(map => {
                if (!map) return;
                let parsedMap = map;
                if (typeof parsedMap === 'string') {
                    try { parsedMap = JSON.parse(parsedMap); } catch(e) { parsedMap = null; }
                }
                if (parsedMap && typeof parsedMap === 'object') {
                    Object.values(parsedMap).forEach(v => {
                        const num = parseFloat(v);
                        if (!isNaN(num) && num > 0) prices.push(num);
                    });
                }
            });
        });

        // 3. Database variants (and nested size prices within variants)
        const variants = product._variants || product.variants || [];
        if (Array.isArray(variants)) {
            variants.forEach(v => {
                const vp = parseFloat(v.price);
                if (!isNaN(vp) && vp > 0) prices.push(vp);

                let vAttrs = v.attributes || {};
                if (typeof vAttrs === 'string') {
                    try { vAttrs = JSON.parse(vAttrs); } catch(e) { vAttrs = {}; }
                }
                priceKeys.forEach(k => {
                    [vAttrs[k + '_price'], vAttrs[k + '_prices']].forEach(map => {
                        if (!map) return;
                        let parsedMap = map;
                        if (typeof parsedMap === 'string') {
                            try { parsedMap = JSON.parse(parsedMap); } catch(e) { parsedMap = null; }
                        }
                        if (parsedMap && typeof parsedMap === 'object') {
                            Object.values(parsedMap).forEach(val => {
                                const num = parseFloat(val);
                                if (!isNaN(num) && num > 0) prices.push(num);
                            });
                        }
                    });
                });
            });
        }

        if (prices.length === 0) {
            return parseFloat(product.selling_price) || 0;
        }

        return Math.min(...prices);
    }

    formatProductTitle(baseName, selectedColor, selectedSize) {
        let name = (baseName || 'Product').trim();
        const activeColor = (selectedColor || '').trim();
        const activeSize = (selectedSize || '').trim();

        // If name already contains a parenthesized size, e.g. "Full slaves (M)"
        if (activeSize) {
            const sizeRegex = /\s*\(([A-Za-z0-9\s]+)\)/;
            const match = name.match(sizeRegex);
            if (match) {
                name = name.replace(sizeRegex, ` (${activeSize})`);
            } else if (!name.toLowerCase().includes(`(${activeSize.toLowerCase()})`)) {
                name += ` (${activeSize})`;
            }
        }

        if (activeColor && !name.toLowerCase().includes(activeColor.toLowerCase())) {
            const cFormatted = activeColor.charAt(0).toUpperCase() + activeColor.slice(1);
            name += ` - ${cFormatted}`;
        }

        return name;
    }

    getProductDefaultColor(product) {
        if (!product) return '';
        let meta = product.metadata || {};
        if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e) { meta = {}; } }
        let attrs = meta.attributes || {};
        if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch(e) { attrs = {}; } }

        if (product.description && product.description.includes('--SPECIFICATIONS--')) {
            try {
                const specParts = product.description.split('--SPECIFICATIONS--');
                for (let i = 1; i < specParts.length; i++) {
                    const part = specParts[i].split('--VARIANT_DATA--')[0].trim();
                    if (part) {
                        try {
                            const parsed = JSON.parse(part);
                            if (parsed && typeof parsed === 'object') {
                                meta = Object.assign({}, meta, parsed);
                                if (parsed.attributes && typeof parsed.attributes === 'object') {
                                    attrs = Object.assign({}, attrs, parsed.attributes);
                                }
                            }
                        } catch(err) {}
                    }
                }
            } catch(e) {}
        }

        const rawColor = meta.color || meta.Color || meta.available_colors || meta.Available_Colors || meta.colour || meta.shade ||
                         attrs.color || attrs.Color || attrs.available_colors || attrs.Available_Colors || attrs.colour || attrs.shade ||
                         product.color || product.colour || product.shade;

        if (rawColor) {
            const first = Array.isArray(rawColor) ? rawColor[0] : String(rawColor).split(',')[0];
            if (first && String(first).trim()) return String(first).trim();
        }

        const nameLower = (product.product_name || '').toLowerCase();
        const multiWordColors = ['navy blue', 'sky blue', 'light blue', 'dark blue', 'denim blue', 'olive green', 'army green', 'forest green', 'mint green', 'lime green', 'emerald green', 'sea green', 'baby pink', 'hot pink', 'rose pink', 'chocolate brown', 'coffee brown', 'off white', 'ash grey', 'smoke grey', 'slate grey'];
        for (const mc of multiWordColors) {
            if (nameLower.includes(mc)) {
                return mc.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            }
        }
        const singleWordColors = ['white', 'black', 'grey', 'gray', 'charcoal', 'silver', 'navy', 'blue', 'indigo', 'teal', 'turquoise', 'aqua', 'green', 'yellow', 'mustard', 'gold', 'orange', 'rust', 'coral', 'peach', 'red', 'maroon', 'burgundy', 'wine', 'pink', 'purple', 'lavender', 'violet', 'lilac', 'brown', 'camel', 'khaki', 'beige', 'cream', 'tan', 'sand', 'ivory'];
        const words = nameLower.split(/[^a-z0-9]+/);
        for (const c of singleWordColors) {
            if (words.includes(c)) {
                return c.charAt(0).toUpperCase() + c.slice(1);
            }
        }

        return '';
    }

    getProductDefaultSize(product) {
        if (!product) return '';
        let meta = product.metadata || {};
        if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e) { meta = {}; } }
        let attrs = meta.attributes || {};
        if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch(e) { attrs = {}; } }

        if (product.description && product.description.includes('--SPECIFICATIONS--')) {
            try {
                const specParts = product.description.split('--SPECIFICATIONS--');
                for (let i = 1; i < specParts.length; i++) {
                    const part = specParts[i].split('--VARIANT_DATA--')[0].trim();
                    if (part) {
                        try {
                            const parsed = JSON.parse(part);
                            if (parsed && typeof parsed === 'object') {
                                meta = Object.assign({}, meta, parsed);
                                if (parsed.attributes && typeof parsed.attributes === 'object') {
                                    attrs = Object.assign({}, attrs, parsed.attributes);
                                }
                            }
                        } catch(err) {}
                    }
                }
            } catch(e) {}
        }

        const rawSize = meta.size || meta.Size || meta.available_sizes || meta.Available_Sizes || meta.storage || meta.Storage ||
                        attrs.size || attrs.Size || attrs.available_sizes || attrs.Available_Sizes || attrs.storage || attrs.Storage;

        if (rawSize) {
            const first = Array.isArray(rawSize) ? rawSize[0] : String(rawSize).split(',')[0];
            if (first && String(first).trim()) return String(first).trim();
        }

        if (meta.size_stock && typeof meta.size_stock === 'object') {
            const keys = Object.keys(meta.size_stock);
            if (keys.length > 0) return keys[0];
        }

        if (product.product_name) {
            const m = product.product_name.match(/\(([A-Za-z0-9\s]+)\)/);
            if (m && m[1] && m[1].trim()) return m[1].trim();
        }

        return '';
    }

    sanitizeCartItems() {
        if (!Array.isArray(this.cart) || !Array.isArray(this.products) || this.products.length === 0) return;
        let changed = false;
        this.cart.forEach(item => {
            const prod = this.products.find(p => p.id === item.id || (typeof item.id === 'string' && item.id.startsWith(p.id + '_')));
            if (prod) {
                const defaultColor = this.getProductDefaultColor(prod);
                const defaultSize = this.getProductDefaultSize(prod);
                if (defaultColor) {
                    const expectedName = this.formatProductTitle(prod.product_name, defaultColor, defaultSize);
                    if (item.name !== expectedName && (!item.name.toLowerCase().includes(defaultColor.toLowerCase()) || item.name.includes('(' + defaultColor + ')'))) {
                        item.name = expectedName;
                        changed = true;
                    }
                }
            }
        });
        if (changed) {
            this.saveCartToStorage();
        }
    }

    getBaseOptionName(product) {
        return this.getProductDefaultColor(product) || 'Original';
    }

    formatCurrency(amount, currencyCode) { try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currencyCode }).format(amount || 0); } catch (e) { return (amount || 0).toFixed(2) + ' ' + currencyCode; } }
    saveCartToStorage() { localStorage.setItem(`cart_${this.shopId}`, JSON.stringify(this.cart)); }
    loadCartFromStorage() {
        const saved = localStorage.getItem(`cart_${this.shopId}`);
        if (saved) {
            try {
                this.cart = JSON.parse(saved);
                this.sanitizeCartItems();
                this.updateCartUI();
            } catch(e) {
                this.cart = [];
            }
        }
    }
    renderError(msg) { document.body.innerHTML = `<div style="text-align:center;padding:100px;">${msg}</div>`; }

    async openProductDetail(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        const modal = document.getElementById('productDetailModal');
        const img = document.getElementById('detailImage');
        const thumbs = document.getElementById('detailThumbnails');
        const nameEl = document.getElementById('detailName');
        const priceEl = document.getElementById('detailPrice');
        const cat = document.getElementById('detailCat');
        const desc = document.getElementById('detailDesc');
        const specsContainer = document.getElementById('detailSpecs');
        const addBtn = document.getElementById('detailAddToCart');
        if (!modal || !img) return;

        const currency = this.shopSettings.currency || 'INR';
        const self = this;
        // Set base product info - use compressed image for detail view
        const originalImgUrl = this.getAssetUrl(product.product_image || 'assets/default-product.png');
        img.src = originalImgUrl; // Show original immediately, compress in background
        img.setAttribute('data-original-src', originalImgUrl); // Store original for lightbox
        compressImageUrl(originalImgUrl, 600, 0.7).then(compressed => { if (img.getAttribute('data-original-src') === originalImgUrl) img.src = compressed; });

        // Add Swipe Left/Right to change variant image
        const imgWrapper = document.getElementById('detailImageWrapper');
        if (imgWrapper) {
            let isImgSwipe = false;
            imgWrapper.ontouchstart = (e) => { 
                imgWrapper.dataset.startX = e.changedTouches[0].screenX; 
                isImgSwipe = false;
            };
            imgWrapper.ontouchmove = (e) => {
                const startX = parseFloat(imgWrapper.dataset.startX);
                if (!isNaN(startX)) {
                    const diffX = e.changedTouches[0].screenX - startX;
                    if (Math.abs(diffX) > 10) e.preventDefault(); // Lock scroll vertically if swiping horizontally
                }
            };
            imgWrapper.ontouchend = (e) => {
                const startX = parseFloat(imgWrapper.dataset.startX);
                const endX = e.changedTouches[0].screenX;
                if (isNaN(startX)) return;
                const diffX = endX - startX;
                if (Math.abs(diffX) > 50) {
                    isImgSwipe = true;
                    const thumbList = thumbs ? Array.from(thumbs.querySelectorAll('.detail-thumb')) : [];
                    if (thumbList.length <= 1) return;
                    const currentIndex = thumbList.findIndex(t => t.classList.contains('active'));
                    if (currentIndex === -1) return;
                    
                    if (diffX < 0) { // Swipe Left -> Next Image
                        const nextIndex = (currentIndex + 1) % thumbList.length;
                        thumbList[nextIndex].click();
                    } else if (diffX > 0) { // Swipe Right -> Prev Image
                        const prevIndex = (currentIndex - 1 + thumbList.length) % thumbList.length;
                        thumbList[prevIndex].click();
                    }
                }
            };
            
            // Prevent opening fullscreen if it was a swipe
            const oldClick = imgWrapper.onclick;
            imgWrapper.onclick = (e) => {
                if (isImgSwipe) {
                    isImgSwipe = false;
                    return;
                }
                if (oldClick) oldClick(e);
            };
        }

        nameEl.textContent = product.product_name;
        priceEl.textContent = this.formatCurrency(this.getProductLowestPrice(product), currency);
        cat.textContent = product.type || product.category || 'General';
        const pureDesc = product.description ? product.description.split('--SPECIFICATIONS--')[0].split('--VARIANT_DATA--')[0].trim() : 'No description provided.';
        desc.textContent = pureDesc;
        addBtn.setAttribute('data-id', product.id);
        addBtn.onclick = (e) => { self.addToCart(product.id, e); };

        const buyBtn = document.getElementById('detailBuyNow');
        if (buyBtn) {
            buyBtn.setAttribute('data-id', product.id);
            buyBtn.disabled = addBtn.disabled;
            buyBtn.style.opacity = addBtn.style.opacity || '1';
            buyBtn.onclick = (e) => {
                if (buyBtn.disabled) return;
                self.addToCart(product.id, e);
                setTimeout(() => {
                    const cartSidebar = document.getElementById('cartSidebar');
                    if (cartSidebar) cartSidebar.classList.add('active');
                }, 300);
            };
        }

        const handleShareAction = (e) => {
            if (e) e.stopPropagation();
            const name = nameEl?.textContent || product.product_name;
            const price = priceEl?.textContent || '';
            const shareUrl = window.location.href;
            if (navigator.share) {
                navigator.share({ title: name, text: `Check out ${name} for ${price}!`, url: shareUrl }).catch(() => {});
            } else if (navigator.clipboard) {
                navigator.clipboard.writeText(shareUrl).then(() => {
                    self.showToast ? self.showToast('Product link copied to clipboard!') : alert('Link copied to clipboard!');
                }).catch(() => {});
            }
        };
        const headerShareBtn = document.getElementById('pdpHeaderShare');
        if (headerShareBtn) headerShareBtn.onclick = handleShareAction;
        const oldShareBtn = document.getElementById('detailShareProduct');
        if (oldShareBtn) oldShareBtn.onclick = handleShareAction;

        // Clear specs and thumbs
        specsContainer.innerHTML = '';
        if (thumbs) { thumbs.innerHTML = ''; thumbs.style.display = 'none'; }
        
        const leftBtn = document.getElementById('thumbScrollLeft');
        const rightBtn = document.getElementById('thumbScrollRight');
        if (leftBtn) leftBtn.style.display = 'none';
        if (rightBtn) rightBtn.style.display = 'none';

        // Clear any previously injected selector blocks that were moved outside specsContainer
        document.querySelectorAll('.variant-selector-container-injected').forEach(el => el.remove());

        // Load variants from product_variants table
        let variants = [];
        try {
            const { data, error } = await supabaseClient
                .from('product_variants')
                .select('*')
                .eq('product_id', productId)
                .eq('is_active', true)
                .order('created_at');

            if (!error && data && data.length > 0) {
                variants = data;
            }
        } catch (e) { console.warn('Variants load failed:', e); }

        // Build complete list of variant options including base product when base product represents a variant
        let allOptions = [];
        const baseName = this.getBaseOptionName(product);
        const alreadyHasBase = variants.some(v => (v.variant_name || '').toLowerCase().trim() === baseName.toLowerCase().trim());

        if (variants.length > 0) {
            if (!alreadyHasBase && (Number(product.stock) > 0 || product.product_image)) {
                allOptions.push({
                    id: 'base',
                    variant_name: baseName,
                    stock: product.stock,
                    price: product.selling_price,
                    image_url: product.product_image,
                    attributes: product.metadata,
                    isBase: true
                });
            }
            allOptions = allOptions.concat(variants);
        } else {
            allOptions = variants;
        }

        // If product has variants OR available options in metadata, show option pickers
        let meta = product.metadata;
        if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e) { meta = {}; } }
        meta = meta || {};

        // Parse description specifications fallback if present
        if (product.description && product.description.includes('--SPECIFICATIONS--')) {
            try {
                const specParts = product.description.split('--SPECIFICATIONS--');
                for (let i = 1; i < specParts.length; i++) {
                    const part = specParts[i].split('--VARIANT_DATA--')[0].trim();
                    if (part) {
                        try {
                            const parsed = JSON.parse(part);
                            if (parsed && typeof parsed === 'object') {
                                meta = Object.assign({}, meta, parsed);
                                if (parsed.attributes && typeof parsed.attributes === 'object') {
                                    meta.attributes = Object.assign({}, meta.attributes || {}, parsed.attributes);
                                }
                            }
                        } catch(err) {}
                    }
                }
            } catch(e) { console.warn('Failed to parse specifications from description', e); }
        }

        let metaAttrs = meta.attributes || {};
        if (typeof metaAttrs === 'string') { try { metaAttrs = JSON.parse(metaAttrs); } catch(e) { metaAttrs = {}; } }

        const extractColors = (source) => {
            if (!source || typeof source !== 'object') return [];
            const result = [];
            const colorKeys = ['available_colors', 'color', 'shade', 'colour', 'colors', 'shades', 'available_color'];
            for (const key of Object.keys(source)) {
                if (colorKeys.includes(key.toLowerCase())) {
                    const val = source[key];
                    if (Array.isArray(val)) {
                        val.forEach(v => {
                            const t = String(v || '').trim();
                            if (t && !result.some(x => x.toLowerCase() === t.toLowerCase())) result.push(t);
                        });
                    } else if (val && typeof val === 'string') {
                        val.split(',').forEach(v => {
                            const t = v.trim();
                            if (t && !result.some(x => x.toLowerCase() === t.toLowerCase())) result.push(t);
                        });
                    }
                }
            }
            return result;
        };

        let metaColors = extractColors(meta);
        extractColors(metaAttrs).forEach(c => {
            if (!metaColors.some(x => x.toLowerCase() === c.toLowerCase())) metaColors.push(c);
        });
        ['color', 'colour', 'shade'].forEach(f => {
            if (product[f]) {
                const c = String(product[f]).trim();
                if (c && !metaColors.some(x => x.toLowerCase() === c.toLowerCase())) metaColors.push(c);
            }
        });
        ['specifications', 'attributes', 'options', 'custom_fields'].forEach(col => {
            if (product[col]) {
                let parsed = product[col];
                if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch(e) { parsed = null; } }
                if (parsed && typeof parsed === 'object') {
                    extractColors(parsed).forEach(c => {
                        if (!metaColors.some(x => x.toLowerCase() === c.toLowerCase())) metaColors.push(c);
                    });
                }
            }
        });

        const extractSizes = (source) => {
            if (!source || typeof source !== 'object') return [];
            const result = [];
            const sizeKeys = ['available_sizes', 'size', 'storage', 'sizes', 'storages', 'available_size'];
            for (const key of Object.keys(source)) {
                if (sizeKeys.includes(key.toLowerCase())) {
                    const val = source[key];
                    if (Array.isArray(val)) {
                        val.forEach(v => {
                            const t = String(v || '').trim();
                            if (t && !result.some(x => x.toLowerCase() === t.toLowerCase())) result.push(t);
                        });
                    } else if (val && typeof val === 'string') {
                        val.split(',').forEach(v => {
                            const t = v.trim();
                            if (t && !result.some(x => x.toLowerCase() === t.toLowerCase())) result.push(t);
                        });
                    }
                }
            }
            return result;
        };

        let metaSizes = extractSizes(meta);
        extractSizes(metaAttrs).forEach(s => {
            if (!metaSizes.some(x => x.toLowerCase() === s.toLowerCase())) metaSizes.push(s);
        });
        const sizeStockMap = meta.size_stock || metaAttrs.size_stock;
        if (sizeStockMap && typeof sizeStockMap === 'object') {
            Object.keys(sizeStockMap).forEach(s => {
                const trimmed = String(s).trim();
                if (trimmed && !metaSizes.some(x => x.toLowerCase() === trimmed.toLowerCase())) {
                    metaSizes.push(trimmed);
                }
            });
        }
        ['specifications', 'attributes', 'options', 'custom_fields'].forEach(col => {
            if (product[col]) {
                let parsed = product[col];
                if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch(e) { parsed = null; } }
                if (parsed && typeof parsed === 'object') {
                    extractSizes(parsed).forEach(s => {
                        if (!metaSizes.some(x => x.toLowerCase() === s.toLowerCase())) metaSizes.push(s);
                    });
                }
            }
        });
        // Fallback: if metaSizes is empty, check if product_name contains size in parentheses e.g. "Full slaves (M)"
        if (metaSizes.length === 0 && product.product_name) {
            const m = product.product_name.match(/\(([A-Za-z0-9\s]+)\)/);
            if (m && m[1] && m[1].trim()) {
                metaSizes.push(m[1].trim());
            }
        }

        if (variants.length > 0 || metaColors.length > 0 || metaSizes.length > 0) {
            // Show product images as gallery thumbnails FIRST
            if (thumbs) {
                // Collect and deduplicate all images using normalized URLs
                let imageList = [];
                const addUniqueImg = (url) => {
                    if (!url) return;
                    const fullUrl = this.getAssetUrl(url);
                    if (!imageList.includes(fullUrl) && !fullUrl.includes('assets/default-product.png')) {
                        imageList.push(fullUrl);
                    }
                };

                addUniqueImg(product.product_image);
                
                let extraImages = product.product_images || [];
                if (typeof extraImages === 'string') { try { extraImages = JSON.parse(extraImages); } catch(e) { extraImages = []; } }
                if (Array.isArray(extraImages)) extraImages.forEach(addUniqueImg);
                
                const metaImages = meta.product_images || [];
                if (Array.isArray(metaImages)) metaImages.forEach(addUniqueImg);

                const imageToVariantMap = {};
                variants.forEach(v => {
                    const mapUrl = (url) => {
                        if (!url) return;
                        const fullUrl = this.getAssetUrl(url);
                        imageToVariantMap[fullUrl] = v;
                        addUniqueImg(url);
                    };
                    
                    mapUrl(v.image_url);
                    let vAttrs = v.attributes;
                    if (typeof vAttrs === 'string') { try { vAttrs = JSON.parse(vAttrs); } catch(e) { vAttrs = {}; } }
                    const variantImgs = vAttrs?.variant_images || [];
                    variantImgs.forEach(mapUrl);
                });

                if (imageList.length > 1) {
                    imageList.forEach((url, idx) => {
                        const t = document.createElement('img');
                        t.className = 'detail-thumb' + (idx === 0 ? ' active' : '');
                        t.style.border = idx === 0 ? '3px solid var(--public-primary)' : '2px solid #ddd';
                        t.setAttribute('data-original-url', url);
                        // Improved compression for clear thumbnails
                        compressImageUrl(url, 150, 0.6).then(c => { t.src = c; });
                        t.onclick = (e) => {
                            e.stopPropagation();
                            img.setAttribute('data-original-src', url);
                            compressImageUrl(url, 600, 0.7).then(c => { img.src = c; });
                            thumbs.querySelectorAll('.detail-thumb').forEach(el => { el.classList.remove('active'); el.style.border = '2px solid #ddd'; });
                            t.classList.add('active');
                            t.style.border = '3px solid var(--public-primary)';
                            // Auto-scroll clicked thumbnail to center
                            t.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

                            const matchedVariant = imageToVariantMap[url];
                            if (matchedVariant) {
                                self.activeVariant = matchedVariant;
                                Object.keys(selectedAttributes).forEach(k => delete selectedAttributes[k]);
                                priceEl.textContent = self.formatCurrency(matchedVariant.price || product.selling_price, currency);
                                nameEl.textContent = self.formatProductTitle(product.product_name, matchedVariant.variant_name, selectedAttributes['size']);
                                renderPickers();
                            } else {
                                self.activeVariant = 'base';
                                Object.keys(selectedAttributes).forEach(k => delete selectedAttributes[k]);
                                priceEl.textContent = self.formatCurrency(product.selling_price, currency);
                                nameEl.textContent = self.formatProductTitle(product.product_name, selectedAttributes['color'], selectedAttributes['size']);
                                renderPickers();
                            }
                        };
                        thumbs.appendChild(t);
                    });
                    thumbs.style.display = 'flex';
                    // Hide scroll buttons - clicking thumbnails auto-centers them
                    const leftBtn = document.getElementById('thumbScrollLeft');
                    const rightBtn = document.getElementById('thumbScrollRight');
                    if (leftBtn) leftBtn.style.display = 'none';
                    if (rightBtn) rightBtn.style.display = 'none';
                }
            }

            // Build interactive Option Pickers (Colors & Sizes)
            const selectorDiv = document.createElement('div');
            selectorDiv.className = 'variant-selector-container-injected';
            selectorDiv.style.cssText = 'margin-bottom:24px;padding:24px;background:#ffffff;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.04);border:1px solid #f1f5f9;';

            const getColorHex = (name) => {
                const n = (name || '').toLowerCase().trim();
                const map = {
                    // Base Colors
                    'black': '#000000', 'white': '#ffffff', 'grey': '#808080', 'gray': '#808080', 'charcoal': '#36454F', 'silver': '#C0C0C0',
                    'navy blue': '#000080', 'navy': '#000080', 'royal blue': '#4169E1', 'sky blue': '#87CEEB', 'light blue': '#ADD8E6',
                    'dark blue': '#00008B', 'denim blue': '#1560BD', 'indigo': '#4B0082', 'teal': '#008080', 'turquoise': '#40E0D0',
                    'aqua': '#00FFFF', 'green': '#008000', 'olive green': '#556B2F', 'army green': '#4B5320', 'forest green': '#228B22',
                    'mint green': '#98FF98', 'lime green': '#32CD32', 'emerald green': '#50C878', 'yellow': '#eab308', 'mustard': '#FFDB58',
                    'gold': '#FFD700', 'orange': '#f97316', 'rust': '#B7410E', 'coral': '#FF7F50', 'peach': '#FFE5B4', 'red': '#ef4444',
                    'maroon': '#800000', 'burgundy': '#800020', 'wine': '#722F37', 'pink': '#ec4899', 'baby pink': '#F4C2C2',
                    'hot pink': '#FF69B4', 'rose pink': '#FF66CC', 'purple': '#a855f7', 'lavender': '#E6E6FA', 'violet': '#EE82EE',
                    'lilac': '#C8A2C8', 'brown': '#A52A2A', 'chocolate brown': '#7B3F00', 'coffee brown': '#4A2C2A', 'camel': '#C19A6B',
                    'khaki': '#F0E68C', 'beige': '#F5F5DC', 'cream': '#FFFDD0', 'tan': '#D2B48C', 'sand': '#C2B280', 'stone': '#877F6C',
                    'off white': '#FAF9F6', 'ivory': '#FFFFF0',
                    // Denim Wash
                    'light wash blue': '#89CFF0', 'medium wash blue': '#3b82f6', 'dark wash blue': '#00008B', 'vintage blue': '#799dbf',
                    'stone wash blue': '#829db3', 'acid wash blue': '#9ebfcc', 'black wash': '#1c1c1c', 'grey wash': '#7a7a7a',
                    'charcoal wash': '#424242', 'white denim': '#f4f4f4', 'ecru denim': '#c2b280', 'indigo denim': '#2b3e5a',
                    'faded blue': '#6b8e99', 'rinse wash': '#18294a', 'raw denim': '#1c2841',
                    // Fashion Colors
                    'ash grey': '#B2BEB5', 'smoke grey': '#708090', 'slate grey': '#708090', 'dusty blue': '#8ca3b8', 'ice blue': '#99FFFF',
                    'petrol blue': '#1F6A7D', 'sea green': '#2E8B57', 'sage green': '#8A9A5B', 'bottle green': '#006A4E', 'moss green': '#8A9A5B',
                    'neon green': '#39FF14', 'neon yellow': '#CCFF00', 'neon orange': '#FF5F1F', 'neon pink': '#FF10F0', 'brick red': '#CB4154',
                    'cherry red': '#D2042D', 'crimson': '#DC143C', 'ruby': '#E0115F', 'terracotta': '#E2725B', 'copper': '#B87333',
                    'mocha': '#492a17', 'taupe': '#483C32', 'walnut': '#773f1a', 'chocolate': '#7B3F00', 'espresso': '#361b0d',
                    'champagne': '#F7E7CE', 'pearl white': '#EAE0C8',
                    // Patterns & Multi
                    'checkered': 'repeating-conic-gradient(#808080 0% 25%, transparent 0% 50%) 50% / 10px 10px',
                    'plaid': 'repeating-linear-gradient(45deg, #d11f26, #d11f26 10px, #8b0000 10px, #8b0000 20px)',
                    'striped': 'repeating-linear-gradient(45deg, #000, #000 5px, #fff 5px, #fff 10px)',
                    'floral': 'radial-gradient(circle at 30% 30%, #ec4899, #a855f7, #3b82f6)',
                    'printed': 'radial-gradient(circle at center, #f59e0b, #ec4899, #8b5cf6)',
                    'graphic print': '#e5e7eb',
                    'color block': 'linear-gradient(to right, #ef4444 33%, #eab308 33%, #eab308 66%, #3b82f6 66%)',
                    'camouflage': 'linear-gradient(45deg, #4B5320 25%, #556B2F 25%, #556B2F 50%, #4B5320 50%, #4B5320 75%, #556B2F 75%, #556B2F 100%)',
                    'tie-dye': 'radial-gradient(circle, #ff00ff, #00ffff, #ffff00, #ff0000)',
                    'ombre': 'linear-gradient(to bottom, #ef4444, #ffffff)',
                    'heather grey': '#b0b4b8',
                    'melange grey': '#9ca3af',
                    'multi color': 'linear-gradient(to right, red, orange, yellow, green, blue, indigo, violet)'
                };
                return map[n] || map[n.replace('-', ' ')] || '#94a3b8';
            };

            const selectedAttributes = this.selectedAttributes = {};
            this.activeVariant = 'base'; // 'base' or a variant object

            // Auto-select lowest priced in-stock option initially if options exist
            if (allOptions.length > 0) {
                let lowestOpt = allOptions[0];
                let lowestPrice = Infinity;
                allOptions.forEach(opt => {
                    const optPrice = opt.isBase ? parseFloat(product.selling_price) : parseFloat(opt.price || product.selling_price);
                    const stock = Number(opt.stock);
                    if (stock > 0 && !isNaN(optPrice) && optPrice < lowestPrice) {
                        lowestPrice = optPrice;
                        lowestOpt = opt;
                    } else if (lowestPrice === Infinity && !isNaN(optPrice) && optPrice > 0) {
                        lowestOpt = opt;
                    }
                });
                this.activeVariant = lowestOpt.isBase ? 'base' : lowestOpt;
            }

            // Parse variant images for swatch previews
            const variantImageMap = {};
            variants.forEach(v => {
                let attrs = v.attributes;
                if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch(e) { attrs = {}; } }
                let c = attrs?.color || attrs?.Color || attrs?.shade || attrs?.Shade;
                if (c) {
                    // c can be a string like "red,green" OR an array ["red","green"]
                    const colors = Array.isArray(c) ? c : String(c).split(',');
                    colors.map(x => String(x).trim()).filter(Boolean).forEach(x => {
                        if (x && v.image_url) variantImageMap[x.toLowerCase()] = v.image_url;
                    });
                }
            });

            // Function to render the Flipkart-style option pickers for the active selection ONLY
            function renderPickers() {
                selectorDiv.innerHTML = '';

                let colorsList = [];
                let sizesList = [];
                const otherGroups = {};

                if (self.activeVariant === 'base') {
                    // Extract base product options from metadata
                    colorsList = [...metaColors];
                    sizesList = [...metaSizes];

                    let prodAttrs = Object.assign({}, meta, metaAttrs);
                    Object.keys(prodAttrs).forEach(k => {
                        const kLower = k.toLowerCase().trim();
                        if (kLower.includes('image') || kLower === 'available_colors' || kLower === 'available_sizes' || kLower === 'attributes' || kLower === 'color' || kLower === 'size' || kLower === 'shade' || kLower === 'storage' || kLower === 'product_name' || kLower === 'sku') return;
                        const val = prodAttrs[k];
                        let list = [];
                        if (Array.isArray(val)) {
                            list = val.map(String).filter(Boolean);
                        } else if (val && typeof val === 'string') {
                            list = val.split(',').map(x => x.trim()).filter(Boolean);
                        }
                        if (list.length > 0 && !['brand', 'fabric_type', 'age', 'material', 'description'].includes(kLower)) {
                            otherGroups[k] = list;
                        }
                    });
                } else {
                    // Extract this specific variant's attributes
                    let attrs = self.activeVariant.attributes;
                    if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch(e) { attrs = {}; } }
                    Object.keys(attrs).forEach(k => {
                        if (k.toLowerCase().includes('image') || k === 'name') return;
                        const val = attrs[k];
                        let list = [];
                        if (Array.isArray(val)) {
                            list = val.map(String).filter(Boolean);
                        } else if (val && typeof val === 'string') {
                            list = val.split(',').map(x => x.trim()).filter(Boolean);
                        }
                        if (list.length > 0) {
                            if (k === 'color' || k === 'shade') colorsList = list;
                            else if (k === 'size' || k === 'storage') sizesList = list;
                            else otherGroups[k] = list;
                        }
                    });

                    // Fall back to product metadata sizes if variant doesn't have custom sizes
                    if (sizesList.length === 0) {
                        sizesList = [...metaSizes];
                    }
                }

                // Deduplicate colorsList and sizesList case-insensitively
                const uniqueColors = [];
                colorsList.forEach(c => {
                    const trimmed = String(c || '').trim();
                    if (trimmed && !uniqueColors.some(x => x.toLowerCase() === trimmed.toLowerCase())) {
                        uniqueColors.push(trimmed);
                    }
                });
                colorsList = uniqueColors;

                const uniqueSizes = [];
                sizesList.forEach(s => {
                    const trimmed = String(s || '').trim();
                    if (trimmed && !uniqueSizes.some(x => x.toLowerCase() === trimmed.toLowerCase())) {
                        uniqueSizes.push(trimmed);
                    }
                });
                sizesList = uniqueSizes;

                let html = '<style>.hide-scrollbar::-webkit-scrollbar { display: none; } .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }</style>';

                // 1. Variant chips list (e.g. White, Black) - styled similar to size
                if (allOptions.length > 0) {
                    const isColorVariants = allOptions.some(v => {
                        const n = (v.variant_name || '').toLowerCase().trim();
                        return getColorHex(n) !== '#94a3b8' || (v.attributes && (v.attributes.color || v.attributes.shade));
                    });
                    const variantLabelText = isColorVariants ? 'Color' : 'Variant';
                    const activeName = (self.activeVariant === 'base')
                        ? baseName
                        : (self.activeVariant && self.activeVariant.variant_name ? self.activeVariant.variant_name : (allOptions[0].variant_name || 'Option'));
                    const activeDisplayName = activeName.charAt(0).toUpperCase() + activeName.slice(1);

                    html += `<div style="margin-bottom:14px;">`;
                    html += `<div style="font-weight:700;font-size:0.85rem;color:#212121;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
                        Select ${variantLabelText}: <span id="selectedVariantLabel" style="font-weight:400;color:#555;">${activeDisplayName}</span>
                    </div>`;
                    html += `<div style="display:flex;flex-wrap:nowrap;gap:8px;overflow-x:auto;padding-bottom:8px;" id="variantChipList" class="hide-scrollbar">`;

                    allOptions.forEach((v, idx) => {
                        const vName = (v.variant_name || ('Option ' + (idx + 1))).trim();
                        const vDisplayName = vName.charAt(0).toUpperCase() + vName.slice(1);
                        const isActive = (v.isBase && self.activeVariant === 'base') || (!v.isBase && self.activeVariant && self.activeVariant.id === v.id);
                        const isOOS = v.stock !== undefined && v.stock !== null && Number(v.stock) <= 0;

                        // Color swatch dot if option is a color
                        let dotHtml = '';
                        const hex = getColorHex(vName) !== '#94a3b8' ? getColorHex(vName) : (v.attributes?.color ? getColorHex(v.attributes.color) : null);
                        if (hex) {
                            dotHtml = `<span style="width:20px;height:20px;border-radius:50%;background:${hex};border:${isActive ? '2px solid #ffffff' : '1.5px solid #94a3b8'};box-shadow:0 1px 3px rgba(0,0,0,0.18);display:inline-block;flex-shrink:0;"></span>`;
                        }

                        if (isOOS) {
                            html += `
                                <button type="button" class="flipkart-attr-chip variant-select-btn" data-idx="${idx}" disabled
                                    title="Out of Stock"
                                    style="min-width:40px;height:38px;padding:0 14px;flex:0 0 auto;border:1px solid #e0e0e0;background:#f5f5f5;color:#9e9e9e;border-radius:4px;font-size:0.85rem;font-weight:400;cursor:not-allowed;transition:all 0.15s;text-align:center;display:inline-flex;align-items:center;justify-content:center;gap:8px;position:relative;text-decoration:line-through;opacity:0.6;">
                                    ${dotHtml}<span>${vDisplayName}</span>
                                </button>
                            `;
                        } else {
                            html += `
                                <button type="button" class="flipkart-attr-chip variant-select-btn" data-idx="${idx}"
                                    style="min-width:40px;height:38px;padding:0 14px;flex:0 0 auto;border:${isActive ? '2px solid #212121' : '1px solid #e0e0e0'};background:${isActive ? '#212121' : 'white'};color:${isActive ? 'white' : '#212121'};border-radius:4px;font-size:0.85rem;font-weight:${isActive ? '600' : '400'};cursor:pointer;transition:all 0.15s;text-align:center;display:inline-flex;align-items:center;justify-content:center;gap:8px;">
                                    ${dotHtml}<span>${vDisplayName}</span>
                                </button>
                            `;
                        }
                    });

                    html += '</div></div>';
                }

                // 2. Color chips list (when metadata color options exist without DB variants) - styled similar to size
                const colorKey = 'color';
                if (allOptions.length === 0 && colorsList.length > 0) {
                    if (!selectedAttributes[colorKey] || !colorsList.map(x => x.toLowerCase()).includes(selectedAttributes[colorKey].toLowerCase())) {
                        selectedAttributes[colorKey] = colorsList[0];
                    }
                    const activeColor = selectedAttributes[colorKey];
                    const activeColorDisplay = activeColor.charAt(0).toUpperCase() + activeColor.slice(1);

                    html += '<div style="margin-bottom:14px;">';
                    html += `<div style="font-weight:700;font-size:0.85rem;color:#212121;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
                        Select Color: <span id="selectedColorLabel" style="font-weight:400;color:#555;">${activeColorDisplay}</span>
                    </div>`;
                    html += '<div style="display:flex;flex-wrap:nowrap;gap:8px;overflow-x:auto;padding-bottom:8px;" id="colorCardList" class="hide-scrollbar">';
                    colorsList.forEach((c) => {
                        const swatch = getColorHex(c);
                        const isActive = String(selectedAttributes[colorKey]).toLowerCase().trim() === String(c).toLowerCase().trim();
                        const cDisplay = c.charAt(0).toUpperCase() + c.slice(1);
                        
                        let dotHtml = '';
                        if (swatch) {
                            dotHtml = `<span style="width:20px;height:20px;border-radius:50%;background:${swatch};border:${isActive ? '2px solid #ffffff' : '1.5px solid #94a3b8'};box-shadow:0 1px 3px rgba(0,0,0,0.18);display:inline-block;flex-shrink:0;"></span>`;
                        }

                        html += `
                            <button type="button" class="flipkart-attr-chip flipkart-color-chip" data-attr-key="${colorKey}" data-attr-val="${c}"
                                style="min-width:40px;height:38px;padding:0 14px;flex:0 0 auto;border:${isActive ? '2px solid #212121' : '1px solid #e0e0e0'};background:${isActive ? '#212121' : 'white'};color:${isActive ? 'white' : '#212121'};border-radius:4px;font-size:0.85rem;font-weight:${isActive ? '600' : '400'};cursor:pointer;transition:all 0.15s;text-align:center;display:inline-flex;align-items:center;justify-content:center;gap:8px;">
                                ${dotHtml}<span>${cDisplay}</span>
                            </button>
                        `;
                    });
                    html += '</div></div>';
                }

                // 3. Sizes chips list
                const sizeKey = 'size';
                if (sizesList.length > 0) {
                    // Get per-size stock and price map from metadata or variant attributes
                    let sizeStockMap = {};
                    let sizePriceMap = {};
                    if (self.activeVariant === 'base') {
                        sizeStockMap = meta.size_stock || meta.attributes?.size_stock || {};
                        if (typeof sizeStockMap === 'string') { try { sizeStockMap = JSON.parse(sizeStockMap); } catch(e) { sizeStockMap = {}; } }
                        sizePriceMap = meta.size_price || meta.attributes?.size_price || meta.size_prices || meta.attributes?.size_prices || {};
                        if (typeof sizePriceMap === 'string') { try { sizePriceMap = JSON.parse(sizePriceMap); } catch(e) { sizePriceMap = {}; } }
                    } else {
                        let attrs = self.activeVariant.attributes;
                        if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch(e) { attrs = {}; } }
                        sizeStockMap = attrs.size_stock || {};
                        if (typeof sizeStockMap === 'string') { try { sizeStockMap = JSON.parse(sizeStockMap); } catch(e) { sizeStockMap = {}; } }
                        sizePriceMap = attrs.size_price || attrs.size_prices || {};
                        if (typeof sizePriceMap === 'string') { try { sizePriceMap = JSON.parse(sizePriceMap); } catch(e) { sizePriceMap = {}; } }

                        // Fallback to product metadata if variant doesn't define custom size stocks/prices
                        if (Object.keys(sizeStockMap).length === 0) {
                            sizeStockMap = meta.size_stock || meta.attributes?.size_stock || {};
                            if (typeof sizeStockMap === 'string') { try { sizeStockMap = JSON.parse(sizeStockMap); } catch(e) { sizeStockMap = {}; } }
                        }
                        if (Object.keys(sizePriceMap).length === 0) {
                            sizePriceMap = meta.size_price || meta.attributes?.size_price || meta.size_prices || meta.attributes?.size_prices || {};
                            if (typeof sizePriceMap === 'string') { try { sizePriceMap = JSON.parse(sizePriceMap); } catch(e) { sizePriceMap = {}; } }
                        }
                    }

                    // Skip OOS sizes and auto-select the size with the lowest price
                    const availableSizes = sizesList.filter(s => {
                        const stock = sizeStockMap[s];
                        return stock === undefined || stock === null || Number(stock) > 0;
                    });
                    const candidateSizes = availableSizes.length > 0 ? availableSizes : sizesList;
                    let defaultSize = candidateSizes[0];
                    if (candidateSizes.length > 1) {
                        defaultSize = candidateSizes.reduce((minS, curS) => {
                            const pCur = (sizePriceMap && sizePriceMap[curS] !== undefined && sizePriceMap[curS] !== null && sizePriceMap[curS] !== '') ? parseFloat(sizePriceMap[curS]) : (parseFloat(product.selling_price) || 0);
                            const pMin = (sizePriceMap && sizePriceMap[minS] !== undefined && sizePriceMap[minS] !== null && sizePriceMap[minS] !== '') ? parseFloat(sizePriceMap[minS]) : (parseFloat(product.selling_price) || 0);
                            return (!isNaN(pCur) && pCur > 0 && (isNaN(pMin) || pCur < pMin)) ? curS : minS;
                        }, candidateSizes[0]);
                    }

                    if (!selectedAttributes[sizeKey] || !sizesList.map(x => x.toLowerCase()).includes(selectedAttributes[sizeKey].toLowerCase())) {
                        selectedAttributes[sizeKey] = defaultSize;
                    }
                    html += `<div style="margin-bottom:14px;">`;
                    html += `<div style="font-weight:700;font-size:0.85rem;color:#212121;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
                        Select Size: <span id="selectedSizeLabel" style="font-weight:400;color:#555;">${selectedAttributes[sizeKey]}</span>
                    </div>`;
                    html += `<div style="display:flex;flex-wrap:nowrap;gap:8px;overflow-x:auto;padding-bottom:8px;" id="attrChipList_${sizeKey}" class="hide-scrollbar">`;
                    sizesList.forEach((v) => {
                        const isActive = String(selectedAttributes[sizeKey]).toLowerCase().trim() === String(v).toLowerCase().trim();
                        const sizeStock = sizeStockMap[v];
                        const isOOS = sizeStock !== undefined && sizeStock !== null && Number(sizeStock) === 0;

                        if (isOOS) {
                            // Show disabled chip with strikethrough for out-of-stock size
                            html += `
                                <button type="button" class="flipkart-attr-chip" data-attr-key="${sizeKey}" data-attr-val="${v}" disabled
                                    title="Out of Stock"
                                    style="min-width:40px;height:36px;padding:0 12px;flex:0 0 auto;border:1px solid #e0e0e0;background:#f5f5f5;color:#9e9e9e;border-radius:4px;font-size:0.85rem;font-weight:400;cursor:not-allowed;transition:all 0.15s;text-align:center;display:inline-flex;align-items:center;justify-content:center;position:relative;text-decoration:line-through;opacity:0.6;">
                                    ${v}
                                </button>
                            `;
                        } else {
                            html += `
                                <button type="button" class="flipkart-attr-chip" data-attr-key="${sizeKey}" data-attr-val="${v}" style="min-width:40px;height:36px;padding:0 12px;flex:0 0 auto;border:${isActive ? '2px solid #212121' : '1px solid #e0e0e0'};background:${isActive ? '#212121' : 'white'};color:${isActive ? 'white' : '#212121'};border-radius:4px;font-size:0.85rem;font-weight:${isActive ? '600' : '400'};cursor:pointer;transition:all 0.15s;text-align:center;display:inline-flex;align-items:center;justify-content:center;">
                                    ${v}
                                </button>
                            `;
                        }
                    });
                    html += '</div></div>';
                }

                // 3. Other attributes chips list
                Object.keys(otherGroups).forEach(k => {
                    const vals = otherGroups[k];
                    if (vals.length === 0) return;
                    if (!selectedAttributes[k] || !vals.map(x => x.toLowerCase()).includes(selectedAttributes[k].toLowerCase())) {
                        selectedAttributes[k] = vals[0];
                    }
                    const label = k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
                    html += `<div style="margin-bottom:14px;">`;
                    html += `<div style="font-weight:700;font-size:0.85rem;color:#212121;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
                        Select ${label}: <span id="selected_${k}_Label" style="font-weight:400;color:#555;">${selectedAttributes[k]}</span>
                    </div>`;
                    html += `<div style="display:flex;flex-wrap:nowrap;gap:8px;overflow-x:auto;padding-bottom:8px;" id="attrChipList_${k}" class="hide-scrollbar">`;
                    vals.forEach((v) => {
                        const isActive = String(selectedAttributes[k]).toLowerCase().trim() === String(v).toLowerCase().trim();
                        html += `
                            <button type="button" class="flipkart-attr-chip" data-attr-key="${k}" data-attr-val="${v}" style="min-width:40px;height:36px;padding:0 10px;flex:0 0 auto;border:${isActive ? '2px solid #212121' : '1px solid #e0e0e0'};background:white;color:#212121;border-radius:4px;font-size:0.85rem;font-weight:${isActive ? '600' : '400'};cursor:pointer;transition:all 0.15s;text-align:center;display:inline-flex;align-items:center;justify-content:center;">
                                ${v}
                            </button>
                        `;
                    });
                    html += '</div></div>';
                });

                // "All Variant Options" list and stock count removed as requested
                
                // End of pickers HTML
                selectorDiv.innerHTML = html;

                bindClickListeners();
                applyCompressedImages();
                updateStockAndCartDetails();
            }

            function bindClickListeners() {
                // Click handlers for Color Chips / Cards
                selectorDiv.querySelectorAll('.flipkart-color-chip, .flipkart-color-card').forEach(card => {
                    card.addEventListener('click', () => {
                        if (card.disabled) return;
                        const key = card.dataset.attrKey;
                        selectedAttributes[key] = card.dataset.attrVal;
                        
                        const colorVal = card.dataset.attrVal;
                        const vImg = variantImageMap[colorVal.toLowerCase()];
                        if (vImg) {
                            img.setAttribute('data-original-src', vImg);
                            compressImageUrl(vImg, 600, 0.7).then(c => { img.src = c; });
                        }
                        
                        renderPickers();
                    });
                });

                // Click handlers for Attribute Chips
                selectorDiv.querySelectorAll('.flipkart-attr-chip').forEach(chip => {
                    chip.addEventListener('click', () => {
                        if (chip.disabled) return; // Skip disabled (Out of Stock) chips
                        if (chip.classList.contains('variant-select-btn') || chip.classList.contains('flipkart-color-chip')) return;
                        const key = chip.dataset.attrKey;
                        selectedAttributes[key] = chip.dataset.attrVal;
                        
                        renderPickers();
                    });
                });

                // Click handlers for Variant Select Buttons (allOptions: White, Black, etc.)
                selectorDiv.querySelectorAll('.variant-select-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (btn.disabled) return;
                        const idx = parseInt(btn.dataset.idx);
                        const targetOption = allOptions[idx];
                        if (!targetOption) return;

                        if (targetOption.isBase) {
                            self.activeVariant = 'base';
                            
                            // Reset selectedAttributes
                            Object.keys(selectedAttributes).forEach(k => delete selectedAttributes[k]);
                            
                            const baseUrl = self.getAssetUrl(product.product_image || 'assets/default-product.png');
                            img.setAttribute('data-original-src', baseUrl);
                            compressImageUrl(baseUrl, 600, 0.7).then(c => { img.src = c; });

                            // Sync thumbnail highlight to primary image
                            if (thumbs) {
                                thumbs.querySelectorAll('.detail-thumb').forEach((el, i) => {
                                    const thumbUrl = el.getAttribute('data-original-url') || '';
                                    const isPrimary = i === 0 || thumbUrl === baseUrl || thumbUrl === product.product_image;
                                    el.classList.toggle('active', isPrimary);
                                    el.style.border = isPrimary ? '3px solid var(--public-primary)' : '2px solid #ddd';
                                });
                            }
                            
                            priceEl.textContent = self.formatCurrency(product.selling_price, currency);
                            nameEl.textContent = self.formatProductTitle(product.product_name, selectedAttributes['color'], selectedAttributes['size']);
                            
                            renderPickers();
                        } else {
                            self.activeVariant = targetOption;
                            
                            // Reset selectedAttributes for this variant
                            Object.keys(selectedAttributes).forEach(k => delete selectedAttributes[k]);
                            
                            const variantUrl = targetOption.image_url;
                            if (variantUrl) {
                                img.setAttribute('data-original-src', variantUrl);
                                compressImageUrl(variantUrl, 600, 0.7).then(c => { img.src = c; });

                                // Sync thumbnail highlight to this variant's image
                                if (thumbs) {
                                    thumbs.querySelectorAll('.detail-thumb').forEach(el => {
                                        const thumbUrl = el.getAttribute('data-original-url') || '';
                                        const isMatch = thumbUrl === variantUrl;
                                        el.classList.toggle('active', isMatch);
                                        el.style.border = isMatch ? '3px solid var(--public-primary)' : '2px solid #ddd';
                                    });
                                }
                            }
                            priceEl.textContent = self.formatCurrency(targetOption.price || product.selling_price, currency);
                            nameEl.textContent = self.formatProductTitle(product.product_name, targetOption.variant_name, selectedAttributes['size']);
                            
                            renderPickers();
                        }
                    });
                });
            }

            function updateStockAndCartDetails() {
                const stockEl = document.getElementById('variantStockInfo');
                const specsBox = document.getElementById('variantSpecsBox');
                
                // Update specsBox content
                if (specsBox) {
                    specsBox.innerHTML = '';
                    
                    let attrs = {};
                    if (self.activeVariant === 'base') {
                        attrs = meta.attributes || meta || {};
                        if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch(e) { attrs = {}; } }
                    } else {
                        attrs = self.activeVariant.attributes;
                        if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch(e) { attrs = {}; } }
                    }
                    
                    // Also skip color/shade/size/storage since they are shown as interactive pickers above
                    const skip = ['name', 'product_images', 'product_image', 'variant_images', 'variant_group', 'variant_size', 'variant_color', 'variant_label', 'has_variants', 'base_stock', 'color', 'shade', 'size', 'storage', 'available_colors', 'available_sizes'];
                    
                    // Merge activeVariant attributes and base meta attributes
                    let baseMeta = meta || {};
                    const orderedKeys = Object.keys(baseMeta).filter(k => !skip.includes(k) && !k.toLowerCase().includes('image') && k !== 'attributes' && k !== 'color' && k !== 'shade' && k !== 'size' && k !== 'storage');
                    
                    if (attrs) {
                        Object.keys(attrs).forEach(k => {
                            if (!orderedKeys.includes(k) && !skip.includes(k) && !k.toLowerCase().includes('image') && k !== 'color' && k !== 'shade' && k !== 'size' && k !== 'storage') {
                                orderedKeys.push(k);
                            }
                        });
                    }
                    
                    let specStrings = [];
                    orderedKeys.forEach((k) => {
                        const val = (attrs && attrs[k] !== undefined) ? attrs[k] : baseMeta[k];
                        if (val !== undefined && val !== null && val !== '') {
                            const valStr = String(val);
                            if (!Array.isArray(val) && typeof val !== 'object' && !k.toLowerCase().includes('image') && !valStr.includes('://') && !valStr.startsWith('[') && !valStr.startsWith('data:')) {
                                const lbl = k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
                                specStrings.push(`<div style="display:flex;flex-direction:column;background:#ffffff;border:1px solid #e2e8f0;padding:10px 14px;border-radius:8px;flex:1 1 45%;max-width:calc(50% - 5px);box-sizing:border-box;"><span style="font-size:0.8rem;color:#64748b;margin-bottom:4px;font-weight:500;">${lbl}</span><span style="font-size:0.95rem;color:#0f172a;font-weight:600;word-break:break-word;">${val}</span></div>`);
                            }
                        }
                    });
                    if (specStrings.length > 0) {
                        specsBox.innerHTML = '<div style="margin-top:16px;width:100%;display:block;"><div style="font-weight:700;color:#212121;margin-bottom:12px;font-size:1rem;display:block;">Specifications</div><div style="display:flex;flex-wrap:wrap;gap:10px;width:100%;box-sizing:border-box;">' + specStrings.join('') + '</div></div>';
                    }
                }
                
                // Now update stock & cart buttons
                if (self.activeVariant === 'base') {
                    const selectedSize = selectedAttributes['size'] || selectedAttributes['storage'];
                    let sizePriceMap = meta.size_price || meta.attributes?.size_price || meta.size_prices || meta.attributes?.size_prices || {};
                    if (typeof sizePriceMap === 'string') { try { sizePriceMap = JSON.parse(sizePriceMap); } catch(e) { sizePriceMap = {}; } }
                    
                    let activePrice = parseFloat(product.selling_price) || 0;
                    if (selectedSize && sizePriceMap && sizePriceMap[selectedSize] !== undefined && sizePriceMap[selectedSize] !== null && sizePriceMap[selectedSize] !== '') {
                        const parsedP = parseFloat(sizePriceMap[selectedSize]);
                        if (!isNaN(parsedP) && parsedP > 0) activePrice = parsedP;
                    }

                    addBtn.setAttribute('data-id', product.id);
                    addBtn.removeAttribute('data-variant-id');
                    addBtn.removeAttribute('data-variant-name');
                    addBtn.setAttribute('data-price', activePrice);
                    addBtn.disabled = false;
                    addBtn.style.opacity = '1';
                    
                    addBtn.onclick = (e) => {
                        const selColor = selectedAttributes['color'] || selectedAttributes['shade'] || self.getProductDefaultColor(product);
                        const selSize = selectedAttributes['size'] || selectedAttributes['storage'] || self.getProductDefaultSize(product);
                        self.addToCartWithOptions(product, selColor, selSize, e, activePrice);
                    };

                    const buyBtn = document.getElementById('detailBuyNow');
                    if (buyBtn) {
                        buyBtn.disabled = false;
                        buyBtn.style.opacity = '1';
                        buyBtn.onclick = (e) => {
                            if (buyBtn.disabled) return;
                            addBtn.click();
                            setTimeout(() => {
                                const cartSidebar = document.getElementById('cartSidebar');
                                if (cartSidebar) cartSidebar.classList.add('active');
                            }, 300);
                        };
                    }
                    
                    const baseStock = meta?.base_stock || product.stock;
                    const numStock = Number(baseStock) || 0;
                    if (stockEl) {
                        stockEl.textContent = baseStock + ' in stock';
                        stockEl.style.color = '#16a34a';
                        stockEl.style.display = 'block';
                    }
                    const stockBadge = document.getElementById('detailStockBadge');
                    if (stockBadge) {
                        if (numStock <= 0) {
                            stockBadge.textContent = 'Out of Stock';
                            stockBadge.style.background = '#fee2e2';
                            stockBadge.style.color = '#991b1b';
                            stockBadge.style.display = 'inline-block';
                        } else if (numStock <= 3) {
                            stockBadge.textContent = `Only ${numStock} left!`;
                            stockBadge.style.background = '#fef3c7';
                            stockBadge.style.color = '#92400e';
                            stockBadge.style.display = 'inline-block';
                        } else {
                            stockBadge.textContent = `In Stock (${numStock})`;
                            stockBadge.style.background = '#dcfce7';
                            stockBadge.style.color = '#166534';
                            stockBadge.style.display = 'inline-block';
                        }
                    }

                    // Update product name with selected options
                    const activeColor = selectedAttributes['color'] || selectedAttributes['shade'] || (metaColors && metaColors.length > 0 ? metaColors[0] : '');
                    const activeSize = selectedAttributes['size'] || selectedAttributes['storage'] || (metaSizes && metaSizes.length > 0 ? metaSizes[0] : '');
                    const nameString = self.formatProductTitle(product.product_name, activeColor, activeSize);
                    
                    priceEl.textContent = self.formatCurrency(activePrice, currency);
                    nameEl.textContent = nameString;
                    nameEl.style.display = 'block';
                    
                    const catEl = document.getElementById('detailCat');
                    if(catEl && product.category) {
                        catEl.textContent = product.category;
                        catEl.style.display = 'inline-block';
                    } else if (catEl) {
                        catEl.style.display = 'none';
                    }
                } else {
                    const v = self.activeVariant;
                    let vAttrs = v.attributes || {};
                    if (typeof vAttrs === 'string') { try { vAttrs = JSON.parse(vAttrs); } catch(e) { vAttrs = {}; } }
                    let vSizePriceMap = vAttrs.size_price || vAttrs.size_prices || {};
                    if (typeof vSizePriceMap === 'string') { try { vSizePriceMap = JSON.parse(vSizePriceMap); } catch(e) { vSizePriceMap = {}; } }

                    const selectedSize = selectedAttributes['size'] || selectedAttributes['storage'];
                    let activePrice = parseFloat(v.price || product.selling_price) || 0;
                    if (selectedSize && vSizePriceMap && vSizePriceMap[selectedSize] !== undefined && vSizePriceMap[selectedSize] !== null && vSizePriceMap[selectedSize] !== '') {
                        const parsedP = parseFloat(vSizePriceMap[selectedSize]);
                        if (!isNaN(parsedP) && parsedP > 0) activePrice = parsedP;
                    }

                    const vStock = Number(v.stock) || 0;
                    if (stockEl) {
                        if (vStock > 0) {
                            stockEl.textContent = vStock + ' in stock';
                            stockEl.style.color = '#16a34a';
                            stockEl.style.display = 'block';
                        } else {
                            stockEl.textContent = 'Out of stock';
                            stockEl.style.color = '#dc2626';
                            stockEl.style.display = 'block';
                        }
                    }
                    const stockBadge = document.getElementById('detailStockBadge');
                    if (stockBadge) {
                        if (vStock <= 0) {
                            stockBadge.textContent = 'Out of Stock';
                            stockBadge.style.background = '#fee2e2';
                            stockBadge.style.color = '#991b1b';
                            stockBadge.style.display = 'inline-block';
                        } else if (vStock <= 3) {
                            stockBadge.textContent = `Only ${vStock} left!`;
                            stockBadge.style.background = '#fef3c7';
                            stockBadge.style.color = '#92400e';
                            stockBadge.style.display = 'inline-block';
                        } else {
                            stockBadge.textContent = `In Stock (${vStock})`;
                            stockBadge.style.background = '#dcfce7';
                            stockBadge.style.color = '#166534';
                            stockBadge.style.display = 'inline-block';
                        }
                    }
                    addBtn.disabled = vStock <= 0;
                    addBtn.style.opacity = vStock <= 0 ? '0.5' : '1';
                    addBtn.setAttribute('data-id', product.id);
                    addBtn.setAttribute('data-variant-id', v.id);
                    addBtn.setAttribute('data-variant-name', v.variant_name);
                    addBtn.setAttribute('data-variant-price', activePrice);
                    
                    addBtn.onclick = (e) => {
                        if (vStock <= 0) { return; }
                        self.addToCartWithVariant(product, v, e, selectedAttributes, activePrice);
                    };

                    const buyBtn = document.getElementById('detailBuyNow');
                    if (buyBtn) {
                        buyBtn.disabled = vStock <= 0;
                        buyBtn.style.opacity = vStock <= 0 ? '0.5' : '1';
                        buyBtn.onclick = (e) => {
                            if (vStock <= 0) return;
                            addBtn.click();
                            setTimeout(() => {
                                const cartSidebar = document.getElementById('cartSidebar');
                                if (cartSidebar) cartSidebar.classList.add('active');
                            }, 300);
                        };
                    }

                    // Update product name with variant + selected options
                    const activeSize = selectedAttributes['size'] || selectedAttributes['storage'] || '';
                    const nameString = self.formatProductTitle(product.product_name, v.variant_name, activeSize);
                    
                    priceEl.textContent = self.formatCurrency(activePrice, currency);
                    nameEl.textContent = nameString;
                    nameEl.style.display = 'block';
                    
                    const catEl = document.getElementById('detailCat');
                    if(catEl && product.category) {
                        catEl.textContent = product.category;
                        catEl.style.display = 'inline-block';
                    } else if (catEl) {
                        catEl.style.display = 'none';
                    }
                }
            }

            // Append specsBox FIRST so updateStockAndCartDetails() can find it by ID
            const specsBox = document.createElement('div');
            specsBox.id = 'variantSpecsBox';
            specsBox.style.cssText = 'margin-top:4px;';
            specsContainer.appendChild(specsBox);

            // Move the selectorDiv (variant pickers) to be above the price block, matching Flipkart layout
            const priceBlock = document.querySelector('.pdp-price-block');
            if (priceBlock && priceBlock.parentNode) {
                priceBlock.parentNode.insertBefore(selectorDiv, priceBlock);
            } else {
                specsContainer.appendChild(selectorDiv);
            }
            
            renderPickers(); // call INSIDE this block — renderPickers is in scope here
        } else {
            // No variants - show regular product thumbnails
            if (thumbs) {
                let extraImages = product.product_images || [];
                if (typeof extraImages === 'string') { try { extraImages = JSON.parse(extraImages); } catch(e) { extraImages = []; } }
                
                let imageList = [];
                if (product.product_image && !product.product_image.includes('default-product')) {
                    imageList.push(this.getAssetUrl(product.product_image));
                }
                extraImages.forEach(url => {
                    const fullUrl = this.getAssetUrl(url);
                    if (!imageList.includes(fullUrl)) imageList.push(fullUrl);
                });

                if (imageList.length > 1) {
                    imageList.forEach((url, idx) => {
                        const t = document.createElement('img');
                        t.className = 'detail-thumb' + (idx === 0 ? ' active' : '');
                        t.setAttribute('data-original-url', url);
                        // Extreme compression for thumbnails
                        // Improved compression for clear thumbnails
                        compressImageUrl(url, 150, 0.6).then(c => { t.src = c; });
                        t.onclick = (e) => {
                            e.stopPropagation();
                            img.setAttribute('data-original-src', url);
                            compressImageUrl(url, 600, 0.7).then(c => { img.src = c; });
                            thumbs.querySelectorAll('.detail-thumb').forEach(el => { el.classList.remove('active'); el.style.border = '2px solid #e2e8f0'; });
                            t.classList.add('active');
                            t.style.border = '3px solid var(--public-primary)';
                            // Auto-scroll clicked thumbnail to center
                            t.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
                        };
                        thumbs.appendChild(t);
                    });
                    thumbs.style.display = 'flex';
                    // Hide scroll buttons - clicking thumbnails auto-centers them
                    const leftBtn = document.getElementById('thumbScrollLeft');
                    const rightBtn = document.getElementById('thumbScrollRight');
                    if (leftBtn) leftBtn.style.display = 'none';
                    if (rightBtn) rightBtn.style.display = 'none';
                }
            }
        }

        // For products WITHOUT variants, show static specs from metadata
        if (!(variants.length > 0 || metaColors.length > 0 || metaSizes.length > 0)) {
            const specsBox2 = document.createElement('div');
            specsBox2.id = 'variantSpecsBox';
            specsBox2.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;';
            if (meta && typeof meta === 'object') {
                const skip = ['product_images','product_image','variant_images','variant_group','variant_size','variant_color','variant_label','has_variants','base_stock'];
                for (const [k, v] of Object.entries(meta)) {
                    const vs = String(v);
                    if (v && !skip.includes(k) && !k.toLowerCase().includes('image') && !Array.isArray(v) && typeof v !== 'object' && !vs.includes('://') && !vs.startsWith('[') && !vs.startsWith('data:')) {
                        const lbl = k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
                        specsBox2.innerHTML += '<div class="spec-chip"><i class="fas fa-check-circle"></i><span><strong>' + lbl + ':</strong> ' + v + '</span></div>';
                    }
                }
            }
            specsContainer.appendChild(specsBox2);
        }

        // Show modal
        modal.style.display = 'flex';
        requestAnimationFrame(() => { modal.classList.add('active'); });
        document.body.style.overflow = 'hidden'; document.documentElement.style.overflow = 'hidden';
    }

    addToCartWithVariant(product, variant, event, selectedOpts = null, customPrice = null) {
        let optionText = '';
        if (selectedOpts) {
            const list = Object.values(selectedOpts).filter(Boolean);
            if (list.length > 0) optionText = ' - ' + list.join(', ');
        }
        const effectivePrice = (customPrice !== null && !isNaN(customPrice) && customPrice > 0) ? customPrice : (parseFloat(variant.price || product.selling_price) || 0);
        const cartId = product.id + '_' + variant.id + (optionText ? '_' + optionText.replace(/\s+/g, '_') : '') + '_' + effectivePrice;
        const existing = this.cart.find(item => item.id === cartId);

        const activeSize = selectedOpts ? (selectedOpts['size'] || selectedOpts['storage'] || '') : '';
        const fullName = this.formatProductTitle(product.product_name, variant.variant_name, activeSize);

        if (existing) {
            if (existing.quantity >= variant.stock) {
                showNotification('Maximum stock reached for this variant', 'warning');
                return;
            }
            existing.name = fullName;
            existing.quantity++;
        } else {
            this.cart.push({
                id: cartId,
                name: fullName,
                price: effectivePrice,
                image: variant.image_url || product.product_image,
                quantity: 1
            });
        }

        this.saveCartToStorage();
        this.updateCartUI();

        // Animation (same as addToCart)
        if (event) {
            const btn = event.currentTarget || event.target;
            const cartIcon = document.getElementById('cartToggle');
            const productImg = document.getElementById('detailImage');

            if (productImg && cartIcon) {
                const flyingImg = document.createElement('img');
                flyingImg.src = productImg.src;
                flyingImg.className = 'flying-img';
                const rect = productImg.getBoundingClientRect();
                flyingImg.style.top = rect.top + 'px';
                flyingImg.style.left = rect.left + 'px';
                flyingImg.style.width = rect.width + 'px';
                flyingImg.style.height = rect.height + 'px';
                document.body.appendChild(flyingImg);
                const cartRect = cartIcon.getBoundingClientRect();
                setTimeout(() => {
                    flyingImg.style.top = (cartRect.top + 10) + 'px';
                    flyingImg.style.left = (cartRect.left + 10) + 'px';
                    flyingImg.style.width = '20px';
                    flyingImg.style.height = '20px';
                    flyingImg.style.opacity = '0.5';
                }, 10);
                setTimeout(() => {
                    flyingImg.remove();
                    cartIcon.classList.add('cart-bounce');
                    setTimeout(() => cartIcon.classList.remove('cart-bounce'), 400);
                }, 1200);
            }

            if (btn) {
                const original = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> Added!';
                btn.classList.add('added');
                setTimeout(() => { btn.innerHTML = original; btn.classList.remove('added'); }, 1500);
            }
        }
    }

    addToCartWithOptions(product, selectedColor, selectedSize, event, customPrice = null) {
        const finalColor = selectedColor || this.getProductDefaultColor(product);
        const finalSize = selectedSize || this.getProductDefaultSize(product);
        const effectivePrice = (customPrice !== null && !isNaN(customPrice) && customPrice > 0) ? customPrice : (parseFloat(product.selling_price) || 0);
        const opts = [finalColor, finalSize].filter(Boolean).join(' / ');
        const cartId = product.id + (opts ? '_' + opts.replace(/\s+/g, '_') : '') + '_' + effectivePrice;
        const fullName = this.formatProductTitle(product.product_name, finalColor, finalSize);

        const existing = this.cart.find(item => item.id === cartId || (item.id === product.id && !String(item.id).includes('_')));
        if (existing) {
            existing.id = cartId;
            existing.name = fullName;
            existing.quantity++;
        } else {
            this.cart.push({
                id: cartId,
                name: fullName,
                price: effectivePrice,
                image: product.product_image,
                quantity: 1
            });
        }

        this.saveCartToStorage();
        this.updateCartUI();

        if (event) {
            const btn = event.currentTarget || event.target;
            const cartIcon = document.getElementById('cartToggle');
            const productImg = document.getElementById('detailImage');

            if (productImg && cartIcon) {
                const flyingImg = document.createElement('img');
                flyingImg.src = productImg.src;
                flyingImg.className = 'flying-img';
                const rect = productImg.getBoundingClientRect();
                flyingImg.style.top = rect.top + 'px';
                flyingImg.style.left = rect.left + 'px';
                flyingImg.style.width = rect.width + 'px';
                flyingImg.style.height = rect.height + 'px';
                document.body.appendChild(flyingImg);
                const cartRect = cartIcon.getBoundingClientRect();
                setTimeout(() => {
                    flyingImg.style.top = (cartRect.top + 10) + 'px';
                    flyingImg.style.left = (cartRect.left + 10) + 'px';
                    flyingImg.style.width = '20px';
                    flyingImg.style.height = '20px';
                    flyingImg.style.opacity = '0.5';
                }, 10);
                setTimeout(() => {
                    flyingImg.remove();
                    cartIcon.classList.add('cart-bounce');
                    setTimeout(() => cartIcon.classList.remove('cart-bounce'), 400);
                }, 1200);
            }

            if (btn) {
                const original = btn.innerHTML;
                btn.innerHTML = '<i class="fas fa-check"></i> Added!';
                btn.classList.add('added');
                setTimeout(() => { btn.innerHTML = original; btn.classList.remove('added'); }, 1500);
            }
        }
    }
}


let app;
document.addEventListener('DOMContentLoaded', () => { app = new ShopProductsViewer(); window.app = app; });





function formatDescs() {
    document.querySelectorAll('#detailDesc, [class*="desc"]').forEach(el => {
        if (!el.classList.contains('formatted')) {
            el.style.whiteSpace = 'pre-line';
            el.style.lineHeight = '1.6';
            el.classList.add('formatted');
        }
    });
}

if (document.readyState === 'complete') formatDescs();
else document.addEventListener('DOMContentLoaded', formatDescs);



