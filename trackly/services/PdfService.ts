import { Platform, Alert } from 'react-native';

export interface InvoiceData {
    id: number;
    name: string;
    invoice_date: string;
    state: string;
    payment_state: string;
    amount_total: number;
    amount_untaxed: number;
    amount_tax: number;
    amount_residual: number;
    date?: string;
    date_due?: string;
    invoice_date_due?: string;
    partner: any;
    company: any;
    lines: Array<{
        name: string;
        quantity: number;
        price_unit: number;
        price_subtotal: number;
        discount: number;
        product_id?: any;
    }>;
}

class PdfService {
    private formatAddress(address: any) {
        if (!address) return "";
        const parts = [];
        if (address.street) parts.push(address.street);
        if (address.street2) parts.push(address.street2);
        if (address.city) parts.push(address.city);
        if (address.state_id && address.state_id[1]) parts.push(address.state_id[1]);
        if (address.zip) parts.push(address.zip);
        if (address.country_id && address.country_id[1]) parts.push(address.country_id[1]);
        return parts.join(", ");
    }

    private formatDate(dateString: string) {
        if (!dateString) return "";
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
            });
        } catch (e) {
            return dateString;
        }
    }

    private formatCurrency(amount: number) {
        return `$${parseFloat((amount || 0) as any).toFixed(2)}`;
    }

    private generateSingleInvoicePage(data: any, isLast: boolean) {
        const { invoice, lines, partner, company } = data;

        const linesHtml = lines && lines.length > 0
            ? lines.map((line: any) => {
                const discount = line.discount || 0;
                const lineTotal = line.price_subtotal || (line.quantity * line.price_unit * (1 - discount / 100));
                return `
                    <tr>
                        <td>${line.name || (line.product_id && line.product_id[1]) || "Product"}</td>
                        <td class="text-right">${line.quantity || 0}</td>
                        <td class="text-right">${this.formatCurrency(line.price_unit || 0)}</td>
                        <td class="text-right">${discount > 0 ? `${discount}%` : "-"}</td>
                        <td class="text-right">${this.formatCurrency(lineTotal)}</td>
                    </tr>
                `;
            }).join("")
            : "<tr><td colspan=\"5\">No items</td></tr>";

        return `
        <div class="page" style="${!isLast ? 'page-break-after: always;' : ''}">
            <div class="header">
                <div class="header-content">
                    <div class="company-info">
                        ${company ? `
                            <div class="company-name">${company.name || "Company Name"}</div>
                            <div class="company-address">${this.formatAddress(company)}</div>
                            ${company.phone ? `<div class="company-address">Phone: ${company.phone}</div>` : ""}
                            ${company.email ? `<div class="company-address">Email: ${company.email}</div>` : ""}
                            ${company.vat ? `<div class="company-address">VAT: ${company.vat}</div>` : ""}
                        ` : ""}
                    </div>
                    <div class="invoice-info">
                        <div class="invoice-title">INVOICE</div>
                        <div class="invoice-number">${invoice.name || `Invoice #${invoice.id}`}</div>
                        <div class="invoice-date">Date: ${this.formatDate(invoice.date || invoice.invoice_date)}</div>
                        ${invoice.date_due || invoice.invoice_date_due ? `<div class="invoice-date">Due Date: ${this.formatDate(invoice.date_due || invoice.invoice_date_due)}</div>` : ""}
                    </div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Bill To:</div>
                ${partner ? `
                    <div class="customer-info">
                        <div class="customer-label">${partner.name || "Customer"}</div>
                        <div>${this.formatAddress(partner)}</div>
                        ${partner.phone ? `<div>Phone: ${partner.phone}</div>` : ""}
                        ${partner.email ? `<div>Email: ${partner.email}</div>` : ""}
                        ${partner.vat ? `<div>VAT: ${partner.vat}</div>` : ""}
                    </div>
                ` : "<div class=\"customer-info\">Customer information not available</div>"}
            </div>

            <table>
                <thead>
                    <tr>
                        <th>Description</th>
                        <th class="text-right">Qty</th>
                        <th class="text-right">Unit Price</th>
                        <th class="text-right">Discount</th>
                        <th class="text-right">Total</th>
                    </tr>
                </thead>
                <tbody>
                    ${linesHtml}
                </tbody>
            </table>

            <div class="totals">
                <div class="total-row">
                    <div class="total-label">Subtotal:</div>
                    <div class="total-value">${this.formatCurrency(invoice.amount_untaxed || 0)}</div>
                </div>
                ${invoice.amount_tax > 0 ? `
                    <div class="total-row">
                        <div class="total-label">Tax:</div>
                        <div class="total-value">${this.formatCurrency(invoice.amount_tax || 0)}</div>
                    </div>
                ` : ""}
                <div class="grand-total-row">
                    <div class="grand-total-label">Total:</div>
                    <div class="grand-total-value">${this.formatCurrency(invoice.amount_total || 0)}</div>
                </div>
                ${invoice.amount_residual > 0 ? `
                    <div class="total-row">
                        <div class="total-label">Amount Due:</div>
                        <div class="total-value">${this.formatCurrency(invoice.amount_residual || 0)}</div>
                    </div>
                ` : ""}
                ${invoice.payment_state ? `
                    <div class="total-row">
                        <div class="total-label">Payment Status:</div>
                        <div class="total-value">${invoice.payment_state.toUpperCase()}</div>
                    </div>
                ` : ""}
            </div>

            <div class="footer">
                <div>Thank you for your business!</div>
            </div>
        </div>
        `;
    }

    private generateInvoiceHtml(invoiceData: any | any[]) {
        const invoices = Array.isArray(invoiceData) ? invoiceData : [invoiceData];
        const pagesHtml = invoices.map((invData, index) => this.generateSingleInvoicePage(invData, index === invoices.length - 1)).join("");

        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: Arial, sans-serif;
                    font-size: 12px;
                    color: #1D2129;
                    background: #FFFFFF;
                }
                .page {
                    padding: 40px;
                    position: relative;
                }
                @media print {
                    .page { page-break-after: always; }
                    .page:last-child { page-break-after: auto; }
                }
                .header { border-bottom: 2px solid #3D3BF3; padding-bottom: 15px; margin-bottom: 30px; }
                .header-content { display: flex; justify-content: space-between; align-items: flex-start; }
                .company-info { flex: 1; }
                .company-name { font-size: 20px; font-weight: bold; color: #1D2129; margin-bottom: 5px; }
                .company-address { font-size: 9px; color: #8A8F99; line-height: 1.5; }
                .invoice-info { text-align: right; }
                .invoice-title { font-size: 24px; font-weight: bold; color: #3D3BF3; margin-bottom: 10px; }
                .invoice-number { font-size: 12px; color: #1D2129; margin-bottom: 5px; }
                .invoice-date { font-size: 10px; color: #8A8F99; }
                .section { margin-bottom: 20px; }
                .section-title { font-size: 12px; font-weight: bold; color: #1D2129; margin-bottom: 10px; border-bottom: 1px solid #E6E8F0; padding-bottom: 5px; }
                .customer-info { font-size: 9px; color: #1D2129; line-height: 1.5; }
                .customer-label { font-weight: bold; margin-top: 8px; margin-bottom: 3px; }
                table { width: 100%; border-collapse: collapse; margin-top: 20px; margin-bottom: 20px; }
                thead { background-color: #F8F9FA; }
                th { padding: 8px; text-align: left; border-bottom: 1px solid #E6E8F0; font-weight: bold; font-size: 9px; }
                th.text-right { text-align: right; }
                td { padding: 8px; border-bottom: 1px solid #E6E8F0; font-size: 9px; }
                td.text-right { text-align: right; }
                .totals { margin-top: 20px; text-align: right; }
                .total-row { display: flex; justify-content: flex-end; margin-bottom: 5px; width: 100%; }
                .total-label { font-size: 10px; color: #8A8F99; width: 200px; text-align: right; padding-right: 10px; }
                .total-value { font-size: 10px; color: #1D2129; width: 150px; text-align: right; font-weight: bold; }
                .grand-total-row { display: flex; justify-content: flex-end; margin-top: 10px; padding-top: 10px; border-top: 2px solid #3D3BF3; width: 100%; }
                .grand-total-label { font-size: 14px; font-weight: bold; color: #1D2129; width: 200px; text-align: right; padding-right: 10px; }
                .grand-total-value { font-size: 14px; font-weight: bold; color: #3D3BF3; width: 150px; text-align: right; }
                .footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #E6E8F0; font-size: 8px; color: #8A8F99; text-align: center; }
            </style>
        </head>
        <body>
            ${pagesHtml}
        </body>
        </html>
        `;
    }

    public async printInvoice(invoice: InvoiceData) {
        // Prepare data in the format expected by the template
        const data = {
            invoice: invoice,
            lines: invoice.lines,
            partner: invoice.partner,
            company: invoice.company
        };
        const html = this.generateInvoiceHtml(data);
        await this.executePrint(html);
    }

    public async printAllInvoices(invoices: InvoiceData[]) {
        // Prepare data array for bulk printing
        const dataArray = invoices.map(inv => ({
            invoice: inv,
            lines: inv.lines,
            partner: inv.partner,
            company: inv.company
        }));
        const html = this.generateInvoiceHtml(dataArray);
        await this.executePrint(html);
    }

    private async executePrint(html: string) {
        try {
            if (Platform.OS === 'web') {
                const printWindow = window.open('', '_blank');
                if (printWindow) {
                    printWindow.document.write(html);
                    printWindow.document.close();
                    printWindow.print();
                }
            } else {
                let Print, shareAsync;
                try {
                    // Lazy-load native modules inside the call to prevent top-level module evaluation crash.
                    // If the native module is missing (not yet built into the binary), these will throw.
                    Print = require('expo-print');
                    const sharing = require('expo-sharing');
                    shareAsync = sharing ? sharing.shareAsync : null;
                } catch (loadError) {
                    console.error('Failed to load native printing modules:', loadError);
                    Alert.alert(
                        'Module Not Ready',
                        'The native printing module is not active. Since this is a new feature with new native dependencies, you MUST rebuild your native app binary.\n\nRun: npx expo run:android'
                    );
                    return;
                }

                if (!Print || !Print.printToFileAsync || !shareAsync) {
                    Alert.alert('Module Error', 'Printing modules were loaded but are incomplete (native code missing). A native rebuild is required.');
                    return;
                }

                // Match old app behavior of going straight to print dialg
                try {
                    await Print.printAsync({ html });
                } catch (err) {
                    console.error('printAsync failed, falling back to file + share:', err);
                    const { uri } = await Print.printToFileAsync({ html });
                    await shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
                }
            }
        } catch (error) {
            console.error('Error generating/printing PDF:', error);
            throw error;
        }
    }
}

export default new PdfService();
