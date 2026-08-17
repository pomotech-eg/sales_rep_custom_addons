import logging
from odoo import models, fields, api

_logger = logging.getLogger(__name__)

class HrEmployee(models.Model):
    _inherit = 'hr.employee'

    work_email = fields.Char(string='Work Email', required=True)
    
    _sql_constraints = [
        ('work_email_unique', 'unique(work_email)', 'Work Email must be unique!')
    ]

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if not vals.get('work_email'):
                email = False
                if vals.get('user_id'):
                    user = self.env['res.users'].browse(vals['user_id'])
                    email = user.login
                
                # Check if it's a valid-looking email, otherwise fallback
                if not email or '@' not in str(email):
                    name_slug = vals.get('name', 'employee').lower().replace(' ', '_')
                    name_slug = ''.join(c for c in name_slug if c.isalnum() or c == '_')
                    import random
                    email = f"{name_slug}"
                
                # Make sure the email is unique
                while self.search_count([('work_email', '=ilike', email)]):
                    import random
                    email = f"{email.split('@')[0]}_{random.randint(1000, 9999)}@{email.split('@')[1]}"
                
                vals['work_email'] = email
        return super().create(vals_list)

    @api.constrains('work_email')
    def _check_work_email_unique(self):
        for employee in self:
            if employee.work_email:
                domain = [
                    ('work_email', '=ilike', employee.work_email),
                    ('id', '!=', employee.id)
                ]
                if self.search_count(domain):
                    raise models.ValidationError("The work email '%s' is already in use by another employee." % employee.work_email)
