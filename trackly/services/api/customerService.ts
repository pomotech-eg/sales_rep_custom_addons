import apiClient from '../apiClient';

// Customer Service — customer creation and lookup
// Called by sync engine, NOT directly by UI screens.

export const createCustomer = async (routeId: number, customerData: any) => {
    return apiClient.post('/api/mobile/customers', {
        route_id: routeId,
        customer: customerData,
    });
};

export const getPartnerDetails = async (partnerId: number) => {
    return apiClient.get(`/api/mobile/partners/${partnerId}`);
};

export const getPriceLists = async () => {
    return apiClient.get('/api/mobile/pricelists');
};


export const getReturnReasons = async () => {
    return apiClient.get('/api/mobile/return_reasons');
};

export const logPromotion = async (customerId: number, promotionType: string, note: string, date: string) => {
    return apiClient.post('/api/mobile/promotion', {
        partner_id: customerId,
        type: promotionType,
        note,
    });
};

export const getLoyaltyInfo = async (partnerId: number) => {
    return apiClient.get(`/api/mobile/products?partner_id=${partnerId}&loyalty_only=true`);
};
