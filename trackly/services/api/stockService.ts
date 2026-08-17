import apiClient from '../apiClient';

// Stock Service — delivery, returns, and inventory
// Called by sync engine, NOT directly by UI screens.

export const getReturnProposal = async (pickingIds: number | string) => {
    return apiClient.get(`/api/mobile/stock/pickings/${pickingIds}/return_proposal`);
};

export const returnPicking = async (pickingId: number, data: {
    lines: { product_id: number; quantity: number }[];
    return_location_id?: number;
    return_reason_id?: number;
    return_reason?: string;
}) => {
    return apiClient.post(`/api/mobile/stock/pickings/${pickingId}/return`, data);
};

export const getQuants = async (productIds: number[] = [], locationIds: number[] = []) => {
    return apiClient.post('/api/mobile/stock/quants', {
        product_ids: productIds,
        location_ids: locationIds,
    });
};

export const getPendingReturns = async (orderId: number) => {
    return apiClient.get(`/api/mobile/stock/order/${orderId}/pending_returns`);
};

export const validateReturns = async (pickingIds: number[]) => {
    return apiClient.post(`/api/mobile/stock/pickings/validate_returns`, {
        picking_ids: pickingIds
    });
};

export const createStockRequest = async (data: {
    local_id: string;
    source_location_id?: number;
    destination_location_id?: number;
    lines: {
        product_id: number;
        product_uom_qty: number;
        product_uom_id?: number;
    }[];
}) => {
    return apiClient.post('/api/mobile/stock/request/create', data);
};

export const getPickingDetails = async (pickingId: number) => {
    return apiClient.get(`/api/mobile/stock/pickings/${pickingId}`);
};
export const createInventoryAdjustment = async (data: {
    local_id: string;
    location_id?: number;
    lines: {
        product_id: number;
        counted_qty: number;
        product_uom_id?: number;
    }[];
}) => {
    return apiClient.post('/api/mobile/stock/inventory_adjustment/create', data);
};

export const getGeneralReturnReasons = async () => {
    return apiClient.get('/api/mobile/stock/general_return/reasons');
};

export const getGeneralReturnList = async () => {
    return apiClient.get('/api/mobile/stock/general_return/list');
};

export const getGeneralReturnDetails = async (requestId: number) => {
    return apiClient.get(`/api/mobile/stock/general_return/details/${requestId}`);
};

export const submitGeneralReturn = async (data: {
    partner_id: number;
    location_dest_id: number;
    reason_id: number;
    lines: { product_id: number; quantity: number; product_uom_id?: number }[];
    attachments?: { name: string; base64: string }[];
}) => {
    return apiClient.post('/api/mobile/stock/general_return/submit', data);
};
