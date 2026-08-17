import dayjs from 'dayjs';
import { Alert } from 'react-native';
import * as ExpoPrint from 'expo-print';
import * as ExpoSharing from 'expo-sharing';

const generateInvoiceHTML = (order: any, isReceipt: boolean = false) => {
  const title = isReceipt ? "RECEIPT" : "INVOICE";
  const date = dayjs(order.date_order || new Date()).format('DD/MM/YYYY HH:mm');

  // Calculate totals
  const subtotal = order.amount_untaxed || 0;
  const tax = order.amount_tax || 0;
  const total = order.amount_total || 0;

  const lines = order.lines || [];

  // Safe safe checks for partner info
  let partnerName = 'Walk-in Customer';
  let partnerId = '';
  if (order.partner_data) {
    partnerName = order.partner_data.name;
    partnerId = order.partner_data.id;
  } else if (order.partner_name) {
    partnerName = order.partner_name;
  } else if (order.customer_name) {
    partnerName = order.customer_name;
  }

  return `
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no" />
        <style>
          body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 20px; color: #333; }
          .header { text-align: center; margin-bottom: 20px; }
          .header h1 { margin: 0; font-size: 24px; font-weight: bold; }
          .header p { margin: 5px 0; font-size: 14px; color: #666; }
          
          .info-grid { display: flex; justify-content: space-between; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 15px; }
          .info-col { width: 48%; }
          .info-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
          .info-value { font-size: 14px; font-weight: 500; margin-top: 2px; }

          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { text-align: left; font-size: 10px; color: #888; text-transform: uppercase; border-bottom: 1px solid #eee; padding: 8px 4px; }
          td { padding: 8px 4px; font-size: 13px; border-bottom: 1px solid #f9f9f9; }
          .text-right { text-align: right; }
          .text-center { text-align: center; }

          .totals { margin-top: 20px; margin-left: auto; width: 60%; }
          .total-row { display: flex; justify-content: space-between; padding: 5px 0; }
          .total-label { font-size: 12px; color: #666; }
          .total-value { font-size: 14px; font-weight: bold; }
          .grand-total { border-top: 2px solid #333; padding-top: 10px; margin-top: 5px; }
          .grand-total .total-value { font-size: 18px; }

          .footer { margin-top: 40px; text-align: center; font-size: 10px; color: #aaa; border-top: 1px solid #eee; padding-top: 15px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${title}</h1>
          <p>${order.name || 'Draft Order'}</p>
          <p>${date}</p>
        </div>

        <div class="info-grid">
          <div class="info-col">
            <div class="info-label">Customer</div>
            <div class="info-value">${partnerName}</div>
            ${partnerId ? `<div class="info-value" style="font-size:12px; color:#666">ID: ${partnerId}</div>` : ''}
          </div>
          <div class="info-col text-right">
            <div class="info-label">Reference</div>
            <div class="info-value">${order.odoo_id ? `SO-${order.odoo_id}` : (order.local_id || '—')}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width: 50%">Item</th>
              <th class="text-center" style="width: 15%">Qty</th>
              <th class="text-right" style="width: 15%">Price</th>
              <th class="text-right" style="width: 20%">Total</th>
            </tr>
          </thead>
          <tbody>
            ${lines.map((line: any) => `
              <tr>
                <td>${line.product_name || line.name || 'Product'}</td>
                <td class="text-center">${line.product_uom_qty}</td>
                <td class="text-right">${(line.price_unit || 0).toFixed(2)}</td>
                <td class="text-right">${(line.price_subtotal || (line.product_uom_qty * line.price_unit)).toFixed(2)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="totals">
          <div class="total-row">
            <div class="total-label">Subtotal</div>
            <div class="total-value">${subtotal.toFixed(2)}</div>
          </div>
          <div class="total-row">
            <div class="total-label">Tax</div>
            <div class="total-value">${tax.toFixed(2)}</div>
          </div>
          <div class="total-row grand-total">
            <div class="total-label" style="font-weight:bold; color:#333; font-size:14px;">TOTAL</div>
            <div class="total-value">${total.toFixed(2)}</div>
          </div>
        </div>

        <div class="footer">
          <p>Thank you for your business!</p>
          <p>Generated by Trackly</p>
        </div>
      </body>
    </html>
  `;
};

export const printInvoice = async (order: any, isReceipt: boolean = false) => {
  try {
    const html = generateInvoiceHTML(order, isReceipt);
    await ExpoPrint.printAsync({
      html,
    });
  } catch (error: any) {
    console.error('Failed to print invoice:', error);
    Alert.alert("Printing Error", error.message);
  }
};

export const shareInvoice = async (order: any, isReceipt: boolean = false) => {
  try {
    const html = generateInvoiceHTML(order, isReceipt);
    const { uri } = await ExpoPrint.printToFileAsync({
      html,
    });
    await ExpoSharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
  } catch (error: any) {
    console.error('Failed to share invoice:', error);
    Alert.alert("Sharing Error", error.message);
  }
};
