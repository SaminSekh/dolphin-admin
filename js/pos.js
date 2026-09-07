// POS System Manager - COMPLETELY FIXED VERSION
class POSManager {
    constructor() {
        this.currentUser = null;
        this.shopId = null;
        this.cart = [];
        this.products = [];
        this.cartTotal = 0;
        this.cartSubtotal = 0;
        this.discount = 0;
        this.deliveryCharge = 0;
        this.posPage = 1;
        this.init();
    }

    async init() {
        // Check authentication
        this.currentUser = authManager.getCurrentUser();

        if (!this.currentUser) {
            window.location.href = 'index.html';
            return;
        }

        // Use shopId from authManager (Visitor Mode support)
        this.shopId = authManager.shopId || this.currentUser.shop_id;

        if (!this.shopId) {
            showNotification('No shop assigned', 'error');
            setTimeout(() => authManager.logout(), 2000);
            return;
        }

        // Update Shop Info (Wait for it so we have the logo)
        await this.updateShopName();

        // Update UI
        this.updateUI();

        // Setup event listeners
        this.setupEventListeners();

        // Load products
        await this.loadProducts();

        // Update time
        this.updateCurrentTime();

        // Load recent transactions
        await this.loadRecentTransactions();

        // Check for held sales
        this.checkHeldSales();
    }

    updateUI() {
        // Update user info
        const userNameEl = document.getElementById('userName');
        const userRoleEl = document.getElementById('userRole');

        if (userNameEl) {
            userNameEl.textContent = this.currentUser.full_name || this.currentUser.username;
        }

        if (userRoleEl) {
            userRoleEl.textContent = this.currentUser.role === 'shop_admin' ? 'Shop Admin' : 'Shop Staff';
        }

        // Update currency symbols
        const discountCurrency = document.getElementById('discountCurrency');
        if (discountCurrency) {
            discountCurrency.textContent = getCurrencySymbol();
        }
    }

    async updateShopName() {
        try {
            const { data: shop, error } = await supabaseClient
                .from('shops')
                .select('shop_name, shop_logo')
                .eq('id', this.shopId)
                .single();

            if (!error && shop) {
                this.shopData = shop;
                this.shopLogo = shop.shop_logo || null;

                // Set shop logo as favicon
                if (shop.shop_logo) {
                    setFavicon(shop.shop_logo);
                }
            }

            // Fetch Currency
            const { data: settings } = await supabaseClient
                .from('shop_settings')
                .select('currency')
                .eq('shop_id', this.shopId)
                .maybeSingle();

            if (settings) {
                window.shopCurrency = settings.currency || 'INR';
            }
        } catch (error) {
            console.error('Error fetching shop info:', error);
        }
    }

