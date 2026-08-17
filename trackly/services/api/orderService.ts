import apiClient from '../apiClient';

// Order Service — thin wrappers for Odoo order-related API calls
// These are called by the sync engine, NOT directly by UI screens.

export const getCustomerOrders = async (partnerId: number) => {
    return apiClient.get(`/api/mobile/customers/${partnerId}/orders`);
};

export const getOrderDetails = async (orderId: number) => {
    return apiClient.get(`/api/mobile/orders/${orderId}`);
};

export const createSaleOrder = async (data: any) => {
    return apiClient.post('/api/mobile/orders', data);
};

export const updateOrder = async (orderId: number, data: any) => {
    return apiClient.put(`/api/mobile/orders/${orderId}`, data);
};

export const confirmOrder = async (orderId: number) => {
    return apiClient.post(`/api/mobile/orders/${orderId}/confirm`);
};

export const cancelOrder = async (orderId: number) => {
    return apiClient.post(`/api/mobile/orders/${orderId}/cancel`);
};

export const processDelivery = async (orderId: number, deliveredQuantities?: any, createBackorder: boolean = true) => {
    const payload: any = { create_backorder: createBackorder };
    if (deliveredQuantities) {
        payload.delivered_quantities = deliveredQuantities;
    }
    return apiClient.post(`/api/mobile/orders/${orderId}/process_delivery`, payload);
};

export const createInvoice = async (orderId: number) => {
    return apiClient.post(`/api/mobile/orders/${orderId}/create_invoice`);
};

export const applyPromotion = async (orderId: number, promotionId: number, couponCode?: string) => {
    return apiClient.post(`/api/mobile/orders/${orderId}/apply_promotion`, {
        promotion_id: promotionId,
        coupon_code: couponCode || null,
    });
};

export const addOrderLine = async (orderId: number, data: { product_id: number; quantity: number; price_unit: number; uom_id?: number }) => {
    return apiClient.post(`/api/mobile/orders/${orderId}/lines`, data);
};

export const updateOrderLine = async (lineId: number, data: { quantity?: number; uom_id?: number; price_unit?: number }) => {
    return apiClient.put(`/api/mobile/orders/lines/${lineId}`, data);
};

export const removeOrderLine = async (lineId: number) => {
    return apiClient.delete(`/api/mobile/orders/lines/${lineId}`);
};

export const getOrdersToday = async () => {
    return apiClient.get('/api/mobile/orders/today');
};
