import { create } from 'zustand';
import NetInfo from '@react-native-community/netinfo';
import { getSession, initDB, getDB } from '@/services/database';
import dayjs from 'dayjs';
import {
    getRoutes, upsertRoute, upsertRouteCustomer, upsertProduct, upsertSalesRepresentative, getRouteCustomers,
    getPendingVisits, getPendingCollections, markVisitSynced, markCollectionSynced, getSalesRepresentative,
    upsertTraccarDevice, getPendingLocations, markLocationSynced, updateCustomerStatus, insertVisit,
    getPendingSalesOrders, markOrderSynced,
    getPendingActions, markActionCompleted, markActionFailed, resetFailedActions, insertPendingAction,
    upsertSalesOrderFromServer, upsertPartner,
    upsertPaymentJournal, upsertPricelist, upsertPricelistItem, upsertPaymentTerm, upsertPaymentMethod,
    getUnsyncedCounts, upsertLoyaltyProgram, getInProgressVisits, getRecentActivity,
    getDashboardStats, getJournalPaymentStats, insertSyncLog, updateSyncLog,
    deleteRouteByOdooId, getRouteCustomersByRouteOdooId, deleteRouteCustomerByOdooId,
    normalizeSalesRepProfile,
    upsertCollectionFromServer, getUnsyncedPartners, markPartnerSynced,
    reconcileRouteCustomerReferences, markRouteCustomerSynced,
    deleteUnassignedPaymentJournals, deleteUnassignedPaymentMethods, deleteUnassignedPricelists, deleteUnassignedPaymentTerms,
    cleanupRoutes, cleanupRouteCustomers,
    upsertUomCategory, upsertUom,
    createInventoryAdjustment, getPendingInventoryAdjustments, markInventoryAdjustmentSynced,
    getPendingStockRequests, markStockRequestSynced, upsertStockRequest,
    upsertStockPicking, upsertStockMove,
    updateSessionUser,
    clearProductStock, upsertProductStock
} from '@/services/database/repositories';
import { syncData, sendSalesOrder } from '@/services/api';
import { orderService, accountService, paymentService, customerService, stockService } from '@/services/api/index';
import { SSEStatus } from '@/services/sseService';
import { TraccarService } from '@/services/traccar';
import { useAuthStore } from './useAuthStore';

// Module-level sync lock — prevents concurrent syncs even if Zustand state hasn't propagated yet
let _syncLock = false;

interface OfflineState {
    isOffline: boolean;
    lastSyncTime: string | null;
    pendingSyncItems: number;
    isSyncing: boolean;
    syncProgress: number;
    isInitialSyncComplete: boolean;
    unsyncedCounts: { 
        visits: number, 
        collections: number, 
        locations: number, 
        pending_updates: number, 
        orders: number, 
        actions: number, 
        customers: number, 
        partners: number, 
        inventory_adjustments: number,
        stockRequests: number 
    };
    sseStatus: SSEStatus;
    dashboardStats: { completedVisits: number, totalVisits: number, actualSales: number, actualCollections: number };
    journalPaymentStats: any[];
    journalHistoricalPayments: any[];
    stockRequests: any[];
    fetchStockRequests: () => Promise<void>;
    submitStockRequest: (lines: any[], sourceLocationId?: number, destinationLocationId?: number) => Promise<void>;

    // State
    routes: any[];
    currentRoute: any | null;
    currentRouteCustomers: any[];
    salesRepProfile: any | null;
    activeVisits: any[]; // Added activeVisits state
    recentActivity: any[]; // Added recentActivity state

    // Actions
    setOfflineMode: (isOffline: boolean) => void;
    syncRoutes: (routes: any[]) => Promise<void>;
    syncProducts: (products: any[]) => Promise<void>;
    fetchLocalRoutes: () => Promise<void>;
    fetchSalesRepProfile: () => Promise<void>;
    fetchActiveVisits: () => Promise<void>; // Added fetchActiveVisits action
    fetchRecentActivity: () => Promise<void>; // Added fetchRecentActivity action
    selectRoute: (route: any) => Promise<void>;
    initialize: () => Promise<void>;
    performSync: () => Promise<void>;
    startVisit: (customerId: number, latitude?: number, longitude?: number) => Promise<void>;
    endVisit: (customerId: number, visitData: any) => Promise<string | undefined>;
    cancelVisit: (customerId: number) => Promise<void>;
    submitInventoryAdjustment: (lines: any[]) => Promise<any>;

    fetchUnsyncedCounts: () => Promise<void>;
    fetchDashboardStats: () => Promise<void>; // Added fetchDashboardStats action
    fetchJournalPaymentStats: () => Promise<void>;
    fetchJournalHistoricalPayments: (journalOdooId: number) => Promise<void>;
    triggerSyncIfOnline: () => Promise<any>;
    syncPendingActionsLightweight: () => Promise<void>;
    setSseStatus: (status: SSEStatus) => void;
    checkConnection: () => Promise<void>;
    resetSyncState: () => void;
    recordPendingAction: (action: { action_type: string, payload: any, related_id?: string }, optimistic_update_fn?: () => Promise<void>) => Promise<any>;
    isMockLocationActive: boolean;
    isDevModeActive: boolean;
    pendingForceLogout: 'mock' | 'dev' | null;
    setSecurityStatus: (status: { isMockLocationActive?: boolean; isDevModeActive?: boolean; pendingForceLogout?: 'mock' | 'dev' | null }) => void;
}

