# -*- coding: utf-8 -*-
from odoo import models, fields


class SalesRepSecurityAlert(models.Model):
    _name = 'sales.rep.security.alert'
    _description = 'Sales Rep Security Alert'
    _order = 'detected_at desc'

    active = fields.Boolean(default=True, help='Uncheck to dismiss this alert from the dashboard.')
    sales_rep_id = fields.Many2one(
        'sales.representative',
        string='Sales Representative',
        required=True,
        ondelete='cascade',
        index=True,
    )
    detected_at = fields.Datetime(
        string='Detected At',
        required=True,
        default=fields.Datetime.now,
        index=True,
    )
    latitude = fields.Float(string='Latitude', digits=(10, 6))
    longitude = fields.Float(string='Longitude', digits=(10, 6))
    accuracy = fields.Float(string='Accuracy (m)')
    device_identifier = fields.Char(string='Device Identifier')
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        related='sales_rep_id.company_id',
        store=True,
        index=True,
    )
    alert_type = fields.Selection(
        string='Alert Type',
        selection=[
            ('mock_location', 'Mock Location'),
            ('developer_mode', 'Developer Mode'),
            ('unknown', 'Unknown'),
        ],
        required=True,
        index=True,
    )

    def action_dismiss(self):
        self.write({'active': False})
