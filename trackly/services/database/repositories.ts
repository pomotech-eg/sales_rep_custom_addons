import { getDB, updateSessionUser } from './index';
export { updateSessionUser };

// --- Sales Representative ---
export const ACCESS_PROFILE_FLAGS = [
    'access_cash_balance',
    'access_storage',
    'access_returns',
    'access_general_return',
    'access_confirm_quotation',
    'access_cancel_quotation',
    'access_delivery',
    'access_payment',
    'access_discount',
    'access_inventory_adjustment',
    'access_sales_report',
    'access_customer_debt_report',
    'access_collection_report',
    'access_journal_report',
    'access_requests',
    'access_visit_order',
    'access_visit_payment',
    'access_create_customer',
    'access_mock_location',
    'access_force_logout_on_mock_location',
    'access_developer_mode',
    'access_force_logout_on_developer_mode',
] as const;

const toAccessFlag = (value: any) => (
    value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0
);

export const isProfileAccessEnabled = (profile: any, flag: string): boolean => {
    if (!profile) return false;
    const value = profile[flag];
    return value === true || value === 1 || value === '1' || value === 'true';
};

export const normalizeSalesRepProfile = (profile: any, fallback?: any) => {
    if (!profile && !fallback) return null;

    const normalized: any = { ...(fallback || {}), ...(profile || {}) };
    for (const flag of ACCESS_PROFILE_FLAGS) {
        normalized[flag] = isProfileAccessEnabled(profile, flag)
            || isProfileAccessEnabled(fallback, flag);
    }

    const jsonFields = [
        'default_location_ids',
        'return_location_ids',
        'location_general_return_ids',
        'location_request_ids',
        'product_category_ids',
        'payment_method_ids'
    ];
    for (const field of jsonFields) {
        if (typeof normalized[field] === 'string') {
            try {
                normalized[field] = JSON.parse(normalized[field]);
            } catch (e) {
                console.warn(`Failed to parse field ${field}:`, e);
                normalized[field] = [];
            }
        } else if (!normalized[field]) {
            normalized[field] = [];
        }
    }
    return normalized;
};

// Helper to extract ID from Many2one
const getId = (field: any) => {
    if (field === false || field === undefined || field === null) return null;
    return Array.isArray(field) ? field[0] : field;
};