export const useOfflineStore = create<OfflineState>((set, get) => ({
    isOffline: false,
    lastSyncTime: null,
    pendingSyncItems: 0,
    isSyncing: false,
    syncProgress: 0,
    isInitialSyncComplete: false,
    unsyncedCounts: { visits: 0, collections: 0, locations: 0, pending_updates: 0, orders: 0, actions: 0, customers: 0, partners: 0, inventory_adjustments: 0, stockRequests: 0 },
    routes: [],
    currentRoute: null,
    currentRouteCustomers: [],
    salesRepProfile: null,
    activeVisits: [], // Initial state for activeVisits
    recentActivity: [], // Initial state for recentActivity
    sseStatus: 'disconnected',
    dashboardStats: { completedVisits: 0, totalVisits: 0, actualSales: 0, actualCollections: 0 },
    journalPaymentStats: [],
    journalHistoricalPayments: [],
    stockRequests: [],
    isMockLocationActive: false,
    isDevModeActive: false,
    pendingForceLogout: null,

    setSecurityStatus: (status) => set(status),

    resetSyncState: () => set({
        isInitialSyncComplete: false,
        syncProgress: 0,
        routes: [],
        currentRoute: null,
        currentRouteCustomers: [],
        salesRepProfile: null,
        lastSyncTime: null,
        isMockLocationActive: false,
        isDevModeActive: false,
        pendingForceLogout: null
    }),

    setOfflineMode: (isOffline) => set({ isOffline }),

    initialize: async () => {
        await initDB();
        await get().fetchLocalRoutes();
        await get().fetchSalesRepProfile();
        await get().fetchUnsyncedCounts();
        await get().fetchActiveVisits();
        await get().fetchRecentActivity();
        await get().fetchDashboardStats(); // Fetch stats on initialize

        // Setup reactive connection listener
        NetInfo.addEventListener(state => {
            const isConnected = state.isConnected && (state.isInternetReachable ?? true);
            const wasOffline = get().isOffline;
            set({ isOffline: !isConnected });

            // If we just came back online and have unsynced items, trigger sync
            if (wasOffline && isConnected) {
                const counts = get().unsyncedCounts;
                const totalPending = (counts.visits || 0) + (counts.collections || 0) + (counts.locations || 0) + (counts.pending_updates || 0) + (counts.orders || 0) + (counts.actions || 0) + (counts.inventory_adjustments || 0) + (counts.stockRequests || 0);
                if (totalPending > 0) {
                    console.log(`Auto-Sync: Connection restored, triggering sync for ${totalPending} items`);
                    get().performSync();
                }
            }
        });
    },

    recordPendingAction: async (action, optimistic_update_fn) => {
        try {
            const localId = await insertPendingAction(action);
            if (optimistic_update_fn) {
                await optimistic_update_fn();
            }
            const syncResult = await get().triggerSyncIfOnline();
            
            // If we synced, try to find the result for this specific action
            if (syncResult && syncResult.action_ack && syncResult.action_ack[localId]) {
                return syncResult.action_ack[localId];
            }
            return { success: true, localId }; // Default success if offline or not in this sync batch
        } catch (error) {
            console.error('Failed to record pending action:', error);
            throw error;
        }
    },

    triggerSyncIfOnline: async () => {
        const { isOffline, isSyncing, performSync, fetchUnsyncedCounts } = get();
        await fetchUnsyncedCounts();
        const counts = get().unsyncedCounts;
        const totalPending = (counts.visits || 0) + (counts.collections || 0) + (counts.locations || 0) + (counts.pending_updates || 0) + (counts.orders || 0) + (counts.actions || 0) + (counts.inventory_adjustments || 0) + (counts.stockRequests || 0);

        if (!isOffline && !isSyncing && totalPending > 0) {
            console.log(`Auto-Sync Trigger: Starting sync for ${totalPending} items...`);
            return await performSync();
        }
        return null;
    },

    syncPendingActionsLightweight: async () => {
        const { isOffline } = get();
        if (isOffline) return;

        try {
            await resetFailedActions();
            const pendingActions = await getPendingActions();
            const attachmentActions = pendingActions.filter((a: any) =>
                a.action_type === 'upload_attachment' || a.action_type === 'delete_attachment'
            );

            if (attachmentActions.length === 0) return;

            console.log(`Lightweight Sync: Uploading ${attachmentActions.length} attachment actions...`);

            const formattedActions = (attachmentActions as any[]).map((a: any) => ({
                local_id: a.local_id,
                action_type: a.action_type,
                payload: typeof a.payload === 'string' ? JSON.parse(a.payload) : a.payload,
            }));

            const payload = {
                last_sync_date: get().lastSyncTime,
                upload_data: {
                    visits: [],
                    collections: [],
                    locations: [],
                    orders: [],
                    inventory_adjustments: [],
                    stock_requests: [],
                    pending_actions: formattedActions,
                }
            };

            const response = await syncData(payload);
            const data = response.data;

            if (data.success && data.action_ack) {
                for (const action of attachmentActions as any[]) {
                    const ackEntry = data.action_ack[action.local_id];
                    if (ackEntry?.success) {
                        await markActionCompleted(action.local_id);
                        console.log(`Lightweight Sync: Action ${action.action_type} completed`);
                    } else if (ackEntry) {
                        await markActionFailed(action.local_id, ackEntry.error || 'Server returned failure');
                        console.warn(`Lightweight Sync: Action ${action.action_type} failed: ${ackEntry.error}`);
                    }
                }
            }
        } catch (error) {
            console.error('Failed lightweight sync of attachments:', error);
        }
    },

    syncRoutes: async (routes: any[]) => {
        try {
            for (const route of routes) {
                await upsertRoute(route);
            }
            console.log('Routes synced successfully');
        } catch (error) {
            console.error('Failed to sync routes:', error);
        }
    },

    syncProducts: async (products: any[]) => {
        try {
            for (const product of products) {
                await upsertProduct(product);
            }
            console.log('Products synced successfully');
        } catch (error) {
            console.error('Failed to sync products:', error);
        }
    },

    fetchLocalRoutes: async () => {
        const routes = await getRoutes();
        set({ routes });

        const { currentRoute, selectRoute } = get();
        const today = dayjs().format('YYYY-MM-DD');

        // 1. If we have a current route, just refresh its data from the new routes list
        if (currentRoute) {
            const refreshedRoute = routes.find((r: any) =>
                (r.odoo_id && r.odoo_id === currentRoute.odoo_id) ||
                (r.id && r.id === currentRoute.id)
            );

            if (refreshedRoute) {
                // Update the currentRoute object with any server-side changes (like name or date)
                set({ currentRoute: refreshedRoute });
                // We don't necessarily need to re-select (which pulls all customers again) 
                // unless we think the customer list significantly changed. 
                // But let's avoid the full selectRoute call to prevent recursion/loops.
                const { getRouteCustomers } = require('@/services/database/repositories');
                const customers = await getRouteCustomers(refreshedRoute.odoo_id);
                set({ currentRouteCustomers: customers });
                return;
            }
        }

        // 2. Otherwise default to today's route ONLY IF we don't have one selected
        if (!currentRoute) {
            const todaysRoute = routes.find((r: any) => r.date === today);
            if (todaysRoute) {
                console.log('Sync: Defaulting to today\'s route:', (todaysRoute as any).name);
                await selectRoute(todaysRoute);
            } else {
                await selectRoute(null);
            }
        }
    },

    selectRoute: async (route: any) => {
        set({ currentRoute: route });
        if (route) {
            const customers = await getRouteCustomers(route.odoo_id);
            set({ currentRouteCustomers: customers });
        } else {
            set({ currentRouteCustomers: [] });
        }
        await get().fetchDashboardStats(); // Refresh stats (will handle null route correctly)
    },

    performSync: async () => {
        if (_syncLock || get().isSyncing || get().isOffline) return;

        // Subscription check before sync
        const currentUser = useAuthStore.getState().user;
        if (currentUser && currentUser.subscription_valid === false) {
            console.error("Sync: Subscription expired. Forcing logout...");
            useAuthStore.getState().setSubscriptionError(true);
            await useAuthStore.getState().logout(true);
            return;
        }

        _syncLock = true;

        set({ isSyncing: true, syncProgress: 0 });
        // console.log("syncing data...")

        // Start Sync Log
        let syncLogId: number | null = null;
        try {
            syncLogId = await insertSyncLog({
                entity_type: 'all',
                direction: 'bidirectional',
                status: 'running'
            });
        } catch (e) {
            console.warn("Failed to create sync log:", e);
        }

        try {


            // ========================================
            // STEP 1: Gather & Upload visits/collections/locations/orders/actions (Batch)
            // ========================================
            const visits = await getPendingVisits();
            const collections = await getPendingCollections();
            const locations = await getPendingLocations();
            const pendingOrders = await getPendingSalesOrders();
            const inventoryAdjustments = await getPendingInventoryAdjustments();
            const stockRequests = await getPendingStockRequests();

            if (pendingOrders.length > 0) {
                console.log(`Sync: Found ${pendingOrders.length} unsynced orders to upload`);
                pendingOrders.forEach(o => console.log(`  - Local Order: ${o.local_id} (${o.name})`));
            }

            if (inventoryAdjustments.length > 0) {
                console.log(`Sync: Found ${inventoryAdjustments.length} unsynced inventory adjustments to upload`);
            }

            if (stockRequests.length > 0) {
                console.log(`Sync: Found ${stockRequests.length} unsynced stock requests to upload`);
            }

            // Gather pending actions (confirm, deliver, invoice, payment, etc.)
            await resetFailedActions();
            const pendingActions = await getPendingActions();
            if (pendingActions.length > 0) {
                console.log(`Sync: Found ${pendingActions.length} pending actions to execute`);
            }
            set({ syncProgress: 0.2 }); // 20% - Gathered local data


            const sanitizedVisits = visits.map((v: any) => ({
                ...v,
                state: v.state === 'visited' ? 'completed' : v.state,
                visit_result: v.visit_result === 'interested' ? 'successful' : v.visit_result,
                visit_type: v.visit_type === 'scheduled' ? 'sales' : v.visit_type,
                start_time: v.start_time ? dayjs(v.start_time).format('YYYY-MM-DD HH:mm:ss') : v.start_time,
                end_time: v.end_time ? dayjs(v.end_time).format('YYYY-MM-DD HH:mm:ss') : v.end_time
            }));

            // Map from local route customer ID to local partner ID (string)
            const localPartnerIdMap: { [key: number]: string } = {};
            try {
                const db = await getDB();
                const createActions = await db.getAllAsync(
                    "SELECT payload FROM pending_action WHERE action_type = 'create_customer'"
                );
                for (const act of createActions as any[]) {
                    try {
                        const p = JSON.parse(act.payload || '{}');
                        if (p.temp_route_customer_id && p.customer_data?.local_id) {
                            localPartnerIdMap[Number(p.temp_route_customer_id)] = p.customer_data.local_id;
                        }
                    } catch (e) {
                        console.warn("Error parsing pending action payload:", e);
                    }
                }
            } catch (err) {
                console.warn("Error loading pending actions for partner mapping:", err);
            }

            const formattedOrders = await Promise.all(pendingOrders.map(async (o: any) => {
                let partnerId = o.partner_id;
                let partnerLocalId = undefined;

                if (typeof partnerId === 'string' && partnerId.startsWith('partner_')) {
                    partnerLocalId = partnerId;
                    partnerId = null;
                } else if (typeof partnerId === 'number' || (typeof partnerId === 'string' && /^\d+$/.test(partnerId))) {
                    const numId = Number(partnerId);
                    if (localPartnerIdMap[numId]) {
                        partnerLocalId = localPartnerIdMap[numId];
                        partnerId = null;
                    } else {
                        try {
                            const db = await getDB();
                            const partnerRecord = await db.getFirstAsync<any>(
                                'SELECT odoo_id FROM res_partner WHERE odoo_id = ?',
                                numId
                            );
                            if (!partnerRecord) {
                                const localPartnerRecord = await db.getFirstAsync<any>(
                                    'SELECT local_id FROM res_partner WHERE id = ?',
                                    numId
                                );
                                if (localPartnerRecord && localPartnerRecord.local_id) {
                                    partnerLocalId = localPartnerRecord.local_id;
                                    partnerId = null;
                                }
                            }
                        } catch (e) {
                            console.warn("Error checking partner in DB:", e);
                        }
                    }
                }

                return {
                    local_id: o.local_id,
                    partner_id: partnerId || undefined,
                    partner_local_id: partnerLocalId || undefined,
                    route_id: o.route_id,
                    route_customer_id: o.route_customer_id || undefined,
                    visit_local_id: o.visit_local_id,
                    visit_id: o.visit_odoo_id,
                    date: o.date,
                    warehouse_id: get().salesRepProfile?.default_location_id || undefined,
                    state: o.state,
                    lines: o.lines.map((l: any) => ({
                        product_id: l.product_id,
                        quantity: l.product_uom_qty,
                        price_unit: l.price_unit,
                        product_uom_id: l.product_uom_id,
                        location_id: l.location_id,
                        is_reward_line: !!l.is_reward_line
                    }))
                };
            }));

            const formattedAdjustments = inventoryAdjustments.map((adj: any) => ({
                local_id: adj.local_id,
                date: adj.date,
                lines: (adj.lines || []).map((l: any) => ({
                    product_id: l.product_id,
                    counted_qty: l.counted_qty,
                    product_uom_id: l.product_uom_id,
                }))
            }));

            if (formattedAdjustments.length > 0) {
                console.log(`Sync: Sending ${formattedAdjustments.length} inventory adjustments:`, JSON.stringify(formattedAdjustments));
            }

            // Format pending actions for the sync payload
            const formattedActions = (pendingActions as any[]).map((a: any) => ({
                local_id: a.local_id,
                action_type: a.action_type,
                payload: typeof a.payload === 'string' ? JSON.parse(a.payload) : a.payload,
            }));

            const payload = {
                last_sync_date: get().lastSyncTime,
                upload_data: {
                    visits: sanitizedVisits,
                    collections,
                    locations,
                    orders: formattedOrders,
                    inventory_adjustments: formattedAdjustments,
                    stock_requests: stockRequests, // They are already in correct format if schema matches
                    pending_actions: formattedActions,
                }
            };

            // Call Sync API
            const response = await syncData(payload);
            const data = response.data;
            // console.log("Sync Response:", data);
            set({ syncProgress: 0.5 }); // 50% - Uploaded & Received response

            if (data.success) {
                // Process Upload Ack
                const { upload_ack } = data;

                if (upload_ack.visits) {
                    for (const [localId, odooId] of Object.entries(upload_ack.visits)) {
                        await markVisitSynced(localId, odooId as number);
                    }
                }
                if (upload_ack.collections) {
                    for (const [localId, odooId] of Object.entries(upload_ack.collections)) {
                        await markCollectionSynced(localId, odooId as number);
                    }
                }
                if (upload_ack.locations) {
                    for (const [localId, odooId] of Object.entries(upload_ack.locations)) {
                        await markLocationSynced(localId, odooId as number);
                    }
                }
                if (upload_ack.orders) {
                    const orderIds = Object.keys(upload_ack.orders);
                    console.log(`Sync: ${orderIds.length} orders acknowledged by server`);
                    for (const [localId, odooId] of Object.entries(upload_ack.orders)) {
                        console.log(`Synced Order: ${localId} -> Odoo ID: ${odooId}`);
                        await markOrderSynced(localId, odooId as number);
                    }
                }
                if (upload_ack.inventory_adjustments) {
                    const adjKeys = Object.keys(upload_ack.inventory_adjustments);
                    console.log(`Sync: ${adjKeys.length} inventory adjustments acknowledged by server`);
                    for (const [localId, odooId] of Object.entries(upload_ack.inventory_adjustments)) {
                        console.log(`Sync: Marking inventory adjustment ${localId} as synced (Odoo ID: ${odooId})`);
                        await markInventoryAdjustmentSynced(localId, odooId as number);
                    }
                }

                if (upload_ack.stock_requests) {
                    for (const [localId, odooId] of Object.entries(upload_ack.stock_requests)) {
                        await markStockRequestSynced(localId, odooId as number);
                    }
                }
 else {
                    if (inventoryAdjustments.length > 0) {
                        console.warn('Sync: Sent inventory adjustments but received no acknowledgement from server!');
                    }
                }

                // ========================================
                // STEP 1.5: Process Pending Action Acks
                // ========================================
                // Doing this BEFORE downloads ensures that records created via actions
                // (like create_customer) are linked to their local temporary records
                // BEFORE the download phase tries to upsert them.
                const { action_ack } = data;
                if (action_ack) {
                    for (const action of pendingActions as any[]) {
                        const ackEntry = action_ack[action.local_id];
                        if (ackEntry?.success) {
                            await markActionCompleted(action.local_id);
                            console.log(`Action ${action.action_type} (${action.local_id}) completed`);

                            // OPTIMIZATION: Cleanup temp local data if it was a create_customer action
                            if (action.action_type === 'create_customer') {
                                try {
                                    const payload = typeof action.payload === 'string' ? JSON.parse(action.payload) : action.payload;
                                    if (payload.temp_route_customer_id && ackEntry.result?.route_customer_odoo_id) {
                                        await markRouteCustomerSynced(payload.temp_route_customer_id, ackEntry.result.route_customer_odoo_id);
                                        console.log(`Marked route customer ${payload.temp_route_customer_id} as synced with Odoo ID ${ackEntry.result.route_customer_odoo_id}`);
                                    }

                                    // NEW: Mark the actual partner record as synced
                                    if (action.related_id && ackEntry.result?.partner_odoo_id) {
                                        await markPartnerSynced(action.related_id, ackEntry.result.partner_odoo_id);
                                        console.log(`Marked partner ${action.related_id} as synced with Odoo ID ${ackEntry.result.partner_odoo_id}`);
                                    }
                                } catch (e) {
                                    console.warn("Failed to cleanup temp route customer:", e);
                                }
                            }

                            // NEW: Mark collection as synced
                            if (action.action_type === 'create_payment') {
                                try {
                                    const payload = typeof action.payload === 'string' ? JSON.parse(action.payload) : action.payload;
                                    if (payload.local_id && ackEntry.result?.collection_odoo_id) {
                                        await markCollectionSynced(payload.local_id, ackEntry.result.collection_odoo_id);
                                        console.log(`Marked collection ${payload.local_id} as synced with Odoo ID ${ackEntry.result.collection_odoo_id}`);
                                    }
                                } catch (e) {
                                    console.warn("Failed to mark collection as synced:", e);
                                }
                            }

                            // NEW: Mark route customers as synced
                            if (action.action_type === 'reorder_route_customers') {
                                try {
                                    const { markAllRouteCustomersSynced } = require('@/services/database/repositories');
                                    await markAllRouteCustomersSynced();
                                    console.log(`Marked all route customers as synced because reorder action was successful`);
                                } catch (e) {
                                    console.warn("Failed to mark route customers as synced:", e);
                                }
                            }
                        } else if (ackEntry) {
                            await markActionFailed(action.local_id, ackEntry.error || 'Server returned failure');
                            console.warn(`Action ${action.action_type} (${action.local_id}) failed: ${ackEntry.error}`);
                        }
                    }
                }

                // ========================================
                // STEP 2: Process Downloads (existing + expanded)
                // ========================================
                set({ syncProgress: 0.6 }); // 60% - Starting downloads processing
                const { downloads } = data;

                if (downloads.routes) {
                    const activeRouteIds = downloads.routes.map((r: any) => r.id);
                    await cleanupRoutes(activeRouteIds);
                    for (const route of downloads.routes) {
                        await upsertRoute(route);
                    }
                }

                if (downloads.stock_requests) {
                    for (const req of downloads.stock_requests) {
                        await upsertStockRequest(req);
                    }
                }

                if (downloads.stock_pickings) {
                    for (const picking of downloads.stock_pickings) {
                        await upsertStockPicking(picking);
                    }
                }

                if (downloads.stock_moves) {
                    for (const move of downloads.stock_moves) {
                        await upsertStockMove(move);
                    }
                }

                if (downloads.route_customers) {
                    const activeCustomerIds = downloads.route_customers.map((c: any) => c.id);
                    await cleanupRouteCustomers(activeCustomerIds);
                    for (const customer of downloads.route_customers) {
                        await upsertRouteCustomer(customer);
                        // Also upsert partner data if embedded
                        if (customer.partner_data) {
                            await upsertPartner(customer.partner_data);
                        }
                    }
                }


                console.log(`[Sync] Downloads keys: ${Object.keys(downloads || {}).join(', ')}`);


                if (downloads.products) {
                    for (const product of downloads.products) {
                        await upsertProduct(product);
                    }
                }

                if (downloads.product_stock) {
                    await clearProductStock();
                    for (const stock of downloads.product_stock) {
                        await upsertProductStock(stock);
                    }
                    console.log(`[Sync] Synced ${downloads.product_stock.length} product stock records`);
                }



                if (downloads.uom_categories || downloads.uom_category || downloads['uom.category']) {
                    const categories = downloads.uom_categories || downloads.uom_category || downloads['uom.category'];
                    console.log(`[Sync] Syncing ${categories.length} UoM categories`);
                    for (const cat of categories) {
                        await upsertUomCategory(cat);
                    }
                }

                if (downloads.uom_uoms || downloads.uom_uom || downloads.uoms || downloads['uom.uom']) {
                    const uoms = downloads.uom_uoms || downloads.uom_uom || downloads.uoms || downloads['uom.uom'];
                    console.log(`[Sync] Syncing ${uoms.length} UoMs`);
                    for (const uom of uoms) {
                        await upsertUom(uom);
                    }
                }

                // ★ NEW: Sync partners (customers) - processed BEFORE orders to satisfy FK constraints
                if (downloads.partners) {
                    for (const partner of downloads.partners) {
                        await upsertPartner(partner);
                    }
                }

                if (downloads.traccar_device) {
                    await upsertTraccarDevice(downloads.traccar_device);
                }

                // ★ NEW: Sync server-side sales orders + lines
                if (downloads.sales_orders && downloads.sales_orders.length > 0) {
                    const orderLineMap: Record<number, any[]> = {};
                    if (downloads.sales_order_lines) {
                        for (const line of downloads.sales_order_lines) {
                            const orderId = Array.isArray(line.order_id) ? line.order_id[0] : line.order_id;
                            if (!orderLineMap[orderId]) orderLineMap[orderId] = [];
                            orderLineMap[orderId].push(line);
                        }
                    }
                    for (const order of downloads.sales_orders) {
                        const lines = orderLineMap[order.id] || [];
                        await upsertSalesOrderFromServer(order, lines);
                    }
                    // console.log(`Synced ${downloads.sales_orders.length} server orders`);
                }

                // ★ NEW: Sync payment journals
                if (downloads.payment_journals) {
                    for (const journal of downloads.payment_journals) {
                        await upsertPaymentJournal(journal);
                    }
                }

                // ★ NEW: Sync pricelists
                if (downloads.pricelists) {
                    let seq = 0;
                    for (const item of downloads.pricelists) {
                        await upsertPricelist(item, seq++);
                    }
                }

                // ★ NEW: Sync pricelist items
                if (downloads.pricelist_items) {
                    for (const item of downloads.pricelist_items) {
                        await upsertPricelistItem(item);
                    }
                    console.log(`Synced ${downloads.pricelist_items.length} pricelist items`);
                }

                // ★ NEW: Sync payment terms
                if (downloads.payment_terms) {
                    let seq = 0;
                    for (const item of downloads.payment_terms) {
                        await upsertPaymentTerm(item, seq++);
                    }
                }

                // ★ NEW: Sync payment methods
                if (downloads.payment_methods) {
                    for (const item of downloads.payment_methods) {
                        await upsertPaymentMethod(item);
                    }
                }

                // ★ NEW: Sync collections (historical/today's from server)
                if (downloads.collections) {
                    for (const col of downloads.collections) {
                        await upsertCollectionFromServer(col);
                    }
                }

                // Sync Sales Rep Profile (Mapping tables rely on master data synced above)
                if (downloads.sales_rep_profile) {
                    await upsertSalesRepresentative(downloads.sales_rep_profile);
                    
                    const { useAuthStore } = require('./useAuthStore');
                    const currentUser = useAuthStore.getState().user;
                    
                    if (currentUser) {
                        const updatedUser = {
                            ...currentUser,
                            ...downloads.sales_rep_profile
                        };
                        useAuthStore.setState({ user: updatedUser });
                        await updateSessionUser(updatedUser);
                    }
                }



                // ★ NEW: Sync loyalty programs (promotions)
                if (downloads.promotions) {
                    for (const prog of downloads.promotions) {
                        await upsertLoyaltyProgram(prog);
                    }
                    console.log(`Synced ${downloads.promotions.length} loyalty programs`);
                }

                // ★ NEW: Sync return reasons
                if (downloads.return_reasons) {
                    const { upsertReturnReason, cleanupReturnReasons } = require('@/services/database/repositories');
                    const activeIds = downloads.return_reasons.map((r: any) => r.id);
                    await cleanupReturnReasons(activeIds);
                    for (const reason of downloads.return_reasons) {
                        await upsertReturnReason(reason);
                    }
                    console.log(`Synced ${downloads.return_reasons.length} return reasons`);
                }

                // ========================================
                // STEP 2.4: Cleanup Unassigned Master Data
                // ========================================
                // 1. Cleanup Payment Journals
                if (downloads.payment_journals) {
                    const serverJournalIds = downloads.payment_journals.map((j: any) => j.id);
                    await deleteUnassignedPaymentJournals(serverJournalIds);
                }

                // 2. Cleanup Payment Methods
                if (downloads.payment_methods) {
                    const serverMethodIds = downloads.payment_methods.map((m: any) => m.id);
                    await deleteUnassignedPaymentMethods(serverMethodIds);
                }

                // 3. Cleanup Pricelists
                if (downloads.pricelists) {
                    const serverPricelistIds = downloads.pricelists.map((p: any) => p.id);
                    await deleteUnassignedPricelists(serverPricelistIds);
                }

                // 4. Cleanup Payment Terms
                if (downloads.payment_terms) {
                    const serverPaymentTermIds = downloads.payment_terms.map((pt: any) => pt.id);
                    await deleteUnassignedPaymentTerms(serverPaymentTermIds);
                }

                // ========================================
                // STEP 2.5: Pruning & Reconciliation
                // ========================================
                // 1. Reconcile temporary local IDs with server IDs for visits, orders, and collections
                await reconcileRouteCustomerReferences();

                // 2. Prune routes not in the downloaded list
                if (downloads.routes) {
                    const localRoutes = await getRoutes();
                    const serverRouteIds = new Set(downloads.routes.map((r: any) => r.id));

                    for (const localRoute of localRoutes) {
                        if (localRoute.odoo_id && !serverRouteIds.has(localRoute.odoo_id)) {
                            console.log(`Pruning route ${localRoute.odoo_id} (not on server)`);
                            await deleteRouteByOdooId(localRoute.odoo_id);
                        }
                    }
                }

                // Prune customers within routes
                if (downloads.route_customers && downloads.routes) {
                    const serverCustomerIds = new Set(downloads.route_customers.map((c: any) => c.id));
                    for (const route of downloads.routes) {
                        const localCustomers = await getRouteCustomersByRouteOdooId(route.id);
                        for (const localCust of localCustomers) {
                            if (localCust.odoo_id && !serverCustomerIds.has(localCust.odoo_id)) {
                                console.log(`Pruning customer ${localCust.odoo_id} from route ${route.id}`);
                                await deleteRouteCustomerByOdooId(localCust.odoo_id);
                            }
                        }
                    }
                }

                set({ syncProgress: 0.9 }); // 90% - Processed all downloads

                set({
                    lastSyncTime: data.server_time,
                    pendingSyncItems: 0
                });


                // console.log('Sync completed successfully');

                // Trigger Traccar offline location sync
                await TraccarService.syncOfflineLocations().catch(e => console.warn("Failed to sync Traccar locations:", e));

                // Refresh local data
                await get().fetchLocalRoutes();
                await get().fetchSalesRepProfile();
                await get().fetchUnsyncedCounts();
                await get().fetchActiveVisits(); // Refresh active visits after sync
                await get().fetchRecentActivity(); // Refresh recent activity after sync
                await get().fetchDashboardStats(); // Refresh dashboard stats after sync

                return data;

            } else {
                console.error('Sync failed:', data.message || data.error);
                // Fail Sync Log
                if (syncLogId) {
                    await updateSyncLog(syncLogId, 'failed', data.message || data.error);
                }
                return data;
            }

        } catch (error: any) {
            // Differentiate true network errors from logic/DB errors
            const isNetworkError = error?.status === 0 ||
                error?.code === 'ERR_NETWORK' ||
                error?.message?.toLowerCase().includes('network') ||
                error?.message?.toLowerCase().includes('timeout');

            const isSQLiteError = error?.message?.includes('NativeStatement') ||
                error?.message?.includes('NativeDatabase') ||
                error?.message?.includes('SQLite');

            if (isNetworkError) {
                console.log('Sync: Server unreachable (will retry)');
            } else {
                console.error('Sync Fatal Error:', error.message);
            }

            let errMsg = error.message;
            if (error.response) {
                errMsg = `HTTP ${error.response.status}: ${JSON.stringify(error.response.data)}`;
            } else if (error.request && isNetworkError) {
                errMsg = "Network request failed (no response)";
            }

            // Fail Sync Log
            if (syncLogId) {
                await updateSyncLog(syncLogId, 'failed', errMsg);
            }

            // Force Logout on Unauthorized (401)
            const isUnauthorized = error?.status === 401 ||
                error?.response?.status === 401 ||
                error?.message?.includes('Unauthorized') ||
                (error?.response?.data && JSON.stringify(error.response.data).includes('Unauthorized'));

            if (isUnauthorized) {
                console.error("Sync: Unauthorized. Forcing logout...");
                const { logout } = useAuthStore.getState();
                await logout(true); // Force logout and clear all data
            }
        } finally {
            _syncLock = false;
            set({ isSyncing: false, isInitialSyncComplete: true, syncProgress: 1 });
        }
    },

    fetchSalesRepProfile: async () => {
        const profile = await getSalesRepresentative();
        const { useAuthStore } = require('./useAuthStore');
        const user = useAuthStore.getState().user;
        set({ salesRepProfile: normalizeSalesRepProfile(profile, user) });
    },

    fetchActiveVisits: async () => {
        const visits = await getInProgressVisits();
        set({ activeVisits: visits });
    },

    fetchRecentActivity: async () => {
        const activity = await getRecentActivity(20);
        set({ recentActivity: activity });
    },

    startVisit: async (customerId: number, latitude?: number, longitude?: number) => {
        const startTime = new Date().toISOString();
        const currentCustomers = get().currentRouteCustomers;
        const customer = currentCustomers.find(c => c.id === customerId);

        if (!customer) {
            console.error("Customer not found in current route:", customerId);
            return;
        }

        try {
            const { updateCustomerStatus, insertVisit, getActiveVisitForCustomer } = require('@/services/database/repositories');

            // 1. Check for existing active visit to prevent duplicates
            const activeVisit = await getActiveVisitForCustomer(customer.odoo_id || null, customer.partner_id || null, customerId);

            if (activeVisit) {
                console.log("Resuming existing active visit:", activeVisit);

                // Update local State to match active visit
                const updatedCustomersResume = currentCustomers.map(c =>
                    c.id === customerId
                        ? { ...c, state: 'in_progress', visit_start_time: activeVisit.start_time }
                        : c
                );
                set({ currentRouteCustomers: updatedCustomersResume });

                // Ensure DB is consistent (in case route customer state lagged)
                await updateCustomerStatus(customerId, 'in_progress', activeVisit.start_time);

                return; // Exit, do not create new visit
            }

            // 2. Optimistic Update (New Visit)
            const updatedCustomers = currentCustomers.map(c =>
                c.id === customerId
                    ? { ...c, state: 'in_progress', visit_start_time: startTime }
                    : c
            );
            set({ currentRouteCustomers: updatedCustomers });

            // 3. DB Update & Creation
            await updateCustomerStatus(customerId, 'in_progress', startTime);

            // Create Visit Record Immediately
            const generateLocalId = () => 'visit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            const localId = generateLocalId();

            const visitRecord = {
                local_id: localId,
                route_id: get().currentRoute?.odoo_id,
                route_customer_id: customer?.odoo_id,
                local_route_customer_id: customerId,
                partner_id: customer?.partner_id,
                visit_date: new Date().toISOString().split('T')[0],
                state: 'in_progress',
                latitude: latitude || 0,
                longitude: longitude || 0,
                visit_type: 'sales',
                start_time: startTime,
                end_time: null
            };

            await insertVisit(visitRecord);
            console.log("Visit started and saved locally:", visitRecord);

            // Attempt Sync if Online
            if (!get().isOffline) {
                try {
                    const { startVisitApi } = require('@/services/api');
                    const response = await startVisitApi({
                        route_customer_id: customer?.odoo_id,
                        latitude: latitude || 0,
                        longitude: longitude || 0
                    });

                    if (response.data && response.data.success && response.data.visitId) {
                        const { markVisitSynced } = require('@/services/database/repositories');
                        await markVisitSynced(localId, response.data.visitId);
                        console.log("Visit started synced immediately. Odoo ID:", response.data.visitId);
                    } else {
                        console.log("Visit started synced immediately.");
                    }
                } catch (syncError) {
                    console.warn("Immediate visit start sync failed:", syncError);
                }
            }
        } catch (error) {
            console.error("Failed to start visit:", error);
        } finally {
            await get().fetchUnsyncedCounts();
            await get().fetchDashboardStats(); // Refresh stats after starting visit
        }
    },

    endVisit: async (customerId: number, visitData: any) => {
        const endTime = new Date().toISOString();
        const currentCustomers = get().currentRouteCustomers;

        // Optimistic Update
        const updatedCustomers = currentCustomers.map(c =>
            c.id === customerId
                ? { ...c, state: 'visited', visit_end_time: endTime }
                : c
        );
        set({ currentRouteCustomers: updatedCustomers });

        let visitLocalId: string | undefined;

        try {
            const { updateCustomerStatus, getActiveVisitForCustomer, updateVisit, insertVisit, markVisitSyncedByLocalId, getRouteCustomer } = require('@/services/database/repositories');
            await updateCustomerStatus(customerId, 'visited');

            // Fetch fresh customer data to ensure we have the correct IDs
            let customer = currentCustomers.find(c => c.id === customerId);
            if (!customer) {
                console.log("Customer not in store, fetching from DB for endVisit...");
                customer = await getRouteCustomer(customerId);
            }

            const activeVisit: any = await getActiveVisitForCustomer(customer?.odoo_id, customer?.partner_id, customerId);

            let finalVisitData: any = {};

            if (activeVisit) {
                // Update existing visit
                visitLocalId = activeVisit.local_id;
                finalVisitData = { ...activeVisit, ...visitData, end_time: endTime, state: 'completed' };

                await updateVisit({
                    local_id: visitLocalId,
                    state: 'completed',
                    visit_result: visitData.visit_result || 'successful',
                    visit_reason: visitData.visit_reason,
                    notes: visitData.notes,
                    follow_up_date: visitData.follow_up_date,
                    end_time: endTime
                });
                console.log("Visit updated locally:", visitLocalId);
            } else {
                // Fallback: Insert if not found
                console.warn("No active visit found for customer, creating new one on endVisit");
                const generateLocalId = () => 'visit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                visitLocalId = generateLocalId();
                const visitRecord = {
                    local_id: visitLocalId,
                    route_id: get().currentRoute?.odoo_id || activeVisit?.route_id,
                    route_customer_id: customer?.odoo_id,
                    local_route_customer_id: customerId,
                    partner_id: customer?.partner_id,
                    visit_date: dayjs().format('YYYY-MM-DD'),
                    state: 'completed',
                    latitude: 0,
                    longitude: 0,
                    visit_type: 'sales',
                    start_time: customer?.visit_start_time,
                    end_time: endTime,
                    ...visitData
                };
                finalVisitData = visitRecord;
                await insertVisit(visitRecord);
                console.log("Visit ended and saved locally (fallback):", visitRecord);
            }

            // Attempt Sync if Online
            if (!get().isOffline) {
                try {
                    const { endVisitApi } = require('@/services/api');
                    const response = await endVisitApi({
                        route_customer_id: customer?.odoo_id,
                        visit_result: finalVisitData.visit_result || 'successful',
                        visit_notes: finalVisitData.notes,
                        visit_end_time: dayjs(finalVisitData.end_time).format('YYYY-MM-DD HH:mm:ss'),
                        follow_up_date: finalVisitData.follow_up_date || null,
                    });

                    if (response.data && response.data.success) {
                        if (visitLocalId) await markVisitSyncedByLocalId(visitLocalId);
                        console.log("Visit synced immediately. Local ID:", visitLocalId);
                    } else {
                        console.warn("Immediate sync returned failure:", response.data);
                    }

                } catch (syncError) {
                    console.warn("Immediate sync failed, will retry later:", syncError);
                }
            }
        } catch (error) {
            console.error("Failed to end visit:", error);
        } finally {
            await get().fetchUnsyncedCounts();
            await get().fetchDashboardStats(); // Refresh stats after ending visit
        }
        return visitLocalId;
    },

    cancelVisit: async (customerId: number) => {
        const endTime = new Date().toISOString();
        const currentCustomers = get().currentRouteCustomers;

        console.log("Cancelling visit for customer:", customerId);

        // Optimistic Update: Revert to 'pending' state
        const updatedCustomers = currentCustomers.map(c =>
            c.id === customerId
                ? { ...c, state: 'pending', visit_start_time: null }
                : c
        );
        set({ currentRouteCustomers: updatedCustomers });

        try {
            const { updateCustomerStatus, getActiveVisitForCustomer, updateVisit } = require('@/services/database/repositories');

            // 1. Revert Customer Status in DB
            await updateCustomerStatus(customerId, 'pending');

            // 2. Find and Cancel Active Visit
            const customer = currentCustomers.find(c => c.id === customerId);
            const activeVisit: any = await getActiveVisitForCustomer(customer?.odoo_id, customer?.partner_id);

            if (activeVisit) {
                await updateVisit({
                    local_id: activeVisit.local_id,
                    state: 'cancelled',
                    visit_result: 'cancelled', // Explicit result
                    visit_reason: 'Mistake/App Closed',
                    notes: 'Visit cancelled by user',
                    end_time: endTime
                });
                console.log("Visit cancelled locally:", activeVisit.local_id);
            } else {
                console.warn("No active visit found to cancel");
            }
        } catch (error) {
            console.error("Failed to cancel visit:", error);
        }
    },

    checkConnection: async () => {
        const state = await NetInfo.fetch();
        const isConnected = state.isConnected && (state.isInternetReachable ?? true);
        set({ isOffline: !isConnected });
    },

    fetchUnsyncedCounts: async () => {
        const counts = await getUnsyncedCounts();
        console.log("Updated unsynced counts:", counts);
        set({ unsyncedCounts: counts });
    },

    fetchDashboardStats: async () => {
        const { currentRoute } = get();
        // Fetch stats (visits will be 0 if no route, but sales/collections are overall)
        const stats = await getDashboardStats(currentRoute?.odoo_id || null);
        set({ dashboardStats: stats });
        await get().fetchJournalPaymentStats();
    },

    fetchJournalPaymentStats: async () => {
        const { currentRoute } = get();
        const stats = await getJournalPaymentStats(currentRoute?.odoo_id || null);
        set({ journalPaymentStats: stats });
    },

    fetchJournalHistoricalPayments: async (journalOdooId: number) => {
        const { getJournalHistoricalPayments } = require('@/services/database/repositories');
        const payments = await getJournalHistoricalPayments(journalOdooId);
        set({ journalHistoricalPayments: payments });
    },

    fetchStockRequests: async () => {
        const { getStockRequests } = require('@/services/database/repositories');
        const requests = await getStockRequests();
        set({ stockRequests: requests });
    },

    submitStockRequest: async (lines: any[], sourceLocationId?: number, destinationLocationId?: number) => {
        const { createLocalStockRequest } = require('@/services/database/repositories');
        const { salesRepProfile, isOffline, fetchStockRequests, fetchUnsyncedCounts } = get();
        
        const srcId = sourceLocationId || salesRepProfile?.location_request_id;
        const destId = destinationLocationId || salesRepProfile?.default_location_id;

        if (!srcId) {
            throw new Error("No source location selected.");
        }
        if (!destId) {
            throw new Error("No destination location selected.");
        }

        // Resolve names
        const defaultLocs = salesRepProfile?.default_location_ids || [];
        const requestLocs = salesRepProfile?.location_request_ids || [];

        const srcLoc = defaultLocs.find((l: any) => l.id === srcId);
        const destLoc = requestLocs.find((l: any) => l.id === destId);

        const srcName = srcLoc ? srcLoc.name : (salesRepProfile?.default_location_name || 'Source Location');
        const destName = destLoc ? destLoc.name : (salesRepProfile?.location_request_name || 'Destination Location');

        const localId = `SR-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        if (!isOffline) {
            try {
                const response = await stockService.createStockRequest({
                    local_id: localId,
                    source_location_id: srcId,
                    destination_location_id: destId,
                    lines: lines
                });

                if (response.data?.success) {
                    // Success! Even if it was online, we might want to save it locally 
                    // as 'synced' so the user sees it in the history immediately.
                    await createLocalStockRequest({
                        local_id: localId,
                        sales_rep_id: salesRepProfile.odoo_id,
                        source_location_id: srcId,
                        source_location_name: srcName,
                        location_id: destId,
                        location_name: destName,
                        is_synced: 1,
                        odoo_id: response.data.picking_id,
                        name: response.data.name,
                        state: 'submitted'
                    }, lines);
                    
                    await fetchStockRequests();
                    await fetchUnsyncedCounts();
                    return;
                }
            } catch (error: any) {
                console.error("Direct stock request failed, falling back to local:", error);
                throw new Error(error.response?.data?.message || error.message || "Failed to submit request online.");
            }
        } else {
            throw new Error("You are currently offline. Stock requests must be submitted online.");
        }
    },

    submitInventoryAdjustment: async (lines: any[], locationId?: number) => {
        const { salesRepProfile, isOffline, fetchUnsyncedCounts } = get();
        if (!salesRepProfile) throw new Error("Sales Rep profile not loaded");

        if (isOffline) {
            throw new Error("Inventory adjustment requires an active internet connection.");
        }

        const localId = `IA-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        try {
            const response = await stockService.createInventoryAdjustment({
                local_id: localId,
                location_id: locationId,
                lines: lines.map(line => ({
                    product_id: line.product_id,
                    counted_qty: line.counted_qty,
                    product_uom_id: line.product_uom_id
                }))
            });

            if (response.data?.success) {
                // Success! We don't need to save locally since it's "direct API".
                // But we should refresh counts if we were using them.
                await fetchUnsyncedCounts();
                return response.data;
            } else {
                throw new Error(response.data?.message || "Failed to submit inventory adjustment.");
            }
        } catch (error: any) {
            console.error("Inventory adjustment submission failed:", error);
            throw new Error(error.response?.data?.message || error.message || "Failed to submit inventory adjustment online.");
        }
    },

    setSseStatus: (status: SSEStatus) => set({ sseStatus: status })
}));
