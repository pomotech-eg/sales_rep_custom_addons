import apiClient from '../apiClient';

// Account Service — invoice and tax related API calls
// Called by sync engine, NOT directly by UI screens.

export const getTaxRates = async () => {
    return apiClient.get('/api/mobile/tax_rates');
};

export const registerPayment = async (invoiceId: number, data: { journal_id: number; amount: number; payment_date: string }) => {
    return apiClient.post(`/api/mobile/invoices/${invoiceId}/register_payment`, data);
};

export const refundInvoice = async (invoiceId: number, data: {
    reason: string;
    journal_id: number;
    payment_date: string;
    return_lines?: { product_id: number; quantity: number }[];
}) => {
    return apiClient.post(`/api/mobile/invoices/${invoiceId}/refund`, data);
};

export const getInvoiceDetails = async (invoiceId: number) => {
    return apiClient.get(`/api/mobile/invoices/${invoiceId}`);
};
