from odoo import models, fields, api, _
import logging
from odoo.exceptions import ValidationError, RedirectWarning
from dateutil.relativedelta import relativedelta
from dateutil.rrule import rrulestr
from datetime import time, datetime
import pytz

_logger = logging.getLogger(__name__)

class SalesRepresentative(models.Model):
    _name = 'sales.representative'
    _description = 'Sales Representative'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'name'



    name = fields.Char(
        string='Name',
        required=True,
        tracking=True
    )
    code = fields.Char(
        string='Code',
        required=True,
        copy=False,
        readonly=True,
        default=lambda self: _('New'),
        index=True
    )
    user_id = fields.Many2one(
        'res.users',
        string='User',
        required=True,
        ondelete='cascade'
    )
    employee_id = fields.Many2one(
        'hr.employee',
        string='Sales Rep',
    )
    supervisor_id = fields.Many2one(
        'sales.representative',
        string='Supervisor',
        domain="[('is_supervisor', '=', True), ('company_id', '=', company_id)]",
        check_company=True
    )
    crm_team_id = fields.Many2one(
        'crm.team',
        string='Sales Team',
        tracking=True,
        check_company=True,
        domain="['|', ('company_id', '=', False), ('company_id', '=', company_id)]"
    )
    is_supervisor = fields.Boolean(
        string='Is Supervisor',
        default=False
    )
    is_manager = fields.Boolean(
        string='Is Manager',
        default=False
    )
    phone = fields.Char(
        string='Phone',
        related='employee_id.work_phone',
        store=True
    )
    email = fields.Char(
        string='Email',
        related='employee_id.work_email',
        readonly=True,
        store=True
    )
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        required=True,
        default=lambda self: self.env.company
    )
    active = fields.Boolean(
        string='Active',
        default=True
    )
    
    @api.model
    def _register_hook(self):
        super()._register_hook()
        if 'hr.contract' in self.env:
            hr_contract_class = type(self.env['hr.contract'])
            
            orig_write = hr_contract_class.write
            def new_write(self_contract, vals):
                res = orig_write(self_contract, vals)
                if 'state' in vals:
                    ICPSudo = self_contract.env['ir.config_parameter'].sudo()
                    deactive_enabled = ICPSudo.get_param('sales_rep_management.hr_contract_deactive', 'False') == 'True'
                    if deactive_enabled:
                        if vals['state'] in ['close', 'cancel']:
                            for record in self_contract:
                                if record.employee_id:
                                    emp_contracts = self_contract.env['hr.contract'].sudo().search([
                                        ('employee_id', '=', record.employee_id.id)
                                    ])
                                    if not any(c.state == 'open' for c in emp_contracts):
                                        reps = self_contract.env['sales.representative'].sudo().search([
                                            ('employee_id', '=', record.employee_id.id),
                                            ('active', '=', True)
                                        ])
                                        if reps:
                                            reps.write({'active': False})
                        elif vals['state'] == 'open':
                            employees = self_contract.mapped('employee_id')
                            if employees:
                                reps = self_contract.env['sales.representative'].sudo().search([
                                    ('employee_id', 'in', employees.ids),
                                    ('active', '=', False)
                                ])
                                if reps:
                                    reps.write({'active': True})
                return res
            hr_contract_class.write = new_write

            orig_create = hr_contract_class.create
            def new_create(self_contract_model, vals_list):
                records = orig_create(self_contract_model, vals_list)
                ICPSudo = self_contract_model.env['ir.config_parameter'].sudo()
                deactive_enabled = ICPSudo.get_param('sales_rep_management.hr_contract_deactive', 'False') == 'True'
                if deactive_enabled:
                    inactive_employees = self_contract_model.env['hr.employee']
                    active_employees = self_contract_model.env['hr.employee']
                    for record in records:
                        if record.employee_id:
                            if record.state in ['close', 'cancel']:
                                inactive_employees |= record.employee_id
                            elif record.state == 'open':
                                active_employees |= record.employee_id
                    if inactive_employees:
                        for emp in inactive_employees:
                            emp_contracts = self_contract_model.env['hr.contract'].sudo().search([
                                ('employee_id', '=', emp.id)
                            ])
                            if not any(c.state == 'open' for c in emp_contracts):
                                reps = self_contract_model.env['sales.representative'].sudo().search([
                                    ('employee_id', '=', emp.id),
                                    ('active', '=', True)
                                ])
                                if reps:
                                    reps.write({'active': False})
                    if active_employees:
                        reps = self_contract_model.env['sales.representative'].sudo().search([
                            ('employee_id', 'in', active_employees.ids),
                            ('active', '=', False)
                        ])
                        if reps:
                            reps.write({'active': True})
                return records
            hr_contract_class.create = new_create
            
    territory_ids = fields.Many2many(
        'res.partner.category',
        string='Territories',
        help='Assigned territories for this sales rep'
    )
    team_member_ids = fields.One2many(
        'sales.representative',
        'supervisor_id',
        string='Team Members'
    )
    session_log_ids = fields.One2many(
        'sales.representative.session.log',
        'sales_rep_id',
        string='Session Logs'
    )

    # Statistics
    total_routes = fields.Integer(
        string='Total Routes',
        compute='_compute_statistics'
    )
    total_visits = fields.Integer(
        string='Total Visits',
        compute='_compute_statistics'
    )
    total_collections = fields.Float(
        string='Total Collections',
        compute='_compute_statistics'
    )

    mobile_access_token = fields.Char(
        string='Mobile Access Token',
        index=True,
        copy=False,
        help="Access token issued by the master server for mobile sync."
    )
    monthly_target = fields.Float(
        string='Monthly Target'
    )
    is_driver = fields.Boolean(
        related='employee_id.is_driver',
        string="Is Driver",
        store=True,
        readonly=True
    )

    license_number = fields.Char(
        related='employee_id.license_number',
        string="License Number",
        readonly=True
    )
    license_issue_date = fields.Date(
        related='employee_id.license_issue_date',
        string="Issue Date",
        readonly=True
    )
    license_expiry_date = fields.Date(
        related='employee_id.license_expiry_date',
        string="Expiry Date",
        readonly=True
    )
    license_attachment = fields.Binary(
        related='employee_id.license_attachment',
        string="License Scan",
        readonly=True
    )
    get_notify = fields.Boolean(
        related='employee_id.get_notify',
        string="Get Expiration Notifications",
        readonly=True
    )
    notify_before_days = fields.Integer(
        related='employee_id.notify_before_days',
        string="Notify Before (Days)",
        readonly=True
    )
    notification_type = fields.Selection(
        related='employee_id.notification_type',
        string="Notification Method",
        readonly=True
    )
    notification_recipient_ids = fields.Many2many(
        related='employee_id.notification_recipient_ids',
        string="Recipients",
        readonly=True
    )

    # --- POS Configuration Fields ---
    
    # Accounting
    invoice_journal_id = fields.Many2one(
        'account.journal',
        string='Invoice Journal',
        domain="[('type', '=', 'sale')]",
        check_company=True,
        help="Journal used for invoices. If empty, uses Sales Journal"
    )
    fiscal_position_id = fields.Many2one(
        'account.fiscal.position',
        string='Default Fiscal Position',
        check_company=True,
        help="Default fiscal position for tax mapping"
    )

    # Inventory
    # Inventory
    return_location_ids = fields.Many2many(
        'stock.location',
        'sales_rep_return_location_rel',
        'rep_id',
        'location_id',
        string='Return Stock Locations',
        domain="[('usage', '=', 'internal')]",
        check_company=True,
        help="Locations from which products are returned"
    )

    return_location_id = fields.Many2one(
        'stock.location',
        string='Return Stock Location',
        compute='_compute_return_location_id',
        help="Location from which products are returned"
    )

    @api.depends('return_location_ids')
    def _compute_return_location_id(self):
        for record in self:
            record.return_location_id = record.return_location_ids[0] if record.return_location_ids else False

    # Products
    available_pricelist_ids = fields.Many2many(
        'product.pricelist',
        string='Pricelists',
        help="Pricelists available for this rep"
    )
    product_category_ids = fields.Many2many(
        'product.category',
        string='Product Categories',
        help="Limit products to these categories. Leave empty for all."
    )
    discount_product_id = fields.Many2one(
        'product.product',
        string='Discount Product',
        domain="[('type', '=', 'service')]",
        help="The service product used for fixed discounts in sales orders."
    )

    # Payment Methods
    payment_method_ids = fields.Many2many(
        'sales.rep.payment.method',
        string='Payment Methods',
        check_company=True,
        help="payment methods"
    )
    available_payment_term_ids = fields.Many2many(
        'account.payment.term',
        string='Payment Terms',
        help="Payment terms available for this rep"
    )


    # Settings
    # auto_confirm_order = fields.Boolean(
    #     string='Auto Confirm Orders',
    #     default=True
    # )
    # auto_create_invoice = fields.Boolean(
    #     string='Auto Create Invoice',
    #     default=True
    # )
    # auto_register_payment = fields.Boolean(
    #     string='Auto Register Payment',
    #     default=True
    # )
    # allow_partial_payment = fields.Boolean(
    #     string='Allow Partial Payment',
    #     default=False
    # )
    auto_delivery = fields.Boolean(
        string='Auto Delivery',
        default=False,
        help='Automatically process delivery and create invoice when confirming sales orders'
    )
    auto_receive = fields.Boolean(
        string='Auto Receive',
        default=False,
        help='Automatically validate return deliveries for this sales representative.'
    )

    # --- Mobile Access Rights ---
    access_cash_balance = fields.Boolean(
        string='Cash Balance',
        default=False,
        help='Allow this sales rep to view their cash balance in the mobile app.'
    )
    access_storage = fields.Boolean(
        string='Storage Page',
        default=False,
        help='Allow this sales rep to access the Storage page in the mobile app.'
    )
    access_returns = fields.Boolean(
        string='Returns',
        default=False,
        help='Allow this sales rep to process returns in the mobile app.'
    )
    access_delivery = fields.Boolean(
        string='Delivery',
        default=False,
        help='Allow this sales rep to process deliveries in the mobile app.'
    )
    access_payment = fields.Boolean(
        string='Register Payment',
        default=False,
        help='Allow this sales rep to register payments in the mobile app.'
    )
    access_confirm_quotation = fields.Boolean(
        string='Confirm Quotation',
        default=False,
        help='Allow this sales rep to confirm quotations in the mobile app.'
    )
    access_cancel_quotation = fields.Boolean(
        string='Cancel Quotation',
        default=False,
        help='Allow this sales rep to cancel quotations in the mobile app.'
    )
    access_discount = fields.Boolean(
        string='Set Discount',
        default=False,
        help='Allow this sales rep to set discounts on quotation lines in the mobile app.'
    )
    access_inventory_adjustment = fields.Boolean(
        string='Inventory Adjustment',
        default=False,
        help='Allow this sales rep to access the Inventory Adjustment page in the mobile app.'
    )
    access_sales_report = fields.Boolean(
        string='Sales Report',
        default=False,
        help='Allow this sales rep to view the Sales Report in the mobile app.'
    )
    access_customer_debt_report = fields.Boolean(
        string='Customer Debt Report',
        default=False,
        help='Allow this sales rep to view the Customer Debt Report (total amount due) in the mobile app.'
    )
    access_collection_report = fields.Boolean(
        string='Collection Report',
        default=False,
        help='Allow this sales rep to view the Collection Report in the mobile app.'
    )
    access_journal_report = fields.Boolean(
        string='Journal Transaction Report',
        default=False,
        help='Allow this sales rep to view the Journal Transaction Report (Cash type journal) in the mobile app.'
    )
    access_requests = fields.Boolean(
        string='Stock Request',
        default=False,
        help='Allow this sales rep to access the Stock Requests page in the mobile app.'
    )
    access_visit_order = fields.Boolean(
        string='Order',
        default=True,
        help='Allow this sales rep to create orders during a visit in the mobile app.'
    )
    access_visit_payment = fields.Boolean(
        string='Payment',
        default=True,
        help='Allow this sales rep to collect payments during a visit in the mobile app.'
    )
    access_create_customer = fields.Boolean(
        string='Create Customer',
        default=True,
        help='Allow this sales rep to create new customers in the mobile app.'
    )
    access_general_return = fields.Boolean(
        string='General Return',
        default=False,
        help='Allow this sales rep to access the General Return page in the mobile app.'
    )
    access_mock_location = fields.Boolean(
        string='Mock Location',
        default=False,
        help='If checked, it will check/report mock location used by the rep'
    )
    access_force_logout_on_mock_location = fields.Boolean(
        string='Force Logout on Mock Location',
        default=False,
        help='If checked, it will force logout if mock location is used by the rep'
    )
    access_developer_mode = fields.Boolean(
        string='Developer Mode',
        default=False,
        help='If checked, it will check/report developer mode on the rep device'
    )
    access_force_logout_on_developer_mode = fields.Boolean(
        string='Force Logout on Developer Mode',
        default=False,
        help='If checked, it will force logout if developer mode is enabled'
    )

    default_location_ids = fields.Many2many(
        'stock.location',
        'sales_rep_default_location_rel',
        'rep_id',
        'location_id',
        string='Default Stock Locations',
        domain=[('usage', '=', 'internal')],
        help='Locations used as source for every delivery created from a route of this rep.'
    )

    default_location_id = fields.Many2one(
        'stock.location',
        string='Default Stock Location',
        compute='_compute_default_location_id',
        help='Primary default location used as source for every delivery created from a route of this rep.'
    )

    @api.depends('default_location_ids')
    def _compute_default_location_id(self):
        for record in self:
            record.default_location_id = record.default_location_ids[0] if record.default_location_ids else False

    location_request_ids = fields.Many2many(
        'stock.location',
        'sales_rep_request_location_rel',
        'rep_id',
        'location_id',
        string='Request Source Locations',
        domain=[('usage', '=', 'internal')],
        help='The source locations to which the sales rep will send stock requests.'
    )

    location_request_id = fields.Many2one(
        'stock.location',
        string='Request Source Location',
        compute='_compute_location_request_id',
        help='Primary request source location to which the sales rep will send stock requests.'
    )

    location_general_return_ids = fields.Many2many(
        'stock.location',
        'sales_rep_general_return_rel',
        'rep_id',
        'location_id',
        string='General Return Locations',
        domain=[('usage', '=', 'internal')],
        help='General source locations to which the sales rep will send stock requests.'
    )

    location_general_return = fields.Many2one(
        'stock.location',
        string='General Return',
        compute='_compute_location_general_return',
        help='Primary general source location to which the sales rep will send stock requests.'
    )
    
    is_customer_return_request_installed = fields.Boolean(
        string="Is Customer Return Request Installed",
        compute="_compute_is_customer_return_request_installed"
    )

    def _compute_is_customer_return_request_installed(self):
        installed = self.env['ir.module.module'].sudo().search_count([
            ('name', '=', 'customer_return_request'),
            ('state', '=', 'installed')
        ]) > 0
        for record in self:
            record.is_customer_return_request_installed = installed
            if not installed and record.access_general_return:
                record.access_general_return = False

    @api.depends('location_general_return_ids')
    def _compute_location_general_return(self):
        for record in self:
            record.location_general_return = record.location_general_return_ids[0] if record.location_general_return_ids else False

    @api.depends('location_request_ids')
    def _compute_location_request_id(self):
        for record in self:
            record.location_request_id = record.location_request_ids[0] if record.location_request_ids else False

    @api.depends('name', 'code')
    def _compute_display_name(self):
        for record in self:
            record.display_name = f"[{record.code}] {record.name}"

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('code', _('New')) == _('New'):
                vals['code'] = self.env['ir.sequence'].next_by_code('sales.representative') or _('New')
            if not vals.get('access_mock_location'):
                vals['access_force_logout_on_mock_location'] = False
            if not vals.get('access_developer_mode'):
                vals['access_force_logout_on_developer_mode'] = False
        ICPSudo = self.env['ir.config_parameter'].sudo()
        deactive_enabled = ICPSudo.get_param('sales_rep_management.hr_contract_deactive', 'False') == 'True'
        if deactive_enabled and 'hr.contract' in self.env:
            for vals in vals_list:
                if vals.get('employee_id') and vals.get('active', True):
                    contracts = self.env['hr.contract'].sudo().search([
                        ('employee_id', '=', vals['employee_id'])
                    ])
                    if contracts:
                        has_active_contract = any(c.state == 'open' for c in contracts)
                        if not has_active_contract:
                            vals['active'] = False
        is_installed = self.env['ir.module.module'].sudo().search_count([
            ('name', '=', 'customer_return_request'),
            ('state', '=', 'installed')
        ]) > 0
        customer_return_enabled = is_installed or ICPSudo.get_param('sales_rep_management.customer_return_request', 'False') == 'True'
        if not customer_return_enabled:
            for vals in vals_list:
                vals['access_returns'] = False
        return super(SalesRepresentative, self).create(vals_list)
 
    def write(self, vals):
        if 'employee_id' in vals or vals.get('active'):
            ICPSudo = self.env['ir.config_parameter'].sudo()
            deactive_enabled = ICPSudo.get_param('sales_rep_management.hr_contract_deactive', 'False') == 'True'
            if deactive_enabled and 'hr.contract' in self.env:
                employee_id = vals.get('employee_id') or self.employee_id.id
                if employee_id:
                    contracts = self.env['hr.contract'].sudo().search([
                        ('employee_id', '=', employee_id)
                    ])
                    if contracts:
                        has_active_contract = any(c.state == 'open' for c in contracts)
                        if not has_active_contract:
                            vals['active'] = False
        if 'access_returns' in vals and vals.get('access_returns'):
            ICPSudo = self.env['ir.config_parameter'].sudo()
            is_installed = self.env['ir.module.module'].sudo().search_count([
                ('name', '=', 'customer_return_request'),
                ('state', '=', 'installed')
            ]) > 0
            customer_return_enabled = is_installed or ICPSudo.get_param('sales_rep_management.customer_return_request', 'False') == 'True'
            if not customer_return_enabled:
                vals['access_returns'] = False

        # Use sudo() to ensure recomputations succeed even if the user loses access during the write
        res = super(SalesRepresentative, self.sudo()).write(vals)
        for record in self:
            vals_to_write = {}
            if not record.access_mock_location and record.access_force_logout_on_mock_location:
                vals_to_write['access_force_logout_on_mock_location'] = False
            if not record.access_developer_mode and record.access_force_logout_on_developer_mode:
                vals_to_write['access_force_logout_on_developer_mode'] = False
            if vals_to_write:
                super(SalesRepresentative, record).write(vals_to_write)
                
        # Fields that should trigger a sync on the mobile app
        sync_trigger_fields = [
            'name',
            'email',
            'phone',
            'monthly_target',
            'auto_delivery',
            'auto_receive',
            'payment_method_ids', 
            'available_pricelist_ids', 
            'available_payment_term_ids',
            'product_category_ids',
            'discount_product_id',
            'invoice_journal_id',
            'default_location_ids',
            'return_location_ids',
            'location_general_return_ids',
            'active',
            'user_id',
            'company_id',
            # Access Rights
            'access_cash_balance',
            'access_storage',
            'access_returns',
            'access_confirm_quotation',
            'access_cancel_quotation',
            'access_discount',
            'access_inventory_adjustment',
            'access_sales_report',
            'access_customer_debt_report',
            'access_collection_report',
            'access_journal_report',
            'access_requests',
            'access_create_customer',
            'access_general_return',
            'access_mock_location',
            'access_developer_mode',
            'access_force_logout_on_mock_location',
            'access_force_logout_on_developer_mode'
        ]
        
        # Handle company reassignment for related routes
        if 'company_id' in vals:
            # Update draft/approved routes to the new company to avoid access errors for the manager
            # and to ensure the mobile app fetches them in the correct company context.
            self.env['sales.rep.route'].sudo().search([
                ('sales_rep_id', 'in', self.ids),
                ('state', 'in', ['draft', 'approved'])
            ]).write({'company_id': vals['company_id']})
        if any(field in vals for field in sync_trigger_fields):
            try:
                from odoo.addons.sales_rep_management.controllers.sse import notify_sales_rep
                for record in self:
                    _logger.info("SSE: Triggering sync for representative %s due to profile update (%s)", record.name, list(vals.keys()))
                    notify_sales_rep(record.id, reason='profile_updated')
            except ImportError:
                pass

        # Force logout and log forced_logout if representative is archived
        if 'active' in vals and not vals.get('active'):
            try:
                from odoo.addons.sales_rep_management.controllers.sse import notify_sales_rep
                for record in self:
                    _logger.info("SSE: Archiving representative %s, triggering force_logout", record.name)
                    notify_sales_rep(record.id, reason='archived', event_type='force_logout')
                    
                    # Find the last session log to check if they are logged in
                    last_log = self.env['sales.representative.session.log'].sudo().search([
                        ('sales_rep_id', '=', record.id),
                        ('session_identifier', '!=', False)
                    ], order='timestamp desc', limit=1)
                    
                    if last_log and last_log.action_type == 'login':
                        # Create forced logout session history record
                        self.env['sales.representative.session.log'].sudo().create({
                            'sales_rep_id': record.id,
                            'action_type': 'forced_logout',
                            'timestamp': fields.Datetime.now(),
                            'device_model': 'System (Archived)',
                            'mac_address': 'System',
                            'session_identifier': last_log.session_identifier,
                        })
            except Exception as e:
                _logger.error("Error triggering force logout on archive: %s", e)

        # Handle access loss after company change
        if 'company_id' in vals and not self.env.su:
            # Check if the records are still accessible to the current user
            accessible_records = self.env['sales.representative'].search([('id', 'in', self.ids)])
            if len(accessible_records) < len(self):
                # At least one record is no longer accessible.
                # We commit the transaction so the change persists before we raise the redirect exception.
                self.env.cr.commit()
                action = self.env.ref('sales_rep_management.action_sales_representative')
                raise RedirectWarning(
                    _("You have changed the company of this representative. Since you no longer have access to this record in your current company context, you will be redirected to the list view."),
                    action.id,
                    _("Return to List View")
                )
        return res

    def _compute_statistics(self):
        for record in self:
            routes = self.env['sales.rep.route'].search([('sales_rep_id', '=', record.id)])
            visits = self.env['sales.rep.visit'].search([('route_id.sales_rep_id', '=', record.id)])
            payments = self.env['account.payment'].search([
                ('visit_id.route_id.sales_rep_id', '=', record.id),
                ('state', 'in', ('posted', 'in_payment'))
            ])

            record.total_routes = len(routes)
            record.total_visits = len(visits)
            record.total_collections = sum(payments.mapped('amount'))

    @api.constrains('supervisor_id')
    def _check_supervisor_hierarchy(self):
         for record in self:
            if record.supervisor_id:
                if record.supervisor_id == record:
                    raise ValidationError(_("A sales representative cannot be their own supervisor."))

                # Check for circular references
                current = record.supervisor_id
                while current:
                    if current == record:
                        raise ValidationError(_("Circular reference detected in supervisor hierarchy."))
                    current = current.supervisor_id

    def action_view_routes(self):
        """View routes for this sales representative"""
        return {
            'type': 'ir.actions.act_window',
            'name': _('Routes - %s') % self.name,
            'res_model': 'sales.rep.route',
            'view_mode': 'list,form',
            'domain': [('sales_rep_id', '=', self.id)],
            'context': {'default_sales_rep_id': self.id}
        }

    def action_view_visits(self):
        """View visits for this sales representative"""
        return {
            'type': 'ir.actions.act_window',
            'name': _('Visits - %s') % self.name,
            'res_model': 'sales.rep.visit',
            'view_mode': 'list,form',
            'domain': [('route_id.sales_rep_id', '=', self.id)],
            'context': {}
        }

    def action_view_collections(self):
        """View payments (collections) for this sales representative"""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Payments - %s') % self.name,
            'res_model': 'account.payment',
            'view_mode': 'list,form',
            'domain': [('sales_rep_id', '=', self.id)],
            'context': {'default_sales_rep_id': self.id}
        }

    def action_view_license_attachment(self):
        """This method calls the view method on the related employee."""
        self.ensure_one()
        if not self.employee_id:
            raise ValidationError(_("No employee is linked to this representative."))
        return self.employee_id.action_view_attachment()



