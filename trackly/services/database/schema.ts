export const CREATE_TABLES_SQL = [
    // 1. Sales Representative
    `CREATE TABLE IF NOT EXISTS sales_representative (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        name TEXT,
        email TEXT,
        image_url TEXT,
        user_id INTEGER,
        company_id INTEGER,
        is_supervisor INTEGER DEFAULT 0,
        is_manager INTEGER DEFAULT 0,
        supervisor_id INTEGER,
        invoice_journal_id INTEGER,
        default_location_id INTEGER,
        default_location_name TEXT,
        return_location_id INTEGER,
        location_general_return_id INTEGER,
        location_general_return_name TEXT,
        location_request_id INTEGER,
        location_request_name TEXT,
        default_location_ids TEXT, -- JSON array
        return_location_ids TEXT, -- JSON array
        location_general_return_ids TEXT, -- JSON array
        location_request_ids TEXT, -- JSON array
        auto_delivery INTEGER DEFAULT 0,
        auto_receive INTEGER DEFAULT 0,
        product_category_ids TEXT, -- JSON array
        payment_method_ids TEXT, -- JSON array
        company_name TEXT,
        access_cash_balance INTEGER DEFAULT 0,
        access_storage INTEGER DEFAULT 0,
        access_returns INTEGER DEFAULT 0,
        access_general_return INTEGER DEFAULT 0,
        access_confirm_quotation INTEGER DEFAULT 0,
        access_cancel_quotation INTEGER DEFAULT 0,
        access_delivery INTEGER DEFAULT 0,
        access_payment INTEGER DEFAULT 0,
        access_discount INTEGER DEFAULT 0,
        access_inventory_adjustment INTEGER DEFAULT 0,
        access_sales_report INTEGER DEFAULT 0,
        access_customer_debt_report INTEGER DEFAULT 0,
        access_collection_report INTEGER DEFAULT 0,
        access_journal_report INTEGER DEFAULT 0,
        access_requests INTEGER DEFAULT 0,
        access_visit_order INTEGER DEFAULT 1,
        access_visit_payment INTEGER DEFAULT 1,
        access_create_customer INTEGER DEFAULT 1,
        access_mock_location INTEGER DEFAULT 0,
        access_force_logout_on_mock_location INTEGER DEFAULT 0,
        access_developer_mode INTEGER DEFAULT 0,
        access_force_logout_on_developer_mode INTEGER DEFAULT 0,
        discount_product_id INTEGER,
        last_synced TEXT
    );`,

    // 2. Service User (Contract Management) -- for potential login/validation
    `CREATE TABLE IF NOT EXISTS contract_service_user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        email TEXT,
        name TEXT,
        contract_id INTEGER,
        active INTEGER DEFAULT 1,
        expiration_date TEXT,
        traccar_identifier TEXT,
        last_synced TEXT
    );`,

    // 3. Sales Rep Route
    `CREATE TABLE IF NOT EXISTS sales_rep_route (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        name TEXT,
        date TEXT,
        state TEXT, 
        sales_rep_id INTEGER,
        start_time TEXT,
        end_time TEXT,
        is_synced INTEGER DEFAULT 1,
        last_modified TEXT
    );`,

    // 4. Sales Route Customer (The stops on the route)
    `CREATE TABLE IF NOT EXISTS sales_route_customer (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        route_id INTEGER,
        partner_id INTEGER,
        name TEXT,
        address TEXT,
        phone TEXT,
        email TEXT,
        latitude REAL,
        longitude REAL,
        radius REAL,
        enable_location INTEGER,
        sequence INTEGER,
        state TEXT,
        visit_start_time TEXT,
        visit_end_time TEXT,
        visit_type_name TEXT,
        visit_notes TEXT,
        is_synced INTEGER DEFAULT 1,
        last_modified TEXT,
        FOREIGN KEY(route_id) REFERENCES sales_rep_route(odoo_id)
    );`,

    // 5. Products (For offline catalog/selection)
    `CREATE TABLE IF NOT EXISTS product_product (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        name TEXT,
        default_code TEXT,
        list_price REAL,
        uom_id INTEGER,
        uom_category_id INTEGER, -- Added for UoM selection
        categ_id INTEGER,
        product_tmpl_id INTEGER,
        taxes_json TEXT, -- JSON array of tax objects
        detailed_type TEXT,
        invoice_policy TEXT,
        image_url TEXT,
        active INTEGER DEFAULT 1,
        free_qtys TEXT DEFAULT '[]',
        uom_name TEXT,
        display_name TEXT,
        categ_name TEXT
    );`,

    // 6. Visits
    `CREATE TABLE IF NOT EXISTS sales_rep_visit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE, -- Can be null if created offline and not yet synced
        local_id TEXT UNIQUE, -- UUID for offline creation tracking
        route_id INTEGER,
        route_customer_id INTEGER,
        local_route_customer_id INTEGER, -- Link to local PK of sales_route_customer
        partner_id INTEGER,
        visit_date TEXT,
        state TEXT,
        latitude REAL,
        longitude REAL,
        visit_type TEXT,
        notes TEXT,
        visit_result TEXT,
        visit_reason TEXT,
        follow_up_date TEXT,
        start_time TEXT,
        end_time TEXT,
        is_synced INTEGER DEFAULT 0,
        last_modified TEXT,
        FOREIGN KEY(route_id) REFERENCES sales_rep_route(odoo_id),
        FOREIGN KEY(route_customer_id) REFERENCES sales_route_customer(odoo_id)
    );`,

    // 7. Visit Products (Lines for orders/discussions)
    `CREATE TABLE IF NOT EXISTS visit_product_line (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        visit_local_id TEXT,
        product_id INTEGER,
        quantity REAL,
        price_unit REAL,
        is_synced INTEGER DEFAULT 0,
        FOREIGN KEY(visit_local_id) REFERENCES sales_rep_visit(local_id),
        FOREIGN KEY(product_id) REFERENCES product_product(odoo_id)
    );`,

    // 8. Collections (Payments)
    `CREATE TABLE IF NOT EXISTS sales_rep_collection (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        local_id TEXT UNIQUE,
        visit_local_id TEXT,
        visit_id INTEGER,
        partner_id INTEGER,
        route_id INTEGER,
        route_customer_id INTEGER,
        local_route_customer_id INTEGER, -- Link to local PK of sales_route_customer
        amount REAL,
        currency_id INTEGER,
        payment_method TEXT,
        payment_method_id INTEGER,
        collection_date TEXT,
        reference TEXT,
        receipt_image_path TEXT,
        state TEXT DEFAULT 'draft',
        is_synced INTEGER DEFAULT 0,
        last_modified TEXT,
        journal_id INTEGER,
        FOREIGN KEY(visit_local_id) REFERENCES sales_rep_visit(local_id)
    );`,

    // 9. Visit Images
    `CREATE TABLE IF NOT EXISTS sales_visit_image (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT UNIQUE,
        visit_local_id TEXT,
        image_path TEXT,
        image_type TEXT,
        description TEXT,
        is_synced INTEGER DEFAULT 0,
        created_at TEXT,
        FOREIGN KEY(visit_local_id) REFERENCES sales_rep_visit(local_id)
    );`,

    // 10. Sales Orders
    `CREATE TABLE IF NOT EXISTS sales_order (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE, -- Nullable if created offline
        local_id TEXT UNIQUE, -- UUID for offline tracking
        partner_id INTEGER,
        route_customer_id INTEGER,
        local_route_customer_id INTEGER, -- Link to local PK of sales_route_customer
        name TEXT,              -- SO number from Odoo (e.g. S00042)
        date TEXT,
        state TEXT DEFAULT 'draft',
        amount_untaxed REAL,
        amount_tax REAL,
        amount_total REAL,
        invoice_status TEXT,    -- 'no', 'to invoice', 'invoiced'
        delivery_status TEXT,   -- 'pending', 'partial', 'full'
        amount_residual REAL,   -- Calculated outstanding amount
        pricelist_id INTEGER,
        route_id INTEGER,
        visit_local_id TEXT,    -- Link to local visit record
        invoice_ids TEXT,       -- JSON array of invoice IDs
        picking_ids TEXT,       -- JSON array of picking IDs
        payment_state TEXT,     -- 'not_paid', 'in_payment', 'paid'
        is_returnable INTEGER DEFAULT 1,
        is_synced INTEGER DEFAULT 0,
        applied_promotions TEXT DEFAULT '[]', -- JSON array of promotion IDs
        discount_total REAL DEFAULT 0,
        is_cash INTEGER DEFAULT 0,
        last_modified TEXT,
        FOREIGN KEY(partner_id) REFERENCES res_partner(odoo_id),
        FOREIGN KEY(visit_local_id) REFERENCES sales_rep_visit(local_id)
    );`,

    // 11. Sales Order Lines
    `CREATE TABLE IF NOT EXISTS sales_order_line (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        order_local_id TEXT,
        visit_local_id TEXT,
        order_odoo_id INTEGER,
        product_id INTEGER,
        product_name TEXT,
        product_uom_id INTEGER, -- Added for UoM selection
        product_uom_qty REAL,
        qty_delivered REAL DEFAULT 0,
        qty_invoiced REAL DEFAULT 0,
        price_unit REAL,
        price_subtotal REAL,
        product_uom_name TEXT,
        is_synced INTEGER DEFAULT 0,
        is_reward_line INTEGER DEFAULT 0,
        FOREIGN KEY(order_local_id) REFERENCES sales_order(local_id),
        FOREIGN KEY(product_id) REFERENCES product_product(odoo_id)
    );`,

    // 12. Expenses
    `CREATE TABLE IF NOT EXISTS sales_rep_expense (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        local_id TEXT UNIQUE,
        employee_id INTEGER,
        date TEXT,
        amount REAL,
        currency_id INTEGER,
        payment_method TEXT,
        expense_type TEXT,
        description TEXT,
        attachment_path TEXT,
        state TEXT DEFAULT 'draft',
        is_synced INTEGER DEFAULT 0,
        last_modified TEXT
    );`,

    // 13. Expense Attachments
    `CREATE TABLE IF NOT EXISTS expense_attachment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT UNIQUE,
        expense_local_id TEXT,
        file_path TEXT,
        file_name TEXT,
        is_synced INTEGER DEFAULT 0,
        created_at TEXT,
        FOREIGN KEY(expense_local_id) REFERENCES sales_rep_expense(local_id)
    );`,

    // 14. traccar device
    `CREATE TABLE IF NOT EXISTS traccar_device (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT UNIQUE,
        is_synced INTEGER DEFAULT 0,
        interval INTEGER,
        distance INTEGER,
        traccar_url TEXT,
        created_at TEXT
    );`,

    // 15. location
    `CREATE TABLE IF NOT EXISTS location (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER,
        latitude REAL,
        longitude REAL,
        speed REAL,
        course REAL,
        accuracy REAL,
        battery REAL,
        timestamp INTEGER,
        is_synced INTEGER DEFAULT 0,
        created_at TEXT,
        FOREIGN KEY(device_id) REFERENCES traccar_device(id)
    );`,

    // 16. Pending Actions Queue (offline action queue)
    `CREATE TABLE IF NOT EXISTS pending_action (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        local_id TEXT UNIQUE,
        action_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        related_id TEXT,
        status TEXT DEFAULT 'pending',
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        created_at TEXT,
        is_synced INTEGER DEFAULT 0
    );`,

    // 17. Payment Journals (synced from backend)
    `CREATE TABLE IF NOT EXISTS payment_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        name TEXT,
        type TEXT,
        balance REAL DEFAULT 0,
        last_synced TEXT
    );`,

    // 18. Pricelists (synced from backend)
    `CREATE TABLE IF NOT EXISTS pricelist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        name TEXT,
        sequence INTEGER DEFAULT 0,
        last_synced TEXT
    );`,

    // 19. Payment Terms (synced from backend)
    `CREATE TABLE IF NOT EXISTS payment_term (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        name TEXT,
        sequence INTEGER DEFAULT 0,
        last_synced TEXT
    );`,

    // 20. Customers / Partners (offline cache)
    `CREATE TABLE IF NOT EXISTS res_partner (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        local_id TEXT UNIQUE,
        name TEXT,
        phone TEXT,
        mobile TEXT,
        email TEXT,
        street TEXT,
        city TEXT,
        country_id INTEGER,
        vat TEXT,
        latitude REAL,
        longitude REAL,
        enable_location INTEGER,
        location_radius REAL,
        property_payment_term_id INTEGER,
        property_product_pricelist INTEGER,
        credit_limit REAL,
        total_due REAL,
        sale_credit_limit REAL DEFAULT 0,
        allow_over_sale_credit INTEGER DEFAULT 0,
        sale_credit_used REAL DEFAULT 0,
        loyalty_points REAL DEFAULT 0,
        mobile_local_id TEXT, -- Original local ID from Odoo
        is_cash INTEGER DEFAULT 0,
        state_id INTEGER,
        area TEXT,
        category_id TEXT, -- JSON array of category IDs
        is_synced INTEGER DEFAULT 0,
        last_modified TEXT
    );`,

    // 21. Sync Log
    `CREATE TABLE IF NOT EXISTS sync_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT,
        direction TEXT,
        status TEXT,
        records_affected INTEGER DEFAULT 0,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT
    );`,

    // 22. Payment Methods (synced from backend)
    `CREATE TABLE IF NOT EXISTS payment_method (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        name TEXT,
        journal_id INTEGER,
        payment_type TEXT,
        last_synced TEXT
    );`,

    // 23. Sales Rep Payment Method Access (Many2Many link)
    `CREATE TABLE IF NOT EXISTS sales_rep_payment_method_access (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sales_rep_odoo_id INTEGER,
        payment_method_odoo_id INTEGER,
        FOREIGN KEY(payment_method_odoo_id) REFERENCES payment_method(odoo_id),
        UNIQUE(sales_rep_odoo_id, payment_method_odoo_id)
    );`,

    // 24. Loyalty Programs (Promotions)
    `CREATE TABLE IF NOT EXISTS loyalty_program (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        name TEXT,
        program_type TEXT,
        priority INTEGER DEFAULT 0,
        can_be_shared INTEGER DEFAULT 1,
        json_data TEXT, -- Full program rules/rewards
        is_synced INTEGER DEFAULT 1,
        last_modified TEXT
    );`,

    // 25. Return Reasons
    `CREATE TABLE IF NOT EXISTS return_reason (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        name TEXT,
        last_synced TEXT
    );`,

    // 26. Pricelist Items (synced from backend)
    `CREATE TABLE IF NOT EXISTS pricelist_item (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        pricelist_id INTEGER,
        product_id INTEGER,
        product_tmpl_id INTEGER,
        categ_id INTEGER,
        min_quantity REAL DEFAULT 0,
        date_start TEXT,
        date_end TEXT,
        compute_price TEXT, -- 'fixed', 'percentage', 'formula'
        fixed_price REAL,
        percent_price REAL,
        base_pricelist_id INTEGER,
        last_synced TEXT,
        FOREIGN KEY(pricelist_id) REFERENCES pricelist(odoo_id)
    );`,

    // 27. UoM Categories
    `CREATE TABLE IF NOT EXISTS uom_category (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        name TEXT,
        last_synced TEXT
    );`,

    // 28. UoMs
    `CREATE TABLE IF NOT EXISTS uom_uom (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        name TEXT,
        category_id INTEGER,
        factor REAL,
        uom_type TEXT, -- 'bigger', 'reference', 'smaller'
        rounding REAL,
        last_synced TEXT,
        FOREIGN KEY(category_id) REFERENCES uom_category(odoo_id)
    );`,

    // 29. Sales Rep Inventory Adjustments
    `CREATE TABLE IF NOT EXISTS sales_rep_inventory_adjustment (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        local_id TEXT UNIQUE,
        name TEXT,
        date TEXT,
        sales_rep_id INTEGER,
        location_id INTEGER,
        is_synced INTEGER DEFAULT 0,
        last_modified TEXT
    );`,

    // 30. Sales Rep Inventory Adjustment Lines
    `CREATE TABLE IF NOT EXISTS sales_rep_inventory_adjustment_line (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        adjustment_local_id TEXT,
        product_id INTEGER,
        product_uom_id INTEGER,
        theoretical_qty REAL,
        counted_qty REAL,
        difference_qty REAL,
        is_synced INTEGER DEFAULT 0,
        FOREIGN KEY(adjustment_local_id) REFERENCES sales_rep_inventory_adjustment(local_id),
        FOREIGN KEY(product_id) REFERENCES product_product(odoo_id)
    );`,

    // 31. Sales Rep Requests
    `CREATE TABLE IF NOT EXISTS sales_rep_request (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        local_id TEXT UNIQUE,
        name TEXT,
        date TEXT,
        sales_rep_id INTEGER,
        location_id INTEGER,
        source_location_id INTEGER,
        location_name TEXT,
        source_location_name TEXT,
        state TEXT DEFAULT 'draft',
        is_synced INTEGER DEFAULT 0,
        last_modified TEXT
    );`,

    // 32. Sales Rep Request Lines
    `CREATE TABLE IF NOT EXISTS sales_rep_request_line (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        odoo_id INTEGER UNIQUE,
        request_local_id TEXT,
        product_id INTEGER,
        qty REAL,
        uom_id INTEGER,
        is_synced INTEGER DEFAULT 0,
        FOREIGN KEY(request_local_id) REFERENCES sales_rep_request(local_id),
        FOREIGN KEY(product_id) REFERENCES product_product(odoo_id)
    );`,

    // 33. Product Stock levels per location (for multi-location storage syncing)
    `CREATE TABLE IF NOT EXISTS product_stock (
        product_id INTEGER,
        location_id INTEGER,
        sales_rep_id INTEGER,
        quantity REAL DEFAULT 0,
        PRIMARY KEY (product_id, location_id, sales_rep_id)
    );`,
];