    setupEventListeners() {
        // Hide out of stock checkbox
        const hideOutOfStockCb = document.getElementById('hideOutOfStock');
        if (hideOutOfStockCb) {
            hideOutOfStockCb.addEventListener('change', () => {
                this.posPage = 1;
                this.filterProductsCombined();
            });
        }

        // Product search
        const searchInput = document.getElementById('productSearch');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterProducts(e.target.value);
            });
        }

        // Filter buttons
        document.querySelectorAll('[data-filter]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filter = e.target.dataset.filter;
                this.filterProductsBy(filter);
            });
        });

        // Category filter
        const categoryFilter = document.getElementById('categoryFilter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                this.handleCategoryChange(e.target.value);
            });
        }

        // Type filter
        const typeFilter = document.getElementById('typeFilter');
        if (typeFilter) {
            typeFilter.addEventListener('change', (e) => {
                this.handleTypeChange(e.target.value);
            });
        }

        // Add to cart
        document.addEventListener('click', (e) => {
            if (e.target.closest('.add-to-cart-btn')) {
                const btn = e.target.closest('.add-to-cart-btn');
                const productId = btn.dataset.id;
                this.handleAddToCart(productId);
            }
            // Product detail view on card click (not on Add button)
            if (e.target.closest('.product-card') && !e.target.closest('.add-to-cart-btn')) {
                const card = e.target.closest('.product-card');
                const addBtn = card.querySelector('.add-to-cart-btn');
                if (addBtn) {
                    this.showProductDetail(addBtn.dataset.id);
                }
            }
        });

        // Remove from cart
        document.addEventListener('click', (e) => {
            if (e.target.closest('.remove-from-cart')) {
                const btn = e.target.closest('.remove-from-cart');
                const productId = btn.dataset.id;
                this.removeFromCart(productId);
            }
        });

        // Edit price in cart
        document.addEventListener('click', (e) => {
            if (e.target.closest('.edit-price-btn')) {
                const btn = e.target.closest('.edit-price-btn');
                const productId = btn.dataset.id;
                this.editCartItemPrice(productId);
            }
        });

        // Update quantity
        document.addEventListener('input', (e) => {
            if (e.target.classList.contains('cart-quantity')) {
                const productId = e.target.dataset.id;
                const quantity = parseInt(e.target.value) || 1;
                this.updateCartQuantity(productId, quantity);
            }
        });

        // Discount input
        const discountInput = document.getElementById('discountAmount');
        if (discountInput) {
            discountInput.addEventListener('input', (e) => {
                this.discount = parseFloat(e.target.value) || 0;
                this.updateCartTotals();
            });
        }

        // Delivery charge input
        const deliveryInput = document.getElementById('deliveryCharge');
        if (deliveryInput) {
            deliveryInput.addEventListener('input', (e) => {
                this.deliveryCharge = parseFloat(e.target.value) || 0;
                this.updateCartTotals();
            });
        }

        // Payment method change
        document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.togglePaymentFields(e.target.value);
            });
        });

        // Remove old amount received / change listeners — replaced by delivery charge
        const amountReceived = document.getElementById('amountReceived');
        if (amountReceived) {
            amountReceived.addEventListener('input', (e) => {
                const received = parseFloat(e.target.value) || 0;
                const change = received - this.cartTotal;
                const changeElement = document.getElementById('changeAmount');
                if (changeElement) {
                    changeElement.value = change > 0 ? change.toFixed(2) : '0.00';
                }
            });
        }

        // Amount paid for credit
        const amountPaid = document.getElementById('amountPaid');
        if (amountPaid) {
            amountPaid.addEventListener('input', (e) => {
                const paid = parseFloat(e.target.value) || 0;
                const pending = this.cartTotal - paid;
                const pendingElement = document.getElementById('pendingAmount');
                if (pendingElement) {
                    pendingElement.value = pending > 0 ? pending.toFixed(2) : '0.00';
                }
            });
        }

        // Checkout button
        const checkoutBtn = document.getElementById('checkoutBtn');
        if (checkoutBtn) {
            checkoutBtn.addEventListener('click', () => {
                this.processCheckout();
            });
        }

        // Clear cart button
        const clearCartBtn = document.getElementById('clearCartBtn');
        if (clearCartBtn) {
            clearCartBtn.addEventListener('click', () => {
                this.clearCart();
            });
        }

        // Hold sale button
        const holdSaleBtn = document.getElementById('holdSaleBtn');
        if (holdSaleBtn) {
            holdSaleBtn.addEventListener('click', () => {
                this.holdSale();
            });
        }

        // Print invoice button
        const printInvoiceBtn = document.getElementById('printInvoiceBtn');
        if (printInvoiceBtn) {
            printInvoiceBtn.addEventListener('click', () => {
                this.printInvoice();
            });
        }

        // Refresh transactions
        const refreshTransactions = document.getElementById('refreshTransactions');
        if (refreshTransactions) {
            refreshTransactions.addEventListener('click', () => {
                this.loadRecentTransactions();
            });
        }

        // Modal close buttons
        document.querySelectorAll('.close-modal').forEach(btn => {
            btn.addEventListener('click', () => {
                this.closeAllModals();
            });
        });

        // Load held sale button
        const loadHeldSaleBtn = document.getElementById('loadHeldSaleBtn');
        if (loadHeldSaleBtn) {
            loadHeldSaleBtn.addEventListener('click', () => {
                this.loadHeldSale();
            });
        }

        // Mobile cart toggle
        const mobileCartToggle = document.getElementById('mobileCartToggle');
        if (mobileCartToggle) {
            mobileCartToggle.addEventListener('click', () => {
                this.toggleMobileCart();
            });
        }

        // Mobile close button
        const closeCartBtn = document.getElementById('closeCartBtn');
        if (closeCartBtn) {
            closeCartBtn.addEventListener('click', () => {
                this.closeMobileCart();
            });
        }

        // Cart backdrop click (close cart)
        const cartBackdrop = document.getElementById('cartBackdrop');
        if (cartBackdrop) {
            cartBackdrop.addEventListener('click', () => {
                this.closeMobileCart();
            });
        }
    }

    checkHeldSales() {
        const heldSale = localStorage.getItem(`hold_sale_${this.shopId}`);
        if (heldSale) {
            showNotification('There is a held sale available', 'info');
        }
    }

    async loadProducts() {
        showLoading(true);

        try {
            // Load business type for this shop
            const { data: shopData } = await supabaseClient
                .from('shops')
                .select('business_type')
                .eq('id', this.shopId)
                .maybeSingle();

            this.businessType = shopData?.business_type || 'general';

            // Load type configurations from system_configs
            const { data: typeConfigsData } = await supabaseClient
                .from('system_configs')
                .select('key, value')
                .like('key', 'types_%');

            this.typeConfigs = {};
            if (typeConfigsData) {
                typeConfigsData.forEach(config => {
                    const category = config.key.replace('types_', '');
                    this.typeConfigs[category] = config.value.split(',').map(t => t.trim());
                });
            }

            const { data: products, error } = await supabaseClient
                .from('products')
                .select('*')
                .eq('shop_id', this.shopId)
                .order('product_name');

            if (error) throw error;

            this.products = products || [];

            // For ALL products, check if they have variants and add variant stocks to display
            if (this.products.length > 0) {
                const allProductIds = this.products.map(p => p.id);
                const { data: variantStocks } = await supabaseClient
                    .from('product_variants')
                    .select('product_id, stock')
                    .in('product_id', allProductIds)
                    .eq('is_active', true);

                if (variantStocks && variantStocks.length > 0) {
                    const variantTotals = {};
                    variantStocks.forEach(v => {
                        variantTotals[v.product_id] = (variantTotals[v.product_id] || 0) + (parseInt(v.stock) || 0);
                    });
                    // Store original base stock and add variant stocks for display
                    this.products.forEach(p => {
                        if (variantTotals[p.id]) {
                            p._baseStock = parseInt(p.stock) || 0;
                            p.stock = p._baseStock + variantTotals[p.id];
                        }
                    });
                }
            }

            this.renderProducts();

            // Load categories for filter
            this.loadCategories();

        } catch (error) {

            showNotification('Failed to load products', 'error');
        } finally {
            showLoading(false);
        }
    }

    renderProducts() {
        const container = document.getElementById('productGrid');
        if (!container) return;

        // Apply hide out of stock filter
        const hideOutOfStockCb = document.getElementById('hideOutOfStock');
        const hideOutOfStock = hideOutOfStockCb ? hideOutOfStockCb.checked : false;
        const displayProducts = hideOutOfStock ? this.products.filter(p => (parseInt(p.stock) || 0) >= 1) : this.products;

        if (displayProducts.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-box-open fa-2x"></i>
                    <p>No products available</p>
                    <small>Add products from inventory</small>
                </div>
            `;

            const productCount = document.getElementById('productCount');
            if (productCount) {
                productCount.innerHTML = `
                    <span class="count-badge">0 Items</span>
                    <span class="stock-badge">Total Stock: 0</span>
                `;
            }
            this.renderPosPagination(0);
            return;
        }

        // Pagination
        const perPage = 20;
        this.posPage = this.posPage || 1;
        const totalItems = displayProducts.length;
        const totalPages = Math.ceil(totalItems / perPage);
        if (this.posPage > totalPages) this.posPage = totalPages;
        if (this.posPage < 1) this.posPage = 1;
        const start = (this.posPage - 1) * perPage;
        const pageProducts = displayProducts.slice(start, start + perPage);

        container.innerHTML = pageProducts.map(product => {
            const stock = parseInt(product.stock) || 0;
            const stockClass = stock < 1 ? 'out-of-stock' :
                stock < 10 ? 'low-stock' : 'in-stock';

            const price = parseFloat(product.selling_price) || 0;

            return `
                <div class="product-card ${stockClass}">
                    <div class="product-image-container">
                        <img src="${product.product_image || this.shopLogo || 'https://via.placeholder.com/300?text=No+Image'}" 
                             class="product-img-pos" 
                             alt="${product.product_name}">
                        ${stock < 1 ? '<div class="out-of-stock-overlay">Sold Out</div>' : ''}
                    </div>
                    <div class="product-info">
                        <div class="product-category-type">
                            ${product.category || 'General'} ${product.type ? `• ${product.type}` : ''}
                        </div>
                        <div class="product-name" title="${product.product_name || 'Unnamed Product'}">
                            ${product.product_name || 'Unnamed Product'}
                        </div>
                        <div class="product-sku">SKU: ${product.sku || 'N/A'}</div>
                        <div class="product-meta">
                            <span class="stock-status ${stockClass}">
                                <i class="fas ${stock < 1 ? 'fa-times-circle' : 'fa-check-circle'}"></i> 
                                ${stock < 1 ? 'Out of Stock' : `${stock} in stock`}
                            </span>
                        </div>
                        <div class="product-price-action">
                            <div class="product-price">${formatCurrency(price)}</div>
                            <button class="btn btn-sm btn-primary add-to-cart-btn" 
                                    data-id="${product.id}"
                                    ${stock < 1 ? 'disabled' : ''}>
                                <i class="fas fa-cart-plus"></i> Add
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const productCount = document.getElementById('productCount');
        if (productCount) {
            const totalStock = displayProducts.reduce((sum, p) => sum + (parseInt(p.stock) || 0), 0);
            productCount.innerHTML = `
                <span class="count-badge">${displayProducts.length} Items</span>
                <span class="stock-badge">Total Stock: ${totalStock}</span>
            `;
        }

        this.renderPosPagination(totalItems);
    }

    loadCategories() {
        const categories = new Set();
        this.products.forEach(product => {
            if (product.category) {
                categories.add(product.category);
            }
        });

        const categoryFilter = document.getElementById('categoryFilter');
        if (!categoryFilter) return;

        categoryFilter.innerHTML = '<option value="">All Categories</option>';

        const sortedCategories = Array.from(categories).sort();
        sortedCategories.forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            categoryFilter.appendChild(option);
        });
    }

    loadTypes(category) {
        const typeFilter = document.getElementById('typeFilter');
        if (!typeFilter) return;

        if (!category) {
            typeFilter.style.display = 'none';
            typeFilter.innerHTML = '<option value="">All Types</option>';
            return;
        }

        // First try to get types from system_configs (set by Super Admin)
        const standardizedCategory = category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
        let configuredTypes = this.typeConfigs?.[category] || this.typeConfigs?.[standardizedCategory] || [];

        // If no configured types, also try the business type category
        if (configuredTypes.length === 0 && this.businessType && this.businessType !== 'general') {
            const bizTypeStd = this.businessType.charAt(0).toUpperCase() + this.businessType.slice(1).toLowerCase();
            configuredTypes = this.typeConfigs?.[this.businessType] || this.typeConfigs?.[bizTypeStd] || [];
        }

        // Also collect types from actual products as fallback
        const productTypes = new Set();
        this.products.forEach(product => {
            if (product.category === category && product.type) {
                productTypes.add(product.type);
            }
        });

        // Merge: configured types + any product types not already in the list
        const allTypes = new Set([...configuredTypes, ...productTypes]);

        if (allTypes.size === 0) {
            typeFilter.style.display = 'none';
            typeFilter.innerHTML = '<option value="">All Types</option>';
            return;
        }

        typeFilter.style.display = 'inline-block';
        typeFilter.innerHTML = '<option value="">All Types</option>';

        const sortedTypes = Array.from(allTypes).sort();
        sortedTypes.forEach(type => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = type;
            typeFilter.appendChild(option);
        });
    }

    handleCategoryChange(category) {
        this.loadTypes(category);
        this.filterProductsCombined();
    }

    handleTypeChange(type) {
        this.filterProductsCombined();
    }

    filterProducts(searchTerm) {
        this.posPage = 1;
        if (!searchTerm.trim()) {
            this.renderProducts();
            return;
        }

        let filtered = this.products.filter(product =>
            (product.product_name && product.product_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (product.sku && product.sku.toLowerCase().includes(searchTerm.toLowerCase())) ||
            (product.category && product.category.toLowerCase().includes(searchTerm.toLowerCase()))
        );

        // Apply hide out of stock filter
        const hideOutOfStockCb = document.getElementById('hideOutOfStock');
        if (hideOutOfStockCb && hideOutOfStockCb.checked) {
            filtered = filtered.filter(p => (parseInt(p.stock) || 0) >= 1);
        }

        this.renderFilteredProducts(filtered);
    }

    filterProductsBy(filterType) {
        this.posPage = 1;
        let filtered = this.products;

        switch (filterType) {
            case 'low-stock':
                filtered = this.products.filter(p => p.stock < 10 && p.stock > 0);
                break;
            case 'out-of-stock':
                filtered = this.products.filter(p => p.stock < 1);
                break;
            default:
                filtered = this.products;
        }

        // Apply hide out of stock filter (except when explicitly viewing out-of-stock)
        if (filterType !== 'out-of-stock') {
            const hideOutOfStockCb = document.getElementById('hideOutOfStock');
            if (hideOutOfStockCb && hideOutOfStockCb.checked) {
                filtered = filtered.filter(p => (parseInt(p.stock) || 0) >= 1);
            }
        }

        this.renderFilteredProducts(filtered);
    }

    filterProductsByCategory(category) {
        this.handleCategoryChange(category);
    }

    filterProductsCombined() {
        this.posPage = 1;
        const categoryFilter = document.getElementById('categoryFilter');
        const typeFilter = document.getElementById('typeFilter');
        const searchInput = document.getElementById('productSearch');

        const selectedCategory = categoryFilter ? categoryFilter.value : '';
        const selectedType = typeFilter ? typeFilter.value : '';
        const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';

        let filtered = this.products;

        if (selectedCategory) {
            filtered = filtered.filter(p => p.category === selectedCategory);
        }

        if (selectedType) {
            filtered = filtered.filter(p => p.type === selectedType);
        }

        if (searchTerm) {
            filtered = filtered.filter(p =>
                (p.product_name && p.product_name.toLowerCase().includes(searchTerm)) ||
                (p.sku && p.sku.toLowerCase().includes(searchTerm))
            );
        }

        // Apply hide out of stock filter
        const hideOutOfStockCb = document.getElementById('hideOutOfStock');
        if (hideOutOfStockCb && hideOutOfStockCb.checked) {
            filtered = filtered.filter(p => (parseInt(p.stock) || 0) >= 1);
        }

        this.renderFilteredProducts(filtered);
    }

    renderFilteredProducts(filteredProducts) {
        const container = document.getElementById('productGrid');
        if (!container) return;

        if (filteredProducts.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search fa-2x"></i>
                    <p>No products found</p>
                    <small>Try a different search term</small>
                </div>
            `;

            const productCount = document.getElementById('productCount');
            if (productCount) {
                productCount.innerHTML = `
                    <span class="count-badge">0 Found</span>
                    <span class="stock-badge">Total Stock: 0</span>
                `;
            }
            this.renderPosPagination(0);
            return;
        }

        // Pagination
        const perPage = 20;
        this.posPage = this.posPage || 1;
        const totalItems = filteredProducts.length;
        const totalPages = Math.ceil(totalItems / perPage);
        if (this.posPage > totalPages) this.posPage = totalPages;
        if (this.posPage < 1) this.posPage = 1;
        const start = (this.posPage - 1) * perPage;
        const pageProducts = filteredProducts.slice(start, start + perPage);

        container.innerHTML = pageProducts.map(product => {
            const stock = parseInt(product.stock) || 0;
            const stockClass = stock < 1 ? 'out-of-stock' :
                stock < 10 ? 'low-stock' : 'in-stock';

            const price = parseFloat(product.selling_price) || 0;

            return `
                <div class="product-card ${stockClass}">
                    <div class="product-image-container">
                        <img src="${product.product_image || this.shopLogo || 'https://via.placeholder.com/300?text=No+Image'}" 
                             class="product-img-pos" 
                             alt="${product.product_name}">
                        ${stock < 1 ? '<div class="out-of-stock-overlay">Sold Out</div>' : ''}
                    </div>
                    <div class="product-info">
                        <div class="product-category-type">
                            ${product.category || 'General'} ${product.type ? `• ${product.type}` : ''}
                        </div>
                        <div class="product-name" title="${product.product_name || 'Unnamed Product'}">
                            ${product.product_name || 'Unnamed Product'}
                        </div>
                        <div class="product-sku">SKU: ${product.sku || 'N/A'}</div>
                        <div class="product-meta">
                            <span class="stock-status ${stockClass}">
                                <i class="fas ${stock < 1 ? 'fa-times-circle' : 'fa-check-circle'}"></i> 
                                ${stock < 1 ? 'Out of Stock' : `${stock} in stock`}
                            </span>
                        </div>
                        <div class="product-price-action">
                            <div class="product-price">${formatCurrency(price)}</div>
                            <button class="btn btn-sm btn-primary add-to-cart-btn" 
                                    data-id="${product.id}"
                                    ${stock < 1 ? 'disabled' : ''}>
                                <i class="fas fa-cart-plus"></i> Add
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        const productCount = document.getElementById('productCount');
        if (productCount) {
            const totalStock = filteredProducts.reduce((sum, p) => sum + (parseInt(p.stock) || 0), 0);
            productCount.innerHTML = `
                <span class="count-badge">${filteredProducts.length} Found</span>
                <span class="stock-badge">Total Stock: ${totalStock}</span>
            `;
        }

        this.renderPosPagination(totalItems);
    }

    renderPosPagination(totalProducts) {
        let paginationEl = document.getElementById('posPagination');
        if (!paginationEl) {
            paginationEl = document.createElement('div');
            paginationEl.id = 'posPagination';
            const productGrid = document.getElementById('productGrid');
            if (productGrid) productGrid.after(paginationEl);
        }

        const perPage = 20;
        const totalPages = Math.ceil(totalProducts / perPage);
        const currentPage = this.posPage || 1;

        if (totalPages <= 1) {
            paginationEl.innerHTML = totalProducts > 0 ? `<div style="text-align:center;padding:10px;font-size:0.8rem;color:#64748b;">${totalProducts} product(s)</div>` : '';
            return;
        }

        paginationEl.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:white;border:1px solid #e2e8f0;border-radius:10px;margin-top:12px;">
                <span style="font-size:0.8rem;color:#64748b;">Showing ${(currentPage-1)*perPage+1}-${Math.min(currentPage*perPage, totalProducts)} of ${totalProducts}</span>
                <div style="display:flex;gap:4px;align-items:center;">
                    <button onclick="window.posManager.posPage=1;window.posManager.renderProducts();" ${currentPage <= 1 ? 'disabled' : ''} style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;background:white;cursor:pointer;font-size:0.75rem;${currentPage <= 1 ? 'opacity:0.4;' : ''}"><i class="fas fa-angle-double-left"></i></button>
                    <button onclick="window.posManager.posPage--;window.posManager.renderProducts();" ${currentPage <= 1 ? 'disabled' : ''} style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;background:white;cursor:pointer;font-size:0.75rem;${currentPage <= 1 ? 'opacity:0.4;' : ''}"><i class="fas fa-chevron-left"></i></button>
                    <span style="padding:6px 12px;background:var(--primary);color:white;border-radius:6px;font-size:0.75rem;font-weight:700;">${currentPage} / ${totalPages}</span>
                    <button onclick="window.posManager.posPage++;window.posManager.renderProducts();" ${currentPage >= totalPages ? 'disabled' : ''} style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;background:white;cursor:pointer;font-size:0.75rem;${currentPage >= totalPages ? 'opacity:0.4;' : ''}"><i class="fas fa-chevron-right"></i></button>
                    <button onclick="window.posManager.posPage=${totalPages};window.posManager.renderProducts();" ${currentPage >= totalPages ? 'disabled' : ''} style="padding:6px 10px;border:1px solid #e2e8f0;border-radius:6px;background:white;cursor:pointer;font-size:0.75rem;${currentPage >= totalPages ? 'opacity:0.4;' : ''}"><i class="fas fa-angle-double-right"></i></button>
                </div>
            </div>
        `;
    }

    showPriceEditor(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        const stock = parseInt(product.stock) || 0;
        if (stock < 1) {
            showNotification('Product out of stock', 'warning');
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 400px;">
                <div class="modal-header">
                    <h3><i class="fas fa-tag"></i> Set Selling Price</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Product: <strong>${product.product_name || 'Unnamed Product'}</strong></label>
                    </div>
                    <div class="form-group">
                        <label>Original Price</label>
                        <input type="number" id="originalPrice" class="form-control" 
                               value="${parseFloat(product.selling_price).toFixed(2)}" 
                               readonly>
                    </div>
                    <div class="form-group">
                        <label for="customPrice">Selling Price *</label>
                        <input type="number" id="customPrice" class="form-control" 
                               value="${parseFloat(product.selling_price).toFixed(2)}" 
                               min="0" step="0.01" required>
                        <small class="form-text">Enter negotiated price</small>
                    </div>
                    <div class="form-row" style="margin-top: 15px;">
                        <div class="form-group">
                            <button class="btn btn-secondary btn-block close-price-modal">
                                Cancel
                            </button>
                        </div>
                        <div class="form-group">
                            <button class="btn btn-primary btn-block" id="addWithCustomPrice">
                                <i class="fas fa-cart-plus"></i> Add to Cart
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        setTimeout(() => {
            const customPriceInput = document.getElementById('customPrice');
            if (customPriceInput) {
                customPriceInput.focus();
                customPriceInput.select();
            }
        }, 100);

        modal.querySelector('#addWithCustomPrice').addEventListener('click', () => {
            const customPriceInput = document.getElementById('customPrice');
            const customPrice = parseFloat(customPriceInput.value);

            if (isNaN(customPrice) || customPrice < 0) {
                showNotification('Please enter a valid price', 'error');
                customPriceInput.focus();
                return;
            }

            this.addToCartWithCustomPrice(productId, customPrice);
            modal.remove();
        });

        modal.querySelector('.close-price-modal').addEventListener('click', () => {
            modal.remove();
        });

        modal.querySelector('#customPrice').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                modal.querySelector('#addWithCustomPrice').click();
            }
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    addSizeToCart(product, size, stock, price, variant = null) {
        const baseSellingPrice = (variant && variant.price !== undefined && variant.price !== null && variant.price !== '' && !isNaN(parseFloat(variant.price)) && parseFloat(variant.price) > 0)
            ? parseFloat(variant.price)
            : (parseFloat(product.selling_price) || 0);

        const effectivePrice = (price !== undefined && price !== null && price !== '' && !isNaN(parseFloat(price)) && parseFloat(price) > 0)
            ? parseFloat(price)
            : baseSellingPrice;

        const effectiveStock = parseInt(stock) || 0;
        if (effectiveStock < 1) {
            showNotification(`Size ${size} is out of stock`, 'warning');
            return false;
        }

        const cartId = variant ? `${product.id}_v_${variant.id}_size_${size}_${effectivePrice}` : `${product.id}_size_${size}_${effectivePrice}`;
        const existingItem = this.cart.find(item => item.id === cartId);

        if (existingItem) {
            if (existingItem.quantity >= effectiveStock) {
                showNotification('Maximum stock reached for size ' + size, 'warning');
                return false;
            }
            existingItem.quantity += 1;
        } else {
            const cost = (variant && variant.cost_price !== undefined && variant.cost_price !== null && !isNaN(parseFloat(variant.cost_price)))
                ? parseFloat(variant.cost_price)
                : (parseFloat(product.cost_price) || 0);
            const name = variant ? `${product.product_name} - ${variant.variant_name} (Size ${size})` : `${product.product_name} (Size ${size})`;
            const image = variant?.image_url || product.product_image || null;

            this.cart.push({
                id: cartId,
                name: name,
                sku: (variant && variant.sku) ? variant.sku : product.sku,
                price: effectivePrice,
                original_price: effectivePrice,
                cost_price: cost,
                quantity: 1,
                stock: effectiveStock,
                product_image: image,
                price_changed: false,
                _sizeKey: size,         // track which size was sold
                _productId: product.id, // needed for stock update
                _variantId: variant ? variant.id : null // needed for variant stock update
            });
        }

        this.updateCartDisplay();
        showNotification(`${product.product_name} (Size ${size}) added to cart`, 'success');
        return true;
    }

    addVariantToCart(product, variant, variantPrice = null) {
        let vAttrs = variant.attributes;
        if (typeof vAttrs === 'string') { try { vAttrs = JSON.parse(vAttrs); } catch(e) { vAttrs = {}; } }
        vAttrs = vAttrs || {};

        let effectivePrice = variantPrice !== null ? parseFloat(variantPrice) : null;
        if (isNaN(effectivePrice) || effectivePrice === null || effectivePrice <= 0) {
            if (variant.price !== undefined && variant.price !== null && !isNaN(parseFloat(variant.price)) && parseFloat(variant.price) > 0) {
                effectivePrice = parseFloat(variant.price);
            } else if (vAttrs.price !== undefined && !isNaN(parseFloat(vAttrs.price)) && parseFloat(vAttrs.price) > 0) {
                effectivePrice = parseFloat(vAttrs.price);
            } else {
                effectivePrice = parseFloat(product.selling_price) || 0;
            }
        }

        const variantStock = parseInt(variant.stock) || 0;
        if (variantStock < 1) {
            showNotification('This variant is out of stock', 'warning');
            return false;
        }

        const cartId = product.id + '_v_' + variant.id;
        const existingItem = this.cart.find(item => item.id === cartId);

        if (existingItem) {
            if (existingItem.quantity >= variantStock) {
                showNotification('Maximum stock reached for ' + (variant.variant_name || 'variant'), 'warning');
                return false;
            }
            existingItem.quantity += 1;
        } else {
            const costPrice = (variant.cost_price !== undefined && variant.cost_price !== null && !isNaN(parseFloat(variant.cost_price)))
                ? parseFloat(variant.cost_price)
                : (parseFloat(product.cost_price) || 0);

            this.cart.push({
                id: cartId,
                name: `${product.product_name} (${variant.variant_name})`,
                sku: variant.sku || product.sku,
                price: effectivePrice,
                original_price: effectivePrice,
                cost_price: costPrice,
                quantity: 1,
                stock: variantStock,
                product_image: variant.image_url || product.product_image || null,
                price_changed: false,
                _productId: product.id,
                _variantId: variant.id
            });
        }

        this.updateCartDisplay();
        showNotification(`${product.product_name} (${variant.variant_name}) added to cart`, 'success');
        return true;
    }

    async showProductDetail(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        // Load database variants if any
        let variants = [];
        try {
            const { data } = await supabaseClient
                .from('product_variants')
                .select('*')
                .eq('product_id', productId)
                .eq('is_active', true);
            if (data) variants = data;
        } catch (e) {}

        // Parse metadata
        let meta = product.metadata;
        if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch(e) { meta = {}; }
        }
        meta = meta || {};
        const attrs = (meta.attributes && typeof meta.attributes === 'object') ? meta.attributes : {};

        // Find size/option stock map
        let sizeStock = meta.size_stock || attrs.size_stock || null;
        if (typeof sizeStock === 'string') { try { sizeStock = JSON.parse(sizeStock); } catch(e) { sizeStock = null; } }

        // Find size/option price map
        let sizePrice = meta.size_price || attrs.size_price || meta.size_prices || attrs.size_prices || null;
        if (typeof sizePrice === 'string') { try { sizePrice = JSON.parse(sizePrice); } catch(e) { sizePrice = null; } }

        // Find sizes list
        let tagType = 'Size';
        const rawSizes = meta.size || attrs.size || meta.available_sizes || attrs.available_sizes || [];
        let sizeList = Array.isArray(rawSizes) ? rawSizes :
                         (typeof rawSizes === 'string' ? rawSizes.split(',').map(s => s.trim()).filter(Boolean) : []);

        // If no sizes found, check other dynamic tag attributes (storage, pack, portion, volume, color, shade, model, edition)
        if (sizeList.length === 0 && !sizeStock) {
            const possibleKeys = ['storage', 'pack', 'portion', 'volume', 'color', 'shade', 'model', 'edition'];
            for (const k of possibleKeys) {
                const rawOpts = meta[k] || attrs[k] || meta[`available_${k}s`] || attrs[`available_${k}s`] || [];
                const list = Array.isArray(rawOpts) ? rawOpts :
                             (typeof rawOpts === 'string' ? rawOpts.split(',').map(s => s.trim()).filter(Boolean) : []);
                const tagStock = meta[`${k}_stock`] || attrs[`${k}_stock`] || null;
                if (list.length > 0 || tagStock) {
                    tagType = k.charAt(0).toUpperCase() + k.slice(1);
                    sizeList = list;
                    sizeStock = tagStock;
                    if (typeof sizeStock === 'string') { try { sizeStock = JSON.parse(sizeStock); } catch(e) { sizeStock = null; } }
                    sizePrice = meta[`${k}_price`] || attrs[`${k}_price`] || meta[`${k}_prices`] || attrs[`${k}_prices`] || null;
                    if (typeof sizePrice === 'string') { try { sizePrice = JSON.parse(sizePrice); } catch(e) { sizePrice = null; } }
                    break;
                }
            }
        }

        // Include any keys from sizeStock or sizePrice that weren't in sizeList
        if (sizeStock && typeof sizeStock === 'object') {
            Object.keys(sizeStock).forEach(k => {
                const trimmed = String(k).trim();
                if (trimmed && !sizeList.some(s => String(s).trim().toLowerCase() === trimmed.toLowerCase())) {
                    sizeList.push(trimmed);
                }
            });
        }
        if (sizePrice && typeof sizePrice === 'object') {
            Object.keys(sizePrice).forEach(k => {
                const trimmed = String(k).trim();
                if (trimmed && !sizeList.some(s => String(s).trim().toLowerCase() === trimmed.toLowerCase())) {
                    sizeList.push(trimmed);
                }
            });
        }

        // Deduplicate sizeList
        sizeList = Array.from(new Set(sizeList.map(s => String(s).trim()).filter(Boolean)));

        const hasExplicitSizeStock = !!(sizeStock && typeof sizeStock === 'object' && Object.keys(sizeStock).length > 0);
        const hasSizes = sizeList.length > 0;

        // Stock helper functions
        const getStockForSize = (s) => {
            if (!hasExplicitSizeStock) return parseInt(product._baseStock || product.stock) || 0;
            if (sizeStock[s] !== undefined && sizeStock[s] !== null) return parseInt(sizeStock[s]) || 0;
            const matchKey = Object.keys(sizeStock).find(k => k.trim().toLowerCase() === s.trim().toLowerCase());
            if (matchKey && sizeStock[matchKey] !== undefined) return parseInt(sizeStock[matchKey]) || 0;
            return 0;
        };

        const getPriceForSize = (s) => {
            if (sizePrice && typeof sizePrice === 'object') {
                if (sizePrice[s] !== undefined && sizePrice[s] !== null && sizePrice[s] !== '') {
                    const sp = parseFloat(sizePrice[s]);
                    if (!isNaN(sp) && sp > 0) return sp;
                }
                const matchKey = Object.keys(sizePrice).find(k => k.trim().toLowerCase() === s.trim().toLowerCase());
                if (matchKey && sizePrice[matchKey] !== undefined && sizePrice[matchKey] !== null && sizePrice[matchKey] !== '') {
                    const sp = parseFloat(sizePrice[matchKey]);
                    if (!isNaN(sp) && sp > 0) return sp;
                }
            }
            return parseFloat(product.selling_price) || 0;
        };

        // Total stock computation
        let totalSizeStock = 0;
        if (hasExplicitSizeStock) {
            sizeList.forEach(s => {
                totalSizeStock += getStockForSize(s);
            });
        }

        const baseSellingPrice = parseFloat(product.selling_price) || 0;
        const costPrice = parseFloat(product.cost_price) || 0;
        const profitMargin = (costPrice > 0 && baseSellingPrice >= costPrice)
            ? Math.round(((baseSellingPrice - costPrice) / costPrice) * 100)
            : null;

        const displayTotalStock = hasExplicitSizeStock ? totalSizeStock : (parseInt(product._baseStock || product.stock) || 0);

        // Build Clean Specifications HTML (exclude internal objects, size_stock, size_price, etc.)
        let specsHtml = '';
        const specsMap = new Map();
        const formatLabel = (k) => k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

        const ignoreKeys = new Set([
            'attributes', 'product_images', 'product_image', 'variant_group', 'variant_size',
            'variant_color', 'variant_label', 'has_variants', 'base_stock', 'stock',
            'cost_price', 'selling_price', 'price', 'description', 'sku', 'name',
            'title', 'id', 'created_at', 'updated_at', 'category', 'type', 'shop_id'
        ]);

        ['size', 'storage', 'pack', 'portion', 'volume', 'color', 'shade', 'model', 'edition'].forEach(tag => {
            ignoreKeys.add(`${tag}_stock`);
            ignoreKeys.add(`${tag}_stocks`);
            ignoreKeys.add(`${tag}_price`);
            ignoreKeys.add(`${tag}_prices`);
            ignoreKeys.add(`${tag}_cost`);
            ignoreKeys.add(`${tag}_costs`);
            ignoreKeys.add(`available_${tag}s`);
            ignoreKeys.add(`available_${tag}`);
        });

        if (hasSizes) {
            ignoreKeys.add('size');
            ignoreKeys.add('available_sizes');
            ignoreKeys.add(tagType.toLowerCase());
            ignoreKeys.add(`available_${tagType.toLowerCase()}s`);
        }

        const extractCleanSpecs = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            for (const [k, v] of Object.entries(obj)) {
                const lower = k.toLowerCase().trim();
                if (ignoreKeys.has(lower)) continue;
                if (lower.endsWith('_stock') || lower.endsWith('_price') || lower.endsWith('_prices') || lower.endsWith('_cost')) continue;
                if (v === null || v === undefined) continue;

                if (typeof v === 'object') {
                    if (Array.isArray(v)) {
                        const validArr = v.filter(item => typeof item !== 'object' && item !== null && String(item).trim());
                        if (validArr.length > 0) {
                            specsMap.set(lower, { label: formatLabel(k), val: validArr.join(', ') });
                        }
                    }
                    continue; // Skip objects to prevent [object Object]
                }

                const str = String(v).trim();
                if (str && str !== '[object Object]') {
                    specsMap.set(lower, { label: formatLabel(k), val: str });
                }
            }
        };

        extractCleanSpecs(attrs);
        extractCleanSpecs(meta);

        if (specsMap.size > 0) {
            specsHtml = `
                <div style="margin-top:16px;padding-top:14px;border-top:1px solid #f1f5f9;">
                    <div style="font-size:0.75rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;">
                        Specifications & Details
                    </div>
                    <div style="display:flex;flex-wrap:wrap;gap:6px;">
                        ${Array.from(specsMap.values()).map(spec => `
                            <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:0.75rem;color:#334155;">
                                <span style="color:#64748b;font-weight:500;">${spec.label}:</span>
                                <strong style="color:#0f172a;">${spec.val}</strong>
                            </span>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        // Build Available Sizes & Pricing Table HTML with beautiful alignment
        let sizesTableHtml = '';
        if (hasSizes) {
            sizesTableHtml = `
                <div style="margin-top:16px;padding-top:14px;border-top:1px solid #e2e8f0;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                        <div style="font-size:0.8rem;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.04em;display:flex;align-items:center;gap:6px;">
                            <i class="fas fa-ruler-combined" style="color:var(--primary);"></i> Available ${tagType}s & Pricing
                        </div>
                        ${hasExplicitSizeStock ? `
                            <span style="font-size:0.75rem;font-weight:600;color:#64748b;background:#f1f5f9;padding:2px 8px;border-radius:12px;">
                                Total: ${totalSizeStock} units
                            </span>
                        ` : ''}
                    </div>

                    <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.03);">
                        <!-- Table Header -->
                        <div style="display:grid;grid-template-columns: 1fr 100px 110px 80px;background:#f8fafc;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:0.72rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;">
                            <div>${tagType}</div>
                            <div style="text-align:right;">Price</div>
                            <div style="text-align:center;">Stock</div>
                            <div style="text-align:right;">Action</div>
                        </div>

                        <!-- Table Body Rows -->
                        <div style="max-height:220px;overflow-y:auto;">
                            ${sizeList.map((size, idx) => {
                                const stock = getStockForSize(size);
                                const isOOS = stock <= 0;
                                const effPrice = getPriceForSize(size);
                                const isLast = idx === sizeList.length - 1;

                                return `
                                    <div class="pos-detail-row" style="display:grid;grid-template-columns: 1fr 100px 110px 80px;align-items:center;padding:10px 14px;border-bottom:${isLast ? 'none' : '1px solid #f1f5f9'};background:${isOOS ? '#fafafa' : '#ffffff'};transition:background 0.15s ease;">
                                        <!-- Size Label -->
                                        <div>
                                            <span style="display:inline-flex;align-items:center;justify-content:center;min-width:32px;height:26px;padding:0 8px;border-radius:6px;background:${isOOS ? '#f1f5f9' : '#eff6ff'};color:${isOOS ? '#94a3b8' : '#1d4ed8'};font-weight:700;font-size:0.82rem;border:1px solid ${isOOS ? '#e2e8f0' : '#bfdbfe'};">
                                                ${size}
                                            </span>
                                        </div>

                                        <!-- Price -->
                                        <div style="text-align:right;font-weight:700;font-size:0.88rem;color:var(--primary);">
                                            ${formatCurrency(effPrice)}
                                        </div>

                                        <!-- Stock Status Badge -->
                                        <div style="text-align:center;">
                                            ${!isOOS ? `
                                                <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;background:#dcfce7;color:#15803d;font-size:0.72rem;font-weight:600;white-space:nowrap;">
                                                    <i class="fas fa-check-circle" style="font-size:0.65rem;"></i> ${stock} avail.
                                                </span>
                                            ` : `
                                                <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;background:#fee2e2;color:#b91c1c;font-size:0.72rem;font-weight:600;white-space:nowrap;">
                                                    <i class="fas fa-times-circle" style="font-size:0.65rem;"></i> Out of stock
                                                </span>
                                            `}
                                        </div>

                                        <!-- Action Button -->
                                        <div style="text-align:right;">
                                            ${!isOOS ? `
                                                <button class="pos-detail-add-size-btn" data-size="${size}" data-stock="${stock}" data-price="${effPrice}" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--primary);color:white;border:none;border-radius:6px;font-size:0.73rem;font-weight:600;cursor:pointer;transition:transform 0.1s, opacity 0.15s;white-space:nowrap;">
                                                    <i class="fas fa-plus"></i> Add
                                                </button>
                                            ` : `
                                                <button disabled style="display:inline-flex;align-items:center;padding:4px 8px;background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0;border-radius:6px;font-size:0.72rem;font-weight:500;cursor:not-allowed;white-space:nowrap;">
                                                    Sold Out
                                                </button>
                                            `}
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                </div>
            `;
        }

        // Build Variants HTML (if any database variants exist)
        let variantsHtml = '';
        if (variants.length > 0) {
            variantsHtml = `
                <div style="margin-top:16px;padding-top:14px;border-top:1px solid #e2e8f0;">
                    <div style="font-size:0.8rem;font-weight:700;color:#334155;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
                        <i class="fas fa-layer-group" style="color:var(--primary);"></i> Product Variants (${variants.length})
                    </div>

                    <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#ffffff;box-shadow:0 1px 3px rgba(0,0,0,0.03);">
                        <!-- Header -->
                        <div style="display:grid;grid-template-columns: 1fr 100px 110px 80px;background:#f8fafc;padding:8px 14px;border-bottom:1px solid #e2e8f0;font-size:0.72rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.04em;">
                            <div>Variant</div>
                            <div style="text-align:right;">Price</div>
                            <div style="text-align:center;">Stock</div>
                            <div style="text-align:right;">Action</div>
                        </div>

                        <!-- Rows -->
                        <div style="max-height:220px;overflow-y:auto;">
                            ${variants.map((v, idx) => {
                                let vPrice = (v.price !== undefined && v.price !== null && v.price !== '' && !isNaN(parseFloat(v.price)))
                                    ? parseFloat(v.price) : baseSellingPrice;
                                const vStock = parseInt(v.stock) || 0;
                                const isOOS = vStock <= 0;
                                const isLast = idx === variants.length - 1;

                                let vAttrs = v.attributes;
                                if (typeof vAttrs === 'string') { try { vAttrs = JSON.parse(vAttrs); } catch(e) { vAttrs = {}; } }
                                vAttrs = vAttrs || {};
                                const vSubStock = vAttrs.size_stock || vAttrs.storage_stock || null;
                                const hasSubSizes = vSubStock && typeof vSubStock === 'object' && Object.keys(vSubStock).length > 0;

                                return `
                                    <div class="pos-detail-row" style="display:grid;grid-template-columns: 1fr 100px 110px 80px;align-items:center;padding:10px 14px;border-bottom:${isLast ? 'none' : '1px solid #f1f5f9'};background:${isOOS ? '#fafafa' : '#ffffff'};transition:background 0.15s ease;">
                                        <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                                            ${v.image_url ? `
                                                <img src="${v.image_url}" style="width:30px;height:30px;border-radius:6px;object-fit:cover;border:1px solid #e2e8f0;cursor:pointer;flex-shrink:0;" onclick="(function(e){var lb=document.createElement('div');lb.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;';lb.innerHTML='<img src=&quot;'+e.target.src+'&quot; style=&quot;max-width:90%;max-height:90%;object-fit:contain;border-radius:12px;&quot;>';lb.onclick=function(){lb.remove();};document.body.appendChild(lb);})(event)">
                                            ` : ''}
                                            <div style="min-width:0;">
                                                <div style="font-weight:600;font-size:0.82rem;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                                                    ${v.variant_name}
                                                </div>
                                                ${v.sku ? `<div style="font-size:0.7rem;color:#94a3b8;">SKU: ${v.sku}</div>` : ''}
                                            </div>
                                        </div>

                                        <div style="text-align:right;font-weight:700;font-size:0.88rem;color:var(--primary);">
                                            ${formatCurrency(vPrice)}
                                        </div>

                                        <div style="text-align:center;">
                                            ${!isOOS ? `
                                                <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;background:#dcfce7;color:#15803d;font-size:0.72rem;font-weight:600;white-space:nowrap;">
                                                    <i class="fas fa-check-circle" style="font-size:0.65rem;"></i> ${vStock} avail.
                                                </span>
                                            ` : `
                                                <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;background:#fee2e2;color:#b91c1c;font-size:0.72rem;font-weight:600;white-space:nowrap;">
                                                    <i class="fas fa-times-circle" style="font-size:0.65rem;"></i> Out of stock
                                                </span>
                                            `}
                                        </div>

                                        <div style="text-align:right;">
                                            ${!isOOS ? (hasSubSizes ? `
                                                <button class="pos-detail-pick-variant-size-btn" data-variant-id="${v.id}" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#3b82f6;color:white;border:none;border-radius:6px;font-size:0.73rem;font-weight:600;cursor:pointer;white-space:nowrap;">
                                                    Sizes <i class="fas fa-chevron-right" style="font-size:0.65rem;"></i>
                                                </button>
                                            ` : `
                                                <button class="pos-detail-add-variant-btn" data-variant-id="${v.id}" data-stock="${vStock}" data-price="${vPrice}" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:var(--primary);color:white;border:none;border-radius:6px;font-size:0.73rem;font-weight:600;cursor:pointer;transition:transform 0.1s, opacity 0.15s;white-space:nowrap;">
                                                    <i class="fas fa-plus"></i> Add
                                                </button>
                                            `) : `
                                                <button disabled style="display:inline-flex;align-items:center;padding:4px 8px;background:#f1f5f9;color:#94a3b8;border:1px solid #e2e8f0;border-radius:6px;font-size:0.72rem;font-weight:500;cursor:not-allowed;white-space:nowrap;">
                                                    Sold Out
                                                </button>
                                            `}
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                </div>
            `;
        }

        // Clean category name
        const categoryName = (typeof product.category === 'object' && product.category !== null)
            ? (product.category.category_name || 'General')
            : (product.category || 'General');

        // Remove existing detail modal if any
        const existing = document.getElementById('posProductDetailModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'posProductDetailModal';
        modal.className = 'modal active';
        modal.innerHTML = `
            <style>
                #posProductDetailModal .pos-detail-row:hover {
                    background: #f8fafc !important;
                }
                #posProductDetailModal .pos-detail-add-size-btn:hover,
                #posProductDetailModal .pos-detail-add-variant-btn:hover {
                    filter: brightness(1.08);
                    transform: scale(1.02);
                }
            </style>
            <div class="modal-content" style="max-width:540px;width:95%;border-radius:14px;overflow:hidden;box-shadow:0 20px 30px -10px rgba(0,0,0,0.25);border:1px solid #e2e8f0;padding:0;">
                <div class="modal-header" style="padding:16px 20px;border-bottom:1px solid #e2e8f0;background:#ffffff;display:flex;align-items:center;justify-content:space-between;">
                    <h3 style="margin:0;font-size:1.15rem;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:10px;">
                        <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:#eff6ff;color:var(--primary);">
                            <i class="fas fa-box-open" style="font-size:0.95rem;"></i>
                        </span>
                        Product Details
                    </h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body" style="padding:20px;max-height:75vh;overflow-y:auto;">
                    <div style="display:flex;gap:16px;align-items:flex-start;">
                        <img src="${product.product_image || this.shopLogo || 'https://via.placeholder.com/100'}" 
                             style="width:96px;height:96px;border-radius:12px;object-fit:cover;border:1px solid #e2e8f0;box-shadow:0 2px 4px rgba(0,0,0,0.04);cursor:pointer;flex-shrink:0;" 
                             onclick="(function(e){var lb=document.createElement('div');lb.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;';lb.innerHTML='<img src=&quot;'+e.target.src+'&quot; style=&quot;max-width:90%;max-height:90%;object-fit:contain;border-radius:12px;&quot;>';lb.onclick=function(){lb.remove();};document.body.appendChild(lb);})(event)"
                             title="Click to zoom">
                        <div style="flex:1;min-width:0;">
                            <div style="font-size:0.72rem;color:#64748b;text-transform:uppercase;font-weight:700;letter-spacing:0.04em;">
                                ${categoryName} ${product.type ? '• ' + product.type : ''}
                            </div>
                            <h4 style="margin:3px 0 2px 0;font-size:1.2rem;font-weight:700;color:#0f172a;line-height:1.3;">
                                ${product.product_name}
                            </h4>
                            <div style="font-size:0.78rem;color:#64748b;font-family:monospace;font-weight:600;">
                                SKU: <span style="color:#334155;">${product.sku || 'N/A'}</span>
                            </div>
                            <div style="margin-top:8px;display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;">
                                <span style="font-size:1.35rem;font-weight:800;color:var(--primary);letter-spacing:-0.02em;">
                                    ${formatCurrency(baseSellingPrice)}
                                </span>
                                ${costPrice > 0 ? `
                                    <span style="font-size:0.8rem;color:#64748b;">Cost: ${formatCurrency(costPrice)}</span>
                                ` : ''}
                                ${profitMargin !== null ? `
                                    <span style="font-size:0.72rem;font-weight:700;color:#16a34a;background:#dcfce7;padding:2px 7px;border-radius:6px;">${profitMargin}% Margin</span>
                                ` : ''}
                            </div>
                            <div style="margin-top:6px;font-size:0.78rem;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                <span style="display:inline-flex;align-items:center;gap:5px;font-weight:600;color:${displayTotalStock > 0 ? '#16a34a' : '#dc2626'};background:${displayTotalStock > 0 ? '#f0fdf4' : '#fef2f2'};border:1px solid ${displayTotalStock > 0 ? '#bbf7d0' : '#fecaca'};padding:2px 8px;border-radius:6px;">
                                    <i class="fas fa-${displayTotalStock > 0 ? 'check-circle' : 'times-circle'}"></i>
                                    ${hasExplicitSizeStock ? `Total Stock: ${displayTotalStock}` : `Stock: ${displayTotalStock}`}
                                </span>
                                ${(hasExplicitSizeStock && product._baseStock && product._baseStock !== displayTotalStock) ? `
                                    <span style="color:#64748b;font-size:0.72rem;">(Base: ${product._baseStock})</span>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    ${product.description ? `
                        <div style="margin-top:12px;padding:10px 12px;background:#f8fafc;border-radius:8px;font-size:0.82rem;color:#475569;line-height:1.5;border:1px solid #f1f5f9;">
                            ${product.description.split('--SPECIFICATIONS--')[0].split('--VARIANT_DATA--')[0].trim()}
                        </div>
                    ` : ''}

                    ${sizesTableHtml}
                    ${variantsHtml}
                    ${specsHtml}
                </div>
                <div class="modal-footer" style="padding:14px 20px;border-top:1px solid #e2e8f0;background:#f8fafc;display:flex;gap:10px;">
                    <button class="btn btn-secondary btn-action close-modal" style="flex:1;border-radius:8px;font-weight:600;">Close</button>
                    <button class="btn btn-primary btn-action" id="posDetailAddBtn" style="flex:2;border-radius:8px;font-weight:600;">
                        <i class="fas fa-cart-plus"></i> Add to Cart
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close handlers
        modal.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', () => modal.remove()));
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        // Add to cart from bottom footer button
        modal.querySelector('#posDetailAddBtn').addEventListener('click', () => {
            modal.remove();
            this.handleAddToCart(productId);
        });

        // Quick Add for Sizes directly inside details table
        modal.querySelectorAll('.pos-detail-add-size-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const size = btn.dataset.size;
                const stock = parseInt(btn.dataset.stock) || 0;
                const price = parseFloat(btn.dataset.price) || baseSellingPrice;

                const success = this.addSizeToCart(product, size, stock, price);
                if (success) {
                    const origHtml = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i> Added';
                    btn.style.background = '#16a34a';
                    setTimeout(() => {
                        btn.innerHTML = origHtml;
                        btn.style.background = 'var(--primary)';
                    }, 1200);
                }
            });
        });

        // Quick Add for DB Variants directly inside details table
        modal.querySelectorAll('.pos-detail-add-variant-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const variantId = btn.dataset.variantId;
                const vData = variants.find(v => v.id === variantId);
                if (!vData) return;

                const success = this.addVariantToCart(product, vData, parseFloat(btn.dataset.price));
                if (success) {
                    const origHtml = btn.innerHTML;
                    btn.innerHTML = '<i class="fas fa-check"></i> Added';
                    btn.style.background = '#16a34a';
                    setTimeout(() => {
                        btn.innerHTML = origHtml;
                        btn.style.background = 'var(--primary)';
                    }, 1200);
                }
            });
        });

        // Select size for DB variant that has sub-sizes
        modal.querySelectorAll('.pos-detail-pick-variant-size-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const variantId = btn.dataset.variantId;
                const vData = variants.find(v => v.id === variantId);
                if (!vData) return;

                let vAttrs = vData.attributes;
                if (typeof vAttrs === 'string') { try { vAttrs = JSON.parse(vAttrs); } catch(err) { vAttrs = {}; } }
                vAttrs = vAttrs || {};
                const vSizeStock = vAttrs.size_stock || vAttrs.storage_stock || {};
                const sizeList = Object.keys(vSizeStock);
                modal.remove();
                this.showSizePicker(product, sizeList, vSizeStock, vData);
            });
        });
    }

    async handleAddToCart(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        // Check if product has database variants
        try {
            const { data: variants } = await supabaseClient
                .from('product_variants')
                .select('*')
                .eq('product_id', productId)
                .eq('is_active', true);

            if (variants && variants.length > 0) {
                // Show variant selector modal
                this.showVariantSelector(product, variants);
                return;
            }
        } catch (e) { /* fall through */ }

        // Check if product has per-size stock in metadata
        let meta = product.metadata || {};
        if (typeof meta === 'string') {
            try {
                meta = JSON.parse(meta);
            } catch(e) {
                meta = {};
            }
        }
        const attrs = meta.attributes || {};

        // Find size_stock from all possible locations
        let sizeStock = meta.size_stock || attrs.size_stock || null;
        if (typeof sizeStock === 'string') { try { sizeStock = JSON.parse(sizeStock); } catch(e) { sizeStock = null; } }

        // Find sizes list from all possible locations
        const rawSizes = meta.size || attrs.size || meta.available_sizes || attrs.available_sizes || [];
        let sizeList = Array.isArray(rawSizes) ? rawSizes :
                         (typeof rawSizes === 'string' ? rawSizes.split(',').map(s => s.trim()).filter(Boolean) : []);

        let optionPriceMap = meta.size_price || attrs.size_price || meta.size_prices || attrs.size_prices || null;

        // If no sizes found, check other dynamic tag attributes (storage, pack, portion, volume, color, etc.)
        if (sizeList.length === 0) {
            const possibleKeys = ['storage', 'pack', 'portion', 'volume', 'color', 'shade', 'model', 'edition'];
            for (const k of possibleKeys) {
                const rawOpts = meta[k] || attrs[k] || meta[`available_${k}s`] || attrs[`available_${k}s`] || [];
                const list = Array.isArray(rawOpts) ? rawOpts :
                             (typeof rawOpts === 'string' ? rawOpts.split(',').map(s => s.trim()).filter(Boolean) : []);
                if (list.length > 0) {
                    sizeList = list;
                    sizeStock = meta[`${k}_stock`] || attrs[`${k}_stock`] || null;
                    if (typeof sizeStock === 'string') { try { sizeStock = JSON.parse(sizeStock); } catch(e) { sizeStock = null; } }
                    optionPriceMap = meta[`${k}_price`] || attrs[`${k}_price`] || meta[`${k}_prices`] || attrs[`${k}_prices`] || null;
                    break;
                }
            }
        }

        console.log('[POS] sizeStock:', JSON.stringify(sizeStock), '| sizeList:', JSON.stringify(sizeList));

        if (sizeList.length > 0) {
            // Show size picker — even if no size_stock set, picker needed to track which size is sold
            this.showSizePicker(product, sizeList, sizeStock || {}, null, optionPriceMap);
            return;
        }

        // No variants, no sizes — add directly
        this.addToCartWithCustomPrice(productId, null);
    }

    showSizePicker(product, sizeList, sizeStock, variant = null, sizePrice = null) {
        const existing = document.getElementById('sizeSelectorModal');
        if (existing) existing.remove();

        let meta = product.metadata || {};
        if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e) { meta = {}; } }
        let resolvedSizePrice = sizePrice;
        if (!resolvedSizePrice) {
            if (variant && variant.attributes) {
                let vAttrs = variant.attributes;
                if (typeof vAttrs === 'string') { try { vAttrs = JSON.parse(vAttrs); } catch(e) { vAttrs = {}; } }
                resolvedSizePrice = vAttrs.size_price || vAttrs.size_prices || {};
            } else {
                let attrs = meta.attributes || {};
                if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch(e) { attrs = {}; } }
                resolvedSizePrice = meta.size_price || attrs.size_price || meta.size_prices || attrs.size_prices || {};
            }
        }
        if (typeof resolvedSizePrice === 'string') { try { resolvedSizePrice = JSON.parse(resolvedSizePrice); } catch(e) { resolvedSizePrice = {}; } }

        const baseSellingPrice = (variant && variant.price !== undefined && variant.price !== null && variant.price !== '' && !isNaN(parseFloat(variant.price)) && parseFloat(variant.price) > 0)
            ? parseFloat(variant.price)
            : (parseFloat(product.selling_price) || 0);

        const modal = document.createElement('div');
        modal.id = 'sizeSelectorModal';
        modal.className = 'modal active';

        const sizeOptions = sizeList.map(size => {
            const stock = parseInt(sizeStock[size] ?? 999) || 0;
            const isOOS = stock === 0;
            let effectivePrice = baseSellingPrice;
            if (resolvedSizePrice && resolvedSizePrice[size] !== undefined && resolvedSizePrice[size] !== null && resolvedSizePrice[size] !== '') {
                const sp = parseFloat(resolvedSizePrice[size]);
                if (!isNaN(sp) && sp > 0) effectivePrice = sp;
            }
            return `
                <div class="size-option${isOOS ? ' oos' : ''}"
                    data-size="${size}" data-stock="${stock}" data-price="${effectivePrice}"
                    style="display:flex;align-items:center;justify-content:space-between;
                           padding:14px 16px;border:2px solid ${isOOS ? '#fee2e2' : '#e2e8f0'};
                           border-radius:10px;cursor:${isOOS ? 'not-allowed' : 'pointer'};
                           margin-bottom:8px;background:${isOOS ? '#fef2f2' : 'white'};
                           transition:all 0.2s;opacity:${isOOS ? '0.6' : '1'};">
                    <div>
                        <span style="font-weight:700;font-size:1rem;color:${isOOS ? '#dc2626' : '#1e293b'};">Size ${size}</span>
                        ${isOOS ? '<span style="margin-left:8px;font-size:0.75rem;background:#dc2626;color:white;padding:2px 8px;border-radius:20px;font-weight:600;">OUT OF STOCK</span>' : ''}
                        <div style="font-size:0.85rem;font-weight:600;color:var(--primary);margin-top:2px;">₹${effectivePrice}</div>
                    </div>
                    <div style="font-size:0.8rem;color:${isOOS ? '#dc2626' : '#64748b'};">
                        ${isOOS ? 'Unavailable' : stock + ' in stock'}
                    </div>
                </div>
            `;
        }).join('');

        modal.innerHTML = `
            <div class="modal-content" style="max-width:380px;">
                <div class="modal-header">
                    <h3><i class="fas fa-ruler-combined"></i> Select Size</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body" style="padding:20px;">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #f1f5f9;">
                        <img src="${(variant?.image_url) || product.product_image || 'https://via.placeholder.com/50'}" style="width:50px;height:50px;border-radius:8px;object-fit:cover;">
                        <div>
                            <div style="font-weight:700;font-size:0.95rem;">${variant ? `${product.product_name} - ${variant.variant_name}` : product.product_name}</div>
                            <div style="font-size:0.8rem;color:#64748b;">SKU: ${(variant && variant.sku) || product.sku} &bull; ₹${baseSellingPrice}</div>
                        </div>
                    </div>
                    ${sizeOptions}
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

        modal.querySelectorAll('.size-option:not(.oos)').forEach(opt => {
            opt.addEventListener('mouseenter', () => { opt.style.borderColor = 'var(--primary)'; opt.style.background = '#f0fdf4'; });
            opt.addEventListener('mouseleave', () => { opt.style.borderColor = '#e2e8f0'; opt.style.background = 'white'; });
            opt.addEventListener('click', () => {
                const size = opt.dataset.size;
                const stock = parseInt(opt.dataset.stock) || 0;
                const price = parseFloat(opt.dataset.price) || baseSellingPrice;
                const added = this.addSizeToCart(product, size, stock, price, variant);
                if (added) {
                    modal.remove();
                }
            });
        });
    }

    showVariantSelector(product, variants) {
        const existing = document.getElementById('variantSelectorModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'variantSelectorModal';
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:420px;">
                <div class="modal-header">
                    <h3><i class="fas fa-layer-group"></i> Select Option</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body" style="padding:20px;">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #f1f5f9;">
                        <img src="${product.product_image || 'https://via.placeholder.com/50'}" style="width:50px;height:50px;border-radius:8px;object-fit:cover;">
                        <div>
                            <div style="font-weight:700;font-size:0.95rem;">${product.product_name}</div>
                            <div style="font-size:0.8rem;color:#64748b;">SKU: ${product.sku}</div>
                        </div>
                    </div>

                    <!-- Base product option -->
                    <div class="variant-option" data-type="base" style="display:flex;align-items:center;gap:12px;padding:12px;border:2px solid #e2e8f0;border-radius:10px;cursor:pointer;margin-bottom:8px;transition:all 0.2s;">
                        <div style="flex:1;">
                            <div style="font-weight:600;font-size:0.85rem;">${product.product_name} (Base)</div>
                            <div style="font-size:0.75rem;color:#64748b;">Stock: ${product._baseStock || product.stock}</div>
                        </div>
                        <div style="font-weight:700;color:var(--primary);">${formatCurrency(product.selling_price)}</div>
                    </div>

                    <!-- Variant options -->
                    ${variants.map(v => {
                        let vPrice = (v.price !== undefined && v.price !== null && v.price !== '' && !isNaN(parseFloat(v.price)))
                            ? parseFloat(v.price)
                            : null;
                        if (vPrice === null && v.attributes) {
                            let vAttrs = v.attributes;
                            if (typeof vAttrs === 'string') { try { vAttrs = JSON.parse(vAttrs); } catch(e) { vAttrs = {}; } }
                            if (vAttrs.price !== undefined && vAttrs.price !== null && !isNaN(parseFloat(vAttrs.price))) {
                                vPrice = parseFloat(vAttrs.price);
                            }
                        }
                        const effectivePrice = (vPrice !== null && vPrice > 0) ? vPrice : (parseFloat(product.selling_price) || 0);
                        return `
                        <div class="variant-option" data-type="variant" data-variant-id="${v.id}" data-price="${effectivePrice}" data-name="${v.variant_name}" data-stock="${v.stock}" style="display:flex;align-items:center;gap:12px;padding:12px;border:2px solid #e2e8f0;border-radius:10px;cursor:pointer;margin-bottom:8px;transition:all 0.2s;">
                            ${v.image_url ? `<img src="${v.image_url}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;">` : ''}
                            <div style="flex:1;">
                                <div style="font-weight:600;font-size:0.85rem;">${v.variant_name}</div>
                                <div style="font-size:0.75rem;color:#64748b;">Stock: ${v.stock}</div>
                            </div>
                            <div style="font-weight:700;color:#d97706;">${formatCurrency(effectivePrice)}</div>
                        </div>
                    `;}).join('')}
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close handlers
        modal.querySelector('.close-modal').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

        // Option click handlers
        modal.querySelectorAll('.variant-option').forEach(opt => {
            opt.addEventListener('mouseenter', () => { opt.style.borderColor = 'var(--primary)'; opt.style.background = '#f0fdf4'; });
            opt.addEventListener('mouseleave', () => { opt.style.borderColor = '#e2e8f0'; opt.style.background = 'white'; });
            opt.addEventListener('click', () => {
                if (opt.dataset.type === 'base') {
                    // Check if base product has sizes
                    let meta = product.metadata || {};
                    if (typeof meta === 'string') {
                        try { meta = JSON.parse(meta); } catch(e) { meta = {}; }
                    }
                    const attrs = meta.attributes || {};
                    let sizeStock = meta.size_stock || attrs.size_stock || null;
                    if (typeof sizeStock === 'string') { try { sizeStock = JSON.parse(sizeStock); } catch(e) { sizeStock = null; } }
                    const rawSizes = meta.size || attrs.size || meta.available_sizes || attrs.available_sizes || [];
                    const sizeList = Array.isArray(rawSizes) ? rawSizes :
                                     (typeof rawSizes === 'string' ? rawSizes.split(',').map(s => s.trim()).filter(Boolean) : []);
                    
                    if (sizeList.length > 0) {
                        this.showSizePicker(product, sizeList, sizeStock || {});
                        modal.remove();
                    } else {
                        this.addToCartWithCustomPrice(product.id, null);
                        modal.remove();
                    }
                } else {
                    const variantId = opt.dataset.variantId;
                    const vData = variants.find(v => v.id === variantId);
                    
                    let vAttrs = vData ? vData.attributes : null;
                    if (typeof vAttrs === 'string') {
                        try { vAttrs = JSON.parse(vAttrs); } catch(e) { vAttrs = {}; }
                    }
                    vAttrs = vAttrs || {};

                    const vSizeStock = vAttrs.size_stock || vAttrs.storage_stock || null;
                    if (vSizeStock && typeof vSizeStock === 'object' && Object.keys(vSizeStock).length > 0) {
                        const sizeStock = vSizeStock;
                        const sizeList = Object.keys(sizeStock);
                        this.showSizePicker(product, sizeList, sizeStock, vData);
                        modal.remove();
                        return;
                    }

                    // Add variant to cart
                    const variantName = vData?.variant_name || opt.dataset.name;
                    let variantPrice = parseFloat(opt.dataset.price);
                    if (isNaN(variantPrice) || variantPrice <= 0) {
                        if (vData && vData.price !== undefined && vData.price !== null && !isNaN(parseFloat(vData.price)) && parseFloat(vData.price) > 0) {
                            variantPrice = parseFloat(vData.price);
                        } else if (vAttrs.price !== undefined && !isNaN(parseFloat(vAttrs.price)) && parseFloat(vAttrs.price) > 0) {
                            variantPrice = parseFloat(vAttrs.price);
                        } else {
                            variantPrice = parseFloat(product.selling_price) || 0;
                        }
                    }
                    const variantStock = parseInt(vData?.stock ?? opt.dataset.stock) || 0;

                    if (variantStock < 1) {
                        showNotification('This variant is out of stock', 'warning');
                        return;
                    }

                    const cartId = product.id + '_v_' + (vData ? vData.id : opt.dataset.variantId);
                    const existingItem = this.cart.find(item => item.id === cartId);

                    if (existingItem) {
                        if (existingItem.quantity >= variantStock) {
                            showNotification('Maximum stock reached', 'warning');
                            return;
                        }
                        existingItem.quantity += 1;
                    } else {
                        const costPrice = (vData?.cost_price !== undefined && vData.cost_price !== null && !isNaN(parseFloat(vData.cost_price)))
                            ? parseFloat(vData.cost_price)
                            : (parseFloat(product.cost_price) || 0);

                        this.cart.push({
                            id: cartId,
                            name: product.product_name + ' (' + variantName + ')',
                            sku: vData?.sku || product.sku,
                            price: variantPrice,
                            original_price: variantPrice,
                            cost_price: costPrice,
                            quantity: 1,
                            stock: variantStock,
                            product_image: vData?.image_url || product.product_image || null,
                            price_changed: false,
                            _productId: product.id,
                            _variantId: vData ? vData.id : opt.dataset.variantId
                        });
                    }

                    this.updateCartDisplay();
                    showNotification(`${product.product_name} (${variantName}) added to cart`, 'success');
                }
                modal.remove();
            });
        });
    }

    addToCartWithCustomPrice(productId, customPrice = null) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        const stock = parseInt(product.stock) || 0;
        if (stock < 1) {
            showNotification('Product out of stock', 'warning');
            return;
        }

        const price = customPrice !== null ? parseFloat(customPrice) : parseFloat(product.selling_price) || 0;
        const existingItem = this.cart.find(item => item.id === productId);

        if (existingItem) {
            if (existingItem.quantity >= stock) {
                showNotification(`Only ${stock} units available in stock`, 'warning');
                return;
            }
            existingItem.quantity += 1;
            if (customPrice !== null && existingItem.price !== price) {
                existingItem.price = price;
                existingItem.price_changed = true;
            }
        } else {
            this.cart.push({
                id: product.id,
                name: product.product_name || 'Unnamed Product',
                sku: product.sku || 'N/A',
                price: price,
                original_price: parseFloat(product.selling_price) || 0,
                cost_price: parseFloat(product.cost_price) || 0, // Store cost price
                quantity: 1,
                stock: stock,
                product_image: product.product_image || null,
                price_changed: customPrice !== null
            });
        }

        this.updateCartDisplay();

        const productName = product.product_name || 'Product';
        const message = customPrice !== null && customPrice !== parseFloat(product.selling_price)
            ? `${productName} added at negotiated price ${formatCurrency(price)}`
            : `${productName} added to cart`;
        showNotification(message, 'success');
    }

    editCartItemPrice(productId) {
        const cartItem = this.cart.find(item => item.id === productId);
        if (!cartItem) return;

        const modal = document.createElement('div');
        modal.className = 'modal active';
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 400px;">
                <div class="modal-header">
                    <h3><i class="fas fa-edit"></i> Edit Price</h3>
                    <button class="close-modal">&times;</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>Product: <strong>${cartItem.name}</strong></label>
                    </div>
                    <div class="form-group">
                        <label>Original Price</label>
                        <input type="number" class="form-control" 
                               value="${cartItem.original_price.toFixed(2)}" readonly>
                    </div>
                    <div class="form-group">
                        <label for="editPrice">Current Price</label>
                        <input type="number" id="editPrice" class="form-control" 
                               value="${cartItem.price.toFixed(2)}" 
                               min="0" step="0.01" required>
                    </div>
                    <div class="form-group">
                        <label>Total for ${cartItem.quantity} units</label>
                        <input type="number" id="editTotal" class="form-control" 
                               value="${(cartItem.price * cartItem.quantity).toFixed(2)}" 
                               readonly>
                    </div>
                    <div class="form-row" style="margin-top: 15px;">
                        <div class="form-group">
                            <button class="btn btn-secondary btn-block close-edit-modal">
                                Cancel
                            </button>
                        </div>
                        <div class="form-group">
                            <button class="btn btn-primary btn-block" id="savePrice">
                                <i class="fas fa-save"></i> Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const editPriceInput = modal.querySelector('#editPrice');
        const editTotalInput = modal.querySelector('#editTotal');

        editPriceInput.addEventListener('input', () => {
            const newPrice = parseFloat(editPriceInput.value) || 0;
            const total = newPrice * cartItem.quantity;
            editTotalInput.value = total.toFixed(2);
        });

        setTimeout(() => {
            editPriceInput.focus();
            editPriceInput.select();
        }, 100);

        modal.querySelector('#savePrice').addEventListener('click', () => {
            const newPrice = parseFloat(editPriceInput.value);

            if (isNaN(newPrice) || newPrice < 0) {
                showNotification('Please enter a valid price', 'error');
                editPriceInput.focus();
                return;
            }

            cartItem.price = newPrice;
            cartItem.price_changed = newPrice !== cartItem.original_price;
            this.updateCartDisplay();
            showNotification('Price updated successfully', 'success');
            modal.remove();
        });

        modal.querySelector('.close-edit-modal').addEventListener('click', () => {
            modal.remove();
        });

        editPriceInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                modal.querySelector('#savePrice').click();
            }
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    removeFromCart(productId) {
        const index = this.cart.findIndex(item => item.id === productId);
        if (index !== -1) {
            const itemName = this.cart[index].name;
            this.cart.splice(index, 1);
            this.updateCartDisplay();
            showNotification(`${itemName} removed from cart`, 'info');
        }
    }

    updateCartQuantity(productId, quantity) {
        const item = this.cart.find(item => item.id === productId);
        if (!item) return;

        if (quantity < 1) {
            this.removeFromCart(productId);
            return;
        }

        if (quantity > item.stock) {
            showNotification(`Only ${item.stock} units available`, 'warning');
            quantity = item.stock;
        }

        item.quantity = quantity;
        this.updateCartDisplay();
    }

    updateCartDisplay() {
        const container = document.getElementById('cartItems');
        if (!container) return;

        if (this.cart.length === 0) {
            container.innerHTML = `
                <div class="empty-cart">
                    <div class="empty-cart-icon">
                        <i class="fas fa-shopping-basket"></i>
                    </div>
                    <h5>Your cart is empty</h5>
                    <p>Select products from the list to start a sale</p>
                </div>
            `;
        } else {
            container.innerHTML = this.cart.map(item => `
                <div class="cart-item">
                    <div class="cart-item-header">
                        <img src="${item.product_image || 'https://via.placeholder.com/150?text=No+Image'}" 
                             class="product-img-cart" 
                             alt="${item.name}">
                        <div class="cart-item-info">
                            <div class="cart-item-name">
                                <strong>${item.name}</strong>
                                <small>SKU: ${item.sku}</small>
                                ${item.price_changed ?
                    `<span class="price-changed-badge">Negotiated</span>` :
                    ''}
                            </div>
                            <div class="cart-item-price">
                                <span class="price-text">${formatCurrency(item.price)} × </span>
                                <input type="number" 
                                       class="cart-quantity" 
                                       data-id="${item.id}"
                                       value="${item.quantity}" 
                                       min="1" 
                                       max="${item.stock}">
                            </div>
                            <div class="cart-item-actions">
                                <button class="btn btn-sm btn-light edit-price-btn" data-id="${item.id}" title="Edit Price">
                                    <i class="fas fa-tag"></i>
                                </button>
                                <button class="btn btn-sm btn-light text-danger remove-from-cart" data-id="${item.id}" title="Remove">
                                    <i class="fas fa-times"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        this.updateCartTotals();
    }

    updateCartTotals() {
        this.cartSubtotal = this.cart.reduce((sum, item) => {
            return sum + (item.price * item.quantity);
        }, 0);

        // Delivery charge is display-only — does NOT affect the sale total
        this.cartTotal = this.cartSubtotal - this.discount;
        if (this.cartTotal < 0) this.cartTotal = 0;

        const subtotalElement = document.getElementById('cartSubtotal');
        const totalElement = document.getElementById('cartTotal');
        const deliveryRow = document.getElementById('deliveryChargeRow');
        const deliveryDisplay = document.getElementById('deliveryChargeDisplay');

        if (subtotalElement) subtotalElement.textContent = formatCurrency(this.cartSubtotal);
        if (totalElement) totalElement.textContent = formatCurrency(this.cartTotal);

        // Show/hide delivery row (info only)
        if (deliveryRow && deliveryDisplay) {
            if (this.deliveryCharge > 0) {
                deliveryRow.style.display = '';
                deliveryDisplay.textContent = '+' + formatCurrency(this.deliveryCharge);
            } else {
                deliveryRow.style.display = 'none';
            }
        }

        const pendingAmount = document.getElementById('pendingAmount');
        const amountPaid = document.getElementById('amountPaid');
        if (pendingAmount && amountPaid) {
            const paid = parseFloat(amountPaid.value) || 0;
            pendingAmount.value = (this.cartTotal - paid).toFixed(2);
        }

        this.updateCartCount();
    }

    updateCartCount() {
        const cartCountBadge = document.getElementById('cartCountBadge');
        if (!cartCountBadge) return;

        const itemCount = this.cart.length;

        if (itemCount > 0) {
            cartCountBadge.textContent = itemCount;
            cartCountBadge.classList.add('active');
        } else {
            cartCountBadge.textContent = '0';
            cartCountBadge.classList.remove('active');
        }
    }

    toggleMobileCart() {
        const cartSection = document.getElementById('cartSection');
        const cartBackdrop = document.getElementById('cartBackdrop');

        if (!cartSection || !cartBackdrop) return;

        const isActive = cartSection.classList.contains('active');

        if (isActive) {
            this.closeMobileCart();
        } else {
            this.openMobileCart();
        }
    }

    openMobileCart() {
        const cartSection = document.getElementById('cartSection');
        const cartBackdrop = document.getElementById('cartBackdrop');

        if (cartSection) {
            cartSection.classList.add('active');
        }

        if (cartBackdrop) {
            cartBackdrop.classList.add('active');
        }

        // Prevent body scroll when cart is open
        document.body.style.overflow = 'hidden';
    }

    closeMobileCart() {
        const cartSection = document.getElementById('cartSection');
        const cartBackdrop = document.getElementById('cartBackdrop');

        if (cartSection) {
            cartSection.classList.remove('active');
        }

        if (cartBackdrop) {
            cartBackdrop.classList.remove('active');
        }

        // Restore body scroll
        document.body.style.overflow = '';
    }

    togglePaymentFields(paymentMethod) {
        const creditInfo = document.getElementById('creditInfo');
        const cashPayment = document.getElementById('cashPayment');

        if (!creditInfo || !cashPayment) return;

        // Update active card class
        document.querySelectorAll('.payment-card').forEach(card => {
            if (card.dataset.method === paymentMethod) {
                card.classList.add('active');
            } else {
                card.classList.remove('active');
            }
        });

        if (paymentMethod === 'credit') {
            creditInfo.style.display = 'block';
            cashPayment.style.display = 'none';
        } else {
            creditInfo.style.display = 'none';
            cashPayment.style.display = 'block';
        }
    }

    async processCheckout() {
        if (this.cart.length === 0) {
            showNotification('Cart is empty', 'warning');
            return;
        }

        const paymentMethodElement = document.querySelector('input[name="paymentMethod"]:checked');
        if (!paymentMethodElement) {
            showNotification('Please select payment method', 'error');
            return;
        }
        const paymentMethod = paymentMethodElement.value;

        if (paymentMethod === 'credit') {
            const buyerName = document.getElementById('buyerName');
            const buyerPhone = document.getElementById('buyerPhone');
            const amountPaid = document.getElementById('amountPaid');

            if (!buyerName || !buyerPhone) {
                showNotification('Please enter buyer information for credit sale', 'error');
                return;
            }

            const name = buyerName.value.trim();
            const phone = buyerPhone.value.trim();
            const paid = parseFloat(amountPaid?.value || 0) || 0;

            if (!name || !phone) {
                showNotification('Buyer name and phone are required for credit sales', 'error');
                return;
            }

            if (paid > this.cartTotal) {
                showNotification('Amount paid cannot exceed total amount', 'error');
                return;
            }
        } else if (paymentMethod === 'cash') {
            // No validation needed — delivery charge is optional, no change field
        }

        showLoading(true);

        try {
            // Validate stock availability BEFORE creating the sale
            for (const item of this.cart) {
                const isVariant = item.id.includes('_v_');
                const isSizeItem = item.id.includes('_size_');

                if (isVariant) {
                    let variantId = item._variantId || item.id.split('_v_')[1];
                    let sizeKey = null;
                    if (isSizeItem) {
                        if (!item._variantId) variantId = variantId.split('_size_')[0];
                        sizeKey = item._sizeKey || (item.id.includes('_size_') ? item.id.split('_size_')[1].split('_')[0] : null);
                    }

                    const { data: variant } = await supabaseClient
                        .from('product_variants')
                        .select('stock, variant_name, attributes')
                        .eq('id', variantId)
                        .single();

                    if (!variant) {
                        throw new Error(`Variant "${item.name}" not found`);
                    }
                    if ((parseInt(variant.stock) || 0) < item.quantity) {
                        throw new Error(`Insufficient stock for "${item.name}". Available: ${variant.stock}, Requested: ${item.quantity}`);
                    }

                    if (isSizeItem && sizeKey) {
                        let attrs = variant.attributes || {};
                        if (typeof attrs === 'string') { try { attrs = JSON.parse(attrs); } catch(e) { attrs = {}; } }
                        const sizeStock = attrs.size_stock || attrs.storage_stock || {};
                        const currentSizeStock = parseInt(sizeStock[sizeKey] ?? variant.stock) || 0;
                        if (currentSizeStock < item.quantity) {
                            throw new Error(`Insufficient stock for "${variant.variant_name} Size ${sizeKey}". Available: ${currentSizeStock}, Requested: ${item.quantity}`);
                        }
                    }
                } else if (isSizeItem) {
                    const productId = item._productId || item.id.split('_size_')[0];
                    const sizeKey = item._sizeKey || (item.id.includes('_size_') ? item.id.split('_size_')[1].split('_')[0] : null);

                    const { data: product, error: fetchError } = await supabaseClient
                        .from('products')
                        .select('stock, metadata, product_name')
                        .eq('id', productId)
                        .eq('shop_id', this.shopId)
                        .single();

                    if (fetchError || !product) {
                        throw new Error(`Product "${item.name}" not found or unavailable`);
                    }

                    let meta = product.metadata || {};
                    if (typeof meta === 'string') {
                        try { meta = JSON.parse(meta); } catch(e) { meta = {}; }
                    }
                    let sizeStock = meta.size_stock || {};
                    if (typeof sizeStock === 'string') { try { sizeStock = JSON.parse(sizeStock); } catch(e) { sizeStock = {}; } }

                    const currentSizeStock = parseInt(sizeStock[sizeKey] ?? product.stock) || 0;
                    if (currentSizeStock < item.quantity) {
                        throw new Error(`Insufficient stock for "${product.product_name} Size ${sizeKey}". Available: ${currentSizeStock}, Requested: ${item.quantity}`);
                    }
                } else {
                    const { data: product, error: fetchError } = await supabaseClient
                        .from('products')
                        .select('stock, product_name')
                        .eq('id', item.id)
                        .eq('shop_id', this.shopId)
                        .single();

                    if (fetchError || !product) {
                        throw new Error(`Product "${item.name}" not found or unavailable`);
                    }
                    if ((parseInt(product.stock) || 0) < item.quantity) {
                        throw new Error(`Insufficient stock for "${product.product_name}". Available: ${product.stock}, Requested: ${item.quantity}`);
                    }
                }
            }

            const invoiceNumber = `INV-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
            const total = this.cartTotal;

            const currentUser = authManager.getCurrentUser();
            if (!currentUser) {
                throw new Error('User not authenticated');
            }

            // Get user identifier - FIXED: Use username/email instead of UUID
            let soldByValue = currentUser.username || currentUser.email || 'pos_user';

            const saleData = {
                shop_id: this.shopId,
                invoice_number: invoiceNumber,
                total_amount: total,
                discount_amount: this.discount,
                payment_method: paymentMethod,
                sold_by: soldByValue,
                amount_paid: total,
                pending_amount: 0,
                sale_status: 'completed'
            };

            // Add optional customer details (available for all payment types)
            const customerName = document.getElementById('customerName')?.value.trim() || '';
            const customerPhone = document.getElementById('customerPhone')?.value.trim() || '';
            const saleRemark = document.getElementById('saleRemark')?.value.trim() || '';

            if (customerName) saleData.buyer_name = customerName;
            if (customerPhone) saleData.buyer_phone = customerPhone;
            if (saleRemark) saleData.buyer_address = saleRemark; // Store remark in buyer_address field

            if (paymentMethod === 'credit') {
                const buyerName = document.getElementById('buyerName');
                const buyerPhone = document.getElementById('buyerPhone');
                const buyerAddress = document.getElementById('buyerAddress');
                const amountPaid = document.getElementById('amountPaid');

                saleData.buyer_name = buyerName ? buyerName.value.trim() : '';
                saleData.buyer_phone = buyerPhone ? buyerPhone.value.trim() : '';
                saleData.buyer_address = buyerAddress ? buyerAddress.value.trim() : '';

                const paid = parseFloat(amountPaid?.value || 0) || 0;
                saleData.amount_paid = paid;
                saleData.pending_amount = total - paid;
                saleData.sale_status = 'credit';

                if (!saleData.buyer_name || !saleData.buyer_phone) {
                    throw new Error('Buyer name and phone are required for credit sales');
                }
            }



            // Create sale record
            const { data: sale, error: saleError } = await supabaseClient
                .from('sales')
                .insert([saleData])
                .select()
                .single();

            if (saleError) {


                // If error is about sold_by, try alternative approach
                if (saleError.message.includes('sold_by')) {
                    // Try with a simpler sold_by value
                    saleData.sold_by = 'system';

                    const { data: sale2, error: saleError2 } = await supabaseClient
                        .from('sales')
                        .insert([saleData])
                        .select()
                        .single();

                    if (saleError2) throw saleError2;
                    return await this.completeSaleProcess(sale2.id, paymentMethod, total, saleData);
                }

                throw saleError;
            }

            await this.completeSaleProcess(sale.id, paymentMethod, total, saleData);

        } catch (error) {


            let errorMessage = 'Failed to process sale';
            if (error.message) {
                errorMessage += ': ' + error.message;
            }

            showNotification(errorMessage, 'error');
        } finally {
            showLoading(false);
        }
    }

    async completeSaleProcess(saleId, paymentMethod, total, saleData) {
        try {
            // Insert sale items
            const saleItems = this.cart.map(item => {
                // For variants/sizes, extract the real product_id
                const productId = item._productId || item.id.split('_v_')[0].split('_size_')[0];

                return {
                    sale_id: saleId,
                    product_id: productId,
                    product_name: item.name,
                    sku: item.sku,
                    product_image: item.product_image,
                    quantity: item.quantity,
                    unit_price: item.price,
                    original_price: item.original_price,
                    cost_price: item.cost_price,
                    total_price: item.price * item.quantity,
                    price_changed: item.price_changed || false
                };
            });



            const { error: itemsError } = await supabaseClient
                .from('sale_items')
                .insert(saleItems);

            if (itemsError) throw itemsError;



            // Update product stock
            await this.updateProductStocks();

            // Create credit record if needed
            if (paymentMethod === 'credit' && saleData.pending_amount > 0) {
                const creditData = {
                    shop_id: this.shopId,
                    buyer_name: saleData.buyer_name,
                    buyer_phone: saleData.buyer_phone,
                    buyer_address: saleData.buyer_address || '',
                    total_amount: total,
                    amount_paid: saleData.amount_paid,
                    pending_amount: saleData.pending_amount,
                    credit_date: new Date().toISOString().split('T')[0],
                    status: 'pending',
                    sale_id: saleId
                };



                const { error: creditError } = await supabaseClient
                    .from('credits')
                    .insert([creditData]);

                if (creditError) {

                }
            }

            showNotification('Sale completed successfully!', 'success');
            // Signal dashboard and other open pages that data changed
            localStorage.setItem('shopDataChanged', Date.now().toString());

            // Save cart items and delivery charge for invoice BEFORE clearing
            const invoiceItems = [...this.cart];
            const invoiceDeliveryCharge = this.deliveryCharge || 0;

            // Clear cart
            this.clearCart();

            // Reset form
            this.resetPaymentForm();

            // Reload recent transactions
            await this.loadRecentTransactions();

            // Reload products to show updated stock
            await this.loadProducts();

            // Get sale details for invoice
            let finalSale = null;
            try {
                const { data: sale } = await supabaseClient
                    .from('sales')
                    .select('*')
                    .eq('id', saleId)
                    .maybeSingle();
                finalSale = sale;
            } catch (fetchErr) {
                console.warn('Could not fetch sale for invoice:', fetchErr);
            }

            if (!finalSale) {
                finalSale = {
                    id: saleId,
                    invoice_number: saleData.invoice_number || `INV-${Date.now()}`,
                    total_amount: total,
                    discount_amount: saleData.discount_amount || 0,
                    amount_paid: saleData.amount_paid || total,
                    pending_amount: saleData.pending_amount || 0,
                    payment_method: paymentMethod,
                    buyer_name: saleData.buyer_name || '',
                    buyer_phone: saleData.buyer_phone || '',
                    buyer_address: saleData.buyer_address || '',
                    created_at: new Date().toISOString()
                };
            }

            // Show invoice modal
            try {
                this.showInvoice(finalSale, invoiceItems, invoiceDeliveryCharge);
            } catch (invErr) {
                console.warn('Failed to display invoice:', invErr);
            }

            // Audit Log
            if (window.authManager) {
                try {
                    await window.authManager.createAuditLog('sell', 'sales', saleId, null, {
                        invoice_number: finalSale.invoice_number,
                        total_amount: total,
                        payment_method: paymentMethod,
                        items_count: saleItems.length
                    });
                } catch (auditErr) {
                    console.warn('Audit log failed:', auditErr);
                }
            }

        } catch (error) {

            throw error;
        }
    }

    async updateProductStocks() {

        for (const item of this.cart) {
            try {
                // Check if this is a variant item (id contains '_v_')
                const isVariant = item.id.includes('_v_');
                const isSizeItem = item.id.includes('_size_');

                if (isVariant) {
                    // Extract variant ID and update variant stock
                    let variantId = item._variantId || item.id.split('_v_')[1];
                    let sizeKey = null;
                    if (isSizeItem) {
                        if (!item._variantId) variantId = variantId.split('_size_')[0];
                        sizeKey = item._sizeKey || (item.id.includes('_size_') ? item.id.split('_size_')[1].split('_')[0] : null);
                    }

                    const { data: variant, error: fetchError } = await supabaseClient
                        .from('product_variants')
                        .select('stock, variant_name, attributes')
                        .eq('id', variantId)
                        .single();

                    if (fetchError || !variant) {
                        throw new Error(`Variant "${item.name}" not found`);
                    }

                    const currentStock = parseInt(variant.stock) || 0;
                    if (currentStock < item.quantity) {
                        throw new Error(`Insufficient stock for ${variant.variant_name}. Available: ${currentStock}, Requested: ${item.quantity}`);
                    }

                    let updatedAttrs = variant.attributes || {};
                    if (typeof updatedAttrs === 'string') { try { updatedAttrs = JSON.parse(updatedAttrs); } catch(e) { updatedAttrs = {}; } }
                    if (isSizeItem && sizeKey) {
                        let sizeStock = updatedAttrs.size_stock || updatedAttrs.storage_stock || {};
                        const currentSizeStock = parseInt(sizeStock[sizeKey] ?? variant.stock) || 0;
                        sizeStock[sizeKey] = Math.max(0, currentSizeStock - item.quantity);
                        if (updatedAttrs.size_stock) updatedAttrs.size_stock = sizeStock;
                        else updatedAttrs.storage_stock = sizeStock;
                    }

                    // Update variant stock and attributes
                    await supabaseClient
                        .from('product_variants')
                        .update({ 
                            stock: Math.max(0, currentStock - item.quantity),
                            attributes: updatedAttrs 
                        })
                        .eq('id', variantId);

                } else if (isSizeItem) {
                    // Size-based product — update size_stock in metadata + overall product stock
                    const productId = item._productId || item.id.split('_size_')[0];
                    const sizeKey = item._sizeKey || (item.id.includes('_size_') ? item.id.split('_size_')[1].split('_')[0] : null);

                    const { data: product, error: fetchError } = await supabaseClient
                        .from('products')
                        .select('stock, metadata, product_name')
                        .eq('id', productId)
                        .eq('shop_id', this.shopId)
                        .single();

                    if (fetchError || !product) {
                        throw new Error(`Product "${item.name}" not found`);
                    }

                    let meta = product.metadata || {};
                    if (typeof meta === 'string') {
                        try { meta = JSON.parse(meta); } catch(e) { meta = {}; }
                    }
                    let sizeStock = meta.size_stock || {};
                    if (typeof sizeStock === 'string') { try { sizeStock = JSON.parse(sizeStock); } catch(e) { sizeStock = {}; } }

                    const currentSizeStock = parseInt(sizeStock[sizeKey] ?? product.stock) || 0;
                    if (currentSizeStock < item.quantity) {
                        throw new Error(`Insufficient stock for ${product.product_name} Size ${sizeKey}. Available: ${currentSizeStock}, Requested: ${item.quantity}`);
                    }

                    // Deduct from size stock
                    sizeStock[sizeKey] = currentSizeStock - item.quantity;

                    // Also deduct from total product stock
                    const newTotalStock = Math.max(0, (parseInt(product.stock) || 0) - item.quantity);

                    const updatedMeta = { ...meta, size_stock: sizeStock };
                    if (updatedMeta.attributes) updatedMeta.attributes = { ...updatedMeta.attributes, size_stock: sizeStock };

                    const { error: updateError } = await supabaseClient
                        .from('products')
                        .update({
                            stock: newTotalStock,
                            metadata: updatedMeta,
                            updated_at: new Date().toISOString()
                        })
                        .eq('id', productId)
                        .eq('shop_id', this.shopId);

                    if (updateError) throw updateError;

                    // Update local product cache
                    const localProduct = this.products.find(p => p.id === productId);
                    if (localProduct) {
                        localProduct.stock = newTotalStock;
                        if (typeof localProduct.metadata === 'string') {
                            try { localProduct.metadata = JSON.parse(localProduct.metadata); } catch(e) { localProduct.metadata = {}; }
                        }
                        if (!localProduct.metadata) localProduct.metadata = {};
                        localProduct.metadata.size_stock = sizeStock;
                    }

                } else {
                    // Regular product — original logic
                    const { data: product, error: fetchError } = await supabaseClient
                        .from('products')
                        .select('stock, product_name')
                        .eq('id', item.id)
                        .eq('shop_id', this.shopId)
                        .single();

                    if (fetchError || !product) {
                        throw new Error(`Product "${item.name}" not found or unavailable`);
                    }

                    const currentStock = parseInt(product.stock) || 0;
                    if (currentStock < item.quantity) {
                        throw new Error(`Insufficient stock for ${product.product_name}. Available: ${currentStock}, Requested: ${item.quantity}`);
                    }

                    const newStock = currentStock - item.quantity;
                    const { error: updateError } = await supabaseClient
                        .from('products')
                        .update({ stock: newStock, updated_at: new Date().toISOString() })
                        .eq('id', item.id)
                        .eq('shop_id', this.shopId);

                    if (updateError) throw updateError;

                    const localProduct = this.products.find(p => p.id === item.id);
                    if (localProduct) localProduct.stock = newStock;
                }

            } catch (error) {
                throw error;
            }
        }
    }

    clearCart() {
        this.cart = [];
        this.discount = 0;
        this.deliveryCharge = 0;
        this.updateCartDisplay();

        const discountInput = document.getElementById('discountAmount');
        if (discountInput) discountInput.value = '';

        const deliveryInput = document.getElementById('deliveryCharge');
        if (deliveryInput) deliveryInput.value = '';

        const deliveryRow = document.getElementById('deliveryChargeRow');
        if (deliveryRow) deliveryRow.style.display = 'none';

        showNotification('Cart cleared', 'info');
    }

    holdSale() {
        if (this.cart.length === 0) {
            showNotification('Cart is empty', 'warning');
            return;
        }

        const holdData = {
            cart: this.cart,
            discount: this.discount,
            timestamp: new Date().toISOString()
        };

        localStorage.setItem(`hold_sale_${this.shopId}`, JSON.stringify(holdData));

        showNotification('Sale held successfully', 'success');
    }

    loadHeldSale() {
        const heldData = localStorage.getItem(`hold_sale_${this.shopId}`);
        if (!heldData) {
            showNotification('No held sale found', 'warning');
            return;
        }

        try {
            const holdData = JSON.parse(heldData);
            this.cart = holdData.cart || [];
            this.discount = holdData.discount || 0;
            this.updateCartDisplay();

            const discountInput = document.getElementById('discountAmount');
            if (discountInput) {
                discountInput.value = this.discount;
            }

            showNotification('Held sale loaded successfully', 'success');
        } catch (error) {

            showNotification('Failed to load held sale', 'error');
        }
    }

    resetPaymentForm() {
        const buyerName = document.getElementById('buyerName');
        const buyerPhone = document.getElementById('buyerPhone');
        const buyerAddress = document.getElementById('buyerAddress');
        const amountPaid = document.getElementById('amountPaid');
        const pendingAmount = document.getElementById('pendingAmount');

        if (buyerName) buyerName.value = '';
        if (buyerPhone) buyerPhone.value = '';
        if (buyerAddress) buyerAddress.value = '';
        if (amountPaid) amountPaid.value = '';
        if (pendingAmount) pendingAmount.value = '';

        const amountReceived = document.getElementById('amountReceived');
        const changeAmount = document.getElementById('changeAmount');

        if (amountReceived) amountReceived.value = '';
        if (changeAmount) changeAmount.value = '';

        const cashRadio = document.querySelector('input[value="cash"]');
        if (cashRadio) {
            cashRadio.checked = true;
            this.togglePaymentFields('cash');
        }
    }

    async loadRecentTransactions() {
        try {
            const { data: transactions, error } = await supabaseClient
                .from('sales')
                .select(`
                    id,
                    invoice_number,
                    total_amount,
                    payment_method,
                    sale_status,
                    created_at
                `)
                .eq('shop_id', this.shopId)
                .order('created_at', { ascending: false })
                .limit(10);

            if (error) throw error;

            this.renderRecentTransactions(transactions || []);

        } catch (error) {

        }
    }

    renderRecentTransactions(transactions) {
        const container = document.getElementById('transactionsList');
        if (!container) return;

        if (transactions.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-receipt fa-2x"></i>
                    <p>No recent transactions</p>
                </div>
            `;
            return;
        }

        container.innerHTML = transactions.map(transaction => `
            <div class="transaction-item">
                <div class="transaction-info">
                    <div class="transaction-header">
                        <span class="invoice-number">${transaction.invoice_number}</span>
                        <span class="transaction-amount">${formatCurrency(transaction.total_amount)}</span>
                    </div>
                    <div class="transaction-details">
                        <span class="payment-method ${transaction.payment_method}">
                            ${transaction.payment_method.toUpperCase()}
                        </span>
                        <span class="transaction-time">
                            ${formatDate(transaction.created_at)}
                        </span>
                    </div>
                </div>
                <span class="transaction-status ${transaction.sale_status}">
                    ${transaction.sale_status}
                </span>
            </div>
        `).join('');
    }

    showInvoice(sale, cartItems, deliveryCharge) {
        if (!sale) return;
        const shopName = this.shopData?.shop_name || 'Shop';
        const shopLogo = this.shopData?.shop_logo || this.shopLogo || '';
        deliveryCharge = parseFloat(deliveryCharge) || 0;
        cartItems = cartItems || [];

        const itemsHtml = cartItems.map(item => `
            <tr>
                <td style="padding: 6px 0; border-bottom: 1px dashed #e2e8f0;">
                    <div style="font-weight: 600; color: #1e293b;">${item.name}</div>
                    <small style="color: #64748b;">${item.quantity} × ${formatCurrency(item.price)}</small>
                </td>
                <td style="text-align: right; vertical-align: top; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; font-weight: 600; color: #1e293b;">
                    ${formatCurrency(item.price * item.quantity)}
                </td>
            </tr>
        `).join('');

        const printItemsHtml = cartItems.map(item => `
            <tr>
                <td style="padding: 5px 0;">${item.name}<br><small style="color: #666;">${item.quantity} x ${formatCurrency(item.price)}</small></td>
                <td style="text-align: right; vertical-align: top; padding: 5px 0;">${formatCurrency(item.price * item.quantity)}</td>
            </tr>
        `).join('');

        // Watermark HTML — only shown if logo exists
        const watermarkHtml = shopLogo ? `
            <div style="
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                width: 55mm;
                height: 55mm;
                display: flex;
                align-items: center;
                justify-content: center;
                opacity: 0.12;
                pointer-events: none;
                z-index: 0;
            ">
                <img src="${shopLogo}" 
                     style="max-width:100%;max-height:100%;object-fit:contain;"
                     crossorigin="anonymous">
            </div>` : `
            <div style="
                position: fixed;
                top: 25%;
                left: 50%;
                transform: translate(-50%, -50%) rotate(-30deg);
                font-size: 48px;
                font-weight: 900;
                color: #000;
                opacity: 0.04;
                pointer-events: none;
                z-index: 0;
                white-space: nowrap;
                letter-spacing: 4px;
                font-family: monospace;
            ">${shopName}</div>`;

        const printableInvoiceHtml = `
            <html>
            <head>
                <title>Invoice - ${sale.invoice_number}</title>
                <style>
                    @import url('https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&display=swap');
                    body { font-family: 'Courier Prime', monospace; margin: 0; padding: 10px; color: #000; font-size: 12px; background: #fff; }
                    .invoice-wrapper { width: 300px; max-width: 300px; margin: 0 auto; position: relative; }
                    .text-center { text-align: center; }
                    .header { margin-bottom: 20px; border-bottom: 1px dashed #000; padding-bottom: 10px; }
                    .shop-name { font-size: 18px; font-weight: bold; text-transform: uppercase; margin-bottom: 5px; }
                    .info-row { display: flex; justify-content: space-between; margin-bottom: 3px; }
                    table { width: 100%; border-collapse: collapse; margin: 15px 0; border-bottom: 1px dashed #000; }
                    .totals { margin-top: 10px; }
                    .total-row { display: flex; justify-content: space-between; font-weight: bold; font-size: 14px; margin-top: 5px; }
                    .footer { margin-top: 30px; font-size: 10px; border-top: 1px dashed #000; padding-top: 10px; }
                    .invoice-content { position: relative; z-index: 1; }
                    @media print { 
                        @page { margin: 0; size: 80mm auto; }
                        body { padding: 0 !important; margin: 0 !important; text-align: left !important; }
                        .invoice-wrapper { width: 300px !important; max-width: 300px !important; margin: 0 !important; padding: 10px !important; display: inline-block !important; } 
                        .no-print { display: none !important; } 
                    }
                </style>
            </head>
            <body>
                <div class="invoice-wrapper">
                ${watermarkHtml}
                <div class="invoice-content">
                <div class="header text-center">
                    <div class="shop-name">${shopName}</div>
                    <div>INVOICE / RECEIPT</div>
                </div>

                <div class="info-section">
                    <div class="info-row"><span>Date:</span> <span>${new Date(sale.created_at || Date.now()).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'})} ${new Date(sale.created_at || Date.now()).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true}).toLowerCase()}</span></div>
                    <div class="info-row"><span>Invoice:</span> <span>${sale.invoice_number}</span></div>
                    <div class="info-row"><span>Payment:</span> <span style="text-transform: uppercase;">${sale.payment_method || 'CASH'}</span></div>
                    ${sale.buyer_name ? `<div class="info-row"><span>Customer:</span> <span>${sale.buyer_name}</span></div>` : ''}
                </div>

                <table>
                    <thead>
                        <tr style="border-bottom: 1px dashed #000;">
                            <th style="text-align: left; padding-bottom: 5px;">Item</th>
                            <th style="text-align: right; padding-bottom: 5px;">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${printItemsHtml}
                    </tbody>
                </table>

                <div class="totals">
                    <div class="info-row"><span>Subtotal:</span> <span>${formatCurrency(parseFloat(sale.total_amount) + parseFloat(sale.discount_amount || 0))}</span></div>
                    <div class="info-row"><span>Discount:</span> <span>-${formatCurrency(sale.discount_amount || 0)}</span></div>
                    ${deliveryCharge > 0 ? `<div class="info-row"><span>Delivery Charge:</span> <span>+${formatCurrency(deliveryCharge)}</span></div>` : ''}
                    <div class="total-row"><span>TOTAL:</span> <span>${formatCurrency(parseFloat(sale.total_amount) + deliveryCharge)}</span></div>
                    ${sale.pending_amount > 0 ? `<div class="info-row" style="color:red;margin-top:5px;"><span>Pending:</span> <span>${formatCurrency(sale.pending_amount)}</span></div>` : ''}
                </div>

                <div class="footer text-center">
                    <p>Thank you for shopping with us!</p>
                    <p>Invoice generated by ${shopName}</p>
                    ${sale.buyer_address && sale.payment_method !== 'credit' ? `<p style="font-style:italic;margin-top:5px;">Note: ${sale.buyer_address}</p>` : ''}
                    <button class="no-print" onclick="window.print()" style="margin-top: 20px; padding: 10px 20px; background: #000; color: #fff; border: none; cursor: pointer; border-radius: 4px;">Print Now</button>
                    <button class="no-print" onclick="window.close()" style="margin-top: 10px; padding: 8px 15px; background: #666; color: #fff; border: none; cursor: pointer; border-radius: 4px; margin-left:10px;">Close</button>
                </div>
                </div>
                </div>
            </body>
            </html>
        `;

        const invoiceModal = document.getElementById('invoiceModal');
        const invoiceContent = document.getElementById('invoiceContent');

        if (invoiceModal && invoiceContent) {
            invoiceContent.innerHTML = `
                <div style="text-align:center;margin-bottom:14px;">
                    <div style="display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:50%;background:#dcfce7;color:#16a34a;font-size:1.35rem;margin-bottom:8px;">
                        <i class="fas fa-check"></i>
                    </div>
                    <h3 style="margin:0;font-size:1.2rem;color:#0f172a;font-weight:700;">Sale Completed!</h3>
                    <p style="margin:2px 0 0;color:#64748b;font-size:0.82rem;font-family:monospace;">${sale.invoice_number}</p>
                </div>

                <div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;padding:16px;font-family:'Courier Prime',monospace,sans-serif;font-size:0.85rem;color:#1e293b;">
                    <div style="text-align:center;border-bottom:1px dashed #cbd5e1;padding-bottom:10px;margin-bottom:10px;">
                        <div style="font-size:1.05rem;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">${shopName}</div>
                        <div style="font-size:0.72rem;color:#64748b;margin-top:2px;">
                            ${new Date(sale.created_at || Date.now()).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'})} 
                            ${new Date(sale.created_at || Date.now()).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:true}).toLowerCase()}
                        </div>
                        <div style="font-size:0.75rem;color:#475569;margin-top:4px;">Payment: <strong style="text-transform:uppercase;">${sale.payment_method || 'CASH'}</strong></div>
                        ${sale.buyer_name ? `<div style="font-size:0.75rem;color:#475569;">Customer: <strong>${sale.buyer_name}</strong></div>` : ''}
                    </div>

                    <div style="max-height:200px;overflow-y:auto;margin-bottom:10px;padding-right:4px;">
                        <table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
                            <tbody>
                                ${itemsHtml}
                            </tbody>
                        </table>
                    </div>

                    <div style="border-top:1px dashed #cbd5e1;padding-top:8px;font-size:0.82rem;">
                        <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                            <span>Subtotal:</span>
                            <span>${formatCurrency(parseFloat(sale.total_amount) + parseFloat(sale.discount_amount || 0))}</span>
                        </div>
                        ${parseFloat(sale.discount_amount || 0) > 0 ? `
                        <div style="display:flex;justify-content:space-between;margin-bottom:3px;color:#16a34a;">
                            <span>Discount:</span>
                            <span>-${formatCurrency(sale.discount_amount)}</span>
                        </div>` : ''}
                        ${deliveryCharge > 0 ? `
                        <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                            <span>Delivery Charge:</span>
                            <span>+${formatCurrency(deliveryCharge)}</span>
                        </div>` : ''}
                        <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1.05rem;margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0;color:#0f172a;">
                            <span>TOTAL:</span>
                            <span>${formatCurrency(parseFloat(sale.total_amount) + deliveryCharge)}</span>
                        </div>
                        ${sale.pending_amount > 0 ? `
                        <div style="display:flex;justify-content:space-between;color:#dc2626;font-weight:700;margin-top:4px;">
                            <span>Pending:</span>
                            <span>${formatCurrency(sale.pending_amount)}</span>
                        </div>` : ''}
                    </div>
                </div>
            `;

            // Setup print button
            const printBtn = document.getElementById('printActualBtn');
            if (printBtn) {
                printBtn.onclick = () => {
                    this.printHtmlReceipt(printableInvoiceHtml);
                };
            }

            // Adjust modal dialog size nicely
            const modalContent = invoiceModal.querySelector('.modal-content');
            if (modalContent) {
                modalContent.style.maxWidth = '460px';
            }

            invoiceModal.classList.add('active');
        } else {
            // Fallback: print directly
            this.printHtmlReceipt(printableInvoiceHtml);
        }
    }

    printHtmlReceipt(htmlContent) {
        let printWindow = null;
        try {
            printWindow = window.open('', '_blank');
        } catch (e) {
            printWindow = null;
        }

        // If window.open succeeded and wasn't blocked by popup blocker
        if (printWindow && printWindow.document) {
            try {
                printWindow.document.open();
                printWindow.document.write(htmlContent);
                printWindow.document.close();
                return;
            } catch (e) {
                console.warn('Direct print window write failed, falling back to iframe:', e);
            }
        }

        // Fallback to hidden iframe (never blocked by popup blocker)
        try {
            let iframe = document.getElementById('posPrintIframe');
            if (!iframe) {
                iframe = document.createElement('iframe');
                iframe.id = 'posPrintIframe';
                iframe.style.position = 'fixed';
                iframe.style.right = '0';
                iframe.style.bottom = '0';
                iframe.style.width = '0';
                iframe.style.height = '0';
                iframe.style.border = '0';
                document.body.appendChild(iframe);
            }
            const doc = iframe.contentWindow.document;
            doc.open();
            doc.write(htmlContent);
            doc.close();
            setTimeout(() => {
                try {
                    iframe.contentWindow.focus();
                    iframe.contentWindow.print();
                } catch (err) {
                    console.warn('Iframe print error:', err);
                }
            }, 300);
        } catch (err) {
            console.error('Failed to print receipt:', err);
            showNotification('Unable to open print preview. Please check browser popups.', 'warning');
        }
    }

    printInvoice() {
        if (this.cart.length === 0) {
            showNotification('Cart is empty', 'warning');
            return;
        }

        this.showInvoice({
            invoice_number: `DRAFT-${Date.now()}`,
            total_amount: this.cartTotal,
            discount_amount: this.discount,
            amount_paid: this.cartTotal,
            pending_amount: 0,
            payment_method: 'cash',
            created_at: new Date().toISOString()
        }, this.cart, this.deliveryCharge);
    }

    updateCurrentTime() {
        const update = () => {
            const now = new Date();
            const timeElement = document.getElementById('currentTime');
            const dateElement = document.getElementById('currentDate');

            if (timeElement) {
                timeElement.textContent = now.toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }

            if (dateElement) {
                dateElement.textContent = now.toLocaleDateString('en-IN', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric'
                });
            }
        };

        update();
        setInterval(update, 1000);
    }

    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.classList.remove('active');
        });
    }
}

// Initialize POS on pos.html page
if (window.location.pathname.includes('pos.html')) {
    document.addEventListener('DOMContentLoaded', () => {
        window.posManager = new POSManager();
    });
}