class SalesRepRoute(models.Model):
    _name = 'sales.rep.route'
    _description = 'Sales Representative Route'
    _inherit = ['mail.thread', 'mail.activity.mixin']
    _order = 'date desc, name'

    active = fields.Boolean(
        string='Active',
        default=True,
        tracking=True
    )
    company_id = fields.Many2one(
        "res.company",
        string="Company",
        required=True,
        default=lambda self: self.env.company
    )
    name = fields.Char(
        string='Route Name',
        required=True,
        tracking=True
    )
    code = fields.Char(
        string='Route Code',
        required=True,
        copy=False,
        readonly=True,
        default=lambda self: _('New'),
        index=True
    )
    sales_rep_id = fields.Many2one(
        'sales.representative',
        string='Sales Representative',
        required=True,
        tracking=True,
        check_company=True
    )
    supervisor_id = fields.Many2one(
        'sales.representative',
        string='Supervisor',
        related='sales_rep_id.supervisor_id',
        store=True
    )
    date = fields.Date(
        string='Route Date',
        required=True,
        default=fields.Date.context_today,
        tracking=True
    )
    state = fields.Selection([
        ('draft', 'Draft'),
        ('approved', 'Approved'),
        ('in_progress', 'In Progress'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled')
    ], string='Status', default='draft', tracking=True)

    # Existing fields
    visit_ids = fields.One2many(
        'sales.rep.visit',
        'route_id',
        string='Visits'
    )

    # New fields for customer management
    route_customer_ids = fields.One2many(
        'sales.route.customer',
        'route_id',
        string='Route Customers'
    )

    # Related records fields
    sale_order_ids = fields.One2many(
        'sale.order',
        'route_id',
        string='Sales Orders'
    )

    # pos_order_ids = fields.One2many(
    #     'pos.order',
    #     'route_id',
    #     string='POS Orders'
    # )

    payment_ids = fields.One2many(
        'account.payment',
        'route_id',
        string='Payments'
    )

    # Route Planning
    start_time = fields.Datetime(
        string='Start Time',
        default=fields.Datetime.now
    )
    end_time = fields.Datetime(
        string='End Time'
    )
    planned_visits = fields.Integer(
        string='Planned Visits',
        compute='_compute_visit_stats'
    )
    completed_visits = fields.Integer(
        string='Completed Visits',
        compute='_compute_visit_stats'
    )
    completed_visits_today = fields.Integer(
        string='Visits today',
        compute='_compute_completed_visits_today'
    )
    completion_rate = fields.Float(
        string='Completion Rate (%)',
        compute='_compute_visit_stats'
    )

    # Targets
    sales_target = fields.Float(
        string='Sales Target'
    )
    collection_target = fields.Float(
        string='Collection Target'
    )

    # Actuals
    actual_sales = fields.Float(
        string='Actual Sales',
        compute='_compute_actuals'
    )
    actual_collections = fields.Float(
        string='Actual Collections',
        compute='_compute_actuals'
    )

    notes = fields.Text(
        string='Notes'
    )

    # for recurrence
    is_recurrent = fields.Boolean(
        string='Recurrent',
        default=False,
        help="Check this box to make the route recurrent."
    )
    repeat_interval = fields.Integer(
        string='Repeat Every',
        default=1,
        help="Number of time units to repeat the route."
    )
    repeat_unit = fields.Selection([
        ('day', 'Days'),
        ('week', 'Weeks'),
        ('month', 'Months'),
        ('year', 'Years'),
    ], string='Repeat Unit', default='day', help="Unit of time for recurrence.")
    end_condition = fields.Selection([
        ('forever', 'Forever'),
        ('until', 'Until'),
    ], string='End Condition', default='forever', help="Specify if recurrence ends.")
    show_recurrent_hours = fields.Boolean(
        string='Show Hours Grid',
        default=False
    )
    reccurent_hour = fields.Selection([
        (str(float(h)), f"{h if 1 <= h <= 12 else (h-12 if h > 12 else 12)} {'AM' if h < 12 else 'PM'}")
        for h in range(24)
    ], string='Recurrent Hour', default='8.0', help="Hour at which the route will recur.")
    until_date = fields.Date(
        string='Until Date',
        help="Date until which the route will recur."
    )

    @api.depends('')
    def action_open_google_maps(self):
        self.ensure_one()
        if self.recurrent_hour and self.repeat_unit:
            url = f"https://www.google.com/maps/search/?api=1&query={self.visit_location_lat},{self.visit_location_long}"
            return {
                'type': 'ir.actions.act_url',
                'url': url,
                'target': 'new',
            }
        return False


    def _create_recurrent_routes(self):
        today = fields.Date.today()
        # Find all routes that are recurrent and active
        recurrent_routes = self.search([
            ('is_recurrent', '=', True),
            '|',
            ('end_condition', '=', 'forever'),
            ('until_date', '>=', today)
        ])

        for route in recurrent_routes:
            try:
                last_date = route.date
                if route.repeat_unit == 'day':
                    delta = relativedelta(days=route.repeat_interval)
                elif route.repeat_unit == 'week':
                    delta = relativedelta(weeks=route.repeat_interval)
                elif route.repeat_unit == 'month':
                    delta = relativedelta(months=route.repeat_interval)
                elif route.repeat_unit == 'year':
                    delta = relativedelta(years=route.repeat_interval)
                else:
                    continue

                next_date = last_date
                # Find the next occurrence that is on or after today
                while next_date < today:
                    next_date += delta

                # If the next date is past the 'until_date', stop recurrence
                if route.end_condition == 'until' and next_date > route.until_date:
                    route.write({'is_recurrent': False})
                    continue

                # Check if a route for this rep on this date already exists
                existing = self.search([
                    ('id', '!=', route.id),
                    ('sales_rep_id', '=', route.sales_rep_id.id),
                    ('date', '=', next_date)
                ], limit=1)
                if existing:
                    continue

                route.route_customer_ids.write({
                    'state': 'planned',
                    'visit_start_time': False,
                    'visit_end_time': False,
                    'visit_notes': False,
                    'visit_result': False,
                    'visit_id': False,
                })

                # Calculate start_time from reccurent_hour (Selection value is a string float)
                tz_name = route.sales_rep_id.user_id.tz or self.env.user.tz or 'UTC'
                user_tz = pytz.timezone(tz_name)
                
                # Convert selection string to float
                float_hour = float(route.reccurent_hour or 0.0)
                hour = int(float_hour)
                minute = int(round((float_hour - hour) * 60))
                
                # Combine date and time in user's timezone, then convert to UTC
                local_dt = user_tz.localize(datetime.combine(next_date, time(hour, minute)))
                utc_dt = local_dt.astimezone(pytz.UTC).replace(tzinfo=None)

                # Update the main route record for the new day
                route.write({
                    'date': next_date,
                    'state': 'in_progress',
                    'start_time': utc_dt,
                    'end_time': False,
                })
            except Exception as e:
                _logger.error("Failed to create recurrent route for route %s: %s", route.name, str(e))
                continue
        return True

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get('code', _('New')) == _('New'):
                vals['code'] = self.env['ir.sequence'].next_by_code('sales.rep.route') or _('New')
        res = super().create(vals_list)
        
        # SSE Notification: Notify new representative (Post-Commit)
        try:
            from odoo.addons.sales_rep_management.controllers.sse import notify_sales_rep
            for route in res:
                if route.sales_rep_id:
                    rep_id = route.sales_rep_id.id
                    rep_name = route.sales_rep_id.name
                    _logger.debug("SSE: Registering post-commit notify for NEW representative %s", rep_name)
                    self.env.cr.postcommit.add(lambda: notify_sales_rep(rep_id, reason='route_created'))
        except Exception as e:
            _logger.warning("SSE: Failed to register notification for route creation: %s", e)
            
        return res

    def write(self, vals):
        # Capture affected representatives BEFORE the update
        reps_to_notify = set()
        for route in self:
            if route.sales_rep_id:
                reps_to_notify.add(route.sales_rep_id.id)
        
        res = super().write(vals)
        
        # Capture affected representatives AFTER the update (to catch new assignments)
        for route in self:
            if route.sales_rep_id:
                reps_to_notify.add(route.sales_rep_id.id)
        
        # SSE Notification: Notify everyone who was or is assigned to these routes (Post-Commit)
        if reps_to_notify:
            try:
                from odoo.addons.sales_rep_management.controllers.sse import notify_sales_rep
                def notify_reps():
                    for rep_id in reps_to_notify:
                        _logger.info("SSE: Triggering sync for representative ID %s due to route update", rep_id)
                        notify_sales_rep(rep_id, reason='route_updated')
                
                self.env.cr.postcommit.add(notify_reps)
            except Exception as e:
                _logger.warning("SSE: Failed to register notification for route update: %s", e)
            
        return res

    def unlink(self):
        # Capture affected representatives BEFORE deletion
        reps_to_notify = set()
        for route in self:
            if route.sales_rep_id:
                reps_to_notify.add(route.sales_rep_id.id)
                
        # Notify POST-COMMIT
        if reps_to_notify:
            try:
                from odoo.addons.sales_rep_management.controllers.sse import notify_sales_rep
                def notify_reps_deletion():
                    for rep_id in reps_to_notify:
                        _logger.info("SSE: Triggering sync for representative ID %s after route deletion", rep_id)
                        notify_sales_rep(rep_id, reason='route_deleted')
                
                self.env.cr.postcommit.add(notify_reps_deletion)
            except Exception as e:
                _logger.warning("SSE: Failed to register notification for route deletion: %s", e)
            
        return super().unlink()

    @api.constrains('company_id', 'sales_rep_id')
    def _check_sales_rep_company(self):
        for route in self:
            if route.company_id and route.sales_rep_id and route.sales_rep_id.company_id:
                if route.company_id != route.sales_rep_id.company_id:
                    raise ValidationError(_("This representative is not present at the selected company."))

    @api.depends('visit_ids.state', 'date')
    def _compute_visit_stats(self):
        for route in self:
            visits = route.visit_ids.sudo()
            planned_count = len(visits)
            completed_count = len(visits.filtered(lambda v: v.state == 'completed'))
            
            route.planned_visits = planned_count
            route.completed_visits = completed_count
            route.completion_rate = (completed_count / planned_count) if planned_count else 0.0

    @api.depends('visit_ids.state', 'visit_ids.visit_time')
    def _compute_completed_visits_today(self):
        for route in self:
            today_local = fields.Date.context_today(route)
            visits = route.visit_ids.sudo()
            completed_count = len(visits.filtered(
                lambda v: v.state == 'completed' and v.visit_time and fields.Date.context_today(v, v.visit_time) == today_local
            ))
            route.completed_visits_today = completed_count

    @api.depends('sale_order_ids.amount_total', 'sale_order_ids.date_order', 'payment_ids.amount', 'payment_ids.date', 'date')
    def _compute_actuals(self):
        for route in self:
            # For recurrent routes, we only want to count orders/payments from the current route date
            route_date = route.date
            
            if route_date:
                # Timezone-aware date comparison for sale order datetimes
                orders = route.sale_order_ids.filtered(
                    lambda r: r.date_order and fields.Date.context_today(r, r.date_order) == route_date
                )
                payments = route.payment_ids.filtered(
                    lambda r: r.date and r.date == route_date
                )
            else:
                orders = route.sale_order_ids
                payments = route.payment_ids
            
            route.actual_sales = sum(orders.mapped('amount_total'))
            route.actual_collections = sum(payments.mapped('amount'))

    def action_approve(self):
        self.state = 'approved'
        return True

    def action_start(self):
        self.state = 'in_progress'
        self.start_time = fields.Datetime.now()
        return True

    def action_complete(self):
        self.state = 'completed'
        self.end_time = fields.Datetime.now()
        return True

    def action_cancel(self):
        self.state = 'cancelled'
        return True

    def action_reset_to_draft(self):
        self.state = 'draft'
        return True

    def action_view_visits(self):
        return {
            'type': 'ir.actions.act_window',
            'name': _('Visits - %s') % self.name,
            'res_model': 'sales.rep.visit',
            'view_mode': 'list,form',
            'domain': [('route_id', '=', self.id)],
            'context': {'default_route_id': self.id}
        }

    def action_view_collections(self):
        """View payments (collections) for this route"""
        return {
            'type': 'ir.actions.act_window',
            'name': _('Payments - %s') % self.name,
            'res_model': 'account.payment',
            'view_mode': 'list,form',
            'domain': [('route_id', '=', self.id)],
            'context': {'default_route_id': self.id}
        }

    def action_add_customer(self):
        return {
            'type': 'ir.actions.act_window',
            'name': _('Add Customer to Route'),
            'res_model': 'sales.route.customer',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_route_id': self.id,
                'default_sales_rep_id': self.sales_rep_id.id
            }
        }


