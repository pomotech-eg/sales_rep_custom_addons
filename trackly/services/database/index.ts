import * as SQLite from 'expo-sqlite';
import { CREATE_TABLES_SQL } from './schema';


const DB_NAME = 'trackly.db';
let dbInstance: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const initTables = async (db: SQLite.SQLiteDatabase) => {
    try {
        // Set basic performance and concurrency pragmas
        await db.execAsync('PRAGMA journal_mode = WAL;');
        await db.execAsync('PRAGMA busy_timeout = 5000;');

        // Execute schema creation
        for (const query of CREATE_TABLES_SQL) {
            await db.execAsync(query);
        }

        // Initialize Session Table if not already in schema (legacy support)
        await db.execAsync(`
            CREATE TABLE IF NOT EXISTS session (
                id INTEGER PRIMARY KEY NOT NULL,
                user_id INTEGER,
                email TEXT,
                access_token TEXT,
                token_expiration TEXT,
                server_url TEXT,
                partner_id INTEGER,
                company_name TEXT,
                raw_data TEXT
            );
            CREATE TABLE IF NOT EXISTS loyalty_program (
                odoo_id INTEGER PRIMARY KEY NOT NULL,
                name TEXT,
                program_type TEXT,
                json_data TEXT,
                is_synced INTEGER DEFAULT 1,
                last_modified TEXT
            );
        `);

        // --- MIGRATIONS ---
        const columnsToAdd = [
            'ALTER TABLE sales_representative ADD COLUMN invoice_journal_id INTEGER;',
            'ALTER TABLE sales_order ADD COLUMN amount_residual REAL;',
            'ALTER TABLE payment_method ADD COLUMN journal_id INTEGER;',
            'ALTER TABLE sales_representative ADD COLUMN default_location_id INTEGER;',
            'ALTER TABLE sales_representative ADD COLUMN return_location_id INTEGER;',
            'ALTER TABLE sales_representative ADD COLUMN auto_delivery INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN auto_receive INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN product_category_ids TEXT;',
            'ALTER TABLE sales_representative ADD COLUMN payment_method_ids TEXT;',
            // Migration for traccar_device
            'ALTER TABLE traccar_device ADD COLUMN interval INTEGER;',
            'ALTER TABLE traccar_device ADD COLUMN distance INTEGER;',
            'ALTER TABLE traccar_device ADD COLUMN traccar_url TEXT;',
            // Migration for location
            'ALTER TABLE location ADD COLUMN speed REAL;',
            'ALTER TABLE location ADD COLUMN course REAL;',
            'ALTER TABLE location ADD COLUMN accuracy REAL;',
            'ALTER TABLE location ADD COLUMN battery REAL;',
            'ALTER TABLE location ADD COLUMN timestamp INTEGER;',
            'ALTER TABLE location ADD COLUMN created_at TEXT;',
            // Migration for sales_route_customer
            'ALTER TABLE sales_route_customer ADD COLUMN radius REAL;',
            'ALTER TABLE sales_route_customer ADD COLUMN enable_location INTEGER;',
            'ALTER TABLE sales_route_customer ADD COLUMN visit_type_name TEXT;',
            // Migration for res_partner
            'ALTER TABLE res_partner ADD COLUMN enable_location INTEGER;',
            'ALTER TABLE res_partner ADD COLUMN location_radius REAL;',
            // Migration for sales_rep_visit
            'ALTER TABLE sales_rep_visit ADD COLUMN visit_reason TEXT;',
            'ALTER TABLE sales_rep_visit ADD COLUMN follow_up_date TEXT;',
            // Migration for product_product
            'ALTER TABLE product_product ADD COLUMN product_tmpl_id INTEGER;',
            'ALTER TABLE product_product ADD COLUMN taxes_json TEXT;',
            'ALTER TABLE product_product ADD COLUMN detailed_type TEXT;',
            'ALTER TABLE product_product ADD COLUMN invoice_policy TEXT;',
            'ALTER TABLE product_product ADD COLUMN free_qty REAL DEFAULT 0;',
            'ALTER TABLE product_product ADD COLUMN uom_name TEXT;',
            'ALTER TABLE product_product ADD COLUMN display_name TEXT;',
            // Migration for sales_order
            'ALTER TABLE sales_order ADD COLUMN route_customer_id INTEGER;',
            'ALTER TABLE sales_order ADD COLUMN name TEXT;',
            'ALTER TABLE sales_order ADD COLUMN amount_untaxed REAL;',
            'ALTER TABLE sales_order ADD COLUMN amount_tax REAL;',
            'ALTER TABLE sales_order ADD COLUMN amount_total REAL;',
            'ALTER TABLE sales_order ADD COLUMN invoice_status TEXT;',
            'ALTER TABLE sales_order ADD COLUMN delivery_status TEXT;',
            'ALTER TABLE sales_order ADD COLUMN pricelist_id INTEGER;',
            'ALTER TABLE sales_order ADD COLUMN route_id INTEGER;',
            // Migration for sales_order_line
            'ALTER TABLE sales_order_line ADD COLUMN odoo_id INTEGER;',
            'ALTER TABLE sales_order_line ADD COLUMN location_id INTEGER;',
            'ALTER TABLE sales_order_line ADD COLUMN location_name TEXT;',
            'ALTER TABLE sales_order_line ADD COLUMN order_odoo_id INTEGER;',
            'ALTER TABLE sales_order_line ADD COLUMN product_name TEXT;',
            'ALTER TABLE sales_order_line ADD COLUMN product_uom_qty REAL;',
            'ALTER TABLE sales_order_line ADD COLUMN qty_delivered REAL DEFAULT 0;',
            'ALTER TABLE sales_order_line ADD COLUMN qty_invoiced REAL DEFAULT 0;',
            'ALTER TABLE sales_order_line ADD COLUMN price_subtotal REAL;',
            'ALTER TABLE sales_order_line ADD COLUMN product_uom_name TEXT;',
            // Fixes for missing columns
            'ALTER TABLE sales_order ADD COLUMN visit_local_id TEXT;',
            'ALTER TABLE sales_order ADD COLUMN invoice_ids TEXT;',       // JSON array of invoice IDs
            'ALTER TABLE sales_order ADD COLUMN picking_ids TEXT;',       // JSON array of picking IDs
            'ALTER TABLE sales_order ADD COLUMN payment_state TEXT;',     // 'not_paid', 'in_payment', 'paid'
            'ALTER TABLE sales_order ADD COLUMN is_returnable INTEGER DEFAULT 1;',
            'ALTER TABLE sales_order_line ADD COLUMN visit_local_id TEXT;',
            'ALTER TABLE sales_order_line ADD COLUMN order_local_id TEXT;',
            // Loyalty Points
            'ALTER TABLE res_partner ADD COLUMN loyalty_points REAL DEFAULT 0;',
            'ALTER TABLE res_partner ADD COLUMN mobile_local_id TEXT;',

            // --- UNIQUE INDEX MIGRATIONS (For ON CONFLICT support) ---
            'ALTER TABLE product_product ADD COLUMN categ_name TEXT;',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_order_odoo_id ON sales_order(odoo_id);',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_order_line_odoo_id ON sales_order_line(odoo_id);',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_res_partner_odoo_id ON res_partner(odoo_id);',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_loyalty_program_odoo_id ON loyalty_program(odoo_id);',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_journal_odoo_id ON payment_journal(odoo_id);',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_pricelist_odoo_id ON pricelist(odoo_id);',
            'ALTER TABLE sales_order ADD COLUMN payment_term_id INTEGER;',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_term_odoo_id ON payment_term(odoo_id);',
            'ALTER TABLE sales_rep_collection ADD COLUMN order_id INTEGER;',
            'ALTER TABLE payment_method ADD COLUMN payment_type TEXT;',
            'ALTER TABLE payment_journal ADD COLUMN balance REAL DEFAULT 0;',
            'ALTER TABLE sales_rep_collection ADD COLUMN visit_id INTEGER;',
            'ALTER TABLE sales_rep_collection ADD COLUMN route_id INTEGER;',
            'ALTER TABLE sales_rep_collection ADD COLUMN route_customer_id INTEGER;',
            'ALTER TABLE sales_rep_visit ADD COLUMN local_route_customer_id INTEGER;',
            'ALTER TABLE sales_rep_collection ADD COLUMN local_route_customer_id INTEGER;',
            'ALTER TABLE sales_order ADD COLUMN local_route_customer_id INTEGER;',
            'ALTER TABLE sales_rep_collection ADD COLUMN journal_id INTEGER;',
            // Pricelist Items
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
                compute_price TEXT,
                fixed_price REAL,
                percent_price REAL,
                base_pricelist_id INTEGER,
                last_synced TEXT,
                FOREIGN KEY(pricelist_id) REFERENCES pricelist(odoo_id)
            );`,
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_pricelist_item_odoo_id ON pricelist_item(odoo_id);',
            'DELETE FROM pricelist_item WHERE typeof(pricelist_id) = \'text\' OR product_id = 0 OR product_tmpl_id = 0 OR categ_id = 0;',
            // Migration for UoM Support
            'ALTER TABLE product_product ADD COLUMN uom_category_id INTEGER;',
            'ALTER TABLE sales_order_line ADD COLUMN product_uom_id INTEGER;',
            'ALTER TABLE sales_representative ADD COLUMN company_name TEXT;',
            // Access Rights Migrations
            'ALTER TABLE sales_representative ADD COLUMN access_cash_balance INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_storage INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_returns INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_confirm_quotation INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_discount INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_inventory_adjustment INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_sales_report INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_customer_debt_report INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_collection_report INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_journal_report INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_requests INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_delivery INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_payment INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_create_customer INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN location_request_id INTEGER;',
            'ALTER TABLE sales_representative ADD COLUMN default_location_name TEXT;',
            'ALTER TABLE sales_representative ADD COLUMN location_request_name TEXT;',
            'ALTER TABLE sales_representative ADD COLUMN access_cancel_quotation INTEGER DEFAULT 0;',
            'ALTER TABLE sales_rep_request ADD COLUMN location_name TEXT;',
            'ALTER TABLE sales_rep_request ADD COLUMN source_location_name TEXT;',
            'ALTER TABLE sales_rep_inventory_adjustment_line ADD COLUMN product_uom_id INTEGER;',
            // Migration for partner financial limits (credit limit enforcement)
            'ALTER TABLE res_partner ADD COLUMN sale_credit_limit REAL DEFAULT 0;',
            'ALTER TABLE res_partner ADD COLUMN allow_over_sale_credit INTEGER DEFAULT 0;',
            'ALTER TABLE res_partner ADD COLUMN sale_credit_used REAL DEFAULT 0;',
            'ALTER TABLE sales_order ADD COLUMN discount_total REAL DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_visit_order INTEGER DEFAULT 1;',
            'ALTER TABLE sales_representative ADD COLUMN access_visit_payment INTEGER DEFAULT 1;',
            'ALTER TABLE res_partner ADD COLUMN is_cash INTEGER DEFAULT 0;',
            'ALTER TABLE res_partner ADD COLUMN state_id INTEGER;',
            'ALTER TABLE res_partner ADD COLUMN area TEXT;',
            'ALTER TABLE res_partner ADD COLUMN category_id TEXT;',
            'ALTER TABLE sales_order ADD COLUMN is_cash INTEGER DEFAULT 0;',
            'ALTER TABLE pricelist ADD COLUMN sequence INTEGER DEFAULT 0;',
            'ALTER TABLE payment_term ADD COLUMN sequence INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN default_location_ids TEXT;',
            'ALTER TABLE sales_representative ADD COLUMN return_location_ids TEXT;',
            'ALTER TABLE sales_representative ADD COLUMN location_request_ids TEXT;',
            'ALTER TABLE sales_representative ADD COLUMN location_general_return_id INTEGER;',
            'ALTER TABLE sales_representative ADD COLUMN location_general_return_name TEXT;',
            'ALTER TABLE sales_representative ADD COLUMN location_general_return_ids TEXT;',
            'ALTER TABLE sales_representative ADD COLUMN access_general_return INTEGER DEFAULT 0;',
            `CREATE TABLE IF NOT EXISTS product_stock (
                product_id INTEGER,
                location_id INTEGER,
                sales_rep_id INTEGER,
                quantity REAL DEFAULT 0,
                PRIMARY KEY (product_id, location_id, sales_rep_id)
            );`,
            'ALTER TABLE product_product ADD COLUMN free_qtys TEXT;',
            `CREATE TABLE IF NOT EXISTS stock_picking (
                odoo_id INTEGER PRIMARY KEY,
                name TEXT,
                state TEXT,
                location_name TEXT,
                location_dest_name TEXT,
                date TEXT,
                origin TEXT,
                partner_id INTEGER,
                partner_name TEXT,
                picking_type_code TEXT
            );`,
            `CREATE TABLE IF NOT EXISTS stock_move (
                odoo_id INTEGER PRIMARY KEY,
                picking_id INTEGER,
                product_id INTEGER,
                product_name TEXT,
                product_uom_qty REAL,
                quantity REAL,
                state TEXT,
                product_uom TEXT
            );`,
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_picking_odoo_id ON stock_picking(odoo_id);',
            'CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_move_odoo_id ON stock_move(odoo_id);',
            'ALTER TABLE product_stock ADD COLUMN sales_rep_id INTEGER;',
            'ALTER TABLE sales_representative ADD COLUMN access_mock_location INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_force_logout_on_mock_location INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_developer_mode INTEGER DEFAULT 0;',
            'ALTER TABLE sales_representative ADD COLUMN access_force_logout_on_developer_mode INTEGER DEFAULT 0;',
        ];

        for (const query of columnsToAdd) {
            try {
                await db.execAsync(query);
            } catch (e: any) {
                // Ignore error if column/index already exists
                const msg = (e.message || '').toLowerCase();
                if (
                    msg.includes('duplicate column name') ||
                    msg.includes('already exists') ||
                    msg.includes('duplicate index name')
                ) {
                    continue;
                }
                console.warn('Migration warning:', e.message, query);
            }
        }

        console.log('Database tables initialized and migrated');
    } catch (error) {
        console.error('Error initializing tables:', error);
        throw error;
    }
};

const sanitizeParams = (params: any[]) => params.map(p => p === undefined ? null : p);

export const getDB = async (): Promise<SQLite.SQLiteDatabase> => {
    if (dbInstance) {
        return dbInstance;
    }

    if (!dbPromise) {
        dbPromise = (async () => {
            console.log('Opening database:', DB_NAME);
            const db = await SQLite.openDatabaseAsync(DB_NAME);
            await initTables(db);

            // Use a Proxy to wrap the database instance.
            // This intercepts all calls and ensures parameters are sanitized.
            const handler: ProxyHandler<SQLite.SQLiteDatabase> = {
                get(target: any, prop: string | symbol, receiver: any) {
                    const value = Reflect.get(target, prop, receiver);

                    // Only wrap the specific async methods that take parameters
                    if (typeof value === 'function' &&
                        (prop === 'runAsync' || prop === 'getAllAsync' || prop === 'getFirstAsync' || prop === 'prepareAsync')) {
                        return (...args: any[]) => {
                            // The first argument is the query, the rest are params
                            const query = args[0];
                            const params = args.slice(1);
                            return value.apply(target, [query, ...sanitizeParams(params)]);
                        };
                    }

                    // Bind other functions to the original instance
                    if (typeof value === 'function') {
                        return value.bind(target);
                    }

                    return value;
                }
            };

            dbInstance = new Proxy(db, handler);
            return dbInstance;
        })();
    }

    return dbPromise;
};

export const initDB = async () => {
    // Explicit initialization if needed
    await getDB();
};

// Generic query helper
export const executeQuery = async (query: string, params: any[] = []) => {
    const db = await getDB();
    // Sanitize params: convert undefined to null to prevent SQL bridge errors
    const sanitizedParams = params.map(p => p === undefined ? null : p);

    try {
        if (sanitizedParams.length > 0) {
            return await db.getAllAsync(query, ...sanitizedParams);
        } else {
            return await db.getAllAsync(query);
        }
    } catch (error) {
        console.error('Query execution failed:', query, error);
        throw error;
    }
};


// --- Session Management ---

export const setSession = async (user: any, token: string, expiration: string, serverUrl: string) => {
    const db = await getDB();
    try {
        await db.runAsync('DELETE FROM session'); // Clear old session
        await db.runAsync(
            'INSERT INTO session (user_id, email, access_token, token_expiration, server_url, company_name, raw_data) VALUES (?, ?, ?, ?, ?, ?, ?)',
            user.user_id,
            user.email,
            token,
            expiration,
            serverUrl,
            user.company,
            JSON.stringify(user)
        );
    } catch (error) {
        console.error('Error setting session:', error);
    }
};

export const updateSessionUser = async (user: any) => {
    const db = await getDB();
    try {
        await db.runAsync(
            'UPDATE session SET raw_data = ?',
            JSON.stringify(user)
        );
    } catch (error) {
        console.error('Error updating session user:', error);
    }
};

export const getSession = async () => {
    const db = await getDB();
    try {
        const result = await db.getFirstAsync('SELECT * FROM session');
        if (result) {
            return {
                ...result,
                raw_data: JSON.parse((result as any).raw_data)
            };
        }
    } catch (error) {
        console.error('Error getting session:', error);
        return null;
    }
};

export const clearSession = async (fullReset: boolean = false) => {
    const db = await getDB();
    try {
        if (!fullReset) {
            // Standard logout: Clear session and sensitive profile/sync data
            // but keep catalog (products) and other non-user caches if we wanted to.
            // However, to fix the "wrong rep" issue, we MUST clear the profile.
            const sessionTables = [
                'session',
                'sales_representative',
                'sales_rep_route',
                'sales_route_customer',
                'pending_action',
                'sync_log'
            ];
            for (const table of sessionTables) {
                await db.runAsync(`DELETE FROM ${table}`);
            }
            console.log("Logout: session and user-specific profile/route data cleared.");
            return;
        }

        // --- FULL RESET CASE ---
        // Clear all tables to force re-sync
        const tables = [
            'session',
            'sales_representative',
            'contract_service_user',
            'sales_rep_route',
            'sales_route_customer',
            'product_product',
            'sales_rep_visit',
            'visit_product_line',
            'sales_rep_collection',
            'sales_visit_image',
            'sales_order',
            'sales_order_line',
            'sales_rep_expense',
            'expense_attachment',
            'traccar_device',
            'location',
            'pending_action',
            'payment_journal',
            'pricelist',
            'payment_term',
            'res_partner',
            'loyalty_program',
            'sync_log',
            'payment_method',
            'sales_rep_payment_method_access',
            'stock_picking',
            'stock_move'
        ];

        for (const table of tables) {
            try {
                await db.runAsync(`DELETE FROM ${table}`);
            } catch (e) {
                // Table might not exist, ignore
            }
        }

        console.log("Database totally reset (all local data wiped).");
    } catch (error) {
        console.error('Error clearing session/database:', error);
    }
};

export const logDatabaseStats = async (label: string) => {
    const db = await getDB();
    const tables = [
        'session', 'sales_representative', 'contract_service_user', 'sales_rep_route',
        'sales_route_customer', 'product_product', 'sales_rep_visit', 'visit_product_line',
        'sales_rep_collection', 'sales_visit_image', 'sales_order', 'sales_order_line',
        'sales_rep_expense', 'expense_attachment', 'traccar_device', 'location',
        'pending_action', 'payment_journal', 'pricelist', 'payment_term', 'res_partner',
        'loyalty_program', 'sync_log', 'payment_method', 'sales_rep_payment_method_access',
        'stock_picking', 'stock_move'
    ];

    console.log(`--- SQLite Database Stats (${label}) ---`);
    for (const table of tables) {
        try {
            const result: any = await db.getFirstAsync(`SELECT COUNT(*) as count FROM ${table}`);
            if (result && result.count > 0) {
                console.log(`${table}: ${result.count} records`);
            }
        } catch (e) {
            // Ignore if table doesn't exist
        }
    }
    console.log('------------------------------------------');
};
