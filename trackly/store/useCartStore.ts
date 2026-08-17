import { create } from 'zustand';

export interface CartItem {
    cartKey: string; // Composite key: `${id}_${location_id}`
    id: number; // Product Odoo ID
    local_id?: number; // DB ID
    name: string;
    price: number;
    quantity: number;
    taxes: any[]; // JSON object of taxes
    product_tmpl_id?: number;
    free_qty?: number; // Available stock
    uom_name?: string;
    uom_id?: number;
    uom_category_id?: number;
    factor?: number;
    location_id?: number;
    location_name?: string;
}

interface CartState {
    items: CartItem[];
    addItem: (product: any, quantity?: number, location_id?: number, location_name?: string) => boolean;
    removeItem: (cartKey: string) => void;
    updateQuantity: (cartKey: string, quantity: number) => void;
    updateUom: (cartKey: string, uom: any) => void;
    clearCart: () => void;

    // Computed (helper functions, or derived in component)
    getSubtotal: () => number;
    getTaxTotal: () => number;
    getTotal: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
    items: [],

    addItem: (product, quantity = 1, location_id?: number, location_name?: string) => {
        const items = get().items;
        const currentLocId = location_id || 0; // Use 0 as fallback for no-location
        
        // Ensure all items in the cart are from the same location
        if (items.length > 0) {
            const hasDifferentLocation = items.some(i => (i.location_id || 0) !== currentLocId);
            if (hasDifferentLocation) {
                return false;
            }
        }

        const newCartKey = `${product.odoo_id}_${currentLocId}`;
        const existingItem = items.find(i => i.cartKey === newCartKey);
        const freeQty = product.free_qty || 0; // Reference UoM

        if (existingItem) {
            // Convert incoming quantity (product.uom_id context) to existingItem.uom_id context
            const incomingFactor = product.uom_factor || 1;
            const currentFactor = existingItem.factor || 1;
            const convertedIncomingQty = (quantity * currentFactor) / incomingFactor;
            
            const newQuantity = existingItem.quantity + convertedIncomingQty;
            const maxQtyInCurrentUom = freeQty; // Use free_qty directly as displayed in UI

            if (freeQty > 0 && newQuantity > maxQtyInCurrentUom) {
                const quantityToAdd = Math.max(0, maxQtyInCurrentUom - existingItem.quantity);
                if (quantityToAdd > 0) {
                    set({
                        items: items.map(i =>
                            i.cartKey === newCartKey
                                ? { ...i, quantity: i.quantity + quantityToAdd }
                                : i
                        )
                    });
                }
            } else {
                set({
                    items: items.map(i =>
                        i.cartKey === newCartKey
                            ? { ...i, quantity: newQuantity }
                            : i
                    )
                });
            }
        } else {
            const currentFactor = product.uom_factor || 1;
            const maxQtyInCurrentUom = freeQty; // Use free_qty directly as displayed in UI

            // Check initial quantity
            if (freeQty > 0 && quantity > maxQtyInCurrentUom) {
                quantity = maxQtyInCurrentUom;
            }

            // Parse taxes if string
            let taxes = [];
            try {
                taxes = typeof product.taxes_json === 'string' ? JSON.parse(product.taxes_json) : (product.taxes_json || []);
            } catch (e) {
                console.warn("Failed to parse taxes for product", product.name);
            }

            const newItem: CartItem = {
                cartKey: newCartKey,
                id: product.odoo_id || 0,
                local_id: product.id,
                name: product.name,
                price: product.list_price || 0,
                quantity: quantity || 1,
                taxes: taxes,
                product_tmpl_id: product.product_tmpl_id,
                free_qty: product.free_qty,
                uom_name: product.uom_name,
                uom_id: product.uom_id,
                uom_category_id: product.uom_category_id,
                factor: currentFactor,
                location_id: currentLocId || undefined,
                location_name: location_name
            };
            set({ items: [...items, newItem] });
        }
        return true;
    },

    removeItem: (cartKey) => {
        set({ items: get().items.filter(i => i.cartKey !== cartKey) });
    },

    updateQuantity: (cartKey, quantity) => {
        if (quantity <= 0) {
            get().removeItem(cartKey);
            return;
        }

        const item = get().items.find(i => i.cartKey === cartKey);
        if (item && item.free_qty !== undefined) {
            // free_qty is in Reference UoM. Convert to current UoM.
            const maxQtyInCurrentUom = item.free_qty;
            if (quantity > maxQtyInCurrentUom) {
                quantity = maxQtyInCurrentUom;
            }
        }

        set({
            items: get().items.map(i =>
                i.cartKey === cartKey ? { ...i, quantity } : i
            )
        });
    },
    
    updateUom: (cartKey, uom) => {
        const items = get().items;
        const item = items.find(i => i.cartKey === cartKey);
        if (!item) return;

        const oldFactor = item.factor || 1;
        const newFactor = uom.factor || 1;

        // Calculate new quantity
        let newQuantity = (item.quantity * newFactor) / oldFactor;
        
        // Apply UoM rounding if available
        if (uom.rounding) {
            newQuantity = Math.round(newQuantity / uom.rounding) * uom.rounding;
        }

        // Calculate new price based on factor ratio
        const newPrice = (item.price * oldFactor) / newFactor;

        set({
            items: items.map(i =>
                i.cartKey === cartKey 
                ? { 
                    ...i, 
                    uom_id: uom.odoo_id, 
                    uom_name: uom.name, 
                    factor: newFactor,
                    price: newPrice,
                    quantity: newQuantity
                } 
                : i
            )
        });
    },

    clearCart: () => set({ items: [] }),

    getSubtotal: () => {
        return get().items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    },

    getTaxTotal: () => {
        return get().items.reduce((sum, item) => {
            // Simple tax calculation (percent)
            // Assuming tax object has amount (percentage)
            // Odoo taxes can be complex, assuming simple percent for now
            const itemSubtotal = item.price * item.quantity;
            const itemTax = item.taxes.reduce((tSum: number, tax: any) => {
                // Check for amount or amount_percent, or assume just 'amount'
                const rate = tax.amount || 0;
                return tSum + (itemSubtotal * (rate / 100));
            }, 0);
            return sum + itemTax;
        }, 0);
    },

    getTotal: () => {
        return get().getSubtotal() + get().getTaxTotal();
    }
}));