class SalesRouteCustomer(models.Model):
    _name = 'sales.route.customer'
    _description = 'Route Customer'
    _order = 'sequence, id'

    route_id = fields.Many2one(
        'sales.rep.route',
        string='Route',
        required=True,
        ondelete='cascade',
        check_company=True
    )
    sales_rep_id = fields.Many2one(
        'sales.representative',
        string='Sales Representative',
        related='route_id.sales_rep_id',
        store=True
    )
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        related='route_id.company_id',
        store=True,
        index=True,
        check_company=True,
        default=lambda self: self.env.company
    )
    partner_id = fields.Many2one(
        'res.partner',
        string='Customer',
        required=True,
        # domain=[('customer_rank', '>', 0)]
    )
    sequence = fields.Integer(
        string='Sequence',
        default=10
    )
    state = fields.Selection([
        ('planned', 'Planned'),
        ('in_progress', 'Visit In Progress'),
        ('visited', 'Visited'),
        ('cancelled', 'Cancelled')
    ], string='Status', default='planned')

    # Visit information
    visit_type_id = fields.Many2one(
        'sales.rep.visit.types',
        string='Visit Type'
    )
    visit_start_time = fields.Datetime(string='Visit Start Time')
    visit_end_time = fields.Datetime(string='Visit End Time')
    visit_duration = fields.Char(string='Visit Duration', compute='_compute_visit_duration')
    visit_notes = fields.Text(string='Visit Notes')
    visit_result = fields.Selection([
        ('successful', 'Successful'),
        ('customer_unavailable', 'Customer Unavailable'),
        ('refused', 'Refused'),
        ('closed', 'Location Closed'),
        ('rescheduled', 'Rescheduled')
    ], string='Visit Result')

    # Related records
    visit_id = fields.Many2one('sales.rep.visit', string='Related Visit')
    
    # Location tracking
    visit_location_lat = fields.Char(string='Visit Latitude')
    visit_location_long = fields.Char(string='Visit Longitude')

    sale_order_ids = fields.One2many('sale.order', 'route_customer_id', string='Sales Orders')
    # pos_order_ids = fields.One2many('pos.order', 'route_customer_id', string='POS Orders')
    payment_ids = fields.One2many('account.payment', 'route_customer_id', string='Payments')


    @api.depends('visit_start_time', 'visit_end_time')
    def _compute_visit_duration(self):
        for record in self:
            if record.visit_start_time and record.visit_end_time:
                start = record.visit_start_time
                end = record.visit_end_time
                diff = end - start
                seconds = int(diff.total_seconds())
                hours, remainder = divmod(seconds, 3600)
                minutes, seconds = divmod(remainder, 60)
                record.visit_duration = f"{hours:02}:{minutes:02}:{seconds:02}"
            else:
                record.visit_duration = "00:00:00"

    def action_start_visit(self):
        """Start visit - create visit record and update state without redirecting"""
        self.ensure_one()
        self.state = 'in_progress'
        self.visit_start_time = fields.Datetime.now()

        # Create a new visit record
        visit = self.env['sales.rep.visit'].create({
            'name': self.env['ir.sequence'].next_by_code('sales.rep.visit') or _('New'),
            'route_id': self.route_id.id,
            'partner_id': self.partner_id.id,
            'route_customer_id': self.id,  # LINK TO ROUTE CUSTOMER
            'planned_time': fields.Datetime.now(),
            'visit_type': 'sales',
            'state': 'in_progress'
        })
        self.visit_id = visit.id

        # Return True to stay on the same page and refresh the view
        return True

    def action_end_visit(self):
        """End visit - open visit result wizard"""
        self.ensure_one()
        self.visit_end_time = fields.Datetime.now()

        # Open visit result wizard
        return {
            'type': 'ir.actions.act_window',
            'name': _('Complete Visit'),
            'res_model': 'visit.result.wizard',
            'view_mode': 'form',
            'target': 'new',
            'context': {
                'default_route_customer_id': self.id,
                'default_visit_id': self.visit_id.id
            }
        }

    def action_create_sale_order(self):
        """Create sales order and link to visit"""
        self.ensure_one()

        # Check if we have a visit record from starting the visit
        if not self.visit_id:
            raise ValidationError(_("Please start the visit first before creating a sales order."))

        # Create the sale order and link it to the visit and route customer
        sale_order = self.env['sale.order'].create({
            'partner_id': self.partner_id.id,
            'route_id': self.route_id.id,
            'route_customer_id': self.id,
            'visit_id': self.visit_id.id,
            'origin': f"Route: {self.route_id.name} - Visit: {self.visit_id.name}",
            'date_order': fields.Datetime.now(),
        })

        # Link the sale order and complete the visit automatically
        self.visit_id.write({
            'state': 'completed',
            'visit_result': 'successful',
            'visit_time': fields.Datetime.now(),
            'sale_order_id': sale_order.id,
            'sale_amount': sale_order.amount_total
        })

        # Update route customer state
        self.state = 'visited'
        self.visit_end_time = fields.Datetime.now()

        return {
            'type': 'ir.actions.act_window',
            'name': _('Sales Order'),
            'res_model': 'sale.order',
            'res_id': sale_order.id,
            'view_mode': 'form',
            'target': 'current',
        }

    @api.model_create_multi
    def create(self, vals_list):
        res = super().create(vals_list)
        # Notify representative of the route
        try:
            from odoo.addons.sales_rep_management.controllers.sse import notify_sales_rep
            for record in res:
                if record.route_id.sales_rep_id:
                    notify_sales_rep(record.route_id.sales_rep_id.id, reason='customer_added_to_route')
        except Exception:
            pass
        return res

    def write(self, vals):
        # Capture affected representatives
        reps_to_notify = set()
        for record in self:
            if record.route_id.sales_rep_id:
                reps_to_notify.add(record.route_id.sales_rep_id.id)
                
        res = super().write(vals)
        
        # Notify after update
        for record in self:
            if record.route_id.sales_rep_id:
                reps_to_notify.add(record.route_id.sales_rep_id.id)
                
        if reps_to_notify:
            try:
                from odoo.addons.sales_rep_management.controllers.sse import notify_sales_rep
                for rep_id in reps_to_notify:
                    notify_sales_rep(rep_id, reason='customer_route_updated')
            except Exception:
                pass
        return res

    def unlink(self):
        # Capture affected representatives BEFORE deletion
        reps_to_notify = set()
        for record in self:
            # Use sudo() to ensure we can read the sales_rep_id even during deletion
            if record.sudo().route_id.sales_rep_id:
                reps_to_notify.add(record.route_id.sales_rep_id.id)
                
        res = super().unlink()

        if reps_to_notify:
            try:
                from odoo.addons.sales_rep_management.controllers.sse import notify_sales_rep
                for rep_id in reps_to_notify:
                    notify_sales_rep(rep_id, reason='customer_removed_from_route')
            except Exception:
                pass
        return res

    # def action_create_pos_order(self):
    #     """Open POS interface and handle order completion"""
    #     self.ensure_one()

    #     # Check if we have a visit record from starting the visit
    #     if not self.visit_id:
    #         raise ValidationError(_("Please start the visit first before creating a POS order."))

    #     # Find an open POS session for current user
    #     # pos_session = self.env['pos.session'].search([
    #     #     ('state', '=', 'opened'),
    #     #     ('user_id', '=', self.env.user.id)
    #     # ], limit=1)

    #     if not pos_session:
    #         # Create a new POS session if none exists
    #         config = self.env['pos.config'].search([], limit=1)
    #         if not config:
    #             raise ValidationError(_("No POS configuration found. Please set up POS first."))

    #         pos_session = self.env['pos.session'].create({
    #             'config_id': config.id,
    #             'user_id': self.env.user.id,
    #         })
    #         pos_session.action_pos_session_open()

    #     # Store the visit and route customer information in the session for later linking
    #     pos_session.write({
    #         'current_route_customer_id': self.id,
    #         'current_visit_id': self.visit_id.id,
    #         'current_route_id': self.route_id.id,
    #     })

    #     # Open POS interface with the customer pre-selected
    #     return {
    #         'type': 'ir.actions.act_url',
    #         'url': f'/pos/ui?session_id={pos_session.id}',
    #         'target': 'self',
    #     }

    def action_create_payment(self):
        """Create customer payment and link to visit"""
        self.ensure_one()

        # Check if we have a visit record from starting the visit
        if not self.visit_id:
            raise ValidationError(_("Please start the visit first before creating a payment."))

        # Create payment record and link it to visit and route customer
        payment = self.env['account.payment'].create({
            'payment_type': 'inbound',
            'partner_type': 'customer',
            'partner_id': self.partner_id.id,
            'amount': 1.0,  # Set default amount to 1.0 to avoid validation error
            'route_id': self.route_id.id,
            'route_customer_id': self.id,
            'visit_id': self.visit_id.id,
            'date': fields.Date.today(),
            'journal_id': self._get_default_journal().id,
        })

        # Create a collection record linked to the visit with the same amount
        # collection = self.env['sales.rep.collection'].create({
        #     'name': self.env['ir.sequence'].next_by_code('sales.rep.collection') or _('New'),
        #     'visit_id': self.visit_id.id,
        #     'collection_date': fields.Datetime.now(),
        #     'amount': 1.0,  # Set default amount to 1.0
        #     'payment_method': 'cash',
        #     'state': 'draft'
        # })

        # Complete the visit automatically when payment is saved
        self.visit_id.write({
            'state': 'completed',
            'visit_result': 'successful',
            'visit_time': fields.Datetime.now(),
        })

        # Update route customer state
        self.state = 'visited'
        self.visit_end_time = fields.Datetime.now()

        return {
            'type': 'ir.actions.act_window',
            'name': _('Customer Payment'),
            'res_model': 'account.payment',
            'res_id': payment.id,
            'view_mode': 'form',
            'target': 'current',
        }

    def _get_default_journal(self):
        """Get default journal for payments"""
        journal = self.env['account.journal'].search([
            ('type', 'in', ['bank', 'cash']),
            ('company_id', '=', self.env.company.id)
        ], limit=1)

        if not journal:
            # Fallback to any journal
            journal = self.env['account.journal'].search([
                ('company_id', '=', self.env.company.id)
            ], limit=1)

        return journal

    def action_view_related_orders(self):
        """View related orders for this route customer"""
        self.ensure_one()
        return {
            'type': 'ir.actions.act_window',
            'name': _('Related Orders'),
            'res_model': 'sale.order',
            'view_mode': 'list,form',
            'domain': [('route_customer_id', '=', self.id)],
            'context': {'create': False}
        }