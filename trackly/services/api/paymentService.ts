import apiClient from '../apiClient';

// Payment Service — standalone payment creation
// Called by sync engine, NOT directly by UI screens.

export const getPaymentsToday = async () => {
    return apiClient.get('/api/mobile/payments/today');
};

export const createPayment = async (data: {
    partner_id: number;
    journal_id: number;
    amount: number;
    memo?: string;
    route_id?: number;
    visit_id?: number;
    route_customer_id?: number;
}) => {
    return apiClient.post('/api/mobile/payments', data);
};

export const getPaymentTerms = async () => {
    return apiClient.get('/api/mobile/payment_terms');
};