export const upsertSalesRepresentative = async (rep: any) => {
    const db = await getDB();

    const defaultLocs = rep.default_location_ids || rep.default_locations || [];
    const returnLocs = rep.return_location_ids || rep.return_locations || [];
    const generalReturnLocs = rep.location_general_return_ids || rep.general_return_locations || [];
    const requestLocs = rep.location_request_ids || rep.location_requests || [];

    const getFirstLocId = (locs: any[], fallback: any) => {
        if (locs && locs.length > 0) {
            const first = locs[0];
            return typeof first === 'object' && first !== null ? first.id : first;
        }
        return getId(fallback);
    };

    const getFirstLocName = (locs: any[], fallback: any) => {
        if (locs && locs.length > 0) {
            const first = locs[0];
            return typeof first === 'object' && first !== null ? (first.display_name || first.name) : null;
        }
        return fallback ?? null;
    };

    const firstDefaultLocId = getFirstLocId(defaultLocs, rep.default_location_id);
    const firstDefaultLocName = getFirstLocName(defaultLocs, rep.default_location_name);
    const firstReturnLocId = getFirstLocId(returnLocs, rep.return_location_id);
    const firstGeneralReturnLocId = getFirstLocId(generalReturnLocs, rep.location_general_return_id);
    const firstGeneralReturnLocName = getFirstLocName(generalReturnLocs, rep.location_general_return_name);
    const firstRequestLocId = getFirstLocId(requestLocs, rep.location_request_id);
    const firstRequestLocName = getFirstLocName(requestLocs, rep.location_request_name);

    await db.runAsync(
        `INSERT OR REPLACE INTO sales_representative (
            odoo_id, name, email, image_url, user_id, company_id, company_name, is_supervisor, is_manager, supervisor_id,
            invoice_journal_id, default_location_id, default_location_name, return_location_id,
            location_general_return_id, location_general_return_name,
            location_request_id, location_request_name,
            default_location_ids, return_location_ids, location_general_return_ids, location_request_ids,
            auto_delivery, auto_receive, product_category_ids, payment_method_ids,
            access_cash_balance, access_storage, access_returns, access_general_return, access_confirm_quotation, access_cancel_quotation,
            access_delivery, access_payment, access_discount, access_inventory_adjustment, access_sales_report,
            access_customer_debt_report, access_collection_report, access_journal_report, access_requests,
            access_visit_order, access_visit_payment, access_create_customer,
            access_mock_location, access_force_logout_on_mock_location,
            access_developer_mode, access_force_logout_on_developer_mode,
            discount_product_id,
            last_synced
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        rep.id ?? null,
        rep.name ?? null,
        rep.email ?? null,
        rep.image_url ?? null,
        getId(rep.user_id) ?? null,
        getId(rep.company_id) ?? null,
        rep.company_name ?? null,
        rep.is_supervisor ? 1 : 0,
        rep.is_manager ? 1 : 0,
        getId(rep.supervisor_id) ?? null,
        getId(rep.invoice_journal_id) ?? null,
        firstDefaultLocId,
        firstDefaultLocName,
        firstReturnLocId,
        firstGeneralReturnLocId,
        firstGeneralReturnLocName,
        firstRequestLocId,
        firstRequestLocName,
        JSON.stringify(defaultLocs),
        JSON.stringify(returnLocs),
        JSON.stringify(generalReturnLocs),
        JSON.stringify(requestLocs),
        rep.auto_delivery ? 1 : 0,
        rep.auto_receive ? 1 : 0,
        JSON.stringify(rep.product_categories || []),
        JSON.stringify(rep.payment_method_ids || []),
        toAccessFlag(rep.access_cash_balance),
        toAccessFlag(rep.access_storage),
        toAccessFlag(rep.access_returns),
        toAccessFlag(rep.access_general_return),
        toAccessFlag(rep.access_confirm_quotation),
        toAccessFlag(rep.access_cancel_quotation),
        toAccessFlag(rep.access_delivery),
        toAccessFlag(rep.access_payment),
        toAccessFlag(rep.access_discount),
        toAccessFlag(rep.access_inventory_adjustment),
        toAccessFlag(rep.access_sales_report),
        toAccessFlag(rep.access_customer_debt_report),
        toAccessFlag(rep.access_collection_report),
        toAccessFlag(rep.access_journal_report),
        toAccessFlag(rep.access_requests),
        toAccessFlag(rep.access_visit_order),
        toAccessFlag(rep.access_visit_payment),
        toAccessFlag(rep.access_create_customer),
        toAccessFlag(rep.access_mock_location),
        toAccessFlag(rep.access_force_logout_on_mock_location),
        toAccessFlag(rep.access_developer_mode),
        toAccessFlag(rep.access_force_logout_on_developer_mode),
        getId(rep.discount_product_id) ?? null,
        new Date().toISOString()
    );

    // Update Payment Method Access Table
    if (rep.payment_method_ids && Array.isArray(rep.payment_method_ids)) {
        await db.runAsync('DELETE FROM sales_rep_payment_method_access WHERE sales_rep_odoo_id = ?', rep.id);
        for (const paymentMethodId of rep.payment_method_ids) {
            await db.runAsync(
                `INSERT INTO sales_rep_payment_method_access (sales_rep_odoo_id, payment_method_odoo_id)
                 VALUES (?, ?)`,
                rep.id,
                paymentMethodId
            );
        }
    }
};

export const getSalesRepresentative = async () => {
    const db = await getDB();
    const profile = await db.getFirstAsync<any>('SELECT * FROM sales_representative LIMIT 1');
    return normalizeSalesRepProfile(profile);
};

// --- Stock Requests ---
export const upsertStockRequest = async (req: any) => {
    const db = await getDB();
    await db.runAsync(
        `INSERT OR REPLACE INTO sales_rep_request (
            odoo_id, local_id, name, date, sales_rep_id, location_id, source_location_id, 
            location_name, source_location_name,
            state, is_synced, last_modified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        req.id ?? null,
        req.local_id ?? null,
        req.name ?? null,
        req.date ?? null,
        getId(req.sales_rep_id) ?? null,
        getId(req.location_id) ?? null,
        getId(req.source_location_id) ?? null,
        req.location_dest_name || req.location_name || null,
        req.location_src_name || req.source_location_name || null,
        req.state ?? 'draft',
        1, // is_synced
        new Date().toISOString()
    );

    if (req.lines && Array.isArray(req.lines)) {
        // Delete old lines to avoid duplicates during sync
        await db.runAsync('DELETE FROM sales_rep_request_line WHERE request_local_id = ?', req.local_id);
        for (const line of req.lines) {
            await db.runAsync(
                `INSERT INTO sales_rep_request_line (odoo_id, request_local_id, product_id, qty, uom_id, is_synced)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                line.id ?? null,
                req.local_id ?? null,
                getId(line.product_id) ?? null,
                line.qty ?? 0,
                getId(line.uom_id) ?? null,
                1
            );
        }
    }
};

export const createLocalStockRequest = async (requestData: any, lines: any[]) => {
    const db = await getDB();
    const localId = requestData.local_id || `REQ-${Date.now()}`;

    await db.runAsync(
        `INSERT INTO sales_rep_request (
            local_id, odoo_id, name, date, sales_rep_id, 
            location_id, source_location_id, 
            location_name, source_location_name,
            state, is_synced, last_modified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        localId,
        requestData.odoo_id || null,
        requestData.name || 'Draft Request',
        requestData.date || new Date().toISOString(),
        requestData.sales_rep_id,
        requestData.location_dest_id,
        requestData.location_src_id,
        requestData.location_dest_name,
        requestData.location_src_name,
        requestData.state || 'draft',
        requestData.is_synced || 0,
        new Date().toISOString()
    );

    for (const line of lines) {
        await db.runAsync(
            `INSERT INTO sales_rep_request_line (request_local_id, product_id, qty, uom_id, is_synced)
             VALUES (?, ?, ?, ?, ?)`,
            localId,
            line.product_id,
            line.qty || line.product_uom_qty,
            line.uom_id || line.product_uom_id,
            requestData.is_synced || 0
        );
    }
    return localId;
};

export const getStockRequests = async () => {
    const db = await getDB();
    const requests = await db.getAllAsync<any>('SELECT * FROM sales_rep_request ORDER BY date DESC');
    for (const req of requests) {
        req.lines = await db.getAllAsync<any>('SELECT * FROM sales_rep_request_line WHERE request_local_id = ?', req.local_id);
    }
    return requests;
};

// --- Routes ---
export const upsertRoute = async (route: any) => {
    const db = await getDB();
    const salesRepId = getId(route.sales_rep_id);

    await db.runAsync(
        `INSERT OR REPLACE INTO sales_rep_route (odoo_id, name, date, state, sales_rep_id, start_time, end_time, is_synced, last_modified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        route.id ?? null,
        route.name || '',
        route.date ?? null,
        route.state ?? null,
        salesRepId ?? null,
        route.start_time ?? null,
        route.end_time ?? null,
        1, // is_synced
        new Date().toISOString() // last_modified
    );
};

export const getRoutes = async () => {
    const db = await getDB();
    return await db.getAllAsync<any>('SELECT * FROM sales_rep_route ORDER BY date DESC');
};

export const deleteRouteByOdooId = async (odooId: number) => {
    const db = await getDB();
    // Also delete associated customers/visits to maintain integrity
    await db.runAsync('DELETE FROM sales_route_customer WHERE route_id = ?', odooId);
    await db.runAsync('DELETE FROM sales_rep_route WHERE odoo_id = ?', odooId);
};

// --- Route Customers ---
export const upsertRouteCustomer = async (data: any) => {
    const db = await getDB();
    // We need to be careful not to overwrite local unsynced changes (like state='in_progress')
    // when syncing from server. 
    // Strategy: Insert, or Update only if local is_synced=1 OR if we want to force specific fields.
    // However, SQLite ON CONFLICT doesn't easily let us check the OLD value's is_synced in a simple way 
    // within a standard INSERT OR REPLACE without a trigger or specific logic.
    // 
    // BETTER APPROACH: Check if it exists and is unsynced first? 
    // Or use INSERT ... ON CONFLICT(odoo_id) DO UPDATE SET ... WHERE is_synced=1

    // Let's try the ON CONFLICT approach with a WHERE clause in the DO UPDATE.
    // NOTE: SQLite 3.24+ supports UPSERT syntax. Expo SQLite should support it.

    // Extract integer IDs
    const routeId = getId(data.route_id);
    const partnerId = getId(data.partner_id);

    await db.runAsync(
        `INSERT INTO sales_route_customer (
            odoo_id, route_id, partner_id, name, address, phone, email, 
            latitude, longitude, radius, enable_location, sequence, state, visit_type_name, is_synced, last_modified
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(odoo_id) DO UPDATE SET
            route_id=excluded.route_id,
            partner_id=excluded.partner_id,
            name=excluded.name,
            address=excluded.address,
            phone=excluded.phone,
            email=excluded.email,
            latitude=excluded.latitude,
            longitude=excluded.longitude,
            radius=excluded.radius,
            enable_location=excluded.enable_location,
            sequence=excluded.sequence,
            visit_type_name=excluded.visit_type_name,
            -- Only update state if the local record is fully synced (is_synced=1)
            -- If is_synced=0, we have local changes we want to keep.
            state = CASE WHEN sales_route_customer.is_synced = 1 THEN excluded.state ELSE sales_route_customer.state END,
            is_synced = 1,
            last_modified=excluded.last_modified` ,
        data.id ?? null,
        routeId ?? null,
        partnerId ?? null,
        data.name ?? '',
        data.address ?? '',
        data.phone ?? '',
        data.email ?? '',
        data.latitude ?? null,
        data.longitude ?? null,
        data.location_radius ?? data.radius ?? null,
        data.enable_location ? 1 : 0,
        data.sequence ?? 0,
        data.state ?? 'draft',
        data.visit_type_name ?? '',
        new Date().toISOString()
    );
};

export const getRouteCustomersByRouteOdooId = async (routeOdooId: number) => {
    const db = await getDB();
    return await db.getAllAsync<any>(`
        SELECT src.*, rp.name as partner_name, rp.property_product_pricelist, rp.property_payment_term_id, 
               rp.credit_limit, rp.total_due, rp.loyalty_points,
               rp.sale_credit_limit, rp.allow_over_sale_credit, rp.sale_credit_used, rp.is_cash
        FROM sales_route_customer src
        LEFT JOIN res_partner rp ON src.partner_id = rp.odoo_id
        WHERE src.route_id = ?
    `, routeOdooId);
};

export const deleteRouteCustomerByOdooId = async (odooId: number) => {
    const db = await getDB();
    await db.runAsync('DELETE FROM sales_route_customer WHERE odoo_id = ?', odooId);
};

export const cleanupRoutes = async (activeOdooIds: number[]) => {
    const db = await getDB();
    if (activeOdooIds.length === 0) {
        await db.runAsync('DELETE FROM sales_rep_route WHERE odoo_id IS NOT NULL AND is_synced = 1');
    } else {
        const placeholders = activeOdooIds.map(() => '?').join(',');
        await db.runAsync(
            `DELETE FROM sales_rep_route WHERE odoo_id IS NOT NULL AND is_synced = 1 AND odoo_id NOT IN (${placeholders})`,
            ...activeOdooIds
        );
    }
};

export const cleanupRouteCustomers = async (activeOdooIds: number[]) => {
    const db = await getDB();
    if (activeOdooIds.length === 0) {
        await db.runAsync('DELETE FROM sales_route_customer WHERE odoo_id IS NOT NULL AND is_synced = 1');
    } else {
        const placeholders = activeOdooIds.map(() => '?').join(',');
        await db.runAsync(
            `DELETE FROM sales_route_customer WHERE odoo_id IS NOT NULL AND is_synced = 1 AND odoo_id NOT IN (${placeholders})`,
            ...activeOdooIds
        );
    }
};

export const getRouteCustomers = async (routeId: number) => {
    const db = await getDB();
    console.log("Fetching customers for route_id:", routeId);
    return await db.getAllAsync(`
        SELECT src.*, COALESCE(src.name, rp.name) as name, src.address,
               rp.property_product_pricelist, rp.property_payment_term_id, 
               rp.credit_limit, rp.total_due, rp.loyalty_points,
               rp.sale_credit_limit, rp.allow_over_sale_credit, rp.sale_credit_used,
               rp.mobile_local_id as partner_local_id
        FROM sales_route_customer src
        LEFT JOIN res_partner rp ON src.partner_id = rp.odoo_id
        WHERE src.route_id = ? 
        ORDER BY src.sequence
    `, routeId);
};

export const updateCustomerStatus = async (id: number, state: string, startTime?: string) => {
    const db = await getDB();
    if (startTime) {
        await db.runAsync(
            'UPDATE sales_route_customer SET state = ?, visit_start_time = ?, is_synced = 0, last_modified = ? WHERE id = ?',
            state, startTime, new Date().toISOString(), id
        );
    } else {
        await db.runAsync(
            'UPDATE sales_route_customer SET state = ?, is_synced = 0, last_modified = ? WHERE id = ?',
            state, new Date().toISOString(), id
        );
    }
};

export const updateRouteCustomerSequence = async (id: number, sequence: number) => {
    const db = await getDB();
    await db.runAsync(
        'UPDATE sales_route_customer SET sequence = ?, is_synced = 0, last_modified = ? WHERE id = ?',
        sequence, new Date().toISOString(), id
    );
};

export const markAllRouteCustomersSynced = async () => {
    const db = await getDB();
    await db.runAsync('UPDATE sales_route_customer SET is_synced = 1');
};

export const createLocalRouteCustomer = async (data: any) => {
    const db = await getDB();
    const result = await db.runAsync(
        `INSERT INTO sales_route_customer (
            route_id, partner_id, name, address, phone, email, 
            latitude, longitude, radius, enable_location, sequence, state, is_synced, last_modified
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        getId(data.route_id),
        null, // No Odoo ID for partner yet
        data.name ?? null,
        data.address ?? null,
        data.phone ?? null,
        data.email ?? null,
        data.latitude ?? null,
        data.longitude ?? null,
        data.location_radius || 0,
        data.enable_location ? 1 : 0,
        data.sequence ?? 0,
        data.state ?? 'pending',
        new Date().toISOString()
    );
    return result.lastInsertRowId;
};

export const deleteRouteCustomer = async (id: number) => {
    const db = await getDB();
    await db.runAsync('DELETE FROM sales_route_customer WHERE id = ?', id);
};

export const markRouteCustomerSynced = async (id: number, odooId: number) => {
    const db = await getDB();
    // Duplicate protection: if another record already has this odooId, delete it first
    // This can happen if the sync download phase created a new record for this customer
    // before the action acknowledgment was processed.
    await db.runAsync('DELETE FROM sales_route_customer WHERE odoo_id = ? AND id != ?', odooId, id);

    await db.runAsync(
        'UPDATE sales_route_customer SET odoo_id = ?, is_synced = 1 WHERE id = ?',
        odooId, id
    );
};

export const getRouteCustomer = async (id: number) => {
    const db = await getDB();
    // Allow lookup by ID (local PK) or Odoo ID
    // Prioritize ID if it looks like a local PK (small int) vs Odoo ID
    return await db.getFirstAsync(`
        SELECT src.*, COALESCE(src.name, rp.name) as name, src.address,
               rp.property_product_pricelist, rp.property_payment_term_id, 
               rp.credit_limit, rp.total_due, rp.loyalty_points,
               rp.sale_credit_limit, rp.allow_over_sale_credit, rp.sale_credit_used
        FROM sales_route_customer src
        LEFT JOIN res_partner rp ON src.partner_id = rp.odoo_id
        WHERE src.id = ? OR src.odoo_id = ?
    `, id, id);
};

// --- Products ---
export const upsertProduct = async (product: any) => {
    const db = await getDB();
    await db.runAsync(
        `INSERT OR REPLACE INTO product_product (
            odoo_id, product_tmpl_id, name, display_name, list_price, free_qtys,
            uom_id, uom_name, uom_category_id, categ_id, categ_name, detailed_type, invoice_policy, taxes_json, image_url, active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        product.id ?? null,
        getId(product.product_tmpl_id) ?? null,
        product.name ?? null,
        product.display_name ?? null,
        product.list_price ?? 0,
        JSON.stringify(product.free_qtys || []),
        getId(product.uom_id) ?? null,
        (product.uom_id && Array.isArray(product.uom_id)) ? product.uom_id[1] : (product.uom_name || null),
        getId(product.uom_category_id) ?? null,
        getId(product.categ_id) ?? null,
        (product.categ_id && Array.isArray(product.categ_id)) ? product.categ_id[1] : (product.categ_name || null),
        product.detailed_type || null,
        product.invoice_policy || null,
        JSON.stringify(product.taxes_id || []),
        product.image_url ?? null,
        product.active ? 1 : 0
    );
};

export const searchProducts = async (query: string) => {
    const db = await getDB();
    return await db.getAllAsync(
        `SELECT p.*, u.factor as uom_factor, u.rounding as uom_rounding 
         FROM product_product p
         LEFT JOIN uom_uom u ON p.uom_id = u.odoo_id
         WHERE (p.name LIKE ? OR p.default_code LIKE ?) 
         AND p.free_qty > 0 
         LIMIT 50`,
        `%${query}%`, `%${query}%`
    );
};

export const getProductById = async (odooId: number) => {
    const db = await getDB();
    return await db.getFirstAsync<any>(
        'SELECT * FROM product_product WHERE odoo_id = ?',
        odooId
    );
};

// --- Visits ---
export const insertVisit = async (visit: any) => {
    const db = await getDB();
    await db.runAsync(
        `INSERT INTO sales_rep_visit (
            local_id, route_id, route_customer_id, local_route_customer_id, partner_id, visit_date, state,
            latitude, longitude, visit_type, notes, visit_result, visit_reason, follow_up_date,
            start_time, end_time, is_synced, last_modified
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
        visit.local_id,
        visit.route_id ?? null,
        visit.route_customer_id ?? null,
        visit.local_route_customer_id ?? null,
        visit.partner_id ?? null,
        visit.visit_date ?? null,
        visit.state ?? 'pending',
        visit.latitude ?? null,
        visit.longitude ?? null,
        visit.visit_type ?? null,
        visit.notes ?? null,
        visit.visit_result ?? null,
        visit.visit_reason ?? null,
        visit.follow_up_date ?? null,
        visit.start_time ?? null,
        visit.end_time ?? null,
        new Date().toISOString()
    );
};

export const updateVisit = async (visit: any) => {
    const db = await getDB();
    await db.runAsync(
        `UPDATE sales_rep_visit SET
            state = ?, visit_result = ?, visit_reason = ?, notes = ?,
            end_time = ?, follow_up_date = ?, is_synced = 0, last_modified = ?
        WHERE local_id = ?`,
        visit.state, visit.visit_result, visit.visit_reason, visit.notes,
        visit.end_time, visit.follow_up_date ?? null, new Date().toISOString(), visit.local_id
    );
};

export const getActiveVisitForCustomer = async (routeCustomerId: number | null, partnerId: number | null, localRouteCustomerId?: number | null) => {
    const db = await getDB();
    if (!routeCustomerId && !partnerId && !localRouteCustomerId) return null;

    console.log("Looking for active visit:", { routeCustomerId, partnerId, localRouteCustomerId });

    // Check locally active visit by either route_customer_id, partner_id OR local_route_customer_id
    // This handles cases where we might have started visit via one ID but looking up via another
    return await db.getFirstAsync(
        `SELECT * FROM sales_rep_visit 
         WHERE state = 'in_progress' 
         AND (
            (route_customer_id = ? AND route_customer_id IS NOT NULL) 
            OR 
            (partner_id = ? AND partner_id IS NOT NULL)
            OR
            (local_route_customer_id = ? AND local_route_customer_id IS NOT NULL)
         )
         ORDER BY start_time DESC LIMIT 1`,
        routeCustomerId, partnerId, localRouteCustomerId || null
    );
};
// --- SYNC HELPERS ---
export const getInProgressVisits = async () => {
    const db = await getDB();
    return await db.getAllAsync(`
        SELECT v.*, p.name as partner_name, rc.name as route_customer_name, rc.visit_type_name, rc.id as customer_id, rc.address, v.route_id
        FROM sales_rep_visit v
        LEFT JOIN res_partner p ON v.partner_id = p.odoo_id
        LEFT JOIN sales_route_customer rc ON v.route_customer_id = rc.odoo_id
        WHERE v.state = 'in_progress'
        ORDER BY v.start_time DESC
    `);
};

export const getPendingVisits = async () => {
    const db = await getDB();
    return await db.getAllAsync('SELECT * FROM sales_rep_visit WHERE is_synced = 0');
};

export const getPendingCollections = async () => {
    const db = await getDB();
    return await db.getAllAsync('SELECT * FROM sales_rep_collection WHERE is_synced = 0');
};

export const markVisitSynced = async (localId: string, odooId: number) => {
    const db = await getDB();

    // 1. Mark the visit itself as synced
    await db.runAsync(
        'UPDATE sales_rep_visit SET odoo_id = ?, is_synced = 1 WHERE local_id = ?',
        odooId, localId
    );

    // 2. ALSO mark the related sales_route_customer as synced.
    // In this app, starting/ending a visit marks sales_route_customer.is_synced = 0
    // so it shows up in "pending_updates". Once the visit is synced, the "update" is complete.
    await db.runAsync(
        `UPDATE sales_route_customer 
         SET is_synced = 1 
         WHERE odoo_id IN (SELECT route_customer_id FROM sales_rep_visit WHERE local_id = ?)`,
        localId
    );
};

export const markVisitSyncedByLocalId = async (localId: string) => {
    const db = await getDB();
    await db.runAsync(
        'UPDATE sales_rep_visit SET is_synced = 1 WHERE local_id = ?',
        localId
    );

    // Mark related customer as synced too
    await db.runAsync(
        `UPDATE sales_route_customer 
         SET is_synced = 1 
         WHERE odoo_id IN (SELECT route_customer_id FROM sales_rep_visit WHERE local_id = ?)`,
        localId
    );
};

export const markCollectionSynced = async (localId: string, odooId: number) => {
    const db = await getDB();
    // Duplicate protection
    await db.runAsync('DELETE FROM sales_rep_collection WHERE odoo_id = ? AND local_id != ?', odooId, localId);

    await db.runAsync(
        'UPDATE sales_rep_collection SET odoo_id = ?, is_synced = 1 WHERE local_id = ?',
        odooId, localId
    );
};

// --- TRACCAR ---

export interface TraccarDevice {
    id: number;
    local_id: string;
    is_synced: number;
    interval: number;
    distance: number;
    traccar_url: string;
    created_at: string;
}

export const upsertTraccarDevice = async (device: any) => {
    const db = await getDB();
    console.log("Upserting Traccar Device:", device);
    try {
        await db.runAsync(
            `INSERT OR REPLACE INTO traccar_device (local_id, interval, distance, traccar_url, is_synced, created_at)
             VALUES (?, ?, ?, ?, 1, ?)`,
            device.local_id || null,
            device.interval !== undefined ? device.interval : null,
            device.distance !== undefined ? device.distance : null,
            device.traccar_url || null,
            new Date().toISOString()
        );
    } catch (e) {
        console.error("Failed to upsert Traccar Device:", e);
        throw e;
    }
};

export const getTraccarDevice = async (): Promise<TraccarDevice | null> => {
    const db = await getDB();
    return await db.getFirstAsync<TraccarDevice>('SELECT * FROM traccar_device LIMIT 1');
};

export interface TraccarLocation {
    id: number;
    device_id: number;
    latitude: number;
    longitude: number;
    speed: number;
    course: number;
    accuracy: number;
    battery: number;
    timestamp: number;
    is_synced: number;
    created_at: string;
}

export const insertLocation = async (location: any) => {
    const db = await getDB();
    try {
        const checkNum = (val: any) => (typeof val === 'number' && Number.isFinite(val)) ? val : 0;

        const params = [
            location.device_id ?? null,
            checkNum(location.latitude),
            checkNum(location.longitude),
            checkNum(location.speed),
            checkNum(location.course),
            checkNum(location.accuracy),
            checkNum(location.battery),
            location.timestamp ?? 0,
            new Date().toISOString()
        ];
        console.log("Buffered Location Params:", JSON.stringify(params));

        const statement = await db.prepareAsync(
            `INSERT INTO location (device_id, latitude, longitude, speed, course, accuracy, battery, timestamp, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        try {
            await statement.executeAsync(...params);
            console.log("📍 Location buffered to SQLite");
        } finally {
            await statement.finalizeAsync();
        }
    } catch (e) {
        console.error("Failed to insert Location:", e);
        throw e;
    }
};

export const getUnsyncedLocations = async (): Promise<TraccarLocation[]> => {
    const db = await getDB();
    return await db.getAllAsync<TraccarLocation>('SELECT * FROM location WHERE is_synced = 0 ORDER BY timestamp ASC LIMIT 50');
};

export const deleteLocation = async (id: number) => {
    const db = await getDB();
    await db.runAsync('DELETE FROM location WHERE id = ?', id);
};



export const getPendingLocations = async () => {
    const db = await getDB();
    return await db.getAllAsync('SELECT * FROM location WHERE is_synced = 0');
};

export const markLocationSynced = async (localId: string, odooId: number) => {
    const db = await getDB();
    await db.runAsync(
        'UPDATE location SET odoo_id = ?, is_synced = 1 WHERE local_id = ?',
        odooId, localId
    );
};

export const getUnsyncedCounts = async () => {
    const db = await getDB();
    const visits = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM sales_rep_visit WHERE is_synced = 0');
    const collections = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM sales_rep_collection WHERE is_synced = 0');
    const locations = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM location WHERE is_synced = 0');
    const customers = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM sales_route_customer WHERE is_synced = 0');
    const orders = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM sales_order WHERE is_synced = 0');
    const actions = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) as count FROM pending_action WHERE (is_synced = 0 OR status = 'pending') AND action_type NOT IN ('upload_attachment', 'delete_attachment')");
    const partners = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM res_partner WHERE is_synced = 0');
    const adjustments = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM sales_rep_inventory_adjustment WHERE is_synced = 0');
    const stockRequests = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM sales_rep_request WHERE is_synced = 0');

    return {
        visits: visits?.count || 0,
        collections: collections?.count || 0,
        locations: locations?.count || 0,
        pending_updates: (customers?.count || 0) + (partners?.count || 0), // Bundle customer/partner together in UI count
        orders: orders?.count || 0,
        actions: actions?.count || 0,
        inventory_adjustments: adjustments?.count || 0,
        stockRequests: stockRequests?.count || 0,
        // Detailed breakdown for internal use
        customers: customers?.count || 0,
        partners: partners?.count || 0
    };
};

export const getProducts = async (showAll: boolean = false, locationId?: number) => {
    const db = await getDB();
    const rep = await getSalesRepresentative() as any;

    let activeLocId = locationId;
    if (!activeLocId && rep && rep.default_location_id) {
        activeLocId = rep.default_location_id;
    }

    let query = '';
    let params: any[] = [];

    if (activeLocId) {
        query = `
            SELECT p.id, p.odoo_id, p.product_tmpl_id, p.name, p.display_name, p.default_code, p.list_price,
                   p.uom_id, p.uom_category_id, p.categ_id, p.categ_name, p.detailed_type, p.invoice_policy,
                   p.taxes_json, p.image_url, p.active, p.uom_name, p.free_qtys,
                   COALESCE((
                       SELECT CAST(json_extract(value, '$.quantity') AS REAL)
                       FROM json_each(p.free_qtys)
                       WHERE CAST(json_extract(value, '$.location_id') AS INTEGER) = ?
                       LIMIT 1
                   ), 0.0) as free_qty, 
                   u.factor as uom_factor, u.rounding as uom_rounding 
            FROM product_product p
            LEFT JOIN uom_uom u ON p.uom_id = u.odoo_id
            WHERE p.detailed_type IN ("product", "consu")
        `;
        params.push(activeLocId);
    } else {
        query = `
            SELECT p.*, 0.0 as free_qty, u.factor as uom_factor, u.rounding as uom_rounding 
            FROM product_product p
            LEFT JOIN uom_uom u ON p.uom_id = u.odoo_id
            WHERE p.detailed_type IN ("product", "consu")
        `;
    }

    if (!showAll) {
        if (activeLocId) {
            query += ` AND COALESCE((
                SELECT CAST(json_extract(value, '$.quantity') AS REAL)
                FROM json_each(p.free_qtys)
                WHERE CAST(json_extract(value, '$.location_id') AS INTEGER) = ?
                LIMIT 1
            ), 0.0) >= 0`;
            params.push(activeLocId);
        } else {
            query += ' AND 0.0 >= 0';
        }
    }

    if (rep && rep.product_category_ids) {
        try {
            const categories = JSON.parse(rep.product_category_ids);
            if (Array.isArray(categories) && categories.length > 0) {
                const categoryIds = categories.map((c: any) => (typeof c === 'object' && c !== null) ? c.id : c);

                if (!categoryIds.includes(1)) {
                    const placeholders = categoryIds.map(() => '?').join(',');
                    query += ` AND categ_id IN (${placeholders})`;
                    params.push(...categoryIds);
                }
            }
        } catch (e) {
            console.warn("Failed to parse product_category_ids:", e);
        }
    }

    query += ' ORDER BY p.name';
    console.log("Products Query:", query);
    console.log("Products Params:", params);
    return await db.getAllAsync(query, ...params);
};

export const getInventoryAdjustmentProducts = async () => {
    const db = await getDB();
    const rep = await getSalesRepresentative() as any;

    let query = `
        SELECT p.*, u.factor as uom_factor, u.rounding as uom_rounding 
        FROM product_product p
        LEFT JOIN uom_uom u ON p.uom_id = u.odoo_id
        WHERE p.detailed_type IN ("product", "consu")
    `;
    let params: any[] = [];

    if (rep && rep.product_category_ids) {
        try {
            const categories = JSON.parse(rep.product_category_ids);
            if (Array.isArray(categories) && categories.length > 0) {
                const categoryIds = categories.map((c: any) => (typeof c === 'object' && c !== null) ? c.id : c);
                if (!categoryIds.includes(1)) {
                    const placeholders = categoryIds.map(() => '?').join(',');
                    query += ` AND categ_id IN (${placeholders})`;
                    params = categoryIds;
                }
            }
        } catch (e) {
            console.warn("Failed to parse product_category_ids:", e);
        }
    }

    query += ' ORDER BY name';
    return await db.getAllAsync(query, ...params);
};

export const getUoMsByCategory = async (categoryId: number) => {
    const db = await getDB();
    return await db.getAllAsync(
        'SELECT * FROM uom_uom WHERE category_id = ? ORDER BY name',
        categoryId
    );
};

export const createLocalOrder = async (orderData: any, lines: any[]) => {
    const db = await getDB();
    const uniqueSuffix = Math.random().toString(36).substr(2, 5).toUpperCase();
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const localName = `LO-${dateStr}-${uniqueSuffix}`;
    const localId = 'order_' + Date.now() + '_' + uniqueSuffix;

    // Try to link to an active visit
    let visitLocalId = null;
    const searchRouteCustId = orderData.route_customer_id || null;
    const searchPartnerId = orderData.partner_id || null;
    const searchLocalRouteCustId = orderData.local_route_customer_id || null;
    if (searchRouteCustId || searchPartnerId || searchLocalRouteCustId) {
        const activeVisit: any = await getActiveVisitForCustomer(searchRouteCustId, searchPartnerId, searchLocalRouteCustId);
        if (activeVisit) {
            visitLocalId = activeVisit.local_id;
            console.log(`Linking order ${localId} to active visit ${visitLocalId}`);
        }
    }

    try {
        await db.runAsync(
            `INSERT INTO sales_order (
                local_id, name, partner_id, route_customer_id, local_route_customer_id, 
                visit_local_id, route_id, date, state, amount_untaxed, amount_tax, 
                amount_total, amount_residual, is_returnable, is_cash, is_synced, last_modified
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?)`,
            localId, localName, orderData.partner_id, orderData.route_customer_id || null,
            orderData.local_route_customer_id || null,
            visitLocalId, orderData.route_id || null, orderData.date, 'draft',
            orderData.amount_untaxed || 0, orderData.amount_tax || 0, orderData.amount_total,
            orderData.amount_total, // Default residual = total for new draft
            orderData.is_cash ? 1 : 0,
            new Date().toISOString()
        );

        for (const line of lines) {
            await db.runAsync(
                `INSERT INTO sales_order_line (order_local_id, product_id, product_name, product_uom_id, product_uom_qty, price_unit, price_subtotal, product_uom_name, location_id, location_name, is_synced)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
                localId, line.product_id, line.product_name || null, line.uom_id || null, line.quantity, line.price_unit, (line.quantity * line.price_unit), line.uom_name || null, line.location_id || null, line.location_name || null
            );
        }

        console.log("Order created locally:", localId, localName);
        return localId;
    } catch (e) {
        console.error("Failed to create local order:", e);
        throw e;
    }
};

export const getPendingSalesOrders = async () => {
    const db = await getDB();
    const orders = await db.getAllAsync(`
        SELECT so.*, v.odoo_id as visit_odoo_id
        FROM sales_order so
        LEFT JOIN sales_rep_visit v ON so.visit_local_id = v.local_id
        WHERE so.is_synced = 0
    `);
    // We need to fetch lines for each order
    const ordersWithLines = await Promise.all(orders.map(async (order: any) => {
        const lines = await db.getAllAsync('SELECT * FROM sales_order_line WHERE order_local_id = ?', order.local_id);
        return { ...order, lines };
    }));
    return ordersWithLines;
};

export const markOrderSynced = async (localId: string, odooId: number) => {
    const db = await getDB();
    // Duplicate protection
    await db.runAsync('DELETE FROM sales_order WHERE odoo_id = ? AND local_id != ?', odooId, localId);

    await db.runAsync(
        'UPDATE sales_order SET odoo_id = ?, is_synced = 1 WHERE local_id = ?',
        odooId, localId
    );
};


// ==========================================
// PENDING ACTION QUEUE
// ==========================================

const generateLocalId = (prefix: string) => {
    return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
};

export const insertPendingAction = async (action: {
    action_type: string;
    payload: any;
    related_id?: string;
}) => {
    const db = await getDB();
    const localId = generateLocalId('action');
    await db.runAsync(
        `INSERT INTO pending_action (local_id, action_type, payload, related_id, status, created_at, is_synced)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        localId, action.action_type, JSON.stringify(action.payload), action.related_id || null, 'pending', new Date().toISOString()
    );
    console.log(`Pending action queued: ${action.action_type} (${localId})`);
    return localId;
};

export const getPendingActions = async () => {
    const db = await getDB();
    return await db.getAllAsync(
        "SELECT * FROM pending_action WHERE status = 'pending' AND is_synced = 0 ORDER BY created_at ASC"
    );
};

export const getPendingReturnsForOrder = async (orderId: string | number) => {
    const db = await getDB();
    const actions = await db.getAllAsync(
        "SELECT payload FROM pending_action WHERE action_type = 'return_picking' AND status = 'pending'"
    );

    const returnedItems: { [productId: number]: number } = {};

    for (const action of actions as any[]) {
        try {
            const payload = JSON.parse(action.payload || '{}');
            // Support both string matching (local_id) and number matching (odoo_id)
            if (payload.order_id == orderId) {
                const lines = payload.lines || [];
                for (const line of lines) {
                    if (line.product_id) {
                        returnedItems[line.product_id] = (returnedItems[line.product_id] || 0) + (line.quantity || 0);
                    }
                }
            }
        } catch (e) {
            console.error("Failed to parse pending return action:", e);
        }
    }

    return returnedItems;
};

export const markActionCompleted = async (localId: string) => {
    const db = await getDB();
    await db.runAsync(
        "UPDATE pending_action SET status = 'completed', is_synced = 1 WHERE local_id = ?",
        localId
    );
};

export const markActionFailed = async (localId: string, errorMessage: string) => {
    const db = await getDB();
    // User requested to remove records if they have an error
    console.log(`Removing failed action ${localId} due to error: ${errorMessage}`);
    await db.runAsync(
        "DELETE FROM pending_action WHERE local_id = ?",
        localId
    );
};

export const resetFailedActions = async (forceAll: boolean = false) => {
    // No-op or deprecated since we now delete failed actions
    // But keeping it for now in case we revert or for existing records
    const db = await getDB();
    if (forceAll) {
        await db.runAsync("UPDATE pending_action SET status = 'pending' WHERE status = 'failed'");
    } else {
        await db.runAsync(
            "UPDATE pending_action SET status = 'pending' WHERE status = 'failed' AND retry_count < 5"
        );
    }
};

export const getPermanentlyFailedActions = async () => {
    const db = await getDB();
    return await db.getAllAsync(
        "SELECT * FROM pending_action WHERE status = 'failed' AND retry_count >= 5 ORDER BY created_at DESC"
    );
};


// ==========================================
// RES.PARTNER (Customers)
// ==========================================

export const upsertPartner = async (partner: any) => {
    const db = await getDB();

    // 1. Resolve mobile_local_id linking and handle potential local_id conflicts
    if (partner.mobile_local_id) {
        const existingByLocal: any = await db.getFirstAsync(
            'SELECT odoo_id FROM res_partner WHERE local_id = ?',
            partner.mobile_local_id
        );
        if (existingByLocal) {
            if (!existingByLocal.odoo_id || existingByLocal.odoo_id === 0) {
                console.log(`Sync: Linking downloaded partner ${partner.id} to local record ${partner.mobile_local_id}`);
                // Robust duplicate protection: clear other records with this odoo_id before linking
                await db.runAsync('DELETE FROM res_partner WHERE odoo_id = ? AND local_id != ?', partner.id, partner.mobile_local_id);
                await db.runAsync(
                    'UPDATE res_partner SET odoo_id = ? WHERE local_id = ?',
                    partner.id, partner.mobile_local_id
                );
            } else if (existingByLocal.odoo_id !== partner.id) {
                // CONFLICT: different odoo_id is using this local_id
                console.warn(`Sync: local_id conflict for partner ${partner.mobile_local_id}. Existing Odoo ID: ${existingByLocal.odoo_id}, incoming: ${partner.id}. Removing old record.`);
                await db.runAsync('DELETE FROM res_partner WHERE local_id = ?', partner.mobile_local_id);
            }
        }
    }

    await db.runAsync(
        `INSERT INTO res_partner (
            odoo_id, name, phone, mobile, email, street, city, country_id, vat, latitude, longitude,
            enable_location, location_radius,
            property_payment_term_id, property_product_pricelist, credit_limit, total_due,
            sale_credit_limit, allow_over_sale_credit, sale_credit_used,
            loyalty_points, is_cash, state_id, area, category_id,
            is_synced, last_modified, mobile_local_id
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(odoo_id) DO UPDATE SET
            name=excluded.name, 
            phone=excluded.phone, 
            mobile=excluded.mobile, 
            email=excluded.email, 
            street=excluded.street, 
            city=excluded.city, 
            country_id=excluded.country_id, 
            vat=excluded.vat,
            latitude=excluded.latitude, 
            longitude=excluded.longitude,
            enable_location=excluded.enable_location,
            location_radius=excluded.location_radius,
            property_payment_term_id=excluded.property_payment_term_id,
            property_product_pricelist=excluded.property_product_pricelist,
            credit_limit=excluded.credit_limit,
            total_due=excluded.total_due,
            sale_credit_limit=excluded.sale_credit_limit,
            allow_over_sale_credit=excluded.allow_over_sale_credit,
            sale_credit_used=excluded.sale_credit_used,
            loyalty_points=excluded.loyalty_points,
            is_cash=excluded.is_cash,
            state_id=excluded.state_id,
            area=excluded.area,
            category_id=excluded.category_id,
            is_synced=1,
            last_modified=excluded.last_modified,
            mobile_local_id=COALESCE(res_partner.mobile_local_id, excluded.mobile_local_id),
            local_id=COALESCE(res_partner.local_id, excluded.mobile_local_id)`,
        partner.id ?? null,
        partner.name ?? null,
        partner.phone || null,
        partner.mobile || null,
        partner.email || null,
        partner.street || null,
        partner.city || null,
        getId(partner.country_id) ?? null,
        partner.vat || null,
        partner.visit_latitude || partner.latitude || null,
        partner.visit_longitude || partner.longitude || null,
        partner.enable_location ? 1 : 0,
        partner.location_radius || 0,
        getId(partner.property_payment_term_id) ?? null,
        getId(partner.property_product_pricelist) ?? null,
        partner.credit_limit || 0,
        partner.total_due || 0,
        partner.sale_credit_limit || 0,
        partner.allow_over_sale_credit ? 1 : 0,
        partner.sale_credit_used || 0,
        partner.loyalty_points || 0,
        partner.is_cash ? 1 : 0,
        getId(partner.state_id) || null,
        partner.area || null,
        JSON.stringify(partner.category_id || []),
        new Date().toISOString(),
        partner.mobile_local_id || null
    );
};

export const createLocalPartner = async (partnerData: any) => {
    const db = await getDB();
    const localId = generateLocalId('partner');
    await db.runAsync(
        `INSERT INTO res_partner (local_id, name, phone, mobile, email, street, city, country_id, vat, latitude, longitude,
         enable_location, location_radius,
         property_payment_term_id, property_product_pricelist, is_cash, state_id, area, category_id, is_synced, last_modified, mobile_local_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        localId, partnerData.name, partnerData.phone || null, partnerData.mobile || null,
        partnerData.email || null, partnerData.street || null, partnerData.city || null,
        partnerData.country_id || null, partnerData.vat || null,
        partnerData.latitude || null, partnerData.longitude || null,
        partnerData.enable_location ? 1 : 0, partnerData.location_radius || 0,
        partnerData.property_payment_term_id || null, partnerData.property_product_pricelist || null,
        partnerData.is_cash ? 1 : 0, partnerData.state_id || null, partnerData.area || null,
        JSON.stringify(partnerData.category_id || []),
        new Date().toISOString(), localId
    );
    return localId;
};

export const getPartnerById = async (odooId: number) => {
    const db = await getDB();
    return await db.getFirstAsync('SELECT * FROM res_partner WHERE odoo_id = ?', odooId);
};

export const getPartnersForSelection = async () => {
    const db = await getDB();
    return await db.getAllAsync<{ odoo_id: number; name: string }>(
        'SELECT odoo_id, name FROM res_partner WHERE odoo_id IS NOT NULL ORDER BY name COLLATE NOCASE'
    );
};

export const getUnsyncedPartners = async () => {
    const db = await getDB();
    return await db.getAllAsync('SELECT * FROM res_partner WHERE is_synced = 0');
};

export const markPartnerSynced = async (localId: string, odooId: number) => {
    const db = await getDB();

    // Check if another record already has this odooId (e.g. it was downloaded before create_customer ack)
    const duplicate: any = await db.getFirstAsync(
        'SELECT local_id FROM res_partner WHERE odoo_id = ? AND local_id != ?',
        odooId, localId
    );

    if (duplicate) {
        console.log(`Sync: Found duplicate res_partner for odooId ${odooId}. Merging ${localId} into ${duplicate.local_id}`);
        // Robust duplicate protection: clear ALL records with this odoo_id that aren't our target
        await db.runAsync('DELETE FROM res_partner WHERE odoo_id = ? AND local_id != ?', odooId, localId);
    }

    await db.runAsync(
        'UPDATE res_partner SET odoo_id = ?, is_synced = 1 WHERE local_id = ?',
        odooId, localId
    );
};

// ==========================================
// PAYMENT JOURNALS
// ==========================================

export const upsertPaymentJournal = async (item: any) => {
    const db = await getDB();
    await db.runAsync(
        `INSERT INTO payment_journal (odoo_id, name, type, balance, last_synced)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(odoo_id) DO UPDATE SET
         name=excluded.name, type=excluded.type, balance=excluded.balance, last_synced=excluded.last_synced`,
        item.id,
        item.name,
        item.type || null,
        item.balance || 0,
        new Date().toISOString()
    );
};

export const getPaymentJournals = async () => {
    const db = await getDB();
    return await db.getAllAsync<any>('SELECT * FROM payment_journal ORDER BY name');
};

export const deleteUnassignedPaymentJournals = async (serverIds: number[]) => {
    const db = await getDB();
    if (serverIds.length === 0) {
        await db.runAsync('DELETE FROM payment_journal');
    } else {
        const placeholders = serverIds.map(() => '?').join(',');
        await db.runAsync(`DELETE FROM payment_journal WHERE odoo_id NOT IN (${placeholders})`, ...serverIds);
    }
};

// ==========================================
// PRICELISTS
// ==========================================

export const upsertPricelist = async (item: any, sequence: number = 0) => {
    const db = await getDB();
    await db.runAsync(
        `INSERT OR REPLACE INTO pricelist (odoo_id, name, sequence, last_synced)
         VALUES (?, ?, ?, ?)`,
        item.id,
        item.name,
        sequence,
        new Date().toISOString()
    );
};

export const getPricelists = async () => {
    const db = await getDB();
    return await db.getAllAsync<any>('SELECT * FROM pricelist ORDER BY sequence, name');
};

export const deleteUnassignedPricelists = async (serverIds: number[]) => {
    const db = await getDB();
    if (serverIds.length === 0) {
        await db.runAsync('DELETE FROM pricelist');
        await db.runAsync('DELETE FROM pricelist_item');
    } else {
        const placeholders = serverIds.map(() => '?').join(',');
        await db.runAsync(`DELETE FROM pricelist WHERE odoo_id NOT IN (${placeholders})`, ...serverIds);
        await db.runAsync(`DELETE FROM pricelist_item WHERE pricelist_id NOT IN (${placeholders})`, ...serverIds);
    }
};

// ==========================================
// LOYALTY PROGRAMS
// ==========================================

export const upsertLoyaltyProgram = async (program: any) => {
    const db = await getDB();
    if (program.is_archived) {
        await db.runAsync('DELETE FROM loyalty_program WHERE odoo_id = ?', program.id);
        return;
    }
    await db.runAsync(
        `INSERT INTO loyalty_program (odoo_id, name, program_type, priority, can_be_shared, json_data, is_synced, last_modified)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(odoo_id) DO UPDATE SET
         name=excluded.name, program_type=excluded.program_type, 
         priority=excluded.priority, can_be_shared=excluded.can_be_shared,
         json_data=excluded.json_data,
         is_synced=1, last_modified=excluded.last_modified`,
        program.id, program.name, program.program_type,
        program.priority || 0, program.can_be_shared ? 1 : 0,
        program.json_data || JSON.stringify(program),
        new Date().toISOString()
    );
};

export const getLoyaltyPrograms = async () => {
    const db = await getDB();
    const programs = await db.getAllAsync<any>('SELECT * FROM loyalty_program');
    return programs.map(p => ({
        ...JSON.parse(p.json_data || '{}'), // Base rules/rewards
        ...p,                               // Overlay with fields from SQLite (priority, can_be_shared, etc.)
    }));
};

/**
 * Calculates which promotions are applicable based on priority and shareability.
 * Logic mirrors Odoo's priority system.
 */
export const calculateOfflinePromotions = async (order: any, currentLines: any[] = []) => {
    const db = await getDB();
    const allPrograms = await getLoyaltyPrograms();

    // Fetch customer details to check geographic and partner constraints
    const partner = await db.getFirstAsync<any>(
        'SELECT country_id, state_id, area, category_id FROM res_partner WHERE odoo_id = ? OR local_id = ?',
        order.partner_id, order.partner_id
    );
    const partnerCategories = JSON.parse(partner?.category_id || '[]');

    // 1. Sort by Priority (Ascending, 0 is highest)
    const sortedPrograms = allPrograms.sort((a, b) => (a.priority || 0) - (b.priority || 0));

    const applicablePromotions = [];
    let stopApplying = false;

    for (const program of sortedPrograms) {
        if (stopApplying) break;

        // --- NEW CONSTRAINTS CHECK ---
        // 1. is_cash check (Match program's is_cash with order's is_cash)
        // Note: program.is_cash comes from json_data synced from backend
        if (program.is_cash && !order.is_cash) {
            console.log(`[Promotion] ${program.name} skipped: Cash-only promotion, but order is NOT cash.`);
            continue;
        }

        // 2. Geographic Constraints
        if (program.limit_country_ids?.length > 0 && !program.limit_country_ids.includes(partner?.country_id)) {
            continue;
        }
        if (program.limit_state_ids?.length > 0 && !program.limit_state_ids.includes(partner?.state_id)) {
            continue;
        }
        if (program.limit_area_names?.length > 0 && !program.limit_area_names.includes(partner?.area)) {
            continue;
        }

        // 3. Partner Constraints
        if (program.limit_partner_ids?.length > 0 && !program.limit_partner_ids.includes(order.partner_id)) {
            continue;
        }
        if (program.limit_partner_category_ids?.length > 0) {
            const hasMatchingCategory = partnerCategories.some((catId: number) => program.limit_partner_category_ids.includes(catId));
            if (!hasMatchingCategory) continue;
        }
        // ------------------------------

        // --- NEW TIERS EVALUATION ---
        if (program.program_type === 'tier') {
            const tiers_type = program.tiers_type || 'order_total'; // Fallback if missing in JSON
            const tiers = program.tiers || [];
            let matchedTiers = [];

            if (tiers_type === 'order_total') {
                const totalAmount = currentLines.reduce((sum, l) => sum + (Number(l.price_subtotal) || 0), 0);
                for (const tier of tiers) {
                    if (tier.minimum_amount <= totalAmount && totalAmount <= tier.maximum_amount) {
                        matchedTiers.push({ tier, amount: totalAmount });
                        break; // Only first (best) match
                    }
                }
            } else if (tiers_type === 'order_line') {
                for (const line of currentLines) {
                    for (const tier of tiers) {
                        if (tier.rule_product_id && Number(line.product_id) !== tier.rule_product_id) continue;

                        const val = tier.trigger_type === 'quantity' ? (Number(line.product_uom_qty) || 0) : (Number(line.price_subtotal) || 0);
                        if (tier.minimum_amount <= val && val <= tier.maximum_amount) {
                            matchedTiers.push({ tier, amount: Number(line.price_subtotal) || 0 });
                            break; // Line gets at most one tier match
                        }
                    }
                }
            }

            if (matchedTiers.length > 0) {
                // Construct virtual rewards
                program.earned_points = 1;
                program.rewards = matchedTiers.map(m => {
                    const t = m.tier;
                    return {
                        reward_type: t.reward_type === 'bonus' ? 'product' : 'discount',
                        discountAmountOverride: t.reward_type === 'discount' ? m.amount * ((t.discount || 0) / 100) : 0,
                        discount: t.discount,
                        reward_product_id: t.bonus_product_id,
                        reward_product_name: t.bonus_product_name,
                        reward_product_qty: t.bonus_product_qty,
                        required_points: 1,
                        description: t.reward_type === 'bonus' ? `${t.name} - ${t.bonus_product_name || 'Bonus'}` : t.name
                    };
                });
                applicablePromotions.push(program);
                if (!program.can_be_shared) stopApplying = true;
            }
            continue; // Skip standard rules since this is a tier program
        }
        // ------------------------------

        const rules = program.rules || [];
        let ruleMatches = true;
        let pointsEarned = 0;

        for (const rule of rules) {
            if (rule.minimum_amount > 0 && (order.amount_untaxed || 0) < rule.minimum_amount) {
                ruleMatches = false;
                break;
            }

            let matchingQty = 0;
            let matchingAmount = 0;
            const ruleProductIds = rule.product_ids || [];

            if (ruleProductIds.length > 0) {
                const matchingLines = currentLines.filter(l => ruleProductIds.includes(Number(l.product_id)));
                matchingQty = matchingLines.reduce((sum, l) => sum + (Number(l.product_uom_qty) || 0), 0);
                matchingAmount = matchingLines.reduce((sum, l) => sum + (Number(l.price_subtotal) || 0), 0);
                console.log(`[Promotion] Rule matched ${matchingLines.length} lines. Qty: ${matchingQty}, Amt: ${matchingAmount}`);
            } else {
                matchingQty = currentLines.reduce((sum, l) => sum + (l.product_uom_qty || 0), 0);
                matchingAmount = order.amount_untaxed || 0;
            }

            if (rule.minimum_qty > 0 && matchingQty < rule.minimum_qty) {
                ruleMatches = false;
                break;
            }

            // Calculate points earned (Matching Odoo's loyalty engine behavior)
            let pts = 0;
            if (rule.reward_point_mode === 'unit') {
                pts = Math.floor(matchingQty) * (Number(rule.reward_point_amount) || 1);
            } else if (rule.reward_point_mode === 'money') {
                pts = Math.floor(matchingAmount) * (Number(rule.reward_point_amount) || 1);
            } else { // 'order'
                pts = Number(rule.reward_point_amount) || 1;
            }
            pointsEarned += pts;
            console.log(`[Promotion] Rule earned ${pts} points (Mode: ${rule.reward_point_mode}, Amount: ${rule.reward_point_amount}). Total for program: ${pointsEarned}`);
        }

        if (ruleMatches && pointsEarned > 0) {
            program.earned_points = pointsEarned; // Store for reward calculation
            applicablePromotions.push(program);

            if (!program.can_be_shared) {
                console.log(`Promotion ${program.name} is NOT shareable. Stopping reward calculation.`);
                stopApplying = true;
            }
        }
    }

    return applicablePromotions;
};

// ==========================================
// PAYMENT TERMS
// ==========================================

export const upsertPaymentTerm = async (item: any, sequence: number = 0) => {
    const db = await getDB();
    await db.runAsync(
        `INSERT OR REPLACE INTO payment_term (odoo_id, name, sequence, last_synced)
         VALUES (?, ?, ?, ?)`,
        item.id || item.odoo_id,
        item.name,
        sequence,
        new Date().toISOString()
    );
};

export const getPaymentTerms = async () => {
    const db = await getDB();
    return await db.getAllAsync<any>('SELECT * FROM payment_term ORDER BY sequence, name');
};

export const deleteUnassignedPaymentTerms = async (serverIds: number[]) => {
    const db = await getDB();
    if (serverIds.length === 0) {
        await db.runAsync('DELETE FROM payment_term');
    } else {
        const placeholders = serverIds.map(() => '?').join(',');
        await db.runAsync(`DELETE FROM payment_term WHERE odoo_id NOT IN (${placeholders})`, ...serverIds);
    }
};

// ==========================================
// SALES ORDERS (Server-synced data)
// ==========================================

export const upsertSalesOrderFromServer = async (order: any, lines: any[] = []) => {
    const db = await getDB();
    const partnerId = getId(order.partner_id);

    // Try to link to a local visit if we have the Odoo visit ID
    let visitLocalId = null;
    if (order.visit_id) {
        const visitOdooId = getId(order.visit_id);
        const visit = await db.getFirstAsync<{ local_id: string }>('SELECT local_id FROM sales_rep_visit WHERE odoo_id = ?', visitOdooId);
        if (visit) {
            visitLocalId = visit.local_id;
        }
    }

    // Identify if this order already exists locally, and ensure it has a local_id
    const existingOrder = await db.getFirstAsync<{ local_id: string }>(
        'SELECT local_id FROM sales_order WHERE odoo_id = ? OR local_id = ?',
        order.id, `order_synced_${order.id}`
    );
    const orderLocalId = existingOrder?.local_id || `order_synced_${order.id}`;

    // Critical: If we found a record by local_id but it has no odoo_id or a different one,
    // we must clean it up or update it to avoid UNIQUE constraint violation on local_id
    // when the ON CONFLICT(odoo_id) doesn't trigger.
    await db.runAsync(
        'DELETE FROM sales_order WHERE local_id = ? AND (odoo_id IS NULL OR odoo_id != ?)',
        orderLocalId, order.id
    );

    await db.runAsync(
        `INSERT INTO sales_order (odoo_id, name, partner_id, local_id, date, state, amount_untaxed, amount_tax, amount_total,
         invoice_status, delivery_status, pricelist_id, route_id, visit_local_id, invoice_ids, picking_ids, payment_state, 
         amount_residual, is_returnable, discount_total, applied_promotions, is_cash, is_synced, last_modified)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(odoo_id) DO UPDATE SET
         name=excluded.name, state=excluded.state, amount_untaxed=excluded.amount_untaxed,
         amount_tax=excluded.amount_tax, amount_total=excluded.amount_total,
         invoice_status=excluded.invoice_status, delivery_status=excluded.delivery_status,
         route_id=excluded.route_id, visit_local_id=excluded.visit_local_id,
         invoice_ids=excluded.invoice_ids, picking_ids=excluded.picking_ids, payment_state=excluded.payment_state, amount_residual=excluded.amount_residual,
         is_returnable=excluded.is_returnable, 
         discount_total = CASE WHEN (excluded.discount_total > 0 OR excluded.state NOT IN ('draft', 'sent')) THEN excluded.discount_total ELSE sales_order.discount_total END,
         applied_promotions = CASE WHEN (excluded.applied_promotions != '[]' OR excluded.state NOT IN ('draft', 'sent')) THEN excluded.applied_promotions ELSE sales_order.applied_promotions END,
         is_cash=excluded.is_cash,
         is_synced=1, last_modified=excluded.last_modified`,
        order.id ?? null,
        order.name || null,
        partnerId ?? null,
        orderLocalId,
        order.date_order || order.date || null,
        order.state || 'draft',
        order.amount_untaxed || 0,
        order.amount_tax || 0,
        order.amount_total || 0,
        order.invoice_status || null,
        order.delivery_status || null,
        getId(order.pricelist_id) ?? null,
        getId(order.route_id) ?? null,
        visitLocalId ?? null,
        JSON.stringify(order.invoice_ids || []),
        JSON.stringify(order.picking_ids || []),
        order.payment_state || null,
        order.amount_residual ?? (order.payment_state === 'paid' ? 0 : order.amount_total),
        (order.is_returnable === false || order.is_returnable === 0) ? 0 : 1,
        order.discount_total || 0,
        JSON.stringify(order.applied_promotions || []),
        order.is_cash ? 1 : 0,
        new Date().toISOString()
    );

    // Upsert order lines if provided
    const validOdooLineIds: number[] = [];

    for (const line of lines) {
        if (line.id) validOdooLineIds.push(line.id);

        const productId = getId(line.product_id);
        let productName = Array.isArray(line.product_id) ? line.product_id[1] : (line.name || null);

        // Prepend [REWARD] if server says it's a reward but name doesn't have it
        if (line.is_reward_line && productName && !productName.includes('[REWARD]')) {
            productName = `[REWARD] ${productName}`;
        }

        // Try linking to an existing local line match by product (for newly synced orders)
        let matchedLineId = null;
        if (orderLocalId) {
            const localLine = await db.getFirstAsync<{ id: number }>(
                'SELECT id FROM sales_order_line WHERE order_local_id = ? AND product_id = ? AND is_reward_line = ? AND odoo_id IS NULL',
                orderLocalId, productId, (line.is_reward_line ? 1 : 0)
            );
            if (localLine) matchedLineId = localLine.id;
        }

        if (matchedLineId) {
            // Update the local draft line with server info and quantities.
            // CRITICAL: Ensure no OTHER line already has this odoo_id (which would cause UNIQUE constraint fail).
            if (line.id) {
                await db.runAsync('DELETE FROM sales_order_line WHERE odoo_id = ? AND id != ?', line.id, matchedLineId);
            }

            // Now safe to update
            await db.runAsync(
                `UPDATE sales_order_line SET 
                    odoo_id = ?, 
                    order_odoo_id = ?, 
                    qty_delivered = ?, 
                    qty_invoiced = ?, 
                    price_unit = ?, 
                    price_subtotal = ?, 
                    product_uom_name = ?,
                    product_uom_id = ?,
                    order_local_id = ?,
                    is_reward_line = ?,
                    location_id = ?,
                    location_name = ?,
                    is_synced = 1 
                WHERE id = ?`,
                line.id, order.id, line.qty_delivered || 0, line.qty_invoiced || 0, line.price_unit || 0, line.price_subtotal || 0, line.product_uom_name || 'Unit', getId(line.product_uom), orderLocalId, line.is_reward_line ? 1 : 0, line.location_id || null, line.location_name || null, matchedLineId
            );
        } else {
            // Standard upsert by odoo_id
            await db.runAsync(
                `INSERT OR REPLACE INTO sales_order_line (odoo_id, order_odoo_id, order_local_id, product_id, product_name, product_uom_qty,
                 qty_delivered, qty_invoiced, price_unit, price_subtotal, product_uom_name, product_uom_id, is_reward_line, location_id, location_name, is_synced)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                line.id ?? null,
                order.id ?? null,
                orderLocalId ?? null,
                productId ?? null,
                productName ?? null,
                line.product_uom_qty || 0,
                line.qty_delivered || 0,
                line.qty_invoiced || 0,
                line.price_unit || 0,
                line.price_subtotal || 0,
                line.product_uom_name || 'Unit',
                getId(line.product_uom) ?? null,
                line.is_reward_line ? 1 : 0,
                line.location_id || null,
                line.location_name || null
            );
        }
    }

    // Cleanup stale local lines that were deleted on the server
    if (orderLocalId || order.id) {
        let cleanupQuery = 'DELETE FROM sales_order_line WHERE odoo_id IS NOT NULL';
        const cleanupParams: any[] = [];

        if (orderLocalId) {
            cleanupQuery += ' AND order_local_id = ?';
            cleanupParams.push(orderLocalId);
        } else {
            cleanupQuery += ' AND order_odoo_id = ?';
            cleanupParams.push(order.id);
        }

        if (validOdooLineIds.length > 0) {
            const placeholders = validOdooLineIds.map(() => '?').join(',');
            cleanupQuery += ` AND odoo_id NOT IN (${placeholders})`;
            cleanupParams.push(...validOdooLineIds);
        }

        await db.runAsync(cleanupQuery, ...cleanupParams);

        // CLEAR LOCAL REWARD LINES: Only if server has its own rewards OR if the order is confirmed/sent (finalized)
        const serverHasRewards = lines.some(l => l.is_reward_line);
        if (orderLocalId && (serverHasRewards || !['draft', 'sent'].includes(order.state))) {
            await db.runAsync('DELETE FROM sales_order_line WHERE order_local_id = ? AND is_reward_line = 1 AND odoo_id IS NULL', orderLocalId);
        } else if (!orderLocalId && (serverHasRewards || !['draft', 'sent'].includes(order.state))) {
            await db.runAsync('DELETE FROM sales_order_line WHERE order_odoo_id = ? AND is_reward_line = 1 AND odoo_id IS NULL', order.id);
        }
    }
};

export const getCustomerOrders = async (partnerId: number) => {
    const db = await getDB();
    return await db.getAllAsync(
        'SELECT * FROM sales_order WHERE partner_id = ? ORDER BY odoo_id DESC, id DESC',
        partnerId
    );
};

export const getLastOrderForVisit = async (routeCustomerId: number) => {
    const db = await getDB();
    // Get the visit first (can be in_progress or just completed)
    // We want the order linked to the MOST RECENT visit for this customer
    // The visit might have just been marked 'completed' by endVisit, or is still 'in_progress' if called before.
    // Let's rely on the order's route_customer_id and today's date + draft state for now
    // OR: join with visit.

    // Better approach: Find order linked to this route_customer_id created today
    const today = new Date().toISOString().split('T')[0];
    return await db.getFirstAsync(
        `SELECT * FROM sales_order 
         WHERE route_customer_id = ? AND date >= ? 
         ORDER BY last_modified DESC LIMIT 1`,
        routeCustomerId, today
    );
};

export const getOrderForVisit = async (visitLocalId: string) => {
    const db = await getDB();
    return await db.getFirstAsync('SELECT * FROM sales_order WHERE visit_local_id = ? LIMIT 1', visitLocalId);
};

export const getOrderWithLines = async (identifier: string | number) => {
    const db = await getDB();
    let order: any;

    if (typeof identifier === 'string') {
        // by local_id
        order = await db.getFirstAsync(`
            SELECT so.*, COALESCE(rp.is_cash, 0) as master_is_cash
            FROM sales_order so
            LEFT JOIN res_partner rp ON so.partner_id = rp.odoo_id
            WHERE so.local_id = ?
        `, identifier);
    } else {
        // by odoo_id
        order = await db.getFirstAsync(`
            SELECT so.*, COALESCE(rp.is_cash, 0) as master_is_cash
            FROM sales_order so
            LEFT JOIN res_partner rp ON so.partner_id = rp.odoo_id
            WHERE so.odoo_id = ?
        `, identifier);
    }

    if (!order) return null;

    // Fetch lines from both potential sources (local draft lines and server-synced lines)
    const localLines = order.local_id ? await db.getAllAsync(`
        SELECT sol.*, 
               COALESCE((
                   SELECT CAST(json_extract(value, '$.quantity') AS REAL)
                   FROM json_each(pp.free_qtys)
                   WHERE CAST(json_extract(value, '$.location_id') AS INTEGER) = sol.location_id
                   LIMIT 1
               ), 0.0) as product_free_qty,
               pp.detailed_type as product_type
        FROM sales_order_line sol 
        LEFT JOIN product_product pp ON sol.product_id = pp.odoo_id 
        WHERE sol.order_local_id = ?
    `, order.local_id) : [];

    const serverLines = order.odoo_id ? await db.getAllAsync(`
        SELECT sol.*, 
               COALESCE((
                   SELECT CAST(json_extract(value, '$.quantity') AS REAL)
                   FROM json_each(pp.free_qtys)
                   WHERE CAST(json_extract(value, '$.location_id') AS INTEGER) = sol.location_id
                   LIMIT 1
               ), 0.0) as product_free_qty,
               pp.detailed_type as product_type
        FROM sales_order_line sol 
        LEFT JOIN product_product pp ON sol.product_id = pp.odoo_id 
        WHERE sol.order_odoo_id = ?
    `, order.odoo_id) : [];

    // Merge: Server lines are the source of truth if they exist. 
    // We deduplicate by 'id' (local PK) but we want to prevent hiding reward lines.
    const linesMap = new Map<number, any>();

    // Add all server lines first
    (serverLines as any[]).forEach(sl => {
        linesMap.set(sl.id, sl);
    });

    // Add local lines if they aren't already represented by an odoo_id
    (localLines as any[]).forEach(ll => {
        if (!ll.odoo_id) {
            linesMap.set(ll.id, ll);
        }
    });

    const lines = Array.from(linesMap.values()).map(line => ({
        ...line,
        product_uom_qty: parseFloat(line.product_uom_qty || '0'),
        price_unit: parseFloat(line.price_unit || '0'),
        price_subtotal: parseFloat(line.price_subtotal || '0')
    }));

    return {
        ...order,
        amount_untaxed: parseFloat(order.amount_untaxed || '0'),
        amount_tax: parseFloat(order.amount_tax || '0'),
        amount_total: parseFloat(order.amount_total || '0'),
        discount_total: parseFloat(order.discount_total || '0'),
        applied_promotions: JSON.parse(order.applied_promotions || '[]'),
        lines
    };
};

export const updateOrderCashStatus = async (identifier: string | number, isCash: boolean) => {
    const db = await getDB();
    const cashVal = isCash ? 1 : 0;
    if (typeof identifier === 'string') {
        await db.runAsync('UPDATE sales_order SET is_cash = ? WHERE local_id = ?', cashVal, identifier);
    } else {
        await db.runAsync('UPDATE sales_order SET is_cash = ? WHERE odoo_id = ?', cashVal, identifier);
    }
};

export const updateLocalOrderState = async (
    identifier: string | number,
    newState?: string,
    deliveryStatus?: string,
    isReturnable?: number
) => {
    const db = await getDB();
    const sets: string[] = [];
    const values: any[] = [];

    if (newState) {
        sets.push('state = ?');
        values.push(newState);
    }
    if (deliveryStatus) {
        sets.push('delivery_status = ?');
        values.push(deliveryStatus);
    }
    if (isReturnable !== undefined) {
        sets.push('is_returnable = ?');
        values.push(isReturnable);
    }
    if (sets.length === 0) return;

    // Fix: If identifier is a numeric string and not a UUID/Named ID, treat as odoo_id
    const isNumericString = typeof identifier === 'string' && /^\d+$/.test(identifier);
    const whereCol = (typeof identifier === 'number' || isNumericString) ? 'odoo_id' : 'local_id';

    values.push(isNumericString ? parseInt(identifier) : identifier);
    await db.runAsync(`UPDATE sales_order SET ${sets.join(', ')} WHERE ${whereCol} = ?`, ...values);
};

export const updateLocalOrderInvoiceStatus = async (
    identifier: string | number,
    status: string
) => {
    const db = await getDB();
    if (typeof identifier === 'string') {
        await db.runAsync(
            'UPDATE sales_order SET invoice_status = ? WHERE local_id = ?',
            status, identifier
        );
    } else {
        await db.runAsync(
            'UPDATE sales_order SET invoice_status = ? WHERE odoo_id = ?',
            status, identifier
        );
    }
};

export const updateLocalOrderDiscount = async (localId: string | number, discount: number) => {
    const db = await getDB();
    const idStr = localId.toString();

    // 1. Get current Sales Representative's discount product
    const rep = await db.getFirstAsync<any>('SELECT discount_product_id FROM sales_representative LIMIT 1');
    const discountProductId = rep?.discount_product_id;

    if (discountProductId) {
        // 2. Resolve order IDs
        const order = await db.getFirstAsync<any>(
            'SELECT odoo_id, local_id FROM sales_order WHERE local_id = ? OR odoo_id = ?',
            idStr, localId
        );

        if (order) {
            const orderOdooId = order.odoo_id;
            const orderLocalId = order.local_id;

            // 3. Find existing discount line
            let existingLine = await db.getFirstAsync<any>(
                'SELECT id FROM sales_order_line WHERE (order_local_id = ? OR order_odoo_id = ?) AND product_id = ?',
                orderLocalId, orderOdooId, discountProductId
            );

            if (discount > 0) {
                // Upsert line
                if (existingLine) {
                    await db.runAsync(
                        'UPDATE sales_order_line SET product_uom_qty = 1, price_unit = ?, price_subtotal = ?, is_synced = 0 WHERE id = ?',
                        -discount, -discount, existingLine.id
                    );
                } else {
                    const product = await db.getFirstAsync<any>('SELECT name, uom_id, uom_name FROM product_product WHERE odoo_id = ?', discountProductId);
                    await db.runAsync(
                        `INSERT INTO sales_order_line (
                            order_local_id, order_odoo_id, product_id, product_name, product_uom_qty, 
                            price_unit, price_subtotal, product_uom_id, product_uom_name, is_synced
                        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, 0)`,
                        orderLocalId, orderOdooId, discountProductId,
                        product?.name || 'Discount', -discount, -discount,
                        product?.uom_id || null, product?.uom_name || null
                    );
                }
            } else if (existingLine) {
                // Delete line if discount is 0
                await db.runAsync('DELETE FROM sales_order_line WHERE id = ?', existingLine.id);
            }
        }
    }

    // 4. Update header discount field
    await db.runAsync(
        'UPDATE sales_order SET discount_total = ?, is_synced = 0, last_modified = ? WHERE local_id = ? OR odoo_id = ?',
        discount,
        new Date().toISOString(),
        idStr,
        localId
    );
};

export const updateLocalOrderPaymentState = async (
    identifier: string | number,
    paymentState: string,
    amountPaid?: number
) => {
    const db = await getDB();
    const column = typeof identifier === 'string' ? 'local_id' : 'odoo_id';

    if (amountPaid !== undefined) {
        // Fetch current total and residual to check if it becomes zero
        const order: any = await db.getFirstAsync(
            `SELECT amount_total, amount_residual FROM sales_order WHERE ${column} = ?`,
            identifier
        );

        const currentTotal = order?.amount_total || 0;
        const currentResidual = order?.amount_residual ?? currentTotal;
        const newResidual = Math.max(0, currentResidual - amountPaid);

        // If residual is 0 (or balanced out by refund), set state to 'paid' 
        // We use a small epsilon for float comparison
        const finalState = newResidual <= 0.01 ? 'paid' : paymentState;

        await db.runAsync(
            `UPDATE sales_order 
             SET payment_state = ?,
                 amount_residual = ?
             WHERE ${column} = ?`,
            finalState, newResidual, identifier
        );
    } else {
        await db.runAsync(
            `UPDATE sales_order SET payment_state = ? WHERE ${column} = ?`,
            paymentState, identifier
        );
    }
};

/**
 * Optimistically updates the order header status after a return is processed locally.
 * If all items are returned, sets delivery_status to 'returned'.
 */
export const updateLocalOrderAfterReturn = async (
    orderId: number,
    isFullyReturned: boolean
) => {
    const db = await getDB();
    const deliveryStatus = isFullyReturned ? 'returned' : 'started';
    const isReturnable = isFullyReturned ? 0 : 1;

    await db.runAsync(
        'UPDATE sales_order SET delivery_status = ?, is_returnable = ?, is_synced = 0, last_modified = ? WHERE odoo_id = ?',
        deliveryStatus, isReturnable, new Date().toISOString(), orderId
    );
};


// --- Optimistic Line Updates ---

/**
 * Recalculates order header totals (untaxed, tax, total, residual)
 * based on the current child lines in sales_order_line.
 */
export const rollupOrderTotals = async (orderLocalId: string) => {
    const db = await getDB();
    const orderRow: any = await db.getFirstAsync(
        'SELECT local_id, odoo_id, amount_untaxed, amount_tax FROM sales_order WHERE local_id = ?', orderLocalId
    );
    if (!orderRow) return;

    const targetOdooId = orderRow.odoo_id;

    // Find all lines associated with this order (by local_id OR odoo_id)
    const allLines: any[] = await db.getAllAsync(
        `SELECT price_unit, product_uom_qty, is_reward_line FROM sales_order_line
         WHERE order_local_id = ? OR (order_odoo_id = ? AND ? IS NOT NULL)`,
        orderLocalId, targetOdooId, targetOdooId
    );

    const newSubtotal = allLines.reduce(
        (s: number, l: any) => s + ((l.price_unit || 0) * (l.product_uom_qty || 0)), 0
    );

    // Preserve tax ratio from existing order (tax % = amount_tax / amount_untaxed)
    const oldSubtotal: number = orderRow.amount_untaxed || 0;
    const oldTax: number = orderRow.amount_tax || 0;
    const taxRatio = oldSubtotal > 0 ? oldTax / oldSubtotal : 0;
    const newTax = newSubtotal * taxRatio;
    const newTotal = newSubtotal + newTax;

    await db.runAsync(
        `UPDATE sales_order
         SET amount_untaxed = ?, amount_tax = ?, amount_total = ?, amount_residual = ?,
             is_synced = 0, last_modified = ?
         WHERE local_id = ?`,
        newSubtotal, newTax, newTotal, newTotal, new Date().toISOString(), orderLocalId
    );
};

export const updateLocalOrderLine = async (
    lineId: number,
    updates: {
        quantity?: number;
        qty_delivered?: number;
        qty_invoiced?: number;
        product_uom_id?: number;
        product_uom_name?: string;
        price_unit?: number;
    }
) => {
    const db = await getDB();

    const sets: string[] = [];
    const values: any[] = [];

    if (updates.quantity !== undefined) {
        sets.push('product_uom_qty = ?');
        values.push(updates.quantity);
    }
    if (updates.qty_delivered !== undefined) {
        sets.push('qty_delivered = ?');
        values.push(updates.qty_delivered);
    }
    if (updates.qty_invoiced !== undefined) {
        sets.push('qty_invoiced = ?');
        values.push(updates.qty_invoiced);
    }
    if (updates.product_uom_id !== undefined) {
        sets.push('product_uom_id = ?');
        values.push(updates.product_uom_id);
    }
    if (updates.product_uom_name !== undefined) {
        sets.push('product_uom_name = ?');
        values.push(updates.product_uom_name);
    }
    if (updates.price_unit !== undefined) {
        sets.push('price_unit = ?');
        values.push(updates.price_unit);
    }

    if (sets.length > 0) {
        // If qty or price changed, update subtotal
        if (updates.quantity !== undefined || updates.price_unit !== undefined) {
            sets.push('price_subtotal = product_uom_qty * price_unit');
        }

        values.push(lineId);
        await db.runAsync(`UPDATE sales_order_line SET ${sets.join(', ')} WHERE id = ?`, ...values);

        // Roll up if price/qty changed
        if (updates.quantity !== undefined || updates.price_unit !== undefined) {
            const line: any = await db.getFirstAsync(
                'SELECT order_local_id FROM sales_order_line WHERE id = ?', lineId
            );
            if (line?.order_local_id) {
                await rollupOrderTotals(line.order_local_id);
            }
        }
    }
};



export const addLocalOrderLine = async (
    orderIdentifier: string | number,
    item: { id: number; name: string; price: number; quantity: number; uom_id?: number; uom_name?: string; location_id?: number; location_name?: string },
    isReward: boolean = false
) => {
    const db = await getDB();
    let orderOdooId: number | null = null;
    let orderLocalId: string | null = null;

    if (typeof orderIdentifier === 'string') {
        orderLocalId = orderIdentifier;
        const o = await db.getFirstAsync<any>('SELECT odoo_id FROM sales_order WHERE local_id = ?', orderLocalId);
        orderOdooId = o?.odoo_id || null;
    } else {
        orderOdooId = orderIdentifier;
        const o = await db.getFirstAsync<any>('SELECT local_id FROM sales_order WHERE odoo_id = ?', orderOdooId);
        orderLocalId = o?.local_id || null;
    }

    // Check for existing line for this product on this order
    let existingLine = null;

    // Check locally first
    if (orderLocalId) {
        existingLine = await db.getFirstAsync<any>(
            'SELECT id, product_uom_qty FROM sales_order_line WHERE order_local_id = ? AND product_id = ? AND is_reward_line = ? AND (location_id = ? OR (location_id IS NULL AND ? IS NULL))',
            orderLocalId, item.id, isReward ? 1 : 0, item.location_id || null, item.location_id || null
        );
    }

    // Fallback to check by server ID if not found locally
    if (!existingLine && orderOdooId) {
        existingLine = await db.getFirstAsync<any>(
            'SELECT id, product_uom_qty FROM sales_order_line WHERE order_odoo_id = ? AND product_id = ? AND is_reward_line = ? AND (location_id = ? OR (location_id IS NULL AND ? IS NULL))',
            orderOdooId, item.id, isReward ? 1 : 0, item.location_id || null, item.location_id || null
        );
    }

    if (existingLine) {
        // Update existing line
        const newQty = item.quantity;
        await db.runAsync(
            'UPDATE sales_order_line SET product_uom_qty = ?, price_unit = ?, price_subtotal = ?, product_uom_id = ?, product_uom_name = ?, is_synced = 0 WHERE id = ?',
            newQty,
            item.price || 0,
            newQty * (item.price || 0),
            item.uom_id || null,
            item.uom_name || null,
            existingLine.id
        );
    } else {
        // Insert new line
        await db.runAsync(
            `INSERT INTO sales_order_line (order_local_id, order_odoo_id, product_id, product_name, product_uom_qty, price_unit, price_subtotal, product_uom_id, product_uom_name, location_id, location_name, is_synced, is_reward_line)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
            orderLocalId ?? null,
            orderOdooId ?? null,
            item.id ?? null,
            item.name ?? null,
            item.quantity ?? 0,
            item.price ?? 0,
            (item.quantity || 0) * (item.price || 0),
            item.uom_id || null,
            item.uom_name || null,
            item.location_id || null,
            item.location_name || null,
            isReward ? 1 : 0
        );
    }

    // Mark parent order as unsynced to ensure it gets updated on server
    await db.runAsync('UPDATE sales_order SET is_synced = 0 WHERE local_id = ?', orderLocalId);

    // Roll up: recalculate order header totals from all lines
    if (orderLocalId) {
        await rollupOrderTotals(orderLocalId);
    }
};


/**
 * Recalculates and applies all applicable promotions to an order.
 * This clears existing reward lines and adds new ones based on priority and shareability.
 */
export const applyOrderPromotions = async (orderIdentifier: string | number, manualPromotion?: any) => {
    const db = await getDB();
    const order = await getOrderWithLines(orderIdentifier);
    if (!order) return;

    const orderLocalId = order.local_id || `order_synced_${order.odoo_id}`;
    if (!orderLocalId) return;

    console.log(`[Promotion] Calculating promotions for order: ${order.name || orderLocalId}`);

    // 1. Clear existing reward lines
    await db.runAsync('DELETE FROM sales_order_line WHERE order_local_id = ? AND is_reward_line = 1', orderLocalId);

    // 2. Re-calculate current base amount (without reward lines) before applying rewards
    // This is critical for minimum amount rules and percentage discounts
    const currentLines: any[] = await db.getAllAsync(
        'SELECT product_id, product_uom_qty, price_subtotal FROM sales_order_line WHERE order_local_id = ? AND is_reward_line = 0',
        orderLocalId
    );
    const baseUntaxed = currentLines.reduce((sum, l) => sum + (l.price_subtotal || 0), 0);

    // Update order object for calculateOfflinePromotions to use the pure amount
    const pureOrder = { ...order, amount_untaxed: baseUntaxed };

    // 3. Get applicable promotions based on priority/shareability
    let applicablePromotions = await calculateOfflinePromotions(pureOrder, currentLines);

    // 4. Apply rewards from matching promotions
    for (const promo of applicablePromotions) {
        const rewards = promo.rewards || [];
        const earnedPoints = promo.earned_points || 0;

        for (const reward of rewards) {
            const requiredPoints = Number(reward.required_points) || 1;
            const reward_product_qty = Number(reward.reward_product_qty) || 1;
            const multiplier = Math.floor(earnedPoints / requiredPoints);

            console.log(`[Promotion] Applying reward: ${reward.reward_type}. Required Points: ${requiredPoints}, Earned: ${earnedPoints}, Multiplier: ${multiplier}, Base Qty: ${reward_product_qty}`);

            if (multiplier < 1) {
                console.log(`[Promotion] Multiplier < 1, skipping reward.`);
                continue;
            }

            if (reward.reward_type === 'product') {
                await addLocalOrderLine(orderLocalId, {
                    id: reward.reward_product_id || 0,
                    name: `[REWARD] ${reward.description || reward.reward_product_name || 'Gift'}`,
                    price: 0,
                    quantity: (reward.reward_product_qty || 1) * multiplier
                }, true); // isReward = true
            } else if (reward.reward_type === 'discount') {
                // Implement discount as a negative price line
                const discountAmount = reward.discountAmountOverride !== undefined
                    ? reward.discountAmountOverride
                    : baseUntaxed * ((reward.discount || 0) / 100);

                if (discountAmount > 0) {
                    await addLocalOrderLine(orderLocalId, {
                        id: 0, // Virtual product ID for discounts
                        name: `[DISCOUNT] ${reward.description || promo.name} (${reward.discount}%)`,
                        price: -discountAmount,
                        quantity: 1
                    }, true);
                }
            }
        }
    }

    // 5. Update the order with the list of applied promotion IDs
    const promoIds = applicablePromotions.map(p => p.odoo_id || p.id);
    await db.runAsync(
        'UPDATE sales_order SET applied_promotions = ?, is_synced = 0, last_modified = ? WHERE local_id = ?',
        JSON.stringify(promoIds),
        new Date().toISOString(),
        orderLocalId
    );

    // 6. Finalize totals (Roll up if rewards were added/removed)
    await rollupOrderTotals(orderLocalId);
};

export const applyLocalPromotion = applyOrderPromotions; // Backward compatibility alias

export const removeLocalOrderLine = async (lineId: number) => {
    const db = await getDB();

    // Fetch parent order reference before deleting
    const line: any = await db.getFirstAsync(
        'SELECT order_local_id, order_odoo_id FROM sales_order_line WHERE id = ?', lineId
    );

    // Delete the line
    await db.runAsync('DELETE FROM sales_order_line WHERE id = ?', lineId);

    if (line?.order_local_id) {
        await rollupOrderTotals(line.order_local_id);
    }
};




export const updateAllLinesInvoiced = async (identifier: string | number) => {
    const db = await getDB();
    if (typeof identifier === 'string') {
        // Update by order_local_id
        await db.runAsync(
            `UPDATE sales_order_line 
             SET qty_invoiced = product_uom_qty 
             WHERE order_local_id = ?`,
            identifier
        );
    } else {
        // Update by order_odoo_id
        await db.runAsync(
            `UPDATE sales_order_line 
             SET qty_invoiced = product_uom_qty 
             WHERE order_odoo_id = ?`,
            identifier
        );
    }
};

// ==========================================
// TOTAL UNSYNCED COUNT (for logout guard)
// ==========================================

export const getTotalUnsyncedCount = async (): Promise<number> => {
    const counts = await getUnsyncedCounts();
    return (
        counts.visits +
        counts.collections +
        counts.locations +
        counts.orders +
        counts.actions +
        counts.customers + // Use specific fields from getUnsyncedCounts
        counts.partners +
        counts.inventory_adjustments
    );
};

// ==========================================
// SYNC LOG (Audit Trail)
// ==========================================

export const insertSyncLog = async (log: {
    entity_type: string;
    direction: string;
    status: string;
    records_affected?: number;
    error_message?: string;
}) => {
    const db = await getDB();
    // Singleton log: Always use ID 1 to maintain only the latest sync record
    await db.runAsync(
        `INSERT OR REPLACE INTO sync_log (id, entity_type, direction, status, records_affected, error_message, started_at)
         VALUES (1, ?, ?, ?, ?, ?, datetime('now'))`,
        log.entity_type ?? null,
        log.direction ?? null,
        log.status ?? null,
        log.records_affected || 0,
        log.error_message ?? null
    );
    return 1;
};

export const updateSyncLog = async (id: number, status: string, errorMessage?: string) => {
    const db = await getDB();
    await db.runAsync(
        `UPDATE sync_log SET status = ?, error_message = ?, completed_at = datetime('now') WHERE id = ?`,
        status ?? null,
        errorMessage ?? null,
        id ?? null
    );
};

// ==========================================
// RETURN REASONS
// ==========================================

export const upsertReturnReason = async (reason: any) => {
    const db = await getDB();
    await db.runAsync(
        `INSERT OR REPLACE INTO return_reason (odoo_id, name, last_synced) VALUES (?, ?, datetime('now'))`,
        reason.id,
        reason.name
    );
};

export const cleanupReturnReasons = async (activeOdooIds: number[]) => {
    const db = await getDB();
    if (activeOdooIds.length === 0) {
        await db.runAsync('DELETE FROM return_reason');
    } else {
        const placeholders = activeOdooIds.map(() => '?').join(',');
        await db.runAsync(
            `DELETE FROM return_reason WHERE odoo_id NOT IN (${placeholders})`,
            ...activeOdooIds
        );
    }
};

export const getReturnReasons = async () => {
    const db = await getDB();
    const result = await db.getAllAsync(`SELECT * FROM return_reason ORDER BY name ASC`);
    return { data: { success: true, reasons: result.map((r: any) => ({ id: r.odoo_id, name: r.name })) } };
};

export const getRecentSyncLogs = async (limit = 50) => {
    const db = await getDB();
    return await db.getAllAsync('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT ?', limit);
};

export const upsertPaymentMethod = async (data: any) => {
    const db = await getDB();
    await db.runAsync(
        `INSERT INTO payment_method (odoo_id, name, journal_id, payment_type, last_synced)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(odoo_id) DO UPDATE SET
         name=excluded.name, journal_id=excluded.journal_id, payment_type=excluded.payment_type, last_synced=excluded.last_synced`,
        data.id,
        data.name,
        getId(data.journal_id) || null,
        data.type || data.payment_type || null,
        new Date().toISOString()
    );
};

export const getPaymentMethods = async () => {
    const db = await getDB();
    const result = await db.getAllAsync('SELECT * FROM payment_method');
    return result;
};

export const deleteUnassignedPaymentMethods = async (serverIds: number[]) => {
    const db = await getDB();
    if (serverIds.length === 0) {
        await db.runAsync('DELETE FROM payment_method');
    } else {
        const placeholders = serverIds.map(() => '?').join(',');
        await db.runAsync(`DELETE FROM payment_method WHERE odoo_id NOT IN (${placeholders})`, ...serverIds);
    }
};

export const getSalesRepresentativePaymentMethods = async (salesRepId: number) => {
    const db = await getDB();
    // Join payment_method with access table
    const result = await db.getAllAsync(
        `SELECT pm.* 
         FROM payment_method pm
         JOIN sales_rep_payment_method_access access ON pm.odoo_id = access.payment_method_odoo_id
         WHERE access.sales_rep_odoo_id = ?`,
        salesRepId
    );
    return result;
};

// --- Collections ---
export const insertLocalCollection = async (data: any) => {
    const db = await getDB();
    const localId = data.local_id || 'coll_' + Date.now();
    try {
        await db.runAsync(
            `INSERT INTO sales_rep_collection (
                local_id, visit_local_id, visit_id, partner_id, amount, currency_id, 
                payment_method, payment_method_id, collection_date, reference, state, is_synced, last_modified, order_id,
                journal_id, route_id, route_customer_id, local_route_customer_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
            localId, data.visit_local_id || null, data.visit_id || null, data.partner_id || null,
            data.amount || 0, data.currency_id || null, data.payment_method || null,
            data.payment_method_id || null,
            data.collection_date || new Date().toISOString(), data.reference || null,
            data.state || 'draft', new Date().toISOString(), data.order_id || null,
            data.journal_id || null, data.route_id || null, data.route_customer_id || null,
            data.local_route_customer_id || null
        );
        return localId;
    } catch (e) {
        console.error("Failed to insert local collection:", e);
        throw e;
    }
};

export const upsertCollectionFromServer = async (data: any) => {
    const db = await getDB();

    // 1. Resolve mobile_local_id linking and handle potential local_id conflicts
    if (data.mobile_local_id) {
        // Find if any record (synced or not) uses this local_id
        const existingByLocal: any = await db.getFirstAsync(
            'SELECT odoo_id FROM sales_rep_collection WHERE local_id = ?',
            data.mobile_local_id
        );

        if (existingByLocal) {
            if (!existingByLocal.odoo_id) {
                // record exists but is not linked to Odoo yet -> Link it
                console.log(`Sync: Linking local collection ${data.mobile_local_id} to Odoo ID ${data.id}`);
                // Clear any other record that might have this odoo_id already
                await db.runAsync('DELETE FROM sales_rep_collection WHERE odoo_id = ? AND local_id != ?', data.id, data.mobile_local_id);
                await db.runAsync('UPDATE sales_rep_collection SET odoo_id = ? WHERE local_id = ?', data.id, data.mobile_local_id);
            } else if (existingByLocal.odoo_id !== data.id) {
                // CONFLICT: different odoo_id is using this local_id
                console.warn(`Sync: local_id conflict for collection ${data.mobile_local_id}. Existing Odoo ID: ${existingByLocal.odoo_id}, incoming: ${data.id}. Removing old record.`);
                await db.runAsync('DELETE FROM sales_rep_collection WHERE local_id = ?', data.mobile_local_id);
            }
        }
    }

    // 2. Standard UPSERT by odoo_id
    await db.runAsync(
        `INSERT INTO sales_rep_collection (
            odoo_id, local_id, partner_id, route_id, route_customer_id, visit_id,
            amount, payment_method, collection_date, state, is_synced, last_modified,
            journal_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(odoo_id) DO UPDATE SET
            state=excluded.state, 
            amount=excluded.amount, 
            collection_date=excluded.collection_date,
            route_id=excluded.route_id,
            route_customer_id=excluded.route_customer_id,
            visit_id=excluded.visit_id,
            journal_id=excluded.journal_id,
            local_id=COALESCE(sales_rep_collection.local_id, excluded.local_id)`,
        data.id,
        data.mobile_local_id || null,
        getId(data.partner_id),
        getId(data.route_id),
        getId(data.route_customer_id),
        getId(data.visit_id),
        data.amount,
        data.payment_method,
        data.collection_date || new Date().toISOString(),
        data.state,
        new Date().toISOString(),
        getId(data.journal_id)
    );
};

export const getJournalPaymentStats = async (routeOdooId?: number | null) => {
    const db = await getDB();

    try {
        // 1. Fetch all payment journals and their Odoo balances
        const journals = await db.getAllAsync<any>('SELECT * FROM payment_journal');

        const todayStr = new Date().toISOString().split('T')[0];

        // 2. Fetch ALL unsynced collections (for total balance)
        const unsyncedAllQuery = `
            SELECT 
                COALESCE(j.odoo_id, j2.odoo_id) as res_journal_id,
                COALESCE(pm.name, pm2.name, c.payment_method) as method_name,
                SUM(c.amount) as total
            FROM sales_rep_collection c
            LEFT JOIN payment_method pm ON c.payment_method_id = pm.odoo_id
            LEFT JOIN payment_journal j ON pm.journal_id = j.odoo_id
            LEFT JOIN payment_method pm2 ON (pm.odoo_id IS NULL) AND LOWER(c.payment_method) = LOWER(pm2.name)
            LEFT JOIN payment_journal j2 ON pm2.journal_id = j2.odoo_id
            WHERE c.is_synced = 0 AND c.state != 'cancelled'
            GROUP BY res_journal_id, method_name
        `;
        const unsyncedAllResults = await db.getAllAsync<any>(unsyncedAllQuery);

        // 3. Fetch TODAY'S unsynced collections (for today's totals)
        const unsyncedTodayQuery = `
            SELECT 
                COALESCE(j.odoo_id, j2.odoo_id) as res_journal_id,
                COALESCE(pm.name, pm2.name, c.payment_method) as method_name,
                SUM(c.amount) as total
            FROM sales_rep_collection c
            LEFT JOIN payment_method pm ON c.payment_method_id = pm.odoo_id
            LEFT JOIN payment_journal j ON pm.journal_id = j.odoo_id
            LEFT JOIN payment_method pm2 ON (pm.odoo_id IS NULL) AND LOWER(c.payment_method) = LOWER(pm2.name)
            LEFT JOIN payment_journal j2 ON pm2.journal_id = j2.odoo_id
            WHERE c.is_synced = 0 AND c.state != 'cancelled' AND c.collection_date LIKE ?
            GROUP BY res_journal_id, method_name
        `;
        const unsyncedTodayResults = await db.getAllAsync<any>(unsyncedTodayQuery, [`${todayStr}%`]);

        // 4. Fetch TODAY'S synced collections (for today's totals)
        const syncedTodayQuery = `
            SELECT 
                COALESCE(j.odoo_id, j2.odoo_id) as res_journal_id,
                COALESCE(pm.name, pm2.name, c.payment_method) as method_name,
                SUM(c.amount) as total
            FROM sales_rep_collection c
            LEFT JOIN payment_method pm ON c.payment_method_id = pm.odoo_id
            LEFT JOIN payment_journal j ON pm.journal_id = j.odoo_id
            LEFT JOIN payment_method pm2 ON (pm.odoo_id IS NULL) AND LOWER(c.payment_method) = LOWER(pm2.name)
            LEFT JOIN payment_journal j2 ON pm2.journal_id = j2.odoo_id
            WHERE c.is_synced = 1 AND c.state != 'cancelled' AND c.collection_date LIKE ?
            GROUP BY res_journal_id, method_name
        `;
        const syncedTodayResults = await db.getAllAsync<any>(syncedTodayQuery, [`${todayStr}%`]);

        // 5. Combine into final results for UI
        return journals.map(journal => {
            const allUnsyncedTotal = unsyncedAllResults
                .filter(r => r.res_journal_id === journal.odoo_id)
                .reduce((sum, r) => sum + r.total, 0);

            const todayUnsyncedTotal = unsyncedTodayResults
                .filter(r => r.res_journal_id === journal.odoo_id)
                .reduce((sum, r) => sum + r.total, 0);

            const todaySyncedTotal = syncedTodayResults
                .filter(r => r.res_journal_id === journal.odoo_id)
                .reduce((sum, r) => sum + r.total, 0);

            // Methods breakdown for today
            const methodNames = Array.from(new Set([
                ...unsyncedTodayResults.filter(r => r.res_journal_id === journal.odoo_id).map(r => r.method_name),
                ...syncedTodayResults.filter(r => r.res_journal_id === journal.odoo_id).map(r => r.method_name)
            ]));

            const methods = methodNames.map(name => {
                const unsynced = unsyncedTodayResults.find(r => r.res_journal_id === journal.odoo_id && r.method_name === name)?.total || 0;
                const synced = syncedTodayResults.find(r => r.res_journal_id === journal.odoo_id && r.method_name === name)?.total || 0;
                return {
                    method_name: name,
                    total: unsynced + synced
                };
            }).filter(m => m.total > 0);



            return {
                journal_id: journal.odoo_id,
                journal_name: journal.name,
                // Total Balance = Server Reconciled Balance + All local unsynced money
                journal_balance: (journal.balance || 0) + allUnsyncedTotal,
                today_payments: todayUnsyncedTotal + todaySyncedTotal,
                methods: methods
            };
        });
    } catch (error) {
        console.error('Error getting journal payment stats:', error);
        return [];
    }
};

export const getJournalHistoricalPayments = async (journalOdooId: number) => {
    const db = await getDB();
    try {
        const query = `
            SELECT 
                c.amount,
                c.collection_date as date,
                c.reference,
                c.is_synced,
                c.state,
                COALESCE(pm.name, pm2.name, c.payment_method) as method_name
            FROM sales_rep_collection c
            LEFT JOIN payment_method pm ON c.payment_method_id = pm.odoo_id
            LEFT JOIN payment_journal j ON pm.journal_id = j.odoo_id
            LEFT JOIN payment_method pm2 ON (pm.odoo_id IS NULL) AND LOWER(c.payment_method) = LOWER(pm2.name)
            WHERE (c.journal_id = ? OR COALESCE(j.odoo_id, 0) = ?)
            AND c.state != 'cancelled'
            ORDER BY c.collection_date DESC
        `;
        return await db.getAllAsync<any>(query, [journalOdooId, journalOdooId]);
    } catch (error) {
        console.error('Error getting journal historical payments:', error);
        return [];
    }
};

export const deleteCollection = async (localId: string) => {
    const db = await getDB();
    await db.runAsync('DELETE FROM sales_rep_collection WHERE local_id = ?', localId);
};

export const deleteSalesOrder = async (localId: string) => {
    const db = await getDB();
    // Delete lines first
    await db.runAsync('DELETE FROM sales_order_line WHERE order_local_id = ?', localId);
    await db.runAsync('DELETE FROM sales_order WHERE local_id = ?', localId);
};

export const deleteVisit = async (localId: string) => {
    const db = await getDB();
    await db.runAsync('DELETE FROM sales_rep_visit WHERE local_id = ?', localId);
};

export const deletePendingAction = async (localId: string) => {
    const db = await getDB();
    await db.runAsync('DELETE FROM pending_action WHERE local_id = ?', localId);
};

// ==========================================
// RECENT ACTIVITY
// ==========================================

export const getRecentActivity = async (limit: number = 50) => {
    const db = await getDB();
    const query = `
        SELECT 
            'visit' as type,
            v.local_id as id,
            COALESCE(p.name, rc.name, 'Unknown Customer') as title,
            COALESCE(v.visit_result, v.state) as subtitle,
            COALESCE(v.last_modified, v.start_time) as timestamp,
            NULL as amount,
            v.state as status
        FROM sales_rep_visit v
        LEFT JOIN res_partner p ON v.partner_id = p.odoo_id
        LEFT JOIN sales_route_customer rc ON v.route_customer_id = rc.odoo_id
        WHERE v.state != 'cancelled'

        UNION ALL

        SELECT 
            'order' as type,
            o.local_id as id,
            COALESCE(p.name, 'Unknown Customer') as title,
            o.name as subtitle,
            COALESCE(o.last_modified, o.date) as timestamp,
            o.amount_total as amount,
            o.state as status
        FROM sales_order o
        LEFT JOIN res_partner p ON o.partner_id = p.odoo_id

        UNION ALL

        SELECT 
            'payment' as type,
            c.local_id as id,
            COALESCE(p.name, 'Unknown Customer') as title,
            c.payment_method as subtitle,
            COALESCE(c.last_modified, c.collection_date) as timestamp,
            c.amount as amount,
            c.state as status
        FROM sales_rep_collection c
        LEFT JOIN res_partner p ON c.partner_id = p.odoo_id

    ORDER BY timestamp DESC
        LIMIT ?
    `;
    return await db.getAllAsync<any>(query, limit);
};

export const getDashboardStats = async (routeId: number | null) => {
    const db = await getDB();
    if (!routeId) return { completedVisits: 0, totalVisits: 0, actualSales: 0, actualCollections: 0 };

    try {
        // 1. Visits Stats
        const visitResult: any = await db.getFirstAsync(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN state = 'visited' THEN 1 ELSE 0 END) as completed
            FROM sales_route_customer 
            WHERE route_id = ?
        `, routeId);

        // 2. Sales Stats (Total from all local sales orders for THIS SPECIFIC route instance/date)
        const routeDate = (await db.getFirstAsync<{ date: string }>('SELECT date FROM sales_rep_route WHERE odoo_id = ?', routeId))?.date;

        const salesResult: any = await db.getFirstAsync(`
            SELECT SUM(amount_total) as total
            FROM sales_order 
            WHERE state != 'cancel' AND route_id = ? AND date LIKE ?
        `, routeId, `${routeDate}%`);

        // 3. Collection Stats (Total from all local collections for THIS SPECIFIC route instance/date)
        const collectionsResult: any = await db.getFirstAsync(`
            SELECT SUM(amount) as total
            FROM sales_rep_collection
            WHERE state != 'cancelled' AND route_id = ? AND collection_date LIKE ?
        `, routeId, `${routeDate}%`);

        // console.log(`Table sales_rep_collection has ${rowCount?.count || 0} rows. Querying for route_id: ${routeId}`);
        // console.log('Collection stats:', collectionsResult);

        return {
            completedVisits: visitResult?.completed || 0,
            totalVisits: visitResult?.total || 0,
            actualSales: salesResult?.total || 0,
            actualCollections: collectionsResult?.total || 0
        };
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        return { completedVisits: 0, totalVisits: 0, actualSales: 0, actualCollections: 0 };
    }
};
export const getOrderLines = async (orderIdentifier: string | number) => {
    const db = await getDB();
    let query = `
        SELECT sol.*, u.factor as uom_factor, u.category_id as uom_category_id, p.detailed_type as product_type
        FROM sales_order_line sol
        LEFT JOIN uom_uom u ON sol.product_uom_id = u.odoo_id
        LEFT JOIN product_product p ON sol.product_id = p.odoo_id
        WHERE `;
    let param: any;

    if (typeof orderIdentifier === 'string') {
        query += 'sol.order_local_id = ?';
        param = orderIdentifier;
    } else {
        query += 'sol.order_odoo_id = ?';
        param = orderIdentifier;
    }

    return await db.getAllAsync<any>(query, param);
};

/**
 * Reconciles route_customer_id references across visits, orders, and collections.
 * When a temporary local route customer is replaced by a synchronized server record,
 * we use the stable local_route_customer_id (PK) to find the new server ID (odoo_id)
 * and update all dependent records.
 */
export const reconcileRouteCustomerReferences = async () => {
    const db = await getDB();
    console.log("Sync: Starting Route Customer reference reconciliation...");

    // 1. Reconcile visits
    await db.runAsync(`
        UPDATE sales_rep_visit
        SET route_customer_id = (
            SELECT odoo_id 
            FROM sales_route_customer 
            WHERE sales_route_customer.id = sales_rep_visit.local_route_customer_id
        )
        WHERE local_route_customer_id IS NOT NULL 
        AND route_customer_id IS NULL
    `);

    // 2. Reconcile orders
    await db.runAsync(`
        UPDATE sales_order
        SET route_customer_id = (
            SELECT odoo_id 
            FROM sales_route_customer 
            WHERE sales_route_customer.id = sales_order.local_route_customer_id
        )
        WHERE local_route_customer_id IS NOT NULL 
        AND route_customer_id IS NULL
    `);

    // 3. Reconcile collections
    await db.runAsync(`
        UPDATE sales_rep_collection
        SET route_customer_id = (
            SELECT odoo_id 
            FROM sales_route_customer 
            WHERE sales_route_customer.id = sales_rep_collection.local_route_customer_id
        )
        WHERE local_route_customer_id IS NOT NULL 
        AND route_customer_id IS NULL
    `);

    console.log("Sync: Reference reconciliation complete.");
};
export const upsertPricelistItem = async (data: any) => {
    const db = await getDB();
    console.log("Price List: ", data.pricelist_id)
    await db.runAsync(
        `INSERT INTO pricelist_item (
            odoo_id, pricelist_id, product_id, product_tmpl_id, categ_id, 
            min_quantity, date_start, date_end, compute_price, 
            fixed_price, percent_price, base_pricelist_id, last_synced
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(odoo_id) DO UPDATE SET
            pricelist_id=excluded.pricelist_id,
            product_id=excluded.product_id,
            product_tmpl_id=excluded.product_tmpl_id,
            categ_id=excluded.categ_id,
            min_quantity=excluded.min_quantity,
            date_start=excluded.date_start,
            date_end=excluded.date_end,
            compute_price=excluded.compute_price,
            fixed_price=excluded.fixed_price,
            percent_price=excluded.percent_price,
            base_pricelist_id=excluded.base_pricelist_id,
            last_synced=excluded.last_synced`,
        data.id,
        getId(data.pricelist_id),
        getId(data.product_id),
        getId(data.product_tmpl_id),
        getId(data.categ_id),
        data.min_quantity || 0,
        data.date_start || null,
        data.date_end || null,
        data.compute_price || 'fixed',
        data.fixed_price || 0,
        data.percent_price || 0,
        getId(data.base_pricelist_id) || null,
        new Date().toISOString()
    );
};

export const clearPricelistItems = async () => {
    const db = await getDB();
    await db.runAsync('DELETE FROM pricelist_item');
};


export const calculateProductPrice = async (productId: number, pricelistId: number, quantity: number = 1): Promise<number> => {
    const db = await getDB();

    // 1. Get the base product price
    const product: any = await db.getFirstAsync('SELECT list_price, categ_id, product_tmpl_id FROM product_product WHERE odoo_id = ?', productId);
    if (!product) return 0;

    let basePrice = product.list_price || 0;

    const today = new Date().toISOString().split('T')[0];
    console.log(`[Pricing] Calculating for product ${productId} (tmpl: ${product.product_tmpl_id}, categ: ${product.categ_id}) with pricelist ${pricelistId} on ${today}`);

    // 2. Find matching pricelist items
    // Order of priority in Odoo: 
    // - Product variant (product_id)
    // - Product template (product_tmpl_id)
    // - Category (categ_id)
    // - Global (none of the above)
    // Also must match min_quantity and date range

    // items query...
    const items: any[] = await db.getAllAsync(`
        SELECT * FROM pricelist_item 
        WHERE pricelist_id = ? 
        AND (min_quantity <= ?)
        AND (date_start IS NULL OR date_start <= ?)
        AND (date_end IS NULL OR date_end >= ?)
        AND (
            product_id = ? OR 
            (product_id IS NULL AND product_tmpl_id = ?) OR 
            (product_id IS NULL AND product_tmpl_id IS NULL AND categ_id = ?) OR
            (product_id IS NULL AND product_tmpl_id IS NULL AND categ_id IS NULL)
        )
        ORDER BY product_id DESC, product_tmpl_id DESC, categ_id DESC, min_quantity DESC
    `, pricelistId, quantity, today, today, productId, product.product_tmpl_id, product.categ_id);

    console.log(`[Pricing] Found ${items.length} matching items for product ${productId}`);

    if (items.length > 0) {
        const item = items[0];
        console.log(`[Pricing] Applying item ${item.odoo_id}: type=${item.compute_price}, fixed=${item.fixed_price}, percent=${item.percent_price}`);
        if (item.compute_price === 'fixed') {
            return item.fixed_price;
        } else if (item.compute_price === 'percentage') {
            return basePrice * (1 - (item.percent_price / 100));
        } else if (item.compute_price === 'formula') {
            // Formula support could be improved, but usually it's fixed or percentage for sales reps
            return basePrice;
        }
    }

    return basePrice;
};

// --- UoM REPOSITORY ---

export const upsertUomCategory = async (category: any) => {
    const db = await getDB();
    await db.runAsync(
        `INSERT INTO uom_category (odoo_id, name, last_synced)
         VALUES (?, ?, ?)
         ON CONFLICT(odoo_id) DO UPDATE SET
            name = excluded.name,
            last_synced = excluded.last_synced`,
        category.id, category.name, new Date().toISOString()
    );
};

export const upsertUom = async (uom: any) => {
    const db = await getDB();
    await db.runAsync(
        `INSERT INTO uom_uom (odoo_id, name, category_id, factor, uom_type, rounding, last_synced)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(odoo_id) DO UPDATE SET
            name = excluded.name,
            category_id = excluded.category_id,
            factor = excluded.factor,
            uom_type = excluded.uom_type,
            rounding = excluded.rounding,
            last_synced = excluded.last_synced`,
        uom.id,
        uom.name ?? 'Unknown',
        getId(uom.category_id || uom.uom_category_id) ?? 0,
        uom.factor || uom.ratio || 1,
        uom.uom_type || 'reference',
        uom.rounding || 0.01,
        new Date().toISOString()
    );
};

export const getUomsByCategory = async (categoryId: number) => {
    const db = await getDB();
    return await db.getAllAsync(
        'SELECT * FROM uom_uom WHERE category_id = ? ORDER BY factor ASC',
        categoryId
    );
};

export const getUomByOdooId = async (uomId: number) => {
    const db = await getDB();
    return await db.getFirstAsync<any>('SELECT * FROM uom_uom WHERE odoo_id = ?', uomId);
};

// --- Inventory Adjustments ---
export const createInventoryAdjustment = async (adjustment: any, lines: any[]) => {
    const db = await getDB();
    const localId = 'adj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5).toUpperCase();
    const date = new Date().toISOString();

    try {
        await db.runAsync(
            `INSERT INTO sales_rep_inventory_adjustment (local_id, date, sales_rep_id, location_id, is_synced, last_modified)
             VALUES (?, ?, ?, ?, 0, ?)`,
            localId, date, adjustment.sales_rep_id, adjustment.location_id, date
        );

        for (const line of lines) {
            await db.runAsync(
                `INSERT INTO sales_rep_inventory_adjustment_line (adjustment_local_id, product_id, product_uom_id, theoretical_qty, counted_qty, difference_qty, is_synced)
                 VALUES (?, ?, ?, ?, ?, ?, 0)`,
                localId, line.product_id, line.product_uom_id, line.theoretical_qty || 0, line.counted_qty, (line.counted_qty - (line.theoretical_qty || 0))
            );
        }

        return localId;
    } catch (e) {
        console.error("Failed to create local inventory adjustment:", e);
        throw e;
    }
};

export const getPendingInventoryAdjustments = async () => {
    const db = await getDB();
    const adjs = await db.getAllAsync('SELECT * FROM sales_rep_inventory_adjustment WHERE is_synced = 0');
    const adjsWithLines = await Promise.all(adjs.map(async (adj: any) => {
        const lines = await db.getAllAsync('SELECT * FROM sales_rep_inventory_adjustment_line WHERE adjustment_local_id = ?', adj.local_id);
        return { ...adj, lines };
    }));
    return adjsWithLines;
};

export const markInventoryAdjustmentSynced = async (localId: string, odooId: number) => {
    const db = await getDB();
    await db.runAsync(
        'UPDATE sales_rep_inventory_adjustment SET odoo_id = ?, is_synced = 1 WHERE local_id = ?',
        odooId, localId
    );
    await db.runAsync(
        'UPDATE sales_rep_inventory_adjustment_line SET is_synced = 1 WHERE adjustment_local_id = ?',
        localId
    );
};

// --- Stock Requests ---
export const getPendingStockRequests = async () => {
    const db = await getDB();
    const requests = await db.getAllAsync<any>('SELECT * FROM sales_rep_request WHERE is_synced = 0');
    for (const req of requests) {
        req.lines = await db.getAllAsync<any>('SELECT * FROM sales_rep_request_line WHERE request_local_id = ?', req.local_id);
    }
    return requests;
};


export const markStockRequestSynced = async (localId: string, odooId: number) => {
    const db = await getDB();
    // Update request
    await db.runAsync(
        'UPDATE sales_rep_request SET odoo_id = ?, is_synced = 1, state = \'submitted\' WHERE local_id = ?',
        odooId, localId
    );
    // Update lines
    await db.runAsync(
        'UPDATE sales_rep_request_line SET is_synced = 1 WHERE request_local_id = ?',
        localId
    );
};

// --- Credit Limit Helpers ---
export const getLocalUnsyncedOrdersTotal = async (partnerId: number): Promise<number> => {
    const db = await getDB();
    const result: any = await db.getFirstAsync(
        `SELECT COALESCE(SUM(amount_total), 0) as total 
         FROM sales_order 
         WHERE partner_id = ? AND is_synced = 0 AND state != 'cancel'`,
        partnerId
    );
    return result?.total || 0;
};

export const getLocalUnsyncedCreditExposure = async (partnerId: number) => {
    const db = await getDB();
    const result: any = await db.getFirstAsync(
        `SELECT 
            COALESCE(SUM(CASE WHEN state = 'draft' THEN amount_total ELSE 0 END), 0) as draft_total,
            COALESCE(SUM(CASE WHEN state IN ('sale', 'done') THEN amount_total ELSE 0 END), 0) as confirmed_total
         FROM sales_order 
         WHERE partner_id = ? AND is_synced = 0`,
        partnerId
    );
    return {
        draftTotal: result?.draft_total || 0,
        confirmedTotal: result?.confirmed_total || 0,
        total: (result?.draft_total || 0) + (result?.confirmed_total || 0)
    };
};

// --- Stock Picking / Delivery Helpers ---
export const upsertStockPicking = async (picking: any) => {
    const db = await getDB();
    await db.runAsync(
        `INSERT OR REPLACE INTO stock_picking (
            odoo_id, name, state, location_name, location_dest_name, date, origin, partner_id, partner_name, picking_type_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        picking.id ?? null,
        picking.name ?? null,
        picking.state ?? null,
        picking.location_name ?? null,
        picking.location_dest_name ?? null,
        picking.date ?? null,
        picking.origin ?? null,
        picking.partner_id ?? null,
        picking.partner_name ?? null,
        picking.picking_type_code ?? null
    );
};

export const upsertStockMove = async (move: any) => {
    const db = await getDB();
    await db.runAsync(
        `INSERT OR REPLACE INTO stock_move (
            odoo_id, picking_id, product_id, product_name, product_uom_qty, quantity, state, product_uom
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        move.id ?? null,
        move.picking_id ?? null,
        move.product_id ?? null,
        move.product_name ?? null,
        move.product_uom_qty ?? 0,
        move.quantity ?? 0,
        move.state ?? null,
        move.product_uom ?? null
    );
};

export const getStockPickings = async (stateFilter?: string, query?: string) => {
    const db = await getDB();
    let sql = 'SELECT * FROM stock_picking WHERE 1=1';
    const params: any[] = [];

    if (stateFilter && stateFilter !== 'all') {
        sql += ' AND state = ?';
        params.push(stateFilter);
    } else {
        sql += " AND state != 'draft'";
    }

    if (query) {
        sql += ' AND (name LIKE ? OR origin LIKE ? OR partner_name LIKE ?)';
        const likeQuery = `%${query}%`;
        params.push(likeQuery, likeQuery, likeQuery);
    }

    sql += ' ORDER BY date DESC';
    return await db.getAllAsync(sql, ...params);
};

export const getStockPickingMoves = async (pickingId: number) => {
    const db = await getDB();
    return await db.getAllAsync(
        "SELECT * FROM stock_move WHERE picking_id = ? AND state IN ('done', 'assigned', 'cancel')",
        pickingId
    );
};

export const clearProductStock = async () => {
    const db = await getDB();
    await db.runAsync('DELETE FROM product_stock');
};

export const upsertProductStock = async (stock: any) => {
    const db = await getDB();
    await db.runAsync(
        `INSERT OR REPLACE INTO product_stock (product_id, location_id, sales_rep_id, quantity)
         VALUES (?, ?, ?, ?)`,
        stock.product_id,
        stock.location_id,
        stock.sales_rep_id,
        stock.quantity
    );
};
