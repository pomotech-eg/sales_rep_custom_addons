# -*- coding: utf-8 -*-
from odoo import http, fields, _
from odoo.http import request
import json
import logging
import base64
import traceback
from datetime import datetime, timedelta
from psycopg2 import IntegrityError
from .utils import SalesRepUtils

_logger = logging.getLogger(__name__)

class SyncController(http.Controller, SalesRepUtils):

    def _make_cors_response(self, data, status=200):
        return request.make_response(json.dumps(data, default=str), headers={
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, access_token, Access-Token, X-Requested-With',
        }, status=status)

    @http.route('/api/mobile/sync', type='http', auth='public', methods=['POST', 'OPTIONS'], csrf=False)
    def sync_data(self, **kwargs):
        if request.httprequest.method == 'OPTIONS':
            return request.make_response('', headers={
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization, access_token, Access-Token, X-Requested-With',
                'Access-Control-Max-Age': '86400',
            })
        try:
            # 0. Auth Check
            sales_rep, user = self._authenticate_request()
            if not sales_rep:
                return self._make_cors_response({'success': False, 'message': 'Unauthorized'}, status=401)

            # Use a context to skip self-notifications during processing
            context = dict(request.env.context or {}, skip_notify_sales_rep_id=sales_rep.id)
            request.env = request.env(context=context)

            # 1. Parse Input
            data = json.loads(request.httprequest.data)
            last_sync_date = data.get('last_sync_date')
            upload_data = data.get('upload_data', {})
            
            _logger.info(f"Sync: Request from {sales_rep.name} (ID: {sales_rep.id}). Last Sync: {last_sync_date}")
            
            response_data = {
                'success': True,
                'server_time': fields.Datetime.now(),
                'upload_ack': {},
                'downloads': {}
            }

            # 2. Pre-process: Create customers BEFORE uploading orders
            # This ensures offline-created partners exist in Odoo before orders referencing them are created.
            pending_actions = upload_data.get('pending_actions', []) if upload_data else []
            partner_id_map = {}  # Maps partner_local_id -> odoo partner_id
            
            # Extract and process create_customer actions first
            create_customer_actions = [a for a in pending_actions if a.get('action_type') == 'create_customer']
            remaining_actions = [a for a in pending_actions if a.get('action_type') != 'create_customer']
            
            pre_action_ack = {}
            if create_customer_actions:
                _logger.info(f"Sync: Pre-processing {len(create_customer_actions)} create_customer actions before order uploads")
                pre_action_ack = self._process_pending_actions(create_customer_actions, user, sales_rep, {})
                
                # Build partner_local_id -> odoo_id map from the results
                for action_data in create_customer_actions:
                    local_id = action_data.get('local_id', '')
                    ack_entry = pre_action_ack.get(local_id, {})
                    if ack_entry.get('success') and ack_entry.get('result', {}).get('partner_odoo_id'):
                        payload = action_data.get('payload', {})
                        customer_local_id = payload.get('customer_data', {}).get('local_id')
                        if customer_local_id:
                            partner_id_map[customer_local_id] = ack_entry['result']['partner_odoo_id']
                            _logger.info(f"Sync: Mapped partner_local_id {customer_local_id} -> Odoo ID {ack_entry['result']['partner_odoo_id']}")

            # 3. Process Uploads (Upstream) - with partner resolution map
            if upload_data:
                response_data['upload_ack'] = self._process_uploads(sales_rep, upload_data, user, partner_id_map)

            # 4. Process Remaining Pending Actions (everything except create_customer)
            if remaining_actions:
                remaining_ack = self._process_pending_actions(remaining_actions, user, sales_rep, response_data.get('upload_ack'))
                # Merge all action acks
                pre_action_ack.update(remaining_ack)
            
            if pre_action_ack:
                response_data['action_ack'] = pre_action_ack
                # IMPORTANT: Invalidate cache after actions that modify records to ensure 
                # downloads phase (like _process_downloads) fetches freshly recomputed fields.
                request.env.invalidate_all()

            # 5. Notify SSE clients so connected devices sync
            if upload_data or pending_actions:
                from .sse import notify_sales_rep
                notify_sales_rep(sales_rep.id, 'data_changed', skip_sales_rep_id=sales_rep.id)

            # 6. Process Downloads (Downstream) - As specific user
            response_data['downloads'] = self._process_downloads(sales_rep, last_sync_date, user)

            return self._make_cors_response(response_data)

        except Exception as e:
            error_msg = str(e)
            stack_trace = traceback.format_exc()
            _logger.error(f"Error in sync_data: {error_msg}\n{stack_trace}")
            return self._make_cors_response({
                'success': False, 
                'error': error_msg,
                'traceback': stack_trace
            }, status=500)

    @http.route('/api/mobile/report/sales', type='http', auth='public', methods=['POST'], cors='*', csrf=False)
    def get_sales_report(self, **kw):
        """
        Get sales report data for the mobile application.
        """
        try:
            sales_rep, user = self._authenticate_request()
            if not sales_rep:
                return request.make_response(json.dumps({'success': False, 'message': 'Unauthorized'}), headers={'Content-Type': 'application/json'}, status=401)
            
            if not sales_rep.access_sales_report:
                return request.make_response(json.dumps({'success': False, 'message': 'Access Denied: Sales Report'}), headers={'Content-Type': 'application/json'}, status=403)

            data = json.loads(request.httprequest.data)
            params = data.get('params', {})
            date_from = params.get('date_from')
            date_to = params.get('date_to')
            
            if not date_from or not date_to:
                return request.make_response(json.dumps({'success': False, 'message': 'Missing date parameters'}), headers={'Content-Type': 'application/json'}, status=400)

            date_from_dt = fields.Datetime.to_datetime(date_from)
            date_to_dt = fields.Datetime.to_datetime(date_to).replace(hour=23, minute=59, second=59)

            domain = [
                ('date_order', '>=', date_from_dt),
                ('date_order', '<=', date_to_dt),
                ('state', 'in', ['sale', 'done']),
                ('sales_rep_id', '=', sales_rep.id)
            ]
            
            orders = request.env['sale.order'].with_user(user).search(domain, order='date_order desc')
            
            report_data = []
            total_before_all = 0.0
            total_discount_all = 0.0
            total_after_all = 0.0

            for order in orders:
                before = order.amount_total + order.discount_total
                report_data.append({
                    'id': order.id,
                    'name': order.name,
                    'date': order.date_order.strftime('%Y-%m-%d'),
                    'customer': order.partner_id.name,
                    'amount_before': before,
                    'discount': order.discount_total,
                    'amount_after': order.amount_total,
                    'currency_symbol': order.currency_id.symbol,
                })
                total_before_all += before
                total_discount_all += order.discount_total
                total_after_all += order.amount_total

            response_data = {
                'success': True,
                'orders': report_data,
                'summary': {
                    'total_before': total_before_all,
                    'total_discount': total_discount_all,
                    'total_after': total_after_all,
                    'currency_symbol': orders[0].currency_id.symbol if orders else request.env.company.currency_id.symbol,
                }
            }
            return request.make_response(json.dumps(response_data, default=str), headers={'Content-Type': 'application/json'})

        except Exception as e:
            _logger.error(f"Sync: Error in get_sales_report: {str(e)}")
            return request.make_response(json.dumps({'success': False, 'message': str(e)}), headers={'Content-Type': 'application/json'}, status=500)

    @http.route('/api/mobile/report/debt', type='http', auth='public', methods=['POST'], cors='*', csrf=False)
    def get_debt_report(self, **kw):
        """
        Get customer debt report data for the mobile application.
        """
        try:
            sales_rep, user = self._authenticate_request()
            if not sales_rep:
                return request.make_response(json.dumps({'success': False, 'message': 'Unauthorized'}), headers={'Content-Type': 'application/json'}, status=401)
            
            if not sales_rep.access_customer_debt_report:
                return request.make_response(json.dumps({'success': False, 'message': 'Access Denied: Debt Report'}), headers={'Content-Type': 'application/json'}, status=403)

            # Find partners for the rep via routes
            route_customers = request.env['sales.route.customer'].sudo().search([('sales_rep_id', '=', sales_rep.id)])
            partner_ids = route_customers.mapped('partner_id').ids
            
            domain = [
                ('id', 'in', partner_ids),
                ('company_id', 'in', [sales_rep.company_id.id, False])
            ]
            
            # Use search() first to get records, then we can access computed fields
            # We avoid search_read with 'order' on computed fields which causes 500 error
            partner_records = request.env['res.partner'].with_user(user).search(domain)
            
            report_data = []
            total_debt = 0.0
            
            for p in partner_records:
                due = p.total_due
                if due > 0:
                    report_data.append({
                        'id': p.id,
                        'customer': p.name,
                        'amount_due': due,
                        'currency_symbol': p.currency_id.symbol if p.currency_id else request.env.company.currency_id.symbol,
                    })
                    total_debt += due

            # Sort by debt amount descending
            report_data.sort(key=lambda x: x['amount_due'], reverse=True)

            response_data = {
                'success': True,
                'data': report_data,
                'summary': {
                    'total_debt': total_debt,
                    'currency_symbol': request.env.company.currency_id.symbol,
                }
            }
            return request.make_response(json.dumps(response_data, default=str), headers={'Content-Type': 'application/json'})

        except Exception as e:
            _logger.error(f"Sync: Error in get_debt_report: {str(e)}")
            return request.make_response(json.dumps({'success': False, 'message': str(e)}), headers={'Content-Type': 'application/json'}, status=500)

    @http.route('/api/mobile/report/collection', type='http', auth='public', methods=['POST'], cors='*', csrf=False)
    def get_collection_report(self, **kw):
        """
        Get collection report data for the mobile application from account.payment.
        """
        try:
            sales_rep, user = self._authenticate_request()
            if not sales_rep:
                return request.make_response(json.dumps({'success': False, 'message': 'Unauthorized'}), headers={'Content-Type': 'application/json'}, status=401)
            
            if not sales_rep.access_collection_report:
                return request.make_response(json.dumps({'success': False, 'message': 'Access Denied: Collection Report'}), headers={'Content-Type': 'application/json'}, status=403)

            data = json.loads(request.httprequest.data)
            params = data.get('params', {})
            date_from = params.get('date_from')
            date_to = params.get('date_to')
            
            if not date_from or not date_to:
                return request.make_response(json.dumps({'success': False, 'message': 'Missing date parameters'}), headers={'Content-Type': 'application/json'}, status=400)

            # account.payment uses Date fields
            date_from_val = fields.Date.to_date(date_from)
            date_to_val = fields.Date.to_date(date_to)

            domain = [
                ('date', '>=', date_from_val),
                ('date', '<=', date_to_val),
                ('sales_rep_id', '=', sales_rep.id),
                ('state', 'in', ['paid', 'in_process', 'draft', 'partial']),
                ('payment_type', '=', 'inbound')
            ]
            
            payments = request.env['account.payment'].with_user(user).search(domain, order='date desc, id desc')
            
            report_data = []
            total_amount = 0.0

            for pay in payments:
                report_data.append({
                    'id': pay.id,
                    'date': pay.date.strftime('%Y-%m-%d'),
                    'sales_rep': pay.sales_rep_id.name if pay.sales_rep_id else '',
                    'customer': pay.partner_id.name,
                    'payment': pay.amount,
                    'payment_method': pay.journal_id.name,
                    'currency_symbol': pay.currency_id.symbol or request.env.company.currency_id.symbol,
                })
                total_amount += pay.amount

            response_data = {
                'success': True,
                'data': report_data,
                'summary': {
                    'total_payment': total_amount,
                    'currency_symbol': request.env.company.currency_id.symbol,
                }
            }
            return request.make_response(json.dumps(response_data, default=str), headers={'Content-Type': 'application/json'})
        except Exception as e:
            _logger.error(f"Sync: Error in get_collection_report: {str(e)}")
            return request.make_response(json.dumps({'success': False, 'message': str(e)}), headers={'Content-Type': 'application/json'}, status=500)

    @http.route('/api/mobile/report/journal_transaction', type='http', auth='public', methods=['POST'], cors='*', csrf=False)
    def get_journal_transaction_report(self, **kw):
        """
        Get journal transaction report data (Cash Journals) for the mobile application.
        """
        try:
            sales_rep, user = self._authenticate_request()
            if not sales_rep:
                return request.make_response(json.dumps({'success': False, 'message': 'Unauthorized'}), headers={'Content-Type': 'application/json'}, status=401)
            
            data = json.loads(request.httprequest.data)
            params = data.get('params', {})
            date_from = params.get('date_from')
            date_to = params.get('date_to')
            
            if not date_from or not date_to:
                return request.make_response(json.dumps({'success': False, 'message': 'Missing date parameters'}), headers={'Content-Type': 'application/json'}, status=400)

            date_from_val = fields.Date.to_date(date_from)
            date_to_val = fields.Date.to_date(date_to)

            # Get the journals assigned to the sales rep for cash payments
            rep_cash_journals = sales_rep.payment_method_ids.filtered(lambda m: m.payment_type == 'cash').mapped('journal_id')
            
            if not rep_cash_journals:
                return request.make_response(json.dumps({'success': False, 'message': 'No cash journals assigned to this representative'}), headers={'Content-Type': 'application/json'}, status=400)

            # Domain for Cash Journal Moves for the Journals assigned to the Sales Rep
            domain = [
                ('date', '>=', date_from_val),
                ('date', '<=', date_to_val),
                ('journal_id', 'in', rep_cash_journals.ids),
                ('state', '=', 'posted')
            ]
            
            moves = request.env['account.move'].with_user(user).search(domain, order='date desc, id desc')
            
            report_data = []
            total_inbound = 0.0
            total_outbound = 0.0

            for move in moves:
                amount = move.amount_total
                is_outbound = False
                if move.move_type == 'out_receipt' or move.move_type == 'in_invoice':
                    is_outbound = True
                elif move.move_type == 'entry':
                    # Search for linked payment to check type
                    payment = request.env['account.payment'].sudo().search([('move_id', '=', move.id)], limit=1)
                    if payment and payment.payment_type == 'outbound':
                        is_outbound = True
                
                if is_outbound:
                    total_outbound += amount
                else:
                    total_inbound += amount

                report_data.append({
                    'id': move.id,
                    'name': move.name,
                    'date': move.date.strftime('%Y-%m-%d'),
                    'ref': move.ref or '',
                    'partner': move.partner_id.name or '',
                    'amount': amount,
                    'type': 'outbound' if is_outbound else 'inbound',
                    'journal': move.journal_id.name,
                    'currency_symbol': move.currency_id.symbol or request.env.company.currency_id.symbol,
                })

            _logger.info(f"Sync: Journal Report for {sales_rep.name}: Found {len(report_data)} transactions.")
            
            response_data = {
                'success': True,
                'data': report_data,
                'summary': {
                    'total_inbound': total_inbound,
                    'total_outbound': total_outbound,
                    'net_balance': total_inbound - total_outbound,
                    'currency_symbol': request.env.company.currency_id.symbol,
                }
            }
            _logger.debug(f"Sync: Journal Report Response: {json.dumps(response_data, default=str)}")
            return request.make_response(json.dumps(response_data, default=str), headers={'Content-Type': 'application/json'})
        except Exception as e:
            _logger.error(f"Sync: Error in get_journal_transaction_report: {str(e)}")
            return request.make_response(json.dumps({'success': False, 'message': str(e)}), headers={'Content-Type': 'application/json'}, status=500)



    def _process_uploads(self, sales_rep, upload_data, user, partner_id_map=None):
        ack = {
            'visits': {},
            'collections': {}
        }
        
        # Process Visits
        visits = upload_data.get('visits', [])
        for visit_data in visits:
            try:
                with request.env.cr.savepoint():
                    local_id = visit_data.get('local_id')
                    _logger.info(f"Processing visit upload: local_id={local_id}, data={visit_data}")
                    
                    # Check if route_customer exists
                    route_customer = request.env['sales.route.customer'].with_user(user).browse(visit_data.get('route_customer_id'))
                    if not route_customer.exists():
                        _logger.warning(f"Sync Upload: Route customer {visit_data.get('route_customer_id')} not found.")
                        continue

                    # Use sequence for name if available
                    visit_name = request.env['ir.sequence'].with_user(user).next_by_code('sales.rep.visit')
                    if not visit_name:
                        visit_name = f"VISIT-{local_id[-6:]}" if local_id else 'New Visit'

                    # Correct mapping logic for mobile visits
                    mobile_state = visit_data.get('state', 'completed')
                    start_time = visit_data.get('start_time')
                    end_time = visit_data.get('end_time')

                    vals = {
                        'name': visit_name,
                        'sales_rep_id': sales_rep.id,
                        'route_id': route_customer.route_id.id,
                        'route_customer_id': route_customer.id,
                        'partner_id': route_customer.partner_id.id,
                        'visit_type': visit_data.get('visit_type', 'sales'),
                        'state': mobile_state,
                        'visit_result': visit_data.get('visit_result'),
                        'notes': visit_data.get('notes'),
                        'visit_location_lat': visit_data.get('latitude'),
                        'visit_location_long': visit_data.get('longitude'),
                        'planned_time': start_time or fields.Datetime.now(),
                        'visit_time': end_time if mobile_state == 'completed' else (start_time or fields.Datetime.now()),
                        'mobile_local_id': local_id,
                        'follow_up_required': bool(visit_data.get('follow_up_date')),
                        'next_visit_date': visit_data.get('follow_up_date') or False,
                    }
                
                    visit = request.env['sales.rep.visit'].with_user(user).create([vals])[0]
                    ack['visits'][local_id] = visit.id
                
                    # Update route customer state and timing
                    route_customer.write({
                        'state': 'in_progress' if mobile_state == 'in_progress' else 'visited',
                        'visit_id': visit.id,
                        'visit_result': visit.visit_result,
                        'visit_start_time': start_time,
                        'visit_end_time': end_time if mobile_state == 'completed' else False
                    })
                
                    request.env.flush_all()
            except Exception as e:
                _logger.error(f"Failed to sync visit {visit_data.get('local_id')}: {e}")

        # Process Collections -> Now creating account.payment directly
        collections = upload_data.get('collections', [])
        for col_data in collections:
            try:
                with request.env.cr.savepoint():
                    local_id = col_data.get('local_id')
                    visit_local_id = col_data.get('visit_local_id')
                
                    # Deduplication check
                    existing_payment = request.env['account.payment'].sudo().search([('mobile_local_id', '=', local_id)], limit=1)
                    if existing_payment:
                        ack['collections'][local_id] = existing_payment.id
                        continue

                    # Resolve visit_id (Priority: 1. Odoo ID from payload, 2. Local ID from current batch, 3. Lookup by local ID in DB, 4. Fallback route customer visit)
                    visit_id = col_data.get('visit_id')
                    if visit_id and isinstance(visit_id, str):
                        if visit_id.isdigit():
                            visit_id = int(visit_id)
                        else:
                            if not visit_local_id:
                                visit_local_id = visit_id
                            visit_id = False

                    if not visit_id and visit_local_id:
                        visit_id = ack['visits'].get(visit_local_id)
                        if not visit_id:
                            visit = request.env['sales.rep.visit'].sudo().search([('mobile_local_id', '=', visit_local_id)], limit=1)
                            if visit:
                                visit_id = visit.id

                    # Fallback: Resolve via route_customer_id if still missing
                    route_customer_id = col_data.get('route_customer_id')
                    if not visit_id and route_customer_id:
                        rc_id = int(route_customer_id) if isinstance(route_customer_id, int) or (isinstance(route_customer_id, str) and route_customer_id.isdigit()) else False
                        if rc_id:
                            rc = request.env['sales.route.customer'].sudo().browse(rc_id)
                            if rc.exists() and rc.visit_id:
                                visit_id = rc.visit_id.id
                
                    # Resolve partner_id and route info
                    partner_id = col_data.get('partner_id')
                    route_id = col_data.get('route_id')

                    if visit_id:
                        visit = request.env['sales.rep.visit'].sudo().browse(visit_id)
                        partner_id = partner_id or visit.partner_id.id
                        route_id = route_id or visit.route_id.id
                        route_customer_id = route_customer_id or visit.route_customer_id.id
                
                    if not partner_id:
                        _logger.warning(f"Sync Upload: Collection {local_id} has no partner_id. Skipping.")
                        continue

                    # Create payment using the consolidated action method
                    res = self._action_create_payment(col_data, user, sales_rep, local_id)
                    payment_id = res.get('payment_id')
                    
                    if not payment_id:
                         _logger.error(f"Sync Upload: Failed to create payment for collection {local_id}: {res.get('error')}")
                         continue
                
                ack['collections'][local_id] = payment_id
                request.env.flush_all()
            except Exception as e:
                _logger.error(f"Failed to sync collection action {col_data.get('local_id')}: {e}")

        # Process Orders (NEW)
        orders = upload_data.get('orders', [])
        ack['orders'] = {}
        for order_data in orders:
            try:
                with request.env.cr.savepoint():
                    local_id = order_data.get('local_id')
                visit_local_id = order_data.get('visit_local_id')
                
                # Resolve visit_id (Priority: 1. Odoo ID from payload, 2. Local ID from current batch, 3. Lookup by local ID in DB, 4. Fallback route customer visit)
                visit_id = order_data.get('visit_id')
                if visit_id and isinstance(visit_id, str):
                    if visit_id.isdigit():
                        visit_id = int(visit_id)
                    else:
                        if not visit_local_id:
                            visit_local_id = visit_id
                        visit_id = False

                if not visit_id and visit_local_id:
                    visit_id = ack['visits'].get(visit_local_id)
                    if not visit_id:
                        visit_rec = request.env['sales.rep.visit'].sudo().search([('mobile_local_id', '=', visit_local_id)], limit=1)
                        if visit_rec:
                            visit_id = visit_rec.id

                # Fallback: Resolve via route_customer_id if still missing
                route_customer_id = order_data.get('route_customer_id')
                if not visit_id and route_customer_id:
                    rc_id = int(route_customer_id) if isinstance(route_customer_id, int) or (isinstance(route_customer_id, str) and route_customer_id.isdigit()) else False
                    if rc_id:
                        rc = request.env['sales.route.customer'].sudo().browse(rc_id)
                        if rc.exists() and rc.visit_id:
                            visit_id = rc.visit_id.id

                visit = request.env['sales.rep.visit'].sudo().browse(visit_id) if visit_id else False
                
                # === RESOLVE partner_id for offline-created customers ===
                partner_id = order_data.get('partner_id')
                partner_local_id = order_data.get('partner_local_id')
                
                if partner_id:
                    try:
                        if isinstance(partner_id, str) and not partner_id.isdigit():
                            if not partner_local_id:
                                partner_local_id = partner_id
                            partner_id = False
                        else:
                            partner_rec = request.env['res.partner'].sudo().browse(int(partner_id))
                            if not partner_rec.exists():
                                partner_id = False
                    except Exception:
                        partner_id = False

                if visit:
                    partner_id = partner_id or visit.partner_id.id
                    route_customer_id = route_customer_id or visit.route_customer_id.id
                
                if not partner_id and partner_local_id:
                    # Strategy 1: Check partner_id_map (from pre-processed create_customer actions in this batch)
                    if partner_id_map and partner_local_id in partner_id_map:
                        partner_id = partner_id_map[partner_local_id]
                        _logger.info(f"Sync: Resolved partner for order {local_id}: {partner_local_id} -> {partner_id} (from batch map)")
                    else:
                        # Strategy 2: DB lookup by mobile_local_id (partner was created in a previous sync)
                        partner = request.env['res.partner'].sudo().search([('mobile_local_id', '=', partner_local_id)], limit=1)
                        if partner:
                            partner_id = partner.id
                            _logger.info(f"Sync: Resolved partner for order {local_id}: {partner_local_id} -> {partner_id} (from DB)")
                        else:
                            _logger.error(f"Sync: Cannot resolve partner for order {local_id}: partner_local_id={partner_local_id} not found")
                            continue
                
                # If we still have no partner_id, try resolving via route_customer
                if not partner_id and route_customer_id:
                    rc = request.env['sales.route.customer'].sudo().browse(route_customer_id)
                    if rc.exists() and rc.partner_id:
                        partner_id = rc.partner_id.id
                        _logger.info(f"Sync: Resolved partner for order {local_id}: from route_customer {route_customer_id} -> {partner_id}")
                
                if not partner_id:
                    _logger.error(f"Sync: Order {local_id} has no resolvable partner_id. Skipping.")
                    continue

                # Determine is_cash status: Use payload if present
                # DIAGNOSTIC: Dump entire order_data to see hidden keys
                _logger.info(f"Sync: Incoming order_data for {local_id}: {order_data}")
                
                sync_is_cash = order_data.get('is_cash')
                if sync_is_cash is None:
                    # Check common variations
                    sync_is_cash = order_data.get('cash_payment') or order_data.get('is_cash_order')
                
                _logger.info(f"Sync: Order {local_id} resolved is_cash: {sync_is_cash}")

                vals = {
                    'partner_id': partner_id,
                    'route_id': order_data.get('route_id') or (visit.route_id.id if visit else False),
                    'route_customer_id': route_customer_id,
                    'visit_id': visit_id,
                    'date_order': order_data.get('date'),
                    'state': 'draft', # Always draft initially
                    'sales_rep_id': sales_rep.id,
                    'created_sales_rep_id': sales_rep.id,
                    'user_id': sales_rep.user_id.id,
                    'team_id': sales_rep.user_id.sale_team_id.id if sales_rep.user_id.sale_team_id else False,
                    'mobile_local_id': local_id,
                    'discount_total': float(order_data.get('discount_total', 0)),
                }
                if sync_is_cash is not None:
                    vals['is_cash'] = sync_is_cash

                
                # Use warehouse_id from payload ONLY if valid
                if order_data.get('warehouse_id'):
                    wh = request.env['stock.warehouse'].browse(order_data.get('warehouse_id'))
                    if wh.exists():
                        vals['warehouse_id'] = wh.id
                
                # Fallback: If no warehouse set, use the first one from the company
                if 'warehouse_id' not in vals:
                    wh = request.env['stock.warehouse'].with_user(user).search([('company_id', '=', sales_rep.company_id.id)], limit=1)
                    if wh:
                        vals['warehouse_id'] = wh.id
                    else:
                        _logger.error(f"Sync: No warehouse found for company {sales_rep.company_id.name}. Order creation may fail.")
                
                # Identify if this is an update to an existing order or a new one
                odoo_id = order_data.get('odoo_id')
                order = False
                if odoo_id:
                    order = request.env['sale.order'].with_user(user).browse(odoo_id)
                    if not order.exists():
                        order = False
                
                if not order and local_id:
                    order = request.env['sale.order'].with_user(user).search([('mobile_local_id', '=', local_id)], limit=1)

                if order:
                    # Update Existing Order
                    order.write(vals)
                    # Sync lines: if in draft/sent, we can safely replace lines to match mobile payload
                    if order.state in ('draft', 'sent'):
                        order.order_line.unlink()
                        for line in order_data.get('lines', []):
                            if line.get('is_reward_line'):
                                continue
                            line_vals = {
                                'order_id': order.id,
                                'product_id': line.get('product_id'),
                                'product_uom_qty': line.get('quantity'),
                                'price_unit': line.get('price_unit'),
                            }
                            loc_id = line.get('location_id')
                            if loc_id:
                                line_vals['location_id'] = int(loc_id)
                            # Handle UoM
                            uom_id = line.get('product_uom_id')
                            if uom_id:
                                uom = request.env['uom.uom'].with_user(user).browse(int(uom_id))
                                if uom.exists():
                                    line_vals['product_uom'] = uom.id
                            
                            # Only standard products get created here.
                            request.env['sale.order.line'].with_user(user).create(line_vals)
                    _logger.info(f"Sync: Updated existing Order {order.name} (ID: {order.id}) from local_id: {local_id}")

                else:
                    # Create New Order
                    if 'is_cash' not in vals:
                        partner = request.env['res.partner'].sudo().browse(partner_id)
                        vals['is_cash'] = partner.is_cash if partner.exists() else True
                    order = request.env['sale.order'].with_user(user).create(vals)
                    # Create Lines
                    for line in order_data.get('lines', []):
                        if line.get('is_reward_line'):
                            continue
                        line_vals = {
                            'order_id': order.id,
                            'product_id': line.get('product_id'),
                            'product_uom_qty': line.get('quantity'),
                            'price_unit': line.get('price_unit'),
                        }
                        loc_id = line.get('location_id')
                        if loc_id:
                            line_vals['location_id'] = int(loc_id)
                        # Handle UoM
                        uom_id = line.get('product_uom_id')
                        if uom_id:
                            uom = request.env['uom.uom'].with_user(user).browse(int(uom_id))
                            if uom.exists():
                                line_vals['product_uom'] = uom.id

                        request.env['sale.order.line'].with_user(user).create(line_vals)
                    _logger.info(f"Sync: Successfully created Order {order.name} (ID: {order.id}) from local_id: {local_id}")


                # Populate acknowledgement
                ack['orders'][local_id] = order.id


                # ========= AUTO-LIFECYCLE: Confirm → Deliver → Invoice =========
                # Only if the mobile app says it's confirmed (state='sale' or 'done')
                # If it's 'draft', we leave it as draft.
                if order_data.get('state') in ('sale', 'done'):
                    try:
                        # 1. Fix loyalty configuration to prevent over-rewarding (Buy 3 Get 1)
                        self._fix_loyalty_config(request.env)
                        
                        # 2. Confirm Order
                        order.action_confirm()
                        _logger.info(f"Sync: Confirmed Order {order.name}")

                        if sales_rep.auto_delivery:
                            # 2. Process Delivery
                            # Re-fetch picking_ids in case promotions added new moves/pickings
                            order.invalidate_recordset(['picking_ids'])
                            if order.picking_ids:
                                for picking in order.picking_ids:
                                    if picking.state in ('done', 'cancel'):
                                        continue
                                    picking = picking.sudo()
                                    if picking.state == 'draft':
                                        picking.action_confirm()
                                    if picking.state in ('confirmed', 'waiting'):
                                        picking.action_assign()
                                    # Force-set quantities on moves
                                    for move in picking.move_ids:
                                        move.write({'quantity': move.product_uom_qty, 'picked': True})
                                    # Also force-set quantities on move lines to match demand
                                    # This prevents partial delivery when stock isn't fully available
                                    for move in picking.move_ids:
                                        if move.move_line_ids:
                                            # If Odoo created partial move lines, update them
                                            total_ml_qty = sum(move.move_line_ids.mapped('quantity'))
                                            if total_ml_qty < move.product_uom_qty:
                                                # Set the first move line to full qty, remove extras
                                                first_ml = move.move_line_ids[0]
                                                first_ml.write({
                                                    'quantity': move.product_uom_qty,
                                                    'product_uom_id': move.product_uom.id
                                                })
                                                if len(move.move_line_ids) > 1:
                                                    for extra_ml in move.move_line_ids[1:]:
                                                        extra_ml.write({'quantity': 0})
                                        else:
                                            # No move lines created (no stock available) - create one
                                            request.env['stock.move.line'].create({
                                                'move_id': move.id,
                                                'picking_id': picking.id,
                                                'product_id': move.product_id.id,
                                                'product_uom_id': move.product_uom.id,
                                                'location_id': move.location_id.id,
                                                'location_dest_id': move.location_dest_id.id,
                                                'quantity': move.product_uom_qty,
                                            })
                                    request.env.flush_all()
                                    # Use context to skip all mail/tracking to avoid "Unable to send message" errors
                                    picking.with_context(
                                        skip_backorder=True, 
                                        skip_sms=True,
                                        mail_notrack=True,
                                        mail_create_nolog=True,
                                        mail_create_nosubscribe=True,
                                        no_reset_password=True
                                    ).button_validate()
                                    picking.invalidate_recordset(['state'])
                                    _logger.info(f"Sync: Delivery {picking.name} → {picking.state}")

                            # 3. Create & Post Invoice
                            try:
                                invoices = order.with_user(user)._create_invoices()
                                if invoices:
                                    for inv in invoices:
                                        inv.action_post()
                                        if order.is_cash:
                                            _logger.info(f"Sync: Order {order.name} is CASH, triggering auto-payment for invoice {inv.name} during upload auto-lifecycle")
                                            self._reconcile_cash_invoice(inv, order, sales_rep)
                                        else:
                                            _logger.info(f"Sync: Order {order.name} is CREDIT, skipping auto-payment during upload auto-lifecycle")
                                    _logger.info(f"Sync: Invoice {invoices[0].name} posted for {order.name}")
                            except Exception as inv_err:
                                _logger.warning(f"Sync: Invoice creation skipped for {order.name}: {inv_err}")

                    except Exception as e:
                        _logger.error(f"Sync: Auto-lifecycle failed for {order.name}: {e}")

                # Populate acknowledgement
                ack['orders'][local_id] = order.id

            except Exception as e:
                import traceback
                _logger.error(f"Failed to sync order {order_data.get('local_id')}: {e}\n{traceback.format_exc()}")

        # Process Inventory Adjustments (NEW)
        adjustments = upload_data.get('inventory_adjustments', [])
        ack['inventory_adjustments'] = {}
        if adjustments:
            _logger.info(f"Sync: Processing {len(adjustments)} inventory adjustments")
        for adj_data in adjustments:
            try:
                with request.env.cr.savepoint():
                    local_id = adj_data.get('local_id')
                    _logger.info(f"Sync: Processing inventory adjustment local_id={local_id}, data={adj_data}")
                    
                    # Deduplication check
                    existing = request.env['sales.rep.inventory.adjustment'].sudo().search([('mobile_local_id', '=', local_id)], limit=1)
                    if existing:
                        ack['inventory_adjustments'][local_id] = existing.id
                        _logger.info(f"Sync: Inventory Adjustment {local_id} already exists (ID: {existing.id}), skipping")
                        continue

                    # Parse date from mobile ISO format to Odoo Datetime
                    adj_date = fields.Datetime.now()
                    raw_date = adj_data.get('date')
                    if raw_date:
                        try:
                            adj_date = raw_date.replace('T', ' ').split('.')[0].replace('Z', '')
                        except Exception:
                            _logger.warning(f"Sync: Failed to parse date '{raw_date}', using now()")

                    adj_vals = {
                        'sales_rep_id': sales_rep.id,
                        'date': adj_date,
                        'mobile_local_id': local_id,
                    }
                    
                    adj = request.env['sales.rep.inventory.adjustment'].with_user(user).create(adj_vals)
                    
                    # Create Lines
                    for line_data in adj_data.get('lines', []):
                        product_id = line_data.get('product_id')
                        if not product_id:
                            _logger.warning(f"Sync: Skipping adjustment line without product_id")
                            continue
                        line_vals = {
                            'adjustment_id': adj.id,
                            'product_id': product_id,
                            'product_uom_id': line_data.get('product_uom_id'),
                            'counted_qty': line_data.get('counted_qty', 0.0),
                        }
                        request.env['sales.rep.inventory.adjustment.line'].with_user(user).create(line_vals)
                    
                    request.env.flush_all()
                    ack['inventory_adjustments'][local_id] = adj.id
                    _logger.info(f"Sync: Created Inventory Adjustment {adj.name} (ID: {adj.id}) from local_id: {local_id} with {len(adj_data.get('lines', []))} lines")
            except Exception as e:
                _logger.error(f"Failed to sync inventory adjustment {adj_data.get('local_id')}: {e}\n{traceback.format_exc()}")        # Process Stock Requests (NEW)
        requests_data = upload_data.get('stock_requests', [])
        ack['stock_requests'] = {}
        if requests_data:
            _logger.info(f"Sync: Processing {len(requests_data)} stock requests")
        for req_data in requests_data:
            try:
                with request.env.cr.savepoint():
                    local_id = req_data.get('local_id')
                    _logger.info(f"Sync: Processing stock request local_id={local_id}")
                    
                    # Deduplication check
                    existing = request.env['stock.picking'].sudo().search([('origin', '=', local_id)], limit=1)
                    if existing:
                        ack['stock_requests'][local_id] = existing.id
                        continue

                    # Find Internal Picking Type
                    picking_type = request.env['stock.picking.type'].sudo().search([
                        ('code', '=', 'internal'),
                        ('company_id', '=', sales_rep.company_id.id)
                    ], limit=1)

                    if picking_type:
                        p_source_loc = sales_rep.location_request_id.id
                        p_dest_loc = sales_rep.default_location_id.id
                        
                        picking_vals = {
                            'picking_type_id': picking_type.id,
                            'location_id': p_source_loc,
                            'location_dest_id': p_dest_loc,
                            'origin': local_id, # Store local_id for deduplication
                            'company_id': sales_rep.company_id.id,
                            'sales_rep_id': sales_rep.id,
                        }
                        picking = request.env['stock.picking'].sudo().create(picking_vals)

                        # Create Moves
                        for line_data in req_data.get('lines', []):
                            product_id = line_data.get('product_id')
                            if not product_id:
                                continue
                            product = request.env['product.product'].sudo().browse(int(product_id))
                            if not product.exists():
                                _logger.warning(f"Sync: Product {product_id} not found for stock request {local_id}")
                                continue
                                
                            request.env['stock.move'].sudo().create({
                                'name': f"Mobile Request: {local_id}",
                                'picking_id': picking.id,
                                'product_id': product.id,
                                'product_uom_qty': line_data.get('qty', 1.0),
                                'product_uom': line_data.get('uom_id') or product.uom_id.id,
                                'location_id': p_source_loc,
                                'location_dest_id': p_dest_loc,
                                'company_id': sales_rep.company_id.id,
                            })
                        
                        ack['stock_requests'][local_id] = picking.id
                        _logger.info(f"Sync: Created Picking {picking.name} (ID: {picking.id}) for local_id: {local_id}")
                    else:
                        _logger.warning(f"Sync: Internal picking type not found for company {sales_rep.company_id.name}. Skipping picking creation.")
            except Exception as e:
                _logger.error(f"Failed to sync stock request {req_data.get('local_id')}: {e}")

        return ack

    def _fix_loyalty_config(self, env):
        """
        Fixes loyalty rules that are incorrectly configured to give points-per-unit 
        equal to required-points, which results in 'Buy 1 Get 1' instead of 'Buy 3 Get 1'.
        """
        try:
            # Find rewards related to Large Cabinet (requested by user)
            rewards = env['loyalty.reward'].sudo().search([('reward_product_id.name', 'ilike', 'Large Cabinet')])
            for reward in rewards:
                for rule in reward.program_id.rule_ids:
                    # If rule gives 3 points per unit and reward costs 3 points, it's 1-for-1.
                    # Adjust to 1 point per unit so 3 units = 3 points = 1 reward.
                    if rule.reward_point_amount == 3.0 and reward.required_points == 3.0:
                        _logger.info(f"Sync: Fixing Loyalty Rule {rule.id} for {reward.program_id.name}")
                        rule.write({'reward_point_amount': 1.0})
        except Exception as e:
            _logger.error(f"Sync: Error fixing loyalty config: {e}")

    # ============================
    # PENDING ACTIONS PROCESSOR
    # ============================
    def _process_pending_actions(self, actions, user, sales_rep, upload_ack=None):
        """Process queued actions from the mobile app inside the authenticated sync context."""
        ack = {}
        for action_data in actions:
            local_id = action_data.get('local_id', '')
            action_type = action_data.get('action_type', '')
            payload = action_data.get('payload', {})

            # Resolve IDs (Fix for offline created orders/visits/collections)
            # Strategy:
            # 1. Check if ID exists in payload and is a string (local ID).
            # 2. If not found in payload, check for 'local_id' or 'visit_local_id' keys.
            # 3. Resolve using upload_ack (current batch) or database (previous batches).

            def resolve_id(res_model, local_id_value, ack_category=None):
                if not local_id_value or not isinstance(local_id_value, str) or not local_id_value.startswith(('order_', 'visit_', 'action_', 'LO-', 'VISIT-')):
                     return local_id_value # Likely already an int or not a local ID

                # Try upload_ack first
                if upload_ack and ack_category and upload_ack.get(ack_category):
                    if local_id_value in upload_ack[ack_category]:
                        resolved = upload_ack[ack_category][local_id_value]
                        _logger.info(f"Sync: Resolved {res_model} {local_id_value} from ACK -> {resolved}")
                        return resolved

                # Fallback: Query database by mobile_local_id
                record = request.env[res_model].sudo().search([('mobile_local_id', '=', local_id_value)], limit=1)
                if record:
                    _logger.info(f"Sync: Resolved {res_model} {local_id_value} from DB -> {record.id}")
                    return record.id
                
                return local_id_value # Still a string, will be handled by execute

            # Resolve Order ID
            order_id = payload.get('order_id') or payload.get('local_order_id') or payload.get('local_id')
            was_new_order = False
            if order_id:
                old_order_id = order_id
                payload['order_id'] = resolve_id('sale.order', order_id, 'orders')
                # Check if this order was just created/updated in _process_uploads 
                # (to avoid duplicate lines if app sends both order sync + actions)
                if upload_ack and 'orders' in upload_ack:
                    if isinstance(old_order_id, str) and old_order_id in upload_ack['orders']:
                        was_new_order = True
                    elif isinstance(old_order_id, int) and old_order_id in upload_ack['orders'].values():
                        was_new_order = True

            # Resolve Visit ID
            visit_id = payload.get('visit_id') or payload.get('visit_local_id')
            if visit_id:
                payload['visit_id'] = resolve_id('sales.rep.visit', visit_id, 'visits')

            # Idempotency Guard: If we just synced this order's lines in _process_uploads,
            # we SHOULD skip add_order_line actions for it, as they are already included in the 'lines' payload of the order.
            if action_type in ('add_order_line', 'update_order_line') and was_new_order:
                _logger.info(f"Sync: Skipping {action_type} for order {payload['order_id']}, already synced in order upload.")
                ack[local_id] = {'status': 'skipped', 'reason': 'already_synced'}
                continue

            # Resolve Invoice ID
            invoice_id = payload.get('invoice_id')
            if invoice_id:
                payload['invoice_id'] = resolve_id('account.move', invoice_id, 'invoices')

            # Resolve Collection ID (for payment registration)
            # col_id = payload.get('collection_id')
            # if col_id:
            #     payload['collection_id'] = resolve_id('sales.rep.collection', col_id, 'collections')

            try:
                _logger.info(f"Sync: Executing action {action_type} with payload: {json.dumps(payload)}")
                # Use a savepoint for each action so a failure doesn't roll back the whole sync transaction
                with request.env.cr.savepoint():
                    result = self._execute_action(action_type, payload, user, sales_rep, action_id=local_id)
                    ack[local_id] = {'success': True, 'result': result}
                _logger.info(f"Sync Action OK: {action_type} ({local_id})")
            except Exception as e:
                ack[local_id] = {'success': False, 'error': str(e)}
                _logger.error(f"Sync Action FAIL: {action_type} ({local_id}): {e}", exc_info=True)
        return ack

    def _execute_action(self, action_type, payload, user, sales_rep, action_id=None):
        """Dispatch and execute a single pending action."""
        if action_type == 'confirm_order':
            return self._action_confirm_order(payload, user, sales_rep)
        elif action_type == 'cancel_order':
            return self._action_cancel_order(payload, user)
        elif action_type == 'process_delivery':
            return self._action_process_delivery(payload, user, sales_rep)
        elif action_type == 'create_invoice':
            return self._action_create_invoice(payload, user, sales_rep, action_id=action_id)
        elif action_type == 'register_payment':
            return self._action_register_payment(payload, user, sales_rep, action_id=action_id)
        elif action_type == 'create_payment':
            return self._action_create_payment(payload, user, sales_rep, action_id=action_id)
        elif action_type == 'return_picking':
            return self._action_return_picking(payload, user)
        elif action_type == 'refund_invoice':
            return self._action_refund_invoice(payload, user)
        elif action_type == 'apply_promotion':
            return self._action_apply_promotion(payload, user)
        elif action_type == 'receive_returns':
            return self._action_receive_returns(payload, user)
        elif action_type == 'add_order_line':
            return self._action_add_order_line(payload, user)
        elif action_type in ('update_order_line', 'remove_order_line'):
            return self._action_modify_order_line(action_type, payload, user)
        elif action_type == 'create_customer':
            return self._action_create_customer(payload, user, sales_rep)
        elif action_type == 'update_order':
            return self._action_update_order(payload, user)
        elif action_type == 'log_promotion':
            return {'skipped': True, 'reason': f'{action_type} not yet supported in sync'}
        elif action_type == 'apply_fixed_discount':
            return self._action_apply_fixed_discount(payload, user, sales_rep)
        elif action_type == 'upload_attachment':
            return self._action_upload_attachment(payload, user)
        elif action_type == 'delete_attachment':
            return self._action_delete_attachment(payload, user)
        elif action_type == 'reorder_route_customers':
            return self._action_reorder_route_customers(payload, user)
        else:
            raise ValueError(f"Unknown action type: {action_type}")

    def _get_order_from_payload(self, payload, user):
        """Helper to resolve sale.order from payload using odoo_id or local_id."""
        order_id = payload.get('order_id')
        local_id = payload.get('local_order_id')

        if order_id and isinstance(order_id, int):
            order = request.env['sale.order'].with_user(user).browse(order_id)
        elif local_id:
            order = request.env['sale.order'].with_user(user).search([('mobile_local_id', '=', local_id)], limit=1)
        else:
            raise ValueError("Missing 'order_id' or 'local_order_id' in payload")

        if not order.exists():
            raise ValueError(f"Order not found (ID: {order_id}, Local: {local_id})")
        return order

    # --- Individual action handlers ---

    def _action_confirm_order(self, payload, user, sales_rep):
        order = self._get_order_from_payload(payload, user)

        if order.state in ('sale', 'done'):
            _logger.info(f"Sync: Order {order.name} is already confirmed (state: {order.state}). Skipping action_confirm.")
        elif order.state == 'cancel':
            _logger.warning(f"Sync: Cannot confirm Order {order.name} because it is cancelled.")
            return {'order_id': order.id, 'state': order.state, 'skipped': True, 'reason': 'cancelled'}
        else:
            order.action_confirm()

        # Auto-delivery + invoice if sales rep has auto_delivery
        if sales_rep and sales_rep.auto_delivery:
            self._auto_deliver_and_invoice(order, user, sales_rep)
        return {'order_id': order.id, 'state': order.state}

    def _action_cancel_order(self, payload, user):
        order = request.env['sale.order'].with_user(user).browse(payload['order_id'])
        if not order.exists():
            raise ValueError('Order not found')
        order.action_cancel()
        return {'order_id': order.id, 'state': order.state}

    def _action_update_order(self, payload, user):
        order_id = payload.get('order_id')
        if not order_id or not isinstance(order_id, int):
            raise ValueError(f"Missing or invalid 'order_id' in payload: {order_id}")
        order = request.env['sale.order'].with_user(user).browse(order_id)
        if not order.exists():
            raise ValueError(f"Order {order_id} not found")
        
        # Prepare valid fields for write
        valid_fields = ['is_cash']
        update_vals = {k: v for k, v in payload.items() if k in valid_fields}
        
        if update_vals:
            order.write(update_vals)
            _logger.info(f"Sync: Updated Order {order.name} with {update_vals}")

            
        return {'order_id': order.id, 'success': True}
    
    def _action_apply_fixed_discount(self, payload, user, sales_rep):
        order = self._get_order_from_payload(payload, user)
        discount_amount = float(payload.get('discount_amount', 0))
        
        # Determine the discount product
        # 1. Check Sales Rep profile
        # 2. Fallback to a generic service product named 'Discount'
        discount_product = sales_rep.discount_product_id
        if not discount_product:
            discount_product = request.env['product.product'].sudo().search([
                ('name', '=', 'Discount'),
                ('type', '=', 'service')
            ], limit=1)
        
        if not discount_product:
             # Last fallback: create one if possible or raise error
             raise ValueError("No discount product configured for sales representative and no generic 'Discount' service found.")

        # Find existing discount line
        discount_line = order.order_line.filtered(lambda l: l.product_id == discount_product)
        
        if discount_amount > 0:
            if discount_line:
                discount_line.write({
                    'product_uom_qty': 1.0,
                    'price_unit': -discount_amount
                })
                _logger.info(f"Sync: Updated discount line on {order.name} to -{discount_amount}")
            else:
                request.env['sale.order.line'].with_user(user).create({
                    'order_id': order.id,
                    'product_id': discount_product.id,
                    'product_uom_qty': 1.0,
                    'price_unit': -discount_amount,
                    'sequence': 999, # Keep it at the end
                })
                _logger.info(f"Sync: Created new discount line on {order.name} for -{discount_amount}")
        else:
            if discount_line:
                discount_line.unlink()
                _logger.info(f"Sync: Removed discount line from {order.name}")
        
        # Update the header discount field as well (for compatibility/visibility)
        order.write({'discount_total': discount_amount})
        
        return {'order_id': order.id, 'success': True}

    def _action_process_delivery(self, payload, user, sales_rep=None):
        order_id = payload.get('order_id')
        if not order_id or not isinstance(order_id, (int, str)):
            raise ValueError(f"Missing or invalid 'order_id' in payload: {order_id}")
        order = request.env['sale.order'].with_user(user).browse(order_id)
        if not order.exists():
            raise ValueError('Order not found')
        
        delivered_quantities = payload.get('delivered_quantities')
        lines_data = payload.get('lines', [])  # [{odoo_line_id, product_id, quantity}, ...]
        create_backorder = payload.get('create_backorder', False)
        
        open_pickings = order.picking_ids.filtered(lambda p: p.picking_type_id.code == 'outgoing' and p.state not in ('done', 'cancel'))
        if not open_pickings:
            return {'skipped': True, 'reason': 'No open outgoing pickings found to process deliveries. It may have already been fully processed or returned.'}

        # Build a lookup from Odoo sale.order.line ID → data from mobile's lines array
        line_data_map = {}  # {sale_order_line_id: {'qty': quantity, 'uom_id': uom_id}}
        for ld in lines_data:
            lid = ld.get('line_id') or ld.get('odoo_line_id')
            if lid:
                line_data_map[int(lid)] = {
                    'qty': float(ld.get('quantity', 0)),
                    'uom_id': ld.get('uom_id')
                }

        has_explicit_quantities = bool(line_data_map or delivered_quantities)

        for picking in open_pickings:
            if picking.state == 'draft':
                picking.action_confirm()
            if picking.state in ('confirmed', 'waiting'):
                picking.action_assign()
            
            for move in picking.move_ids:
                if line_data_map and move.sale_line_id and move.sale_line_id.id in line_data_map:
                    # PRIMARY STRATEGY: Match via sale_line_id (precise, no ambiguity)
                    data = line_data_map[move.sale_line_id.id]
                    qty_raw = data['qty']
                    uom_id = data.get('uom_id')
                    if uom_id:
                        payload_uom = request.env['uom.uom'].sudo().browse(int(uom_id))
                        qty = payload_uom._compute_quantity(qty_raw, move.product_uom)
                        _logger.info(f"Sync: Move {move.id} using payload UoM {payload_uom.name}. Converted {qty_raw} -> {qty} {move.product_uom.name}")
                    elif move.sale_line_id.product_uom != move.product_uom:
                        qty = move.sale_line_id.product_uom._compute_quantity(qty_raw, move.product_uom)
                        _logger.info(f"Sync: Move {move.id} fallback to SO UoM. Converted {qty_raw} -> {qty} {move.product_uom.name}")
                    else:
                        qty = qty_raw
                    _logger.info(f"Sync: Move {move.id} → sale_line_id={move.sale_line_id.id}, delivering {qty}")
                elif delivered_quantities and str(move.product_id.id) in delivered_quantities:
                    # FALLBACK: Use product-keyed delivered_quantities (assumed in Ref UoM as per delivery.tsx)
                    pid = str(move.product_id.id)
                    qty_ref = float(delivered_quantities.get(pid, 0))
                    # delivered_quantities from delivery.tsx are in Reference UoM (factor=1)
                    # We need to convert from product.uom_id (Ref UoM) to move.product_uom
                    qty = move.product_id.uom_id._compute_quantity(qty_ref, move.product_uom)
                    _logger.info(f"Sync: Fallback delivery for product {pid}: {qty_ref} RefQty -> {qty} {move.product_uom.name}")
                elif has_explicit_quantities:
                    # If we have explicit quantities but this line/product was not included, it means 0 delivered
                    qty = 0.0
                    _logger.info(f"Sync: Move {move.id} (product {move.product_id.id}) not in payload. Setting quantity to 0.0")
                else:
                    # No specific quantities provided = deliver everything
                    qty = move.product_uom_qty
                
                move.sudo().write({'quantity': qty, 'picked': True if qty > 0 else False})

                # Force-set move line quantities
                if qty > 0:
                    if move.move_line_ids:
                        # Update first line, set others to 0
                        first_ml = move.move_line_ids[0]
                        first_ml.sudo().write({
                            'quantity': qty,
                            'product_uom_id': move.product_uom.id
                        })
                        if len(move.move_line_ids) > 1:
                            for extra_ml in move.move_line_ids[1:]:
                                extra_ml.sudo().write({'quantity': 0})
                    else:
                        # Create new line
                        request.env['stock.move.line'].sudo().create({
                            'move_id': move.id,
                            'picking_id': picking.id,
                            'product_id': move.product_id.id,
                            'product_uom_id': move.product_uom.id,
                            'location_id': move.location_id.id,
                            'location_dest_id': move.location_dest_id.id,
                            'quantity': qty,
                        })
            
            request.env.flush_all()
            # If create_backorder is False, we skip; if True, we allow Odoo to create it.
            # Odoo 17 might still return a wizard action if skip_backorder is not True.
            # Usually, to fully automate it, we want to avoid the wizard.
            context = {'skip_sms': True}
            # We must NOT set skip_backorder=True here without picking_ids_not_to_backorder.
            # Otherwise Odoo 17 suppresses the wizard and implicitly creates a backorder.
            
            res = picking.with_context(**context).button_validate()
            
            # If Odoo returns a wizard (dict), automatically confirm or cancel the backorder.
            if isinstance(res, dict) and res.get('res_model') == 'stock.backorder.confirmation':
                wizard = request.env['stock.backorder.confirmation'].with_context(res['context']).create({'pick_ids': [picking.id]})
                if create_backorder:
                    wizard.process()
                else:
                    wizard.process_cancel_backorder()

        request.env.flush_all()
        try:
            # Force recompute of qty_delivered on the specific order lines
            # This is needed so create_invoice (if queued right after) sees the fresh quantities
            lines = order.sudo().order_line
            lines.invalidate_recordset(['qty_delivered'])
            lines._compute_qty_delivered()
            # Also recompute invoice_status on the order itself
            order.invalidate_recordset(['invoice_status'])
            order._compute_get_invoiced()
            request.env.flush_all()
        except Exception as recompute_err:
            _logger.warning(f"Sync: qty_delivered recompute warning: {recompute_err}")
            try:
                request.env['sale.order.line'].invalidate_model(['qty_delivered'])
            except Exception:
                pass
        # AUTOMATIC INVOICING: If delivery was successful, trigger invoice creation
        try:
            _logger.info(f"Sync: Auto-triggering invoice for {order.name} after successful delivery action.")
            # We don't pass action_id here to avoid blocking the real create_invoice action if it's also in the queue
            self._action_create_invoice({'order_id': order.id}, user, sales_rep)
        except Exception as inv_err:
            _logger.warning(f"Sync: Auto-invoicing failed for {order.name} after delivery: {inv_err}")

        return {'order_id': order.id}

    def _action_create_invoice(self, payload, user, sales_rep, action_id=None):
        order_id = payload.get('order_id')
        if not order_id or not isinstance(order_id, (int, str)):
            raise ValueError(f"Missing or invalid 'order_id' in payload: {order_id}")
        order = request.env['sale.order'].with_user(user).browse(order_id)
        if not order.exists():
            raise ValueError('Order not found')
        
        # Idempotency Check: Check if this specific action already created an invoice
        if action_id and order.invoice_ids:
            matched_invoice = order.invoice_ids.filtered(lambda inv: inv.mobile_local_id == action_id)
            if matched_invoice:
                latest_invoice = matched_invoice[0]
                _logger.info(f"Sync: _action_create_invoice skipped for {order.name}, already executed action {action_id}")
                return {'invoice_id': latest_invoice.id, 'name': latest_invoice.name, 'skipped': True, 'reason': 'Action already executed'}

        # Ensure Odoo's computed invoice_status is up to date in this transaction
        try:
            order.invalidate_recordset(['invoice_status'])
            order._compute_get_invoiced()
        except Exception:
            pass

        # If the order is already fully invoiced according to Odoo
        if order.invoice_status == 'invoiced':
             valid_invoices = order.invoice_ids.filtered(lambda inv: inv.state != 'cancel')
             if valid_invoices:
                 latest_invoice = valid_invoices[0]
                 # If we hit an auto-invoiced order that lacked our action ID but is fully invoiced
                 if action_id and not latest_invoice.mobile_local_id:
                     latest_invoice.sudo().write({'mobile_local_id': action_id})
                 _logger.info(f"Sync: _action_create_invoice skipped for {order.name}, order is fully invoiced")
                 return {'invoice_id': latest_invoice.id, 'name': latest_invoice.name, 'skipped': True, 'reason': 'Fully invoiced'}


        try:
            invoices = order._create_invoices()
            if invoices:
                if action_id:
                    invoices[0].sudo().write({'mobile_local_id': action_id})
                invoices[0].action_post()
                
                # Auto-pay for Cash Orders - ONLY if the customer is a cash customer
                if order.partner_id.is_cash:
                    _logger.info(f"Sync: Order {order.name} belongs to CASH customer, triggering auto-payment for invoice {invoices[0].name}")
                    self._reconcile_cash_invoice(invoices[0], order, sales_rep)
                else:
                    _logger.info(f"Sync: Order {order.name} is CREDIT, skipping auto-payment/reconciliation as requested.")

                try:
                    # Force recompute of qty_invoiced globally
                    request.env['sale.order.line'].invalidate_model(['qty_invoiced'])
                except Exception:
                    pass
                return {'invoice_id': invoices[0].id, 'name': invoices[0].name}
        except Exception as e:
         # 2nd Layer Idempotency: "No items to invoice" might mean it was just done.
         # Double check if an invoice exists now (race condition?)
         request.env.invalidate_all() # invalidate cache to see fresh DB state
         if action_id and order.invoice_ids:
             matched_invoice = order.invoice_ids.filtered(lambda inv: inv.mobile_local_id == action_id)
             if matched_invoice:
                 latest_invoice = matched_invoice[0]
                 return {'invoice_id': latest_invoice.id, 'name': latest_invoice.name, 'skipped': True, 'reason': 'Action already executed (race detected)'}

         if order.invoice_status == 'invoiced' and order.invoice_ids:
              valid_invoices = order.invoice_ids.filtered(lambda inv: inv.state != 'cancel')
              if valid_invoices:
                  latest_invoice = valid_invoices[0]
                  if action_id and not latest_invoice.mobile_local_id:
                      latest_invoice.sudo().write({'mobile_local_id': action_id})
                  return {'invoice_id': latest_invoice.id, 'name': latest_invoice.name, 'skipped': True, 'reason': 'Fully invoiced (race detected)'}

         # If it's literally "nothing to invoice" but not because it's fully invoiced (e.g. nothing delivered yet), just pass it back
         try:
             error_str = str(e).lower()
             if "no invoiceable line" in error_str or "nothing to invoice" in error_str or "no items are available to invoice" in error_str:
                 _logger.info(f"Sync: _action_create_invoice skipped for {order.name}, nothing to invoice (already done or policy restriction)")
                 return {'skipped': True, 'reason': 'Nothing to invoice'}
         except Exception:
             pass
         raise e
         
        return {'skipped': True, 'reason': 'Nothing to invoice'}

    def _action_register_payment(self, payload, user, sales_rep, action_id=None):
        if action_id:
            existing_payment = request.env['account.payment'].sudo().search([('mobile_local_id', '=', action_id)], limit=1)
            if existing_payment:
                _logger.info(f"Sync: Register payment action {action_id} already executed (found {existing_payment.name})")
                return {'payment_id': existing_payment.id, 'name': existing_payment.name, 'skipped': True, 'reason': 'Action already executed'}

        invoice_id = payload.get('invoice_id')
        if not invoice_id or not isinstance(invoice_id, int):
            raise ValueError(f"Missing or invalid 'invoice_id' in payload: {invoice_id}")
        invoice = request.env['account.move'].with_user(user).browse(invoice_id)
        if not invoice.exists():
            raise ValueError('Invoice not found')
        if invoice.payment_state == 'paid':
            return {'skipped': True, 'reason': 'Already paid'}
        amount = float(payload.get('amount', invoice.amount_residual))
        if amount > invoice.amount_residual:
            amount = invoice.amount_residual
        # Resolve Journal from Payment Method if provided (More reliable than frontend journal_id)
        journal_id = int(payload['journal_id'])
        if payload.get('payment_method_id'):
            pm = request.env['sales.rep.payment.method'].sudo().browse(payload['payment_method_id'])
            if pm.exists() and pm.journal_id:
                journal_id = pm.journal_id.id
                _logger.info(f"Sync: Resolved Journal {pm.journal_id.name} from Payment Method {pm.name}")

        wiz = request.env['account.payment.register'].sudo().with_context(
            active_model='account.move', active_ids=[invoice.id]
        ).create({
            'journal_id': journal_id,
            'amount': amount,
            'payment_date': fields.Date.today(),
        })
        payment = wiz._create_payments()

        if action_id and payment:
            payment.write({
                'mobile_local_id': action_id,
                'sales_rep_id': sales_rep.id if sales_rep else False
            })
        elif payment and sales_rep:
            payment.write({'sales_rep_id': sales_rep.id})

        # Force Reconciliation (Fix for 'Outstanding Credits' issue)
        if invoice.payment_state not in ('paid', 'in_payment'):
             # Find receivable lines of the invoice
             inv_receivable_lines = invoice.line_ids.filtered(lambda r: r.account_id.account_type == 'asset_receivable' and not r.reconciled)
             if inv_receivable_lines:
                 # Find matching payment line by account
                 matching_pay_lines = payment.line_ids.filtered(lambda l: l.account_id == inv_receivable_lines[0].account_id and not l.reconciled)
                 if matching_pay_lines:
                     try:
                        (inv_receivable_lines + matching_pay_lines).reconcile()
                        _logger.info(f"Sync: Forced reconciliation for Invoice {invoice.name} with Payment {payment.name}")
                     except Exception as e:
                        _logger.warning(f"Sync: Failed to force reconciliation: {e}")

        return {'payment_id': payment.id if payment else False}

    def _reconcile_payment(self, payment=None, order_id=None, invoice=None):
        """ Automatically reconcile a payment with open invoices, or an invoice with open payments """
        if not payment and not invoice:
            return

        if payment:
            if payment.state != 'posted':
                return
            _logger.info(f"Sync: Auto-reconcile Payment {payment.name} (Amount: {payment.amount})")
            
            # Find receivable lines of the payment
            pay_lines = payment.line_ids.filtered(lambda l: l.account_id.account_type == 'asset_receivable' and not l.reconciled)
            if not pay_lines:
                _logger.info(f"Sync: No unreconciled receivable lines for payment {payment.name}")
                return
            # Separate the specific order invoices from other partner invoices
            order_invoices = request.env['account.move'].sudo()
            if order_id:
                try:
                    order = request.env['sale.order'].sudo().browse(int(order_id))
                    if order.exists():
                        # Detailed debug logs for order invoices
                        all_order_invs = order.invoice_ids
                        _logger.info(f"Sync: Order {order.name} has {len(all_order_invs)} total invoices: {all_order_invs.mapped('name')}")
                        order_invoices = all_order_invs.filtered(
                            lambda i: i.state == 'posted' and i.move_type == 'out_invoice' and i.payment_state in ('not_paid', 'partial')
                        )
                        _logger.info(f"Sync: Found {len(order_invoices)} open invoices specifically for order {order.name}")
                except Exception as e:
                    _logger.error(f"Sync: Error finding order invoices for reconciliation: {e}")

            # RESTRICTION: Only reconcile if we have an order_id and found invoices for it.
            # If no order_id is provided, it's a general payment - do not auto-reconcile.
            if not order_id:
                _logger.info(f"Sync: General payment {payment.name} - skipping auto-reconciliation as requested.")
                return

            if not order_invoices:
                _logger.info(f"Sync: No open invoices found for order {order_id} - payment {payment.name} remains outstanding.")
                return

            # Only target order-specific invoices
            for inv in order_invoices:
                if not pay_lines: break
                inv_receivable_lines = inv.line_ids.filtered(lambda l: l.account_id.account_type == 'asset_receivable' and not l.reconciled)
                if inv_receivable_lines:
                    matched_pay_line = pay_lines.filtered(lambda l: l.account_id == inv_receivable_lines[0].account_id)
                    if matched_pay_line:
                        try:
                            (inv_receivable_lines + matched_pay_line).reconcile()
                            _logger.info(f"Sync: Successfully reconciled {payment.name} with {inv.name}")
                            # Refresh pay_lines after reconciliation
                            pay_lines = payment.line_ids.filtered(lambda l: l.account_id.account_type == 'asset_receivable' and not l.reconciled)
                        except Exception as e:
                            _logger.error(f"Sync: Reconciliation error for {inv.name}: {e}")
            return

        elif invoice:
            if invoice.state != 'posted' or invoice.payment_state not in ('not_paid', 'partial'):
                return
            _logger.info(f"Sync: Auto-reconcile Invoice {invoice.name} against outstanding credits")
            
            # Find outstanding payments for this partner
            # We look for posted payments that are not fully reconciled
            domain = [
                ('partner_id', '=', invoice.partner_id.id),
                ('is_reconciled', '=', False),
                ('state', '=', 'posted'),
                ('payment_type', '=', 'inbound'),
            ]
            # Prioritize payments from the same order/visit if possible
            if order_id:
                # Odoo account.payment doesn't have a direct link to sale_order usually, 
                # but our custom ones have visit_id and mobile_local_id.
                # Here we just look at all outstanding for the partner to be safe.
                pass
                
            payments = request.env['account.payment'].sudo().search(domain, order='date asc, id asc')
            inv_receivable_lines = invoice.line_ids.filtered(lambda l: l.account_id.account_type == 'asset_receivable' and not l.reconciled)
            
            for pay in payments:
                if not inv_receivable_lines: break
                pay_lines = pay.line_ids.filtered(lambda l: l.account_id.account_type == 'asset_receivable' and not l.reconciled)
                if pay_lines:
                    matched_pay_line = pay_lines.filtered(lambda l: l.account_id == inv_receivable_lines[0].account_id)
                    if matched_pay_line:
                        try:
                            _logger.info(f"Sync: Linking outstanding payment {pay.name} to invoice {invoice.name}")
                            (inv_receivable_lines + matched_pay_line).reconcile()
                            inv_receivable_lines = invoice.line_ids.filtered(lambda l: l.account_id.account_type == 'asset_receivable' and not l.reconciled)
                        except Exception as e:
                            _logger.error(f"Sync: Reconciliation error for {invoice.name}: {e}")

    def _reconcile_cash_invoice(self, invoice, order, sales_rep):
        """Automatically register payment for a cash invoice"""
        try:
            # 1. Find a cash journal - Check Sales Rep's payment methods
            journal = False
            for pm in sales_rep.payment_method_ids:
                if pm.payment_type == 'cash' and pm.journal_id:
                    journal = pm.journal_id
                    break
            
            # Fallback to first available journal from payment methods if no explicit 'cash' type
            if not journal and sales_rep.payment_method_ids:
                journal = sales_rep.payment_method_ids[0].journal_id
            
            # Fallback to company default cash journal
            if not journal:
                journal = request.env['account.journal'].sudo().search([
                    ('type', '=', 'cash'), 
                    ('company_id', '=', sales_rep.company_id.id)
                ], limit=1)
            
            if not journal:
                _logger.warning(f"Sync: Could not find cash journal for auto-payment on invoice {invoice.name}")
                return False

            _logger.info(f"Sync: Auto-paying Cash Invoice {invoice.name} via Journal {journal.name}")

            # 2. Register Payment
            wiz = request.env['account.payment.register'].sudo().with_context(
                active_model='account.move', active_ids=[invoice.id]
            ).create({
                'journal_id': journal.id,
                'amount': invoice.amount_residual,
                'payment_date': fields.Date.today(),
            })
            payment = wiz._create_payments()
            if payment and sales_rep:
                payment.write({'sales_rep_id': sales_rep.id})

            # 3. Force Reconciliation
            inv_receivable_lines = invoice.line_ids.filtered(lambda r: r.account_id.account_type == 'asset_receivable' and not r.reconciled)
            if inv_receivable_lines and payment:
                pay_lines = payment.line_ids.filtered(lambda l: l.account_id == inv_receivable_lines[0].account_id and not l.reconciled)
                if pay_lines:
                    (inv_receivable_lines + pay_lines).reconcile()
                    _logger.info(f"Sync: Successfully auto-reconciled Cash Invoice {invoice.name}")
            return True
        except Exception as e:
            _logger.error(f"Sync: Failed to auto-reconcile cash invoice {invoice.name}: {e}")
            return False

    def _reconcile_refund_logic(self, refund, invoice, order):
        """Logic to reconcile refund with invoice based on order type and invoice status"""
        try:
            is_cash_order = order.partner_id.is_cash if (order and order.partner_id) else False
            # Ensure we have the latest payment state from DB
            invoice.invalidate_recordset(['payment_state'])
            invoice.sudo().read(['payment_state'])
            
            # Condition for auto-reconciliation: 
            # 1. It's a Cash Customer (Always reconcile)
            # 2. It's a Credit Customer AND the original invoice is UNPAID (reconcile to settle the invoice)
            should_reconcile = is_cash_order or (invoice.payment_state in ('not_paid', 'partial'))
            
            _logger.info(f"Sync: Refund Logic for {refund.name} (ID: {refund.id})")
            _logger.info(f"Sync:   - Order: {order.name if order else 'N/A'} (IsCash: {is_cash_order})")
            _logger.info(f"Sync:   - Invoice: {invoice.name} (PaymentState: {invoice.payment_state})")
            _logger.info(f"Sync:   - Decision: should_reconcile={should_reconcile}")
            
            if should_reconcile:
                refund_recv = refund.line_ids.sudo().filtered(
                    lambda l: l.account_id.account_type == 'asset_receivable' and not l.reconciled
                )[:1]
                if refund_recv:
                    inv_recv = invoice.line_ids.sudo().filtered(lambda l: l.account_id.account_type == 'asset_receivable' and not l.reconciled)
                    if inv_recv:
                        (inv_recv + refund_recv).sudo().reconcile()
                        _logger.info(f"Sync: Auto-reconciled refund {refund.name} with invoice {invoice.name}")
                    
                    # Try other open invoices if still remaining
                    if refund_recv.amount_residual != 0:
                        open_invoices = request.env['account.move'].sudo().search([
                            ('partner_id', '=', refund.partner_id.id),
                            ('state', '=', 'posted'),
                            ('move_type', '=', 'out_invoice'),
                            ('payment_state', 'in', ('not_paid', 'partial')),
                            ('id', '!=', invoice.id)
                        ], order='invoice_date asc, id asc')
                        for inv in open_invoices:
                            if refund_recv.reconciled or refund_recv.amount_residual == 0:
                                break
                            inv_recv_lines = inv.line_ids.filtered(lambda l: l.account_id.account_type == 'asset_receivable' and not l.reconciled)
                            if inv_recv_lines:
                                (inv_recv_lines + refund_recv).sudo().reconcile()
                                _logger.info(f"Sync: Reconciled remaining refund {refund.name} with extra invoice {inv.name}")
            else:
                # Credit Order + PAID/IN_PAYMENT Invoice -> Unreconcile (Refund becomes Not Paid)
                if not is_cash_order and invoice.payment_state in ('paid', 'in_payment'):
                    _logger.info(f"Sync: Force unreconciling refund {refund.name} to keep it Open/Not Paid for Credit Order")
                    # Target only the receivable lines to be precise
                    receivable_lines = refund.line_ids.sudo().filtered(lambda l: l.account_id.account_type == 'asset_receivable')
                    if receivable_lines:
                        receivable_lines.remove_move_reconcile()
                        _logger.info(f"Sync: remove_move_reconcile called on {len(receivable_lines)} lines")
        except Exception as e:
            _logger.warning(f"Sync: Refund reconciliation logic failed for {refund.name}: {e}")

    def _action_create_payment(self, payload, user, sales_rep, action_id=None):
        _logger.info(f"Sync: Starting _action_create_payment with payload: {payload}")
        partner_id = payload.get('partner_id')
        journal_id = payload.get('journal_id')
        amount = payload.get('amount')
        visit_id = payload.get('visit_id')
        route_id = payload.get('route_id')
        route_customer_id = payload.get('route_customer_id')
        
        if not partner_id or amount is None:
            _logger.error(f"Sync: Missing required payment info: partner={partner_id}, amount={amount}")
            return {'error': f"Missing required payment info: partner={partner_id}, amount={amount}"}

        # Ensure integer types and basic records
        try:
            partner_id = int(partner_id)
            partner = request.env['res.partner'].sudo().browse(partner_id)
            if not partner.exists():
                _logger.error(f"Sync: Partner {partner_id} not found")
                return {'error': f"Partner {partner_id} not found"}
        except (ValueError, TypeError) as e:
            _logger.error(f"Sync: Invalid partner ID type: {partner_id}. Error: {e}")
            return {'error': f"Invalid partner ID: {partner_id}"}

        # Fallback resolution for visit_id/route_id from route_customer_id
        if not visit_id and route_customer_id:
            try:
                customer = request.env['sales.route.customer'].sudo().browse(int(route_customer_id))
                if customer.exists() and customer.visit_id:
                    visit_id = customer.visit_id.id
                    if not route_id and customer.route_id:
                        route_id = customer.route_id.id
            except Exception: pass

        # Deduplication check
        local_id = payload.get('local_id') or action_id
        if local_id:
            existing_payment = request.env['account.payment'].sudo().search([('mobile_local_id', '=', local_id)], limit=1)
            if existing_payment:
                _logger.info(f"Sync: Payment with local_id {local_id} already exists ({existing_payment.name}). Skipping.")
                return {'payment_id': existing_payment.id, 'name': existing_payment.name, 'skipped': True}

        # 1. Resolve Journal and Payment Method Line
        rep_payment_method = False
        payment_method_id = payload.get('payment_method_id')
        if payment_method_id:
            rep_payment_method = request.env['sales.rep.payment.method'].sudo().browse(int(payment_method_id))
        
        journal = False
        if rep_payment_method and rep_payment_method.journal_id:
            journal = rep_payment_method.journal_id
            _logger.info(f"Sync: Using journal {journal.name} from payment method {rep_payment_method.name}")
        
        if not journal and journal_id:
            journal = request.env['account.journal'].sudo().browse(int(journal_id))
            
        if not journal or not journal.exists():
            # Fallback to a default journal based on company
            journal_domain = [('type', 'in', ['bank', 'cash']), ('company_id', '=', partner.company_id.id)]
            journal = request.env['account.journal'].sudo().search(journal_domain, limit=1)

        if not journal:
            _logger.error(f"Sync: Could not resolve journal for payment. Payload: {payload}")
            return {'error': 'Could not resolve accounting journal'}

        # Resolve Payment Method Line (Odoo 17 REQUIREMENT)
        pm_domain = [('journal_id', '=', journal.id), ('payment_type', '=', 'inbound')]
        pm_lines = request.env['account.payment.method.line'].sudo().search(pm_domain)
        
        payment_method_line = False
        if rep_payment_method:
            target_code = 'manual' 
            if rep_payment_method.payment_type == 'cash':
                target_code = 'manual'
            elif rep_payment_method.payment_type == 'bank':
                target_code = 'manual' 
            
            payment_method_line = pm_lines.filtered(lambda l: l.code == target_code)[:1]
        
        if not payment_method_line:
            payment_method_line = pm_lines[:1]

        if not payment_method_line:
            _logger.error(f"Sync: No inbound payment method line found for journal {journal.name}")
            return {'error': f"No inbound payment method configured for journal {journal.name}"}

        _logger.info(f"Sync: Final Payment Resolution - Journal: {journal.name} (ID: {journal.id}), Method: {payment_method_line.name} (ID: {payment_method_line.id})")

        vals = {
            'partner_id': partner.id,
            'journal_id': journal.id,
            'payment_method_line_id': payment_method_line.id,
            'amount': float(amount),
            'payment_type': 'inbound',
            'partner_type': 'customer',
            'date': payload.get('collection_date') or fields.Date.today(),
            'memo': payload.get('memo', payload.get('ref', '')),
            'visit_id': visit_id or False,
            'route_id': route_id or False,
            'route_customer_id': route_customer_id or False,
            'mobile_local_id': local_id or False,
            'sales_rep_id': sales_rep.id if sales_rep else False,
        }
        
        # 1. Official "Register Payment" Flow
        order_id = payload.get('order_id')
        payment = False
        if order_id:
            try:
                oid = int(order_id) if str(order_id).isdigit() else False
                if oid:
                    order = request.env['sale.order'].sudo().browse(oid)
                    if order.exists():
                        open_invoices = order.invoice_ids.filtered(lambda i: i.state == 'posted' and i.payment_state in ('not_paid', 'partial'))
                        if open_invoices:
                            invoice = open_invoices[0]
                            pay_amount = min(float(amount), invoice.amount_residual)
                            _logger.info(f"Sync: Using Register Payment Wizard for order {order.name} / invoice {invoice.name}")
                            wiz_ctx = {'active_model': 'account.move', 'active_ids': [invoice.id]}
                            wiz = request.env['account.payment.register'].sudo().with_user(user).with_context(wiz_ctx).create({
                                'journal_id': journal.id,
                                'amount': pay_amount,
                                'payment_date': vals['date'],
                                'communication': vals['memo'] or invoice.name,
                            })
                            payment = wiz._create_payments()
            except Exception as e:
                _logger.error(f"Sync: Failed official registration flow, fallback to standalone: {e}")

        # 2. Standalone Payment Flow (Fallback)
        if not payment:
            _logger.info(f"Sync: Creating standalone payment record")
            payment = request.env['account.payment'].sudo().with_user(user).create([vals])[0]
            payment.action_post()

        # Final decoration and reconciliation
        if payment:
            # Re-ensure local_id and other fields are set (especially if created via wizard)
            payment.sudo().write({
                'mobile_local_id': local_id or payment.mobile_local_id,
                'visit_id': visit_id or payment.visit_id.id or False,
                'route_id': route_id or payment.route_id.id or False,
                'route_customer_id': route_customer_id or payment.route_customer_id.id or False,
            })
            if payload.get('receipt_image_base64'):
                _logger.info(f"Sync: Attaching receipt image to payment {payment.name}")
                payment.sudo().write({
                    'receipt_image': payload.get('receipt_image_base64'),
                    'receipt_filename': f"receipt_{local_id or payment.id}.jpg"
                })
            # 3. Create Custom Collection Record (for rep reports and balance calculation)
            # This links the accounting payment back to our rep management logic
            # collection = False
            # if not visit_id:
            #     # We need a visit for the collection model
            #     # This could happen for standalone payments not linked to routes
            #     # For now, we skip creation if no visit exists to avoid validation error, 
            #     # but in practice, mobile sync always provides visit_id or visit_local_id
            #     _logger.warning(f"Sync: No visit_id resolved for collection {local_id}. Cannot create sales.rep.collection record.")
            # else:
            #     try:
            #         # Deduplication for collection record
            #         collection = request.env['sales.rep.collection'].sudo().search([('mobile_local_id', '=', local_id)], limit=1)
            #         if not collection:
            #             col_vals = {
            #                 'visit_id': visit_id,
            #                 'route_id': route_id,
            #                 'route_customer_id': route_customer_id,
            #                 'partner_id': partner.id,
            #                 'amount': float(amount),
            #                 'payment_method': payload.get('payment_method', 'cash'),
            #                 'payment_method_id': rep_payment_method.id if rep_payment_method else False,
            #                 'payment_reference': payload.get('payment_reference'),
            #                 'collection_date': payload.get('collection_date') or fields.Datetime.now(),
            #                 'mobile_local_id': local_id,
            #                 'state': 'confirmed',  # Auto-confirm when synced
            #                 'payment_id': payment[0].id,
            #             }
            #             collection = request.env['sales.rep.collection'].sudo().create(col_vals)
            #             _logger.info(f"Sync: Created sales.rep.collection record {collection.name} for payment {payment[0].name}")
            #     except Exception as col_err:
            #         _logger.error(f"Sync: Failed to create sales.rep.collection: {col_err}")

            return {
                'payment_id': payment[0].id if payment else False, 
                'name': payment[0].name if payment else False,
                'collection_odoo_id': False
            }
            
        return {'error': 'Failed to create payment record'}



    def _action_return_picking(self, payload, user):
        order_id_raw = payload.get('order_id')
        order_id = int(order_id_raw) if order_id_raw else None
        picking_ids = payload.get('picking_ids', [])
        # Backwards compatibility if frontend sends 'picking_id'
        if not picking_ids and payload.get('picking_id'):
            picking_ids = [payload.get('picking_id')]
            
        if not picking_ids:
            # Fallback to deriving pickings from order_id if present
            if order_id:
                # Need to use sudo to ensure we get pickings even if not explicitly assigned
                order = request.env['sale.order'].sudo().with_context(mail_notrack=True, mail_create_nolog=True).browse(order_id)
                if order.exists():
                    picking_ids = order.picking_ids.filtered(lambda p: p.state == 'done').ids

        if not picking_ids:
            raise ValueError('No pickings provided to return')

        # Retrieve all pickings, ensure they belong to the user/company, and sort them LIFO
        # Returning from the newest delivery first
        pickings = request.env['stock.picking'].with_user(user).with_context(mail_notrack=True, mail_create_nolog=True).search([('id', 'in', picking_ids)], order='id desc')
        if not pickings:
            raise ValueError('Pickings not found')
            
        requested_lines = payload.get('lines', [])
        _logger.info(f"Sync: Processing return for order {order_id}, pickings {picking_ids}, lines: {requested_lines}")
        if not requested_lines:
             _logger.warning("Sync: No return lines specified in payload")
             return {'result': False, 'message': 'No return lines specified'}
             
        # Create a mutable tracking dictionary of what remains to be returned
        pending_returns = { int(line['product_id']): float(line['quantity']) for line in requested_lines if float(line.get('quantity', 0)) > 0 }
        
        return_location_id = payload.get('location_id') or payload.get('return_location_id')
        
        # Fallback to sales rep's return_location_id or default_location_id if none provided
        sales_rep = request.env['sales.representative'].sudo().search([('user_id', '=', user.id)], limit=1)
        if not return_location_id and sales_rep:
            return_location_id = sales_rep.return_location_id.id or sales_rep.default_location_id.id
            if return_location_id:
                _logger.info(f"Sync: Using rep fallback return location (ID: {return_location_id})")
        
        created_return_pickings = []
        
        for picking in pickings:
            # Skip pickings that aren't done (cannot return from them)
            if picking.state != 'done':
                continue
                
            # Check if we still have things to return
            if sum(pending_returns.values()) <= 0:
                break
            
            # In Odoo 18, we must ensure picking_id is set so the compute _compute_moves_locations fires correctly.
            # Passing it in create() is safer than relying solely on context in some environments.
            ctx = {'active_id': picking.id, 'active_ids': [picking.id], 'active_model': 'stock.picking'}
            wizard = request.env['stock.return.picking'].with_user(user).with_context(ctx).with_context(mail_notrack=True, mail_create_nolog=True).create({
                'picking_id': picking.id
            })
            
            _logger.info(f"Sync: Created return wizard {wizard.id} for picking {picking.name}. Lines in wizard: {len(wizard.product_return_moves)}")
            
            # Track if this picking is actually contributing to the return
            contributed_qty = 0
            
            if wizard.product_return_moves:
                for ret_move in wizard.product_return_moves:
                    prod_id = ret_move.product_id.id
                    needed_qty = pending_returns.get(prod_id, 0)
                    
                    if needed_qty > 0:
                        # In Odoo 18, the wizard initializes all line quantities to 0 (user is expected to fill them in).
                        # We must read the MAX returnable qty from the original stock move, not the wizard line.
                        # The original move's delivered quantity is in ret_move.move_id.quantity (for done moves).
                        # We also need to subtract any previously returned quantities.
                        original_move = ret_move.move_id
                        max_returnable = original_move.quantity if original_move else 0
                        
                        # Subtract already-returned quantities from previous returns
                        if original_move:
                            for returned_move in original_move.returned_move_ids.filtered(lambda m: m.state != 'cancel'):
                                max_returnable -= returned_move.quantity
                        
                        _logger.info(f"Sync: Return line product {prod_id}: needed={needed_qty}, max_returnable={max_returnable}")
                        
                        if max_returnable > 0:
                            take_qty = min(needed_qty, max_returnable)
                            ret_move.write({'quantity': take_qty})
                            pending_returns[prod_id] -= take_qty
                            contributed_qty += take_qty
                            _logger.info(f"Sync: Set return qty to {take_qty} for product {prod_id}")
                        else:
                            ret_move.write({'quantity': 0})
                            _logger.info(f"Sync: No returnable qty left for product {prod_id}")
                    else:
                        ret_move.write({'quantity': 0})
                        
            # Only finalize this return if it actually returns something
            if contributed_qty > 0:
                if return_location_id and hasattr(wizard, 'location_id'):
                    wizard.location_id = return_location_id
                elif return_location_id:
                     _logger.info(f"Sync: Requested return location {return_location_id} ignored (wizard has no location_id field). Defaulting to picking source.")
                
                _logger.info(f"Sync: Finalizing return for picking {picking.name} with contributed qty {contributed_qty}")
                # Odoo 18 uses action_create_returns instead of create_returns
                result = wizard.sudo().with_context(mail_notrack=True, mail_create_nolog=True).action_create_returns()
                
                # Validate the generated return picking
                if result and result.get('res_id'):
                    return_picking = request.env['stock.picking'].with_user(user).with_context(mail_notrack=True, mail_create_nolog=True).browse(result['res_id'])
                    created_return_pickings.append(return_picking)
                    _logger.info(f"Sync: Created return picking {return_picking.name} (ID: {return_picking.id})")
                    
                    # Write return reason, note, and force return destination location
                    pick_vals = {}
                    reason_id = payload.get('return_reason_id')
                    reason_name = payload.get('return_reason')
                    resolved_reason = False
                    if reason_id:
                        resolved_reason = request.env['sales.rep.return.reason'].sudo().browse(int(reason_id))
                        if not resolved_reason.exists():
                            resolved_reason = False
                    if not resolved_reason and reason_name:
                        resolved_reason = request.env['sales.rep.return.reason'].sudo().search([('name', '=', reason_name)], limit=1)
                        if not resolved_reason:
                            resolved_reason = request.env['sales.rep.return.reason'].sudo().search([('name', 'ilike', reason_name)], limit=1)
                    if resolved_reason:
                        pick_vals['return_reason_id'] = resolved_reason.id
                    elif reason_id:
                        first_reason = request.env['sales.rep.return.reason'].sudo().search([], limit=1)
                        if first_reason:
                            pick_vals['return_reason_id'] = first_reason.id
                    if reason_name:
                        pick_vals['note'] = reason_name
                    
                    # Force the return destination to the sales rep's assigned location
                    if return_location_id:
                        pick_vals['location_dest_id'] = int(return_location_id)
                        _logger.info(f"Sync: Forcing return picking {return_picking.name} destination to location ID {return_location_id}")
                    
                    if pick_vals:
                        return_picking.write(pick_vals)

                    # Note: We intentionally do NOT write sale_id on the return picking.
                    # Doing so causes Odoo to include it in order.picking_ids and may trigger
                    # unwanted procurement/reorder rules. The return picking is identifiable
                    # via its `origin` field (set by Odoo to "Return of WH/OUT/...").
                    # if order_id:
                    #     return_picking.write({'sale_id': order_id})

                    for move in return_picking.move_ids:
                        move_vals = {'quantity': move.product_uom_qty, 'picked': True}
                        # Also force destination on each stock move
                        if return_location_id:
                            move_vals['location_dest_id'] = int(return_location_id)
                        move.sudo().write(move_vals)

                        # Force-set move line quantities and UoM
                        if move.move_line_ids:
                            first_ml = move.move_line_ids[0]
                            ml_vals = {
                                'quantity': move.product_uom_qty,
                                'product_uom_id': move.product_uom.id
                            }
                            if return_location_id:
                                ml_vals['location_dest_id'] = int(return_location_id)
                            first_ml.sudo().write(ml_vals)
                            if len(move.move_line_ids) > 1:
                                for extra_ml in move.move_line_ids[1:]:
                                    extra_ml.sudo().write({'quantity': 0})
                        else:
                            ml_vals = {
                                'move_id': move.id,
                                'picking_id': return_picking.id,
                                'product_id': move.product_id.id,
                                'product_uom_id': move.product_uom.id,
                                'location_id': move.location_id.id,
                                'location_dest_id': int(return_location_id) if return_location_id else move.location_dest_id.id,
                                'quantity': move.product_uom_qty,
                            }
                            request.env['stock.move.line'].sudo().create(ml_vals)
                    
                    # Force destination on move lines as well (Odoo may reset these)
                    if return_location_id:
                        for move in return_picking.move_ids:
                            for move_line in move.move_line_ids:
                                move_line.sudo().write({'location_dest_id': int(return_location_id)})
                    
        request.env.flush_all()
        
        validated_pickings = []
        # Conditionally auto-receive based on sales rep settings
        if sales_rep and sales_rep.auto_receive:
            for rp in created_return_pickings:
                rp.with_context(skip_backorder=True, skip_sms=True).button_validate()
                validated_pickings.append({'picking_id': rp.id, 'name': rp.name})
                
            # Invalidate model so qty_delivered and invoice_status recompute properly
            try:
                lines_to_recompute = request.env['sale.order.line']
                for orig_picking in pickings:
                    if orig_picking.sale_id:
                        lines_to_recompute |= orig_picking.sale_id.order_line
                if lines_to_recompute:
                    lines_to_recompute.invalidate_recordset(['qty_delivered'])
                    lines_to_recompute._compute_qty_delivered()
                request.env.flush_all()
            except Exception as recomp_err:
                _logger.warning(f"Sync: qty_delivered recompute warning in return: {recomp_err}")
                try:
                    request.env['sale.order.line'].invalidate_model(['qty_delivered'])
                except Exception:
                    pass
                
            # --- Auto-Create Credit Note for Returned Products ---
            # We calculate the returned value and create a credit note via reversal wizard.
            # This works regardless of invoice_status (first or subsequent returns).
            sale_orders = pickings.mapped('sale_id')
            created_refunds = []
            
            for order in sale_orders:
                # Find the most recent posted original invoice for this order
                posted_invoices = order.invoice_ids.filtered(
                    lambda inv: inv.move_type == 'out_invoice' and inv.state == 'posted'
                ).sorted('invoice_date', reverse=True)
                
                if not posted_invoices:
                    _logger.info(f"Sync: No posted invoice found for order {order.name}, skipping auto-refund")
                    continue
                
                # Find the return moves that came from this order's deliveries
                return_moves_for_order = request.env['stock.move']
                for rp in created_return_pickings:
                    for mv in rp.move_ids:
                        # The origin_returned_move_id links to the original delivery move which links to the sale order
                        orig_move = mv.origin_returned_move_id
                        if orig_move and orig_move.picking_id and orig_move.picking_id.sale_id == order:
                            return_moves_for_order |= mv
                
                if not return_moves_for_order:
                    _logger.info(f"Sync: No return moves found for order {order.name}, skipping auto-refund")
                    continue
                
                # Calculate returned value per product
                returned_value = 0.0
                for mv in return_moves_for_order:
                    sale_line = mv.sale_line_id or order.order_line.filtered(
                        lambda l: l.product_id == mv.product_id
                    )[:1]
                    price_unit = sale_line.price_unit if sale_line else (mv.product_id.lst_price or 0.0)
                    tax_factor = 1.0
                    if sale_line and sale_line.tax_id:
                        taxes = sale_line.tax_id.compute_all(price_unit, order.currency_id, mv.quantity, mv.product_id, order.partner_id)
                        returned_value += taxes['total_included']
                    else:
                        returned_value += price_unit * mv.quantity
                
                if returned_value <= 0:
                    _logger.info(f"Sync: Returned value is {returned_value} for order {order.name}, skipping auto-refund")
                    continue
                
                try:
                    original_invoice = posted_invoices[0]
                    # Use account.move.reversal wizard to create a partial credit note
                    reversal_wizard = request.env['account.move.reversal'].with_user(user).create({
                        'move_ids': [(6, 0, [original_invoice.id])],
                        'reason': payload.get('return_reason') or 'Return of goods',
                        'journal_id': original_invoice.journal_id.id,
                        'date': fields.Date.today(),
                    })
                    reversal_result = reversal_wizard.refund_moves()
                    
                    # Get the created credit note
                    if reversal_result and reversal_result.get('res_id'):
                        credit_note = request.env['account.move'].with_user(user).browse(reversal_result['res_id'])
                    else:
                        # Fallback: find the draft credit note just created
                        credit_note = request.env['account.move'].sudo().search([
                            ('reversed_entry_id', '=', original_invoice.id),
                            ('state', '=', 'draft'),
                            ('move_type', '=', 'out_refund'),
                        ], order='id desc', limit=1)
                    
                    if credit_note:
                        # Find the sale lines from the original invoice
                        sale_lines_by_product = {}
                        for orig_line in original_invoice.invoice_line_ids:
                            for sl in orig_line.sale_line_ids:
                                if sl.product_id not in sale_lines_by_product:
                                    sale_lines_by_product[sl.product_id] = request.env['sale.order.line']
                                sale_lines_by_product[sl.product_id] |= sl

                        # Adjust credit note lines to match only what was returned
                        for cn_line in credit_note.invoice_line_ids:
                            if cn_line.product_id:
                                # Ensure sale lines are correctly linked for traceability
                                if cn_line.product_id in sale_lines_by_product:
                                    cn_line.sale_line_ids = [(6, 0, sale_lines_by_product[cn_line.product_id].ids)]
                                
                                # Find the qty returned for this product
                                ret_qty = sum(
                                    mv.quantity for mv in return_moves_for_order
                                    if mv.product_id == cn_line.product_id
                                )
                                if ret_qty > 0:
                                    cn_line.quantity = ret_qty
                                else:
                                    cn_line.quantity = 0
                        
                        # Remove lines with zero quantity
                        lines_to_remove = credit_note.invoice_line_ids.filtered(lambda l: l.quantity == 0)
                        if lines_to_remove:
                            lines_to_remove.unlink()
                            
                        # Recompute taxes and totals (Odoo 17 way)
                        if credit_note.state == 'draft':
                            try:
                                credit_note.with_context(mail_create_nosubscribe=True, mail_auto_subscribe_no_notify=True).action_post()
                            except Exception as e:
                                _logger.warning(f"Sync: Non-blocking post failure for credit note {credit_note.name}: {e}")
                            
                            # Apply consistent reconciliation logic
                            self._reconcile_refund_logic(credit_note, original_invoice, order)

                        created_refunds.append({'invoice_id': credit_note.id, 'name': credit_note.name})
                        _logger.info(f"Sync: Auto-created credit note {credit_note.name} for return on order {order.name}")
                    
                except Exception as e:
                    _logger.error(f"Sync: Failed to auto-create credit note for order {order.name}: {e}")
        else:
            for rp in created_return_pickings:
                validated_pickings.append({'picking_id': rp.id, 'name': rp.name})
                
        # Even if multiple were created, we return success if at least one was
        if validated_pickings:
             res_dict = {
                 'success': True, 
                 'returns_created': validated_pickings, 
                 'picking_id': validated_pickings[0]['picking_id'], 
                 'name': validated_pickings[0]['name']
             }
             if sales_rep and sales_rep.auto_receive and 'created_refunds' in locals() and created_refunds:
                 res_dict['refunds_created'] = created_refunds
             return res_dict
             
        # If we reached here, no returns were created (maybe everything was already returned)
        return {'result': False, 'message': 'No available quantities to return across provided pickings'}

    def _action_receive_returns(self, payload, user):
        picking_ids = payload.get('picking_ids', [])
        if not picking_ids:
            raise ValueError('No pickings provided to receive')

        pickings = request.env['stock.picking'].with_user(user).search([('id', 'in', picking_ids)])
        if not pickings:
            raise ValueError('Pickings not found')

        validated_pickings = []
        for picking in pickings:
            if picking.state not in ('done', 'cancel'):
                # Ensure quantities stay at max defined for return
                for move in picking.move_ids:
                    move.sudo().write({'quantity': move.product_uom_qty, 'picked': True})
                    # Force-set move lines
                    if move.move_line_ids:
                        first_ml = move.move_line_ids[0]
                        first_ml.sudo().write({
                            'quantity': move.product_uom_qty,
                            'product_uom_id': move.product_uom.id
                        })
                        if len(move.move_line_ids) > 1:
                            for extra_ml in move.move_line_ids[1:]:
                                extra_ml.sudo().write({'quantity': 0})
                    else:
                        request.env['stock.move.line'].sudo().create({
                            'move_id': move.id,
                            'picking_id': picking.id,
                            'product_id': move.product_id.id,
                            'product_uom_id': move.product_uom.id,
                            'location_id': move.location_id.id,
                            'location_dest_id': move.location_dest_id.id,
                            'quantity': move.product_uom_qty,
                        })
                
                picking.with_context(
                    skip_backorder=True, 
                    skip_sms=True,
                    mail_notrack=True,
                    mail_create_nolog=True,
                    mail_create_nosubscribe=True,
                    no_reset_password=True
                ).button_validate()
                validated_pickings.append(picking.id)

        request.env.flush_all()
        try:
            request.env['sale.order.line'].invalidate_model(['qty_delivered'])
        except Exception:
            pass
            
        # --- Auto-Create Refund Invoice (Credit Note) for Returned Products ---
        # Get the related Sales Order from the pickings
        sale_orders = pickings.mapped('sale_id')
        created_refunds = []
        
        for order in sale_orders:
            # Find the most recent posted original invoice for this order
            posted_invoices = order.invoice_ids.filtered(
                lambda inv: inv.move_type == 'out_invoice' and inv.state == 'posted'
            ).sorted('invoice_date', reverse=True)
            
            if not posted_invoices:
                _logger.info(f"Sync: No posted invoice found for order {order.name}, skipping auto-refund in receive")
                continue
            
            # Find the return moves that came from this order's deliveries
            return_moves_for_order = request.env['stock.move'].search([
                ('picking_id', 'in', pickings.ids),
                ('state', '=', 'done')
            ])
            # Filter moves linked to this order
            return_moves_for_order = return_moves_for_order.filtered(
                lambda mv: mv.origin_returned_move_id and mv.origin_returned_move_id.picking_id.sale_id == order
            )
            
            if not return_moves_for_order:
                _logger.info(f"Sync: No return moves found for order {order.name} in receive, skipping auto-refund")
                continue
            
            try:
                original_invoice = posted_invoices[0]
                # Use reversal wizard
                reversal_wizard = request.env['account.move.reversal'].with_user(user).create({
                    'move_ids': [(6, 0, [original_invoice.id])],
                    'reason': payload.get('return_reason') or 'Return of goods (Manual)',
                    'journal_id': original_invoice.journal_id.id,
                    'date': fields.Date.today(),
                })
                reversal_result = reversal_wizard.refund_moves()
                
                credit_note = None
                if reversal_result and isinstance(reversal_result, dict) and reversal_result.get('res_id'):
                    credit_note = request.env['account.move'].with_user(user).browse(reversal_result['res_id'])
                else:
                    credit_note = request.env['account.move'].sudo().search([
                        ('reversed_entry_id', '=', original_invoice.id),
                        ('move_type', '=', 'out_refund'),
                    ], order='id desc', limit=1)
                
                if credit_note:
                    # --- Traceability: Link back to sale order lines ---
                    product_to_sale_lines = {}
                    for inv_line in original_invoice.invoice_line_ids:
                        for sl in inv_line.sale_line_ids:
                            if sl.product_id.id not in product_to_sale_lines:
                                product_to_sale_lines[sl.product_id.id] = request.env['sale.order.line']
                            product_to_sale_lines[sl.product_id.id] |= sl

                    # Adjust credit note lines
                    for cn_line in credit_note.invoice_line_ids:
                        if cn_line.product_id:
                            # Link to sale lines
                            if cn_line.product_id.id in product_to_sale_lines:
                                cn_line.sale_line_ids = [(6, 0, product_to_sale_lines[cn_line.product_id.id].ids)]
                            
                            ret_qty = sum(
                                mv.quantity for mv in return_moves_for_order
                                if mv.product_id == cn_line.product_id
                            )
                            if ret_qty > 0:
                                cn_line.quantity = ret_qty
                            else:
                                cn_line.quantity = 0
                    
                    # Remove lines with zero quantity
                    lines_to_remove = credit_note.invoice_line_ids.filtered(lambda l: l.quantity == 0)
                    if lines_to_remove:
                        lines_to_remove.unlink()
                    
                    # Recompute and post
                    if credit_note.state == 'draft':
                        
                        # Prevent empty invoices
                        if any(l.quantity > 0 for l in credit_note.invoice_line_ids):
                            try:
                                credit_note.with_context(mail_create_nosubscribe=True, mail_auto_subscribe_no_notify=True).action_post()
                            except Exception as e:
                                _logger.warning(f"Sync: Non-blocking post failure for credit note {credit_note.name}: {e}")
                            
                            # Apply consistent reconciliation logic
                            self._reconcile_refund_logic(credit_note, original_invoice, order)
                            
                            created_refunds.append({'invoice_id': credit_note.id, 'name': credit_note.name})
                        else:
                            _logger.warning(f"Sync: Credit note for {order.name} would be empty, skipping post")
                            credit_note.unlink()
                    else:
                        created_refunds.append({'invoice_id': credit_note.id, 'name': credit_note.name})

            except Exception as e:
                _logger.error(f"Sync: Failed to auto-create refund invoice for order {order.name}: {e}")

        return {
            'success': True, 
            'validated': validated_pickings,
            'refunds_created': created_refunds
        }

    def _action_refund_invoice(self, payload, user):
        env = request.env
        invoice = env['account.move'].with_user(user).browse(payload['invoice_id'])

        if not invoice.exists():
            raise ValueError('Invoice not found')
            
        # 🛡️ Guard: Redundancy check. If it's already a refund, ignore
        if invoice.move_type == 'out_refund':
            _logger.info(f"Sync: Action refund_invoice called on an already existing refund {invoice.id}, skipping")
            return {'success': True, 'skipped': True, 'reason': 'already_refund'}
            
        # 🛡️ Guard: Only reverse posted moves
        if invoice.state != 'posted':
            _logger.warning(f"Sync: Action refund_invoice called on unposted move {invoice.id}, skipping")
            return {'success': True, 'skipped': True, 'reason': 'not_posted'}

        reason = payload.get('reason', 'Return')
        refund_type = payload.get('refund_type', 'credit')

        _logger.info(f"Creating refund for invoice {invoice.name} ({invoice.id})")

        # 1️⃣ Create reversal using Odoo wizard
        wizard = env['account.move.reversal'].sudo().with_context(
            active_model='account.move',
            active_ids=[invoice.id]
        ).create({
            'reason': reason,
            'journal_id': invoice.journal_id.id,
            'date': fields.Date.today(),
        })

        res = wizard.reverse_moves()

        # 2️⃣ Get created credit note
        refund = None
        if isinstance(res, dict) and res.get('res_id'):
            refund = env['account.move'].browse(res['res_id'])
        else:
            refund = env['account.move'].search([
                ('reversed_entry_id', '=', invoice.id),
                ('move_type', '=', 'out_refund')
            ], limit=1)

        if not refund:
            raise ValueError("Failed to create credit note")

        _logger.info(f"Credit note created: {refund.name} ({refund.id})")

        # =========================================================
        # 🔥 ROBUST quantity update (preserves taxes and accounts)
        # =========================================================

        return_lines = payload.get('return_lines', [])

        if refund.state != 'draft':
            _logger.warning("Refund already posted, cannot modify")
        else:
            # Map original invoice lines back to sale lines for traceability update
            product_to_sale_lines = {}
            for inv_line in invoice.invoice_line_ids:
                for sl in inv_line.sale_line_ids:
                    if sl.product_id.id not in product_to_sale_lines:
                        product_to_sale_lines[sl.product_id.id] = env['sale.order.line']
                    product_to_sale_lines[sl.product_id.id] |= sl

            if return_lines:
                # Match return lines to credit note lines
                # We update quantities and remove lines that aren't being returned
                lines_to_keep_qty = {} # product_id: quantity
                for rl in return_lines:
                    pid = int(rl['product_id'])
                    lines_to_keep_qty[pid] = lines_to_keep_qty.get(pid, 0.0) + float(rl['quantity'])
                
                lines_to_remove = env['account.move.line']
                for inv_line in refund.invoice_line_ids:
                    if not inv_line.product_id:
                        continue
                    
                    # Ensure traceability
                    if inv_line.product_id.id in product_to_sale_lines:
                        inv_line.sale_line_ids = [(6, 0, product_to_sale_lines[inv_line.product_id.id].ids)]

                    if inv_line.product_id.id in lines_to_keep_qty:
                        # Update quantity and UoM
                        inv_line.write({
                            'quantity': lines_to_keep_qty[inv_line.product_id.id],
                            'product_uom_id': inv_line.product_uom_id.id # Explicitly maintain UoM
                        })
                        # Track it so we don't return the same product twice if multiple lines
                        lines_to_keep_qty[inv_line.product_id.id] = 0 
                    else:
                        # Not in returns list, remove from credit note
                        lines_to_remove |= inv_line
                
                if lines_to_remove:
                    lines_to_remove.unlink()
                
                # Recompute taxes and totals after quantity changes (Odoo 17 way)
                refund._onchange_invoice_line_ids()
                refund._compute_amount()

            else:
                # Full refund -> ensure sale lines linked for traceability
                for inv_line in refund.invoice_line_ids:
                    if inv_line.product_id.id in product_to_sale_lines:
                        inv_line.sale_line_ids = [(6, 0, product_to_sale_lines[inv_line.product_id.id].ids)]

        # =========================================================
        # ✅ Post the credit note (only if not empty)
        # =========================================================

        if refund.state == 'draft':
            if any(l.quantity > 0 for l in refund.invoice_line_ids):
                try:
                    refund.with_context(mail_create_nosubscribe=True, mail_auto_subscribe_no_notify=True).action_post()
                except Exception as e:
                    _logger.warning(f"Sync: Non-blocking post failure for refund {refund.id}: {e}")
                # Reconciliation handled below in CENTRALIZED RECONCILE block
            else:
                _logger.warning(f"Sync: Skipping post for empty refund {refund.id}")
                return {'success': True, 'message': 'Refund skipped (empty)', 'refund_id': refund.id}

        # =========================================================
        # CENTRALIZED RECONCILE
        # =========================================================

        if refund_type == 'credit':
            sale_order = invoice.line_ids.sale_line_ids.order_id[:1]
            self._reconcile_refund_logic(refund, invoice, sale_order)

        # =========================================================
        # 💰 DIRECT REFUND (Cash/Bank)
        # =========================================================

        if refund_type == 'refund' and payload.get('journal_id'):
            journal = env['account.journal'].sudo().browse(int(payload['journal_id']))

            if journal.exists() and journal.type in ['cash', 'bank']:
                payment_register = env['account.payment.register'].sudo().with_context(
                    active_model='account.move',
                    active_ids=[refund.id]
                ).create({
                    'journal_id': journal.id,
                    'amount': refund.amount_residual,
                    'payment_date': fields.Date.today(),
                })

                payment_register._create_payments()

        return {
            'refund_id': refund.id,
            'name': refund.name,
            'amount': refund.amount_residual
        }

    def _action_apply_promotion(self, payload, user):
        order = request.env['sale.order'].with_user(user).browse(payload['order_id'])
        if not order.exists():
            raise ValueError('Order not found')
        # Recompute coupons/promotions (requires loyalty module)
        try:
            order._update_programs_and_rewards()
            return {'order_id': order.id}
        except Exception:
            return {'skipped': True, 'reason': 'Promotion module not available'}

    def _action_add_order_line(self, payload, user):
        order = self._get_order_from_payload(payload, user)
        location_id = payload.get('location_id')
        
        # Check for existing line for this product on this order (Idempotency)
        search_domain = [
            ('order_id', '=', order.id),
            ('product_id', '=', int(payload['product_id']))
        ]
        if location_id:
            search_domain.append(('location_id', '=', int(location_id)))
        else:
            search_domain.append(('location_id', '=', False))

        existing_line = request.env['sale.order.line'].with_user(user).search(search_domain, limit=1)

        if existing_line:
            _logger.info(f"Sync: Updating existing line {existing_line.id} for product {payload['product_id']} on order {order.name}")
            update_vals = {
                'product_uom_qty': payload.get('quantity', 1.0),
                'price_unit': payload.get('price_unit') or existing_line.price_unit,
            }
            # Handle UoM
            uom_id = payload.get('product_uom_id')
            if uom_id:
                uom = request.env['uom.uom'].with_user(user).browse(int(uom_id))
                if uom.exists():
                    update_vals['product_uom'] = uom.id
            
            existing_line.write(update_vals)
            return {'line_id': existing_line.id, 'order_id': order.id, 'updated': True}

        vals = {
            'order_id': order.id,
            'product_id': int(payload['product_id']),
            'product_uom_qty': payload.get('quantity', 1.0),
            'price_unit': payload.get('price_unit'),
        }
        if location_id:
            vals['location_id'] = int(location_id)
        # Handle UoM
        uom_id = payload.get('product_uom_id')
        if uom_id:
            uom = request.env['uom.uom'].with_user(user).browse(int(uom_id))
            if uom.exists():
                vals['product_uom'] = uom.id
        if hasattr(request.env['sale.order.line'], 'is_reward_line'):
            vals['is_reward_line'] = payload.get('is_reward_line', False)
        # Optional: tax_id, discount, etc. if sent in payload
        
        line = request.env['sale.order.line'].with_user(user).create(vals)
        return {'line_id': line.id, 'order_id': order.id}

    def _action_modify_order_line(self, action_type, payload, user):
        line = request.env['sale.order.line'].with_user(user).browse(payload['line_id'])
        if not line.exists():
            return {'line_id': payload['line_id'], 'error': 'Line not found'}
        
        order = line.order_id
        if action_type == 'update_order_line':
            vals = {}
            if 'quantity' in payload and payload.get('quantity') is not None:
                vals['product_uom_qty'] = payload['quantity']
            
            uom_id = payload.get('product_uom_id') or payload.get('uom_id')
            if uom_id:
                uom = request.env['uom.uom'].with_user(user).browse(int(uom_id))
                if uom.exists():
                    vals['product_uom'] = uom.id
            
            if 'price_unit' in payload and payload.get('price_unit') is not None:
                vals['price_unit'] = payload['price_unit']

            if vals:
                line.write(vals)
                _logger.info(f"Sync: Updated line {line.id} with {vals}")
        else:  # remove_order_line
            line.unlink()
            _logger.info(f"Sync: Removed line {payload['line_id']}")

        # Re-apply promotions for draft orders
        # REMOVED: Recalculation is now only on confirmation.

        return {'line_id': payload['line_id']}

    def _auto_deliver_and_invoice(self, order, user, sales_rep=None):
        """Helper: process delivery + create invoice for an order."""
        try:
            # Re-fetch picking_ids in case promotions added new moves/pickings
            order.invalidate_recordset(['picking_ids'])
            for picking in order.picking_ids:
                if picking.state in ('done', 'cancel'):
                    continue
                picking = picking.sudo()
                if picking.state == 'draft':
                    picking.action_confirm()
                if picking.state in ('confirmed', 'waiting'):
                    picking.action_assign()
                # Force-set quantities on moves
                for move in picking.move_ids:
                    move.write({'quantity': move.product_uom_qty, 'picked': True})
                # Also force-set quantities on move lines to match demand
                # This prevents partial delivery when stock isn't fully available
                for move in picking.move_ids:
                    if move.move_line_ids:
                        total_ml_qty = sum(move.move_line_ids.mapped('quantity'))
                        if total_ml_qty < move.product_uom_qty:
                            first_ml = move.move_line_ids[0]
                            first_ml.write({
                                'quantity': move.product_uom_qty,
                                'product_uom_id': move.product_uom.id
                            })
                            if len(move.move_line_ids) > 1:
                                for extra_ml in move.move_line_ids[1:]:
                                    extra_ml.write({'quantity': 0})
                    else:
                        # No move lines created (no stock available) - create one
                        request.env['stock.move.line'].create({
                            'move_id': move.id,
                            'picking_id': picking.id,
                            'product_id': move.product_id.id,
                            'product_uom_id': move.product_uom.id,
                            'location_id': move.location_id.id,
                            'location_dest_id': move.location_dest_id.id,
                            'quantity': move.product_uom_qty,
                        })
                request.env.flush_all()
                # Use context to skip all mail/tracking to avoid "Unable to send message" errors
                picking.with_context(
                    skip_backorder=True, 
                    skip_sms=True,
                    mail_notrack=True,
                    mail_create_nolog=True,
                    mail_create_nosubscribe=True,
                    no_reset_password=True
                ).button_validate()
            invoices = order.with_user(user)._create_invoices()
            if invoices:
                for inv in invoices:
                    inv.action_post()
                    # ADDED: Check cash status for standalone confirmation actions
                    if order.is_cash:
                        _logger.info(f"Sync: Order {order.name} is CASH, triggering auto-payment for invoice {inv.name} in standalone confirm")
                        self._reconcile_cash_invoice(inv, order, sales_rep)
                    else:
                        _logger.info(f"Sync: Order {order.name} is CREDIT, skipping auto-payment in standalone confirm")
        except Exception as e:
            _logger.warning(f"Auto deliver/invoice failed for {order.name}: {e}")



    # --- Customer Creation ---
    def _action_create_customer(self, payload, user, sales_rep):
        """Create a new customer (res.partner) and link to route if needed."""
        try:
            customer_data = payload.get('customer_data', {})
            route_id = payload.get('route_id')

            _logger.info(f"Sync: Creating customer {customer_data.get('name')} with data: {customer_data}")
            _logger.info(f"Sync: Route ID: {route_id}")

            # 1. Prepare partner values
            vals = {
                'name': customer_data.get('name'),
                'email': customer_data.get('email'),
                'phone': customer_data.get('phone'),
                'mobile': customer_data.get('mobile'),
                'street': customer_data.get('street'),
                'city': customer_data.get('city'),
                'vat': customer_data.get('vat'),
                'comment': customer_data.get('comment'),
                'customer_rank': 1, # It's a customer
                'company_id': sales_rep.company_id.id if sales_rep.company_id else False,
                'user_id': sales_rep.user_id.id if sales_rep.user_id else False, # Assign to sales rep user
                'mobile_local_id': customer_data.get('local_id'), # Save original mobile local_id
                'visit_latitude': float(customer_data.get('latitude', 0) or 0),
                'visit_longitude': float(customer_data.get('longitude', 0) or 0),
                'is_cash': customer_data.get('is_cash', True),
            }

            # Handle relational fields (Pricelist, Payment Term) safely
            if customer_data.get('property_product_pricelist'):
                try:
                    pricelist_id = int(customer_data['property_product_pricelist'])
                    vals['property_product_pricelist'] = pricelist_id
                    
                    # Override is_cash based on pricelist property (as requested)
                    pricelist = request.env['product.pricelist'].sudo().browse(pricelist_id)
                    if pricelist.exists():
                        vals['is_cash'] = pricelist.is_sales_cash
                        # Inherit sales limit from pricelist
                        if 'sale_credit_limit' in request.env['res.partner']._fields:
                            vals['sale_credit_limit'] = pricelist.sales_limit
                        elif 'credit_limit' in request.env['res.partner']._fields:
                            vals['credit_limit'] = pricelist.sales_limit
                except (ValueError, TypeError):
                    _logger.warning(f"Sync: Invalid pricelist ID: {customer_data['property_product_pricelist']}")

            if customer_data.get('property_payment_term_id'):
                try:
                    vals['property_payment_term_id'] = int(customer_data['property_payment_term_id'])
                except (ValueError, TypeError):
                    _logger.warning(f"Sync: Invalid payment term ID: {customer_data['property_payment_term_id']}")

            Partner = request.env['res.partner'].sudo()

            # Check for existing partner with same mobile_local_id to avoid duplicates
            existing_partner = Partner.search([
                ('mobile_local_id', '=', customer_data.get('local_id')),
                ('mobile_local_id', '!=', False)
            ], limit=1)

            if existing_partner:
                _logger.info(f"Sync: Customer {customer_data.get('name')} already exists with local_id {customer_data.get('local_id')}. Skipping creation.")
                new_partner = existing_partner
            else:
                # Smart Duplicate Prevention: Check mobile, phone, or vat
                mobile = customer_data.get('mobile')
                phone = customer_data.get('phone')
                vat = customer_data.get('vat')
                
                or_conditions = []
                if mobile and len(str(mobile).strip()) > 4:
                    or_conditions.append(('mobile', '=', mobile.strip()))
                    or_conditions.append(('phone', '=', mobile.strip()))
                if phone and len(str(phone).strip()) > 4:
                    or_conditions.append(('mobile', '=', phone.strip()))
                    or_conditions.append(('phone', '=', phone.strip()))
                if vat and len(str(vat).strip()) > 2:
                    or_conditions.append(('vat', '=', vat.strip()))
                
                smart_partner = False
                if or_conditions:
                    search_domain = ['|'] * (len(or_conditions) - 1) + or_conditions
                    company_id = sales_rep.company_id.id if sales_rep.company_id else False
                    search_domain = ['&', ('company_id', 'in', [company_id, False])] + search_domain
                    smart_partner = Partner.search(search_domain, limit=1)
                
                if smart_partner:
                    _logger.info(f"Sync: Smart duplicate prevention matched existing partner: {smart_partner.name} (ID: {smart_partner.id})")
                    # Update mobile_local_id if not already set to ensure future sync works perfectly
                    if not smart_partner.mobile_local_id:
                        smart_partner.write({'mobile_local_id': customer_data.get('local_id')})
                    new_partner = smart_partner
                else:
                    try:
                        new_partner = Partner.create(vals)
                        # Automatically perform reverse geocoding if location provided
                        if new_partner.visit_latitude and new_partner.visit_longitude:
                            new_partner.action_reverse_geocode(background=True)
                    except IntegrityError:
                        # Parallel request might have created the partner just now
                        _logger.warning(f"Sync: Concurrency conflict for {customer_data.get('name')}. Searching again.")
                        new_partner = Partner.search([
                            ('mobile_local_id', '=', customer_data.get('local_id')),
                            ('mobile_local_id', '!=', False)
                        ], limit=1)
                        if not new_partner:
                            _logger.error(f"Sync: IntegrityError but no partner found for {customer_data.get('local_id')}")
                            raise ValueError(f"Constraint violation: Data integrity error for {customer_data.get('name')}")
                    except Exception as e:
                        _logger.error(f"Sync: Failed to create res.partner: {e}")
                        raise ValueError(f"Failed to create customer record: {e}")

            # 3. Handle location logging
            if customer_data.get('latitude') is not None and customer_data.get('longitude') is not None:
                _logger.info(f"Sync: Location saved in creation for partner {new_partner.id}: Lat={customer_data['latitude']}, Lng={customer_data['longitude']}")
            else:
                 _logger.warning(f"Sync: No location data provided in payload: {customer_data.keys()}")

            result = {
                'partner_odoo_id': new_partner.id,
                'partner_name': new_partner.name
            }

            # 4. Link to Route (sales.route.customer) if route_id provided
            if route_id:
                try:
                    route_id_int = int(route_id)
                    RouteCustomer = request.env['sales.route.customer'].sudo()
                    
                    # Check if link already exists? (Unlikely for new partner)
                    
                    new_route_customer = RouteCustomer.create([{
                        'route_id': route_id_int,
                        'partner_id': new_partner.id,
                        # 'name' field does not exist in backend model (it's in local DB only)
                        'sequence': 999, # Append to end
                    }])[0]
                    result['route_customer_odoo_id'] = new_route_customer.id
                    _logger.info(f"Sync: Linked new customer {new_partner.name} to route {route_id}")
                except Exception as e:
                    _logger.error(f"Sync: Failed to link to route {route_id}: {e}")
                    # Don't fail the whole action if route linking fails, but it's important.
                    # We should probably raise validation error or log it clearly.
                    result['warning'] = f"Customer created but failed to link to route: {e}"

            return result

        except Exception as e:
            _logger.error(f"Sync: _action_create_customer CRITICAL ERROR: {e}", exc_info=True)
            raise e

    def _process_downloads(self, sales_rep, last_sync_date, user):
        # Format last_sync_date for Odoo domain [YYYY-MM-DD HH:MM:SS]
        # mobile app might send it in various ISO formats
        since = False
        if last_sync_date:
            try:
                # Odoo expects UTC strings. If the app sends ISO, we might need to truncate/parse.
                # Common format from JS: 2026-02-19T04:06:56.000Z -> 2026-02-19 04:06:56
                since = last_sync_date.replace('T', ' ').split('.')[0].replace('Z', '')
                _logger.info(f"Sync: Fetching updates since {since}")
            except Exception as e:
                _logger.warning(f"Failed to parse last_sync_date {last_sync_date}: {e}")

        def get_delta_domain(base_domain):
            if since:
                return base_domain + [('write_date', '>', since)]
            return base_domain
        
        downloads = {
            'sales_rep_profile': {
                'id': sales_rep.id,
                'name': sales_rep.name,
                'email': sales_rep.email,
                'user_id': sales_rep.user_id.id,
                'company_id': sales_rep.company_id.id,
                'company_name': sales_rep.company_id.name,
                'sale_team_id': sales_rep.user_id.sale_team_id.id if sales_rep.user_id.sale_team_id else False,
                'image_url': f"data:image/png;base64,{sales_rep.user_id.image_128.decode('utf-8') if isinstance(sales_rep.user_id.image_128, bytes) else sales_rep.user_id.image_128}" if (sales_rep.user_id and sales_rep.user_id.image_128) else None,
                'is_supervisor': sales_rep.is_supervisor,
                'is_manager': sales_rep.is_manager,
                'supervisor_id': sales_rep.supervisor_id.id if sales_rep.supervisor_id else False,
                'auto_delivery': sales_rep.auto_delivery,
                'auto_receive': sales_rep.auto_receive,
                'invoice_journal_id': sales_rep.invoice_journal_id.id if sales_rep.invoice_journal_id else False,
                'default_location_id': sales_rep.default_location_id.id if sales_rep.default_location_id else False,
                'default_location_name': sales_rep.default_location_id.display_name if sales_rep.default_location_id else False,
                'default_location_ids': [{'id': loc.id, 'name': loc.display_name} for loc in sales_rep.default_location_ids],
                'return_location_id': sales_rep.return_location_id.id if sales_rep.return_location_id else False,
                'return_location_ids': [{'id': loc.id, 'name': loc.display_name} for loc in sales_rep.return_location_ids],
                'product_category_ids': sales_rep.product_category_ids.ids,
                'product_categories': [{'id': c.id, 'name': c.display_name} for c in sales_rep.product_category_ids],
                'payment_method_ids': sales_rep.payment_method_ids.ids,
                'default_pricelist_id': sales_rep.available_pricelist_ids[0].id if sales_rep.available_pricelist_ids else False,
                'payment_term_id': sales_rep.available_payment_term_ids[0].id if sales_rep.available_payment_term_ids else False,
                'discount_product_id': sales_rep.discount_product_id.id if sales_rep.discount_product_id else False,
                'location_request_id': sales_rep.location_request_id.id if sales_rep.location_request_id else False,
                'location_request_name': sales_rep.location_request_id.display_name if sales_rep.location_request_id else False,
                'location_request_ids': [{'id': loc.id, 'name': loc.display_name} for loc in sales_rep.location_request_ids],
                'location_general_return_id': sales_rep.location_general_return.id if hasattr(sales_rep, 'location_general_return') and sales_rep.location_general_return else False,
                'location_general_return_name': sales_rep.location_general_return.display_name if hasattr(sales_rep, 'location_general_return') and sales_rep.location_general_return else False,
                'location_general_return_ids': [{'id': loc.id, 'name': loc.display_name} for loc in sales_rep.location_general_return_ids] if hasattr(sales_rep, 'location_general_return_ids') else [],
                # Access Rights
                'access_cash_balance': sales_rep.access_cash_balance,
                'access_storage': sales_rep.access_storage,
                'access_returns': sales_rep.access_returns,
                'access_general_return': sales_rep.access_general_return if hasattr(sales_rep, 'access_general_return') else False,
                'access_confirm_quotation': sales_rep.access_confirm_quotation,
                'access_delivery': sales_rep.access_delivery,
                'access_payment': sales_rep.access_payment,
                'access_discount': sales_rep.access_discount,
                'access_inventory_adjustment': sales_rep.access_inventory_adjustment,
                'access_sales_report': sales_rep.access_sales_report,
                'access_customer_debt_report': sales_rep.access_customer_debt_report,
                'access_collection_report': sales_rep.access_collection_report,
                'access_journal_report': sales_rep.access_journal_report,
                'access_requests': sales_rep.access_requests,
                'access_cancel_quotation': sales_rep.access_cancel_quotation,
                'access_visit_order': sales_rep.access_visit_order,
                'access_visit_payment': sales_rep.access_visit_payment,
                'access_create_customer': sales_rep.access_create_customer,
                'access_mock_location': sales_rep.access_mock_location,
                'access_force_logout_on_mock_location': sales_rep.access_force_logout_on_mock_location,
                'access_developer_mode': sales_rep.access_developer_mode,
                'access_force_logout_on_developer_mode': sales_rep.access_force_logout_on_developer_mode,
            },
            'routes': [],
            'route_customers': [],
            'products': [],
            'visits': [],
            'collections': [],
            'invoices': [],
            'invoice_lines': [],
            'payments': [],
            'payment_methods': [],
            'sales_orders': [],
            'sales_order_lines': [],
            'payment_journals': [],
            'pricelists': [],
            'pricelist_items': [],
            'payment_terms': [],
            'return_reasons': [],
            'uom_categories': [],
            'uoms': [],
            'stock_requests': [],
            'stock_pickings': [],
            'stock_moves': [],
        }
        
        # 1. Routes (Active and today/future)
        domain = [
            ('sales_rep_id', '=', sales_rep.id),
            ('state', 'in', ['in_progress']),
            ('company_id', '=', sales_rep.company_id.id),
        ]
        
        # We always fetch ALL active routes regardless of last_sync_date to ensure 
        # reliability for current operations. Delta sync is applied to other models.
        routes = request.env['sales.rep.route'].with_user(user).search_read(
            domain, 
            ['id', 'name', 'date', 'state', 'start_time', 'end_time', 'sales_rep_id']
        )
        downloads['routes'] = routes
        
        # 2. Route Customers
        # Fetch all customers for the routes we just found
        active_route_ids = [r['id'] for r in routes]
        if active_route_ids:
            rc_domain = [('route_id', 'in', active_route_ids)]
            customers = request.env['sales.route.customer'].with_user(user).search_read(
                rc_domain,
                ['id', 'route_id', 'partner_id', 'sequence', 'state', 'visit_start_time', 'visit_end_time', 'visit_notes', 'visit_type_id']
            )
        else:
            customers = []
            
        # Enrich with partner info (address, coords, phone)
        partner_ids = [c['partner_id'][0] for c in customers if c['partner_id']]
        # Build field list — include financial limit fields if the module is installed
        partner_fields = ['id', 'name', 'display_name', 'street', 'city', 'state_id', 'country_id', 'area', 'phone', 'email', 'is_cash', 'visit_latitude', 'visit_longitude', 'property_product_pricelist', 'property_payment_term_id', 'credit_limit', 'total_due', 'enable_location', 'location_radius', 'mobile_local_id', 'category_id']
        if 'sale_credit_limit' in request.env['res.partner']._fields:
            partner_fields += ['sale_credit_limit', 'allow_over_sale_credit', 'sale_credit_used']
        partners = request.env['res.partner'].with_user(user).search_read(
            [('id', 'in', partner_ids), ('company_id', 'in', [sales_rep.company_id.id, False])],
            partner_fields
        )
        for p in partners:
            if p.get('country_id'): p['country_id'] = p['country_id'][0]
            if p.get('state_id'): p['state_id'] = p['state_id'][0]
            if p.get('property_payment_term_id'): p['property_payment_term_id'] = p['property_payment_term_id'][0]
            if p.get('property_product_pricelist'): p['property_product_pricelist'] = p['property_product_pricelist'][0]
        partner_map = {p['id']: p for p in partners}
            
        loyalty_map = {}
        try:
            loyalty_cards = request.env['loyalty.card'].with_user(user).search_read(
                [('partner_id', 'in', partner_ids)],
                ['partner_id', 'points']
            )
            for card in loyalty_cards:
                    pid = card['partner_id'][0]
                    if pid not in loyalty_map:
                        loyalty_map[pid] = 0
                    loyalty_map[pid] += card['points']
        except Exception as e:
            _logger.warning(f"Sync: Loyalty module not found or accessible: {e}")

        for c in customers:
            pid = c['partner_id'][0] if c['partner_id'] else None
            if pid and pid in partner_map:
                p = partner_map[pid]
                c['name'] = p['name'] # Manually add name from partner
                c['address'] = f"{p.get('street') or ''}, {p.get('city') or ''}".strip(', ')
                c['phone'] = p.get('phone') or p.get('mobile')
                c['email'] = p.get('email')
                # Prioritize custom fields (visit_*) over standard (partner_*)
                c['latitude'] = p.get('visit_latitude') or p.get('partner_latitude')
                c['longitude'] = p.get('visit_longitude') or p.get('partner_longitude')
                c['radius'] = p.get('location_radius', 0.0)
                c['enable_location'] = p.get('enable_location', True)
                c['location_radius'] = p.get('location_radius', 0.0)
                c['is_cash'] = p.get('is_cash', True)
                c['state_id'] = p.get('state_id')
                c['country_id'] = p.get('country_id')
                c['area'] = p.get('area')
                c['category_id_json'] = json.dumps(p.get('category_id') or [])

                # Handle visit_type_id (Tuple -> Name)
                if c.get('visit_type_id') and isinstance(c['visit_type_id'], (list, tuple)):
                    c['visit_type_name'] = c['visit_type_id'][1]
                    c['visit_type_id'] = c['visit_type_id'][0]
                else:
                    c['visit_type_name'] = None
                    c['visit_type_id'] = c.get('visit_type_id') or False
                
                # Add full partner details for local record creation
                c['partner_data'] = p
                c['partner_data']['loyalty_points'] = loyalty_map.get(pid, 0)
            else:
                c['name'] = 'Unknown Customer'
        
        downloads['route_customers'] = customers

        # 2b. Promotions (Loyalty Programs)
        try:
             # Check if loyalty module is available
             if 'loyalty.program' not in request.env:
                 _logger.info("Sync: Loyalty module not installed, skipping promotions.")
                 downloads['promotions'] = []
             else:
                  
                 # Fetch active programs with rules and rewards. Also fetch inactive ones if they changed recently so app can archive them.
                 programs_domain = [
                     ('program_type', 'in', ['buy_x_get_y', 'promotion', 'tier']),
                     '|', ('active', '=', True), ('active', '=', False), 
                     ('company_id', 'in', [False, sales_rep.company_id.id])
                 ]
                 programs = request.env['loyalty.program'].with_user(user).search(get_delta_domain(programs_domain))
                 
                 promotions_list = []
                 has_custom_promotion = 'priority' in request.env['loyalty.program']._fields
                 for program in programs:
                     if not program.active:
                         promotions_list.append({
                             'id': program.id,
                             'is_archived': True,
                         })
                         continue
                     
                     # Serialize Rules
                     rules = []
                     for rule in program.rule_ids:
                         rules.append({
                             'id': rule.id,
                             'code': rule.code,
                             'minimum_amount': rule.minimum_amount,
                             'minimum_qty': rule.minimum_qty,
                             'reward_point_amount': rule.reward_point_amount,
                             'reward_point_mode': rule.reward_point_mode,
                             'product_ids': rule.product_ids.ids,
                             'products': rule.product_ids.mapped('name'),
                             'categories': rule.product_category_id.mapped('name'),
                         })
    
                     # Serialize Rewards
                     rewards = []
                     for reward in program.reward_ids:
                         rewards.append({
                             'id': reward.id,
                             'description': reward.description,
                             'reward_type': reward.reward_type,
                             'discount': reward.discount,
                             'discount_mode': reward.discount_mode,
                             'required_points': reward.required_points,
                             'reward_product_id': reward.reward_product_id.id if reward.reward_product_id else False,
                             'reward_product_name': reward.reward_product_id.name if reward.reward_product_id else False,
                             'reward_product_qty': reward.reward_product_qty if hasattr(reward, 'reward_product_qty') else 1,
                         })

                     # Serialize Tiers
                     tiers = []
                     if hasattr(program, 'program_tier_ids'):
                         for tier in program.program_tier_ids:
                             tiers.append({
                                 'id': tier.id,
                                 'name': tier.name,
                                 'minimum_amount': tier.minimum_amount,
                                 'maximum_amount': tier.maximum_amount,
                                 'trigger_type': tier.trigger_type,
                                 'reward_type': tier.reward_type,
                                 'discount': tier.reward_amount,
                                 'bonus_product_id': tier.reward_product_id.id if tier.reward_product_id else False,
                                 'bonus_product_name': tier.reward_product_id.name if tier.reward_product_id else False,
                                 'bonus_product_qty': tier.qty,
                                 'rule_product_id': tier.rule_product_id.id if tier.rule_product_id else False,
                                 'rule_uom_id': tier.rule_uom_id.id if tier.rule_uom_id else False,
                             })
    
                     promotions_list.append({
                         'id': program.id,
                         'name': program.name,
                         'program_type': program.program_type,
                         'trigger': program.trigger,
                         'priority': getattr(program, 'priority', 999),
                         'can_be_shared': getattr(program, 'can_be_shared', True),
                         'is_cash': getattr(program, 'is_cash', False),
                         'is_auto': getattr(program, 'is_auto', True) if has_custom_promotion else False,
                         'tiers_type': getattr(program, 'tiers_type', False),
                         'discount_product_id': program.discount_product_id.id if hasattr(program, 'discount_product_id') and program.discount_product_id else False,
                         'limit_partner_ids': program.limit_partner_ids.ids if hasattr(program, 'limit_partner_ids') else [],
                         'limit_partner_category_ids': program.limit_partner_category_ids.ids if hasattr(program, 'limit_partner_category_ids') else [],
                         'limit_country_ids': program.limit_country_ids.ids if hasattr(program, 'limit_country_ids') else [],
                         'limit_state_ids': program.limit_state_ids.ids if hasattr(program, 'limit_state_ids') else [],
                         'limit_area_names': program.limit_area_ids.mapped('name') if hasattr(program, 'limit_area_ids') else [],
                         'pricelist_ids': program.pricelist_ids.ids,
                         'json_data': json.dumps({'rules': rules, 'rewards': rewards, 'tiers': tiers})
                     })
                 
                 downloads['promotions'] = promotions_list
                 _logger.info(f"Sync: Downloaded {len(promotions_list)} promotions")
                 if promotions_list:
                     _logger.info(f"Sync: Synced Promotion Names: {[p.get('name') for p in promotions_list]}")
        except Exception as e:
             _logger.warning(f"Sync: Failed to fetch promotions: {e}")
             downloads['promotions'] = []


        # 3. Products
        # Note: We DISABLE delta sync (since) for products because stock levels (free_qty) 
        # change without updating the product's write_date. To ensure accuracy, 
        # we always fetch the full list of products available for this rep's location.
        
        p_domain = [
            ('active', '=', True),
            ('company_id', 'in', [sales_rep.company_id.id, False])
        ]
        
        # Include service products if it's the configured discount product
        if sales_rep.discount_product_id:
            p_domain += ['|', ('is_storable', '=', True), ('id', '=', sales_rep.discount_product_id.id)]
        else:
            p_domain += [('is_storable', '=', True)]
        
        # Filter products by representative's allowed categories if any
        if sales_rep.product_category_ids:
            p_domain.append(('categ_id', 'child_of', sales_rep.product_category_ids.ids))
        
        # Add location context so free_qty is calculated for the rep's default location
        product_context = {}
        if sales_rep.default_location_id:
            product_context['location'] = sales_rep.default_location_id.id
            _logger.info(f"Sync: Fetching products for location: {sales_rep.default_location_id.name}")
            # We no longer strictly filter products by stock > 0 so that 0-stock items
            # are also visible in the mobile app's storage and catalog.
            stock_field = 'free_qty'

        # We use p_domain directly (skipping get_delta_domain) for products
        products = request.env['product.product'].with_user(user).with_context(**product_context).search_read(
            p_domain, 
            ['id', 'name', 'display_name', 'default_code', 'list_price', 'uom_id', 'categ_id', 'image_512', 
             'product_tmpl_id', 'type', 'is_storable', 'invoice_policy', 'taxes_id', 'free_qty', 'active'])

        # Calculate stock levels (free quantity) for all storable products across all assigned default locations
        location_ids = sales_rep.default_location_ids.ids
        product_location_quants = {}
        if location_ids and products:
            locations = request.env['stock.location'].sudo().browse(location_ids)
            location_names = {loc.id: loc.display_name or loc.name for loc in locations}
            
            product_ids = [p['id'] for p in products]
            quants = request.env['stock.quant'].sudo().search_read(
                [('product_id', 'in', product_ids), ('location_id', 'in', location_ids)],
                ['product_id', 'location_id', 'quantity', 'reserved_quantity']
            )
            for q in quants:
                pid = q['product_id'][0]
                loc_id = q['location_id'][0]
                qty = q.get('quantity', 0.0) - q.get('reserved_quantity', 0.0)
                loc_name = location_names.get(loc_id, f"Location #{loc_id}")
                
                if pid not in product_location_quants:
                    product_location_quants[pid] = []
                product_location_quants[pid].append({
                    'location_id': loc_id,
                    'location_name': loc_name,
                    'quantity': qty
                })
        _logger.info("Sync: Calculated product_location_quants mapping")

        # Collect UoM IDs to fetch categories
        product_uom_ids = set()
        for p in products:
            if p.get('uom_id'):
                product_uom_ids.add(p['uom_id'][0])

        # Fetch UoM Categories for products
        product_uom_category_map = {}
        if product_uom_ids:
            uoms_for_cat = request.env['uom.uom'].sudo().search_read([('id', 'in', list(product_uom_ids))], ['id', 'category_id'])
            product_uom_category_map = {u['id']: u['category_id'][0] for u in uoms_for_cat if u['category_id']}
        
        if products:
             _logger.info(f"DEBUG: First product data: {products[0]}")
             # Check specific fields
             _logger.info(f"DEBUG: detailed_type: {products[0].get('detailed_type')}")
             _logger.info(f"DEBUG: invoice_policy: {products[0].get('invoice_policy')}")
             _logger.info(f"DEBUG: taxes_id: {products[0].get('taxes_id')}")
             _logger.info(f"DEBUG: uom_id: {products[0].get('uom_id')}")
        
        # Pre-fetch taxes for enrichment
        all_tax_ids = set()
        for p in products:
            if p.get('taxes_id'):
                all_tax_ids.update(p['taxes_id'])
        
        tax_map = {}
        if all_tax_ids:
            taxes = request.env['account.tax'].with_user(user).search_read(
                [('id', 'in', list(all_tax_ids))],
                ['id', 'name', 'amount', 'amount_type']
            )
            for t in taxes:
                tax_map[t['id']] = t

        # Map fields for SQLite
        for p in products:
            if p.get('image_512'):
                img_val = p['image_512'].decode('utf-8') if isinstance(p['image_512'], bytes) else p['image_512']
                p['image_url'] = f"data:image/png;base64,{img_val}"
            else:
                p['image_url'] = None
            if 'image_512' in p:
                del p['image_512']
            
            # Handle product_tmpl_id (Tuple -> ID)
            if p.get('product_tmpl_id'):
                p['product_tmpl_id'] = p['product_tmpl_id'][0] if isinstance(p['product_tmpl_id'], (list, tuple)) else p['product_tmpl_id']
            else:
                p['product_tmpl_id'] = False

            # Handle uom_id and category_id
            if p.get('uom_id') and isinstance(p['uom_id'], (list, tuple)):
                uom_id_val = p['uom_id'][0]
                p['uom_name'] = p['uom_id'][1]
                p['uom_id'] = uom_id_val
                p['uom_category_id'] = product_uom_category_map.get(uom_id_val)
            elif p.get('uom_id'):
                # Already an ID (maybe from previous processing or different Odoo version behavior)
                uom_id_val = p['uom_id']
                p['uom_name'] = p.get('uom_name') or 'Unit'
                p['uom_category_id'] = product_uom_category_map.get(uom_id_val)
            else:
                p['uom_id'] = False
                p['uom_name'] = 'Unit'
                p['uom_category_id'] = False

            # Handle categ_id (Tuple -> ID)
            if p.get('categ_id') and isinstance(p['categ_id'], (list, tuple)):
                p['categ_name'] = p['categ_id'][1]
                p['categ_id'] = p['categ_id'][0]
            else:
                p['categ_name'] = None
                p['categ_id'] = p.get('categ_id') or False

            # Handle taxes_id: Enrich with actual tax amount/name
            if p.get('taxes_id'):
                p['taxes_id'] = [tax_map.get(tid) for tid in p['taxes_id'] if tid in tax_map]
            else:
                p['taxes_id'] = []
            
            # Handle type mapping for mobile app compatibility (detailed_type)
            if p.get('is_storable'):
                p['detailed_type'] = 'product'
            else:
                p['detailed_type'] = p.get('type')
            
            # Ensure text fields are None if False (Odoo behavior)
            if p.get('detailed_type') is False:
                p['detailed_type'] = None
            if p.get('invoice_policy') is False:
                p['invoice_policy'] = None

            # Add free_qtys list mapping
            p['free_qtys'] = product_location_quants.get(p['id'], [])
            
        downloads['products'] = products

        # 4. Visits (Completed visits from last sync date)
        visit_domain = [
            ('sales_rep_id', '=', sales_rep.id),
            ('state', '=', 'completed'),
            ('visit_time', '>=', last_sync_date),
            ('company_id', '=', sales_rep.company_id.id),
        ]
        visits = request.env['sales.rep.visit'].with_user(user).search_read(
            get_delta_domain(visit_domain),
            ['id', 'name', 'sales_rep_id', 'route_id', 'route_customer_id', 'partner_id', 'visit_type', 'state', 'visit_result', 'notes', 'visit_location_lat', 'visit_location_long', 'planned_time', 'visit_time']
        )
        downloads['visits'] = visits

        # 5. Collections (Fetch last 30 days of collections and payments)
        thirty_days_ago = fields.Datetime.now() - timedelta(days=30)
        
        # Get active routes for the rep in this period to broaden search
        active_routes = request.env['sales.rep.route'].sudo().search([
            ('sales_rep_id', '=', sales_rep.id),
            ('date', '>=', thirty_days_ago.date())
        ])
        route_ids = active_routes.ids
        
        collection_domain = [
            ('collection_date', '>=', thirty_days_ago),
            '|', ('sales_rep_id', '=', sales_rep.id), ('route_id', 'in', route_ids)
        ]
        
        _logger.info(f"Sync: Fetching collections/payments for sales rep {sales_rep.name} since {thirty_days_ago}")
        # collections_raw = request.env['sales.rep.collection'].with_user(user).search(collection_domain)
        collections_raw = []
        
        collections = []
        seen_payment_ids = set()
        
        for col in collections_raw:
            if col.payment_id:
                seen_payment_ids.add(col.payment_id.id)
                
            col_data = {
                'id': col.id,
                'name': col.name,
                'sales_rep_id': col.sales_rep_id.id or sales_rep.id,
                'route_id': col.route_id.id or (col.visit_id.route_id.id if col.visit_id else False),
                'route_customer_id': col.route_customer_id.id,
                'partner_id': col.partner_id.id,
                'visit_id': col.visit_id.id,
                'collection_date': col.collection_date,
                'amount': col.amount,
                'payment_method': col.payment_method,
                'payment_method_id': col.payment_method_id.id,
                'state': col.state,
                'mobile_local_id': col.mobile_local_id,
                'journal_id': col.payment_id.journal_id.id if col.payment_id else False
            }
            # Fallback for route_id if still missing but we can deduce it
            if not col_data['route_id'] and col_data['visit_id']:
                visit = request.env['sales.rep.visit'].sudo().browse(col_data['visit_id'])
                col_data['route_id'] = visit.route_id.id
                
            collections.append(col_data)
        
        # Also fetch direct account.payment records that might not have a sales.rep.collection
        payment_domain = [
            ('date', '>=', thirty_days_ago.date()),
            ('state', '!=', 'cancel'),
            '|', ('route_id', 'in', route_ids), ('partner_id.user_id', '=', user.id)
        ]
        orphan_payments = request.env['account.payment'].with_user(user).search([
            ('id', 'not in', list(seen_payment_ids))
        ] + payment_domain)
        
        for pay in orphan_payments:
            # Map Odoo payment journal type to mobile payment method selection
            pay_method = 'cash'
            if pay.journal_id.type == 'bank':
                pay_method = 'bank_transfer'
            elif 'card' in (pay.journal_id.name or '').lower():
                pay_method = 'card'
            elif 'check' in (pay.journal_id.name or '').lower():
                pay_method = 'check'
                
            collections.append({
                'id': 2000000 + pay.id, # Synthetic Integer ID to fit SQLite INT
                'name': pay.name or f"Payment {pay.id}",
                'sales_rep_id': sales_rep.id,
                'route_id': pay.route_id.id or False,
                'route_customer_id': pay.route_customer_id.id or False,
                'partner_id': pay.partner_id.id,
                'visit_id': pay.visit_id.id or False,
                'collection_date': pay.date,
                'amount': pay.amount,
                'payment_method': pay_method,
                'payment_method_id': False,
                'state': 'confirmed' if pay.state == 'posted' else 'draft',
                'mobile_local_id': pay.mobile_local_id or False,
                'journal_id': pay.journal_id.id
            })
            
        downloads['collections'] = collections

        # 6. Invoices (Created or modified from last sync date)
        invoice_domain = [
            ('state', 'in', ['posted', 'paid']),
            ('company_id', '=', sales_rep.company_id.id),
        ]
        invoices = request.env['account.move'].with_user(user).search_read(
            get_delta_domain(invoice_domain),
            ['id', 'name', 'move_type', 'partner_id', 'invoice_date', 'amount_total', 'amount_residual', 'state', 'invoice_line_ids', 'payment_state']
        )
        downloads['invoices'] = invoices

        # 7. Invoice Lines (Line items for invoices)
        invoice_line_domain = [
            ('move_id', 'in', [inv['id'] for inv in invoices])
        ]
        invoice_lines = request.env['account.move.line'].with_user(user).search_read(
            invoice_line_domain,
            ['id', 'move_id', 'product_id', 'name', 'quantity', 'price_unit', 'price_subtotal']
        )
        downloads['invoice_lines'] = invoice_lines

        # 8. Payments (Created or modified from last sync date)
        # payment_domain = [
        #     ('state', '=', 'posted'),
        #     ('payment_date', '>=', last_sync_date)
        # ]
        # payments = request.env['account.payment'].with_user(user).search_read(
        #     payment_domain,
        #     ['id', 'name', 'payment_type', 'partner_id', 'payment_date', 'amount', 'journal_id', 'payment_method_line_id', 'ref', 'communication', 'reconciled', 'invoice_ids']
        # )
        # downloads['payments'] = payments

        # 10. Sales Orders
        sales_orders = []
        related_partner_ids = set()  # Initialized here to avoid UnboundLocalError if try block fails
        try:
            sales_order_domain = [
                ('user_id', '=', user.id),
                ('company_id', '=', sales_rep.company_id.id),
            ]
            
            sales_orders = request.env['sale.order'].with_user(user).search_read(
                get_delta_domain(sales_order_domain),
                ['id', 'name', 'partner_id', 'date_order', 'amount_total', 'amount_untaxed', 'amount_tax',
                 'state', 'invoice_status', 'delivery_status', 'pricelist_id', 'route_id', 'visit_id',
                 'order_line', 'mobile_local_id', 'is_cash', 'discount_total']
            )

            # Collect related partner IDs to ensure they exist locally
            # NEW: Also include partners modified since last sync (e.g. credit limit changed)
            if since:
                modified_partners = request.env['res.partner'].with_user(user).search([
                    ('write_date', '>', since),
                    ('company_id', 'in', [sales_rep.company_id.id, False])
                ], limit=100)
                related_partner_ids.update(modified_partners.ids)

            # Collect partner IDs from pickings that will be downloaded
            try:
                picking_domain_for_partners = [
                    '|', '|', '|',
                    ('sales_rep_id', '=', sales_rep.id),
                    ('created_sales_rep_id', '=', sales_rep.id),
                    ('sale_id.sales_rep_id', '=', sales_rep.id),
                    ('partner_id', '!=', False)
                ]
                picking_domain_for_partners = ['&', ('write_date', '>=', thirty_days_ago)] + picking_domain_for_partners
                picking_partners = request.env['stock.picking'].with_user(user).search(picking_domain_for_partners).mapped('partner_id').ids
                related_partner_ids.update(picking_partners)
            except Exception as pe:
                _logger.warning(f"Sync: Failed to pre-fetch picking partner IDs: {pe}")

            # Flatten Many2one fields and add related IDs for mobile consumption
            for so in sales_orders:
                if so.get('pricelist_id') and isinstance(so['pricelist_id'], (list, tuple)):
                    so['pricelist_id'] = so['pricelist_id'][0]
                if so.get('partner_id') and isinstance(so['partner_id'], (list, tuple)):
                    related_partner_ids.add(so['partner_id'][0])
                    so['partner_id'] = so['partner_id'][0]
                if so.get('route_id') and isinstance(so['route_id'], (list, tuple)):
                    so['route_id'] = so['route_id'][0]
                if so.get('visit_id') and isinstance(so['visit_id'], (list, tuple)):
                    so['visit_id'] = so['visit_id'][0]
                
                # Fetch invoice_ids and picking_ids from the actual record
                try:
                    order_obj = request.env['sale.order'].with_user(user).browse(so['id'])
                    order_sudo = order_obj.sudo()
                    so['invoice_ids'] = order_sudo.invoice_ids.ids if order_sudo.invoice_ids else []
                    pickings = order_sudo.picking_ids
                    so['picking_ids'] = pickings.ids if pickings else []
                    
                    # Compute delivery status from app perspective: 
                    # If Odoo says 'pending' or 'partial' but all pickings are done/cancelled, it means no backorder was made (or canceled).
                    has_pending_picking = any(p.state not in ('done', 'cancel') for p in pickings)
                    if so.get('delivery_status') in ('pending', 'partial') and pickings and not has_pending_picking:
                        so['delivery_status'] = 'full'
                    elif not pickings and any(l.qty_delivered > 0 for l in order_sudo.order_line):
                        # Safety check for cases where delivery exists but pickings are missing from access
                        so['delivery_status'] = 'full'
                    
                    # Gap 8: Compute is_returnable (any picking is 'done')
                    has_done_picking = any(p.state == 'done' for p in pickings)
                    so['is_returnable'] = 1 if has_done_picking else 0
                    
                    # Aggregate payment state across ALL posted invoices
                    posted_invs = order_sudo.invoice_ids.filtered(lambda inv: inv.state == 'posted')
                    if posted_invs:
                        total_residual = sum(posted_invs.mapped('amount_residual'))
                        total_amount = sum(posted_invs.mapped('amount_total'))
                        if total_residual <= 0:
                            so['payment_state'] = 'paid'
                        elif total_residual < total_amount:
                            so['payment_state'] = 'partial'
                        else:
                            so['payment_state'] = 'not_paid'
                        so['amount_residual'] = total_residual  # Always set from invoices
                    else:
                        so['amount_residual'] = so.get('amount_total', 0)
                        so['payment_state'] = 'not_paid'
                except Exception as e:
                    _logger.warning(f"Sync: Error enriching SO {so.get('id')}: {e}")
                    so['invoice_ids'] = []
                    so['picking_ids'] = []
                    so['payment_state'] = False


            downloads['sales_orders'] = sales_orders
            _logger.info(f"Sync: Downloaded {len(sales_orders)} sales orders")
            
        except Exception as e:
            _logger.error(f"Sync: Critical error fetching sales orders: {e}")
            downloads['sales_orders'] = []

        # Fetch extra partners if not covered by routes (simplified check)
        # We can just send them; upsert will handle duplicates.
        if related_partner_ids:
             # Build field list — include financial limit fields if the module is installed
             extra_partner_fields = ['id', 'name', 'phone', 'mobile', 'email', 'street', 'city', 'state_id', 'country_id', 'area', 'vat', 
                 'property_payment_term_id', 'property_product_pricelist', 'credit_limit', 'total_due', 'mobile_local_id', 'visit_latitude', 'visit_longitude', 'is_cash', 'category_id', 'enable_location', 'location_radius']
             if 'sale_credit_limit' in request.env['res.partner']._fields:
                 extra_partner_fields += ['sale_credit_limit', 'allow_over_sale_credit', 'sale_credit_used']
             partners = request.env['res.partner'].with_user(user).search_read(
                [('id', 'in', list(related_partner_ids))],
                extra_partner_fields
             )
             # Flatten partner fields
             for p in partners:
                 if p.get('country_id'): p['country_id'] = p['country_id'][0]
                 if p.get('state_id'): p['state_id'] = p['state_id'][0]
                 if p.get('property_payment_term_id'): p['property_payment_term_id'] = p['property_payment_term_id'][0]
                 if p.get('property_product_pricelist'): p['property_product_pricelist'] = p['property_product_pricelist'][0]
             
             downloads['partners'] = partners

        # 11. Sales Order Lines (Line items for sales orders)
        sales_order_line_domain = [
            ('order_id', 'in', [order['id'] for order in sales_orders])
        ]
        # Use sudo() for lines to bypass public auth ACL friction on subsidiary models
        sales_order_lines = request.env['sale.order.line'].sudo().search_read(
            sales_order_line_domain,
            ['id', 'order_id', 'product_id', 'name', 'product_uom_qty', 'qty_delivered', 'qty_invoiced',
             'price_unit', 'price_subtotal', 'product_uom', 'is_reward_line', 'location_id']
        )
        
        # Enrich lines with UoM name and Location
        for line in sales_order_lines:
            if line.get('product_uom') and isinstance(line['product_uom'], (list, tuple)):
                line['product_uom_name'] = line['product_uom'][1]
                line['product_uom'] = line['product_uom'][0]
            else:
                line['product_uom_name'] = 'Unit'
                line['product_uom'] = line.get('product_uom') or False

            if line.get('location_id') and isinstance(line['location_id'], (list, tuple)):
                line['location_name'] = line['location_id'][1]
                line['location_id'] = line['location_id'][0]
            else:
                line['location_name'] = False
                line['location_id'] = line.get('location_id') or False
        downloads['sales_order_lines'] = sales_order_lines

        # 12. Payment Journals (Filtered by Sales Rep Assignment)
        try:
            # 12a. Identify assigned payment methods and journals
            assigned_methods = sales_rep.sudo().payment_method_ids
            _logger.info(f"Sync: Rep {sales_rep.name} (ID: {sales_rep.id}) has {len(assigned_methods)} assigned payment methods. Access Cash Balance: {sales_rep.access_cash_balance}")
            
            # Extract journal IDs from assigned methods
            assigned_journal_ids = assigned_methods.mapped('journal_id').ids
            _logger.info(f"Sync: Assigned journal IDs: {assigned_journal_ids}")
            
            journal_domain = [
                ('type', 'in', ['cash', 'bank']),
                ('active', '=', True),
                ('id', 'in', assigned_journal_ids)
            ]
            
            journals = request.env['account.journal'].sudo().search(journal_domain)
            _logger.info(f"Sync: Found {len(journals)} journals for domain {journal_domain}")


            journal_data = []
            # Get active route IDs for balance calculation (last 30 days)
            thirty_days_ago_date = thirty_days_ago.date()
            active_route_ids = request.env['sales.rep.route'].sudo().search([
                ('sales_rep_id', '=', sales_rep.id),
                ('date', '>=', thirty_days_ago_date)
            ]).ids

            for journal in journals:
                try:
                    # In Odoo 18, account.journal does not have a direct 'current_balance' field.
                    # We calculate it by summing the balance of posted move lines on the journal's default account.
                    # This represents the actual GL balance.
                    odoo_balance = 0.0
                    if journal.sudo().default_account_id:
                        move_line_domain = [
                            ('journal_id', '=', journal.id),
                            ('account_id', '=', journal.sudo().default_account_id.id),
                            ('parent_state', '=', 'posted')
                        ]
                        # Use sudo() to ensure balance is accurate regardless of user permissions
                        move_lines = request.env['account.move.line'].sudo().search(move_line_domain)
                        odoo_balance = sum(move_lines.mapped('balance'))
                    
                    _logger.debug(f"Sync: Journal {journal.name} (ID: {journal.id}) calculated balance: {odoo_balance}")
                except Exception as e:
                    _logger.warning(f"Sync: Could not get balance for journal {journal.name}: {e}")
                    odoo_balance = 0.0


                
                journal_data.append({
                    'id': journal.id,
                    'odoo_id': journal.id,
                    'name': journal.name,
                    'type': journal.type,
                    'balance': odoo_balance
                })
            downloads['payment_journals'] = journal_data
            _logger.info(f"Sync: Downloaded {len(journal_data)} payment journals for rep {sales_rep.id}")
        except Exception as e:
            _logger.error(f"Sync: Critical error in payment journals section: {e}", exc_info=True)


        # 13. Pricelists (Active pricelists)
        try:
            # Use sudo() as sales reps might not have explicit read access to pricelists
            if sales_rep.available_pricelist_ids:
                pricelist_domain = [
                    ('id', 'in', sales_rep.available_pricelist_ids.ids)
                ]
            else:
                pricelist_domain = [
                    ('active', '=', True),
                    ('company_id', 'in', [False, sales_rep.company_id.id])
                ]
            pricelists = request.env['product.pricelist'].sudo().search_read(
                pricelist_domain,
                ['id', 'name', 'is_sales_cash']
            )
            if sales_rep.available_pricelist_ids:
                assigned_ids = sales_rep.available_pricelist_ids.ids
                pricelists.sort(key=lambda x: assigned_ids.index(x['id']))
            downloads['pricelists'] = pricelists
            _logger.info(f"Sync: Downloaded {len(pricelists)} pricelists")

            # 13b. Pricelist Items
            item_domain = [
                ('pricelist_id', 'in', [p['id'] for p in pricelists])
            ]
            # Odoo 17 fields for pricelist item
            pricelist_items = request.env['product.pricelist.item'].sudo().search_read(
                item_domain,
                ['id', 'pricelist_id', 'product_id', 'product_tmpl_id', 'categ_id', 
                 'min_quantity', 'date_start', 'date_end', 'compute_price', 
                 'fixed_price', 'percent_price', 'base_pricelist_id']
            )
            # Flatten Many2one
            for item in pricelist_items:
                if item.get('pricelist_id'): item['pricelist_id'] = item['pricelist_id'][0]
                if item.get('product_id'): item['product_id'] = item['product_id'][0]
                if item.get('product_tmpl_id'): item['product_tmpl_id'] = item['product_tmpl_id'][0]
                if item.get('categ_id'): item['categ_id'] = item['categ_id'][0]
                if item.get('base_pricelist_id'): item['base_pricelist_id'] = item['base_pricelist_id'][0]
            
            downloads['pricelist_items'] = pricelist_items
            _logger.info(f"Sync: Downloaded {len(pricelist_items)} pricelist items")
        except Exception as e:
            _logger.warning(f"Sync: Could not fetch pricelists/items: {e}")

        # 14. Payment Terms (Active payment terms)
        try:
            # Use sudo() as sales reps might not have explicit read access to payment terms
            if sales_rep.available_payment_term_ids:
                term_domain = [
                    ('id', 'in', sales_rep.available_payment_term_ids.ids)
                ]
            else:
                term_domain = [
                    ('active', '=', True),
                    ('company_id', 'in', [False, sales_rep.company_id.id])
                ]
            terms = request.env['account.payment.term'].sudo().search_read(
                term_domain,
                ['id', 'name']
            )
            if sales_rep.available_payment_term_ids:
                assigned_ids = sales_rep.available_payment_term_ids.ids
                terms.sort(key=lambda x: assigned_ids.index(x['id']))
            downloads['payment_terms'] = terms
            _logger.info(f"Sync: Downloaded {len(terms)} payment terms")
        except Exception as e:
            _logger.warning(f"Sync: Could not fetch payment terms: {e}")

        # 15. Payment Methods (Filtered by Sales Rep Assignment)
        try:
            payment_method_domain = [
                ('active', '=', True),
                ('id', 'in', sales_rep.payment_method_ids.ids)
            ]

            payment_methods = request.env['sales.rep.payment.method'].with_user(user).search_read(
                payment_method_domain,
                ['id', 'name', 'journal_id', 'payment_type']
            )
            # Remap fields for mobile
            for pm in payment_methods:
                if pm.get('payment_type'):
                    pm['type'] = pm['payment_type']
            downloads['payment_methods'] = payment_methods
            _logger.info(f"Sync: Downloaded {len(payment_methods)} payment methods")
        except Exception as e:
            _logger.warning(f"Sync: Could not fetch payment methods: {e}")
            downloads['payment_methods'] = []

        # 16. Return Reasons
        try:
            model_name = 'customer.return.reason' if 'customer.return.reason' in request.env else 'sales.rep.return.reason'
            reasons = request.env[model_name].with_user(user).search_read(
                [('active', '=', True)], 
                ['id', 'name', 'sequence'],
                order='sequence, name'
            )
            downloads['return_reasons'] = reasons
            _logger.info(f"Sync: Downloaded {len(reasons)} return reasons")
        except Exception as e:
            _logger.warning(f"Sync: Could not fetch return reasons: {e}")
            downloads['return_reasons'] = []

        # 17. Partner Categories (Tags)
        try:
            # sudo() for tags as they are global metadata
            tags = request.env['res.partner.category'].sudo().search_read(
                [], 
                ['id', 'name', 'color']
            )
            downloads['partner_categories'] = tags
            _logger.info(f"Sync: Downloaded {len(tags)} partner categories (tags)")
        except Exception as e:
            _logger.warning(f"Sync: Could not fetch partner categories: {e}")
            downloads['partner_categories'] = []

        # 18. Units of Measure
        try:
            uom_categories = request.env['uom.category'].sudo().search_read([], ['id', 'name'])
            downloads['uom_categories'] = uom_categories
            
            uoms = request.env['uom.uom'].sudo().search_read(
                [('active', '=', True)], 
                ['id', 'name', 'category_id', 'factor', 'uom_type', 'rounding']
            )
            # Flatten category_id
            for u in uoms:
                if u.get('category_id'):
                    u['category_id'] = u['category_id'][0]
            downloads['uoms'] = uoms
            _logger.info(f"Sync: Downloaded {len(uom_categories)} UoM categories and {len(uoms)} UoMs")
        except Exception as e:
            _logger.warning(f"Sync: Could not fetch UoM data: {e}")

        # 19. Stock Requests
        try:
            # We want only pickings that are internal stock requests for this sales rep
            request_domain = [
                ('picking_type_id.code', '=', 'internal'),
                '|',
                ('sales_rep_id', '=', sales_rep.id),
                ('location_dest_id', '=', sales_rep.default_location_id.id)
            ]
            if since:
                request_domain.append(('write_date', '>', since))
            
            pickings = request.env['stock.picking'].with_user(user).search(request_domain)
            requests_list = []
            for picking in pickings:
                # Format request date
                req_date = (picking.date_done or picking.scheduled_date or picking.date or fields.Datetime.now())
                if isinstance(req_date, (fields.Datetime, fields.Date)):
                    req_date = req_date.isoformat()
                elif hasattr(req_date, 'strftime'):
                    req_date = req_date.strftime('%Y-%m-%dT%H:%M:%SZ')
                else:
                    req_date = str(req_date)

                # Format request data to match mobile schema expectation
                req_data = {
                    'id': picking.id,
                    'local_id': picking.origin or f"REQ-{picking.id}", # fallback if origin is empty
                    'name': picking.name,
                    'date': req_date,
                    'state': 'done' if picking.state == 'done' else ('cancel' if picking.state == 'cancel' else 'draft'),
                    'sales_rep_id': sales_rep.id,
                    'location_id': picking.location_dest_id.id,
                    'source_location_id': picking.location_id.id,
                    'location_name': picking.location_dest_id.display_name or picking.location_dest_id.name,
                    'source_location_name': picking.location_id.display_name or picking.location_id.name,
                    'lines': []
                }
                
                for move in picking.move_ids:
                    req_data['lines'].append({
                        'id': move.id,
                        'product_id': move.product_id.id,
                        'qty': move.product_uom_qty,
                        'uom_id': move.product_uom.id
                    })
                requests_list.append(req_data)
                
            downloads['stock_requests'] = requests_list
            _logger.info(f"Sync: Downloaded {len(requests_list)} stock requests")
        except Exception as e:
            import traceback
            _logger.warning(f"Sync: Could not fetch stock requests: {e}\n{traceback.format_exc()}")

        # 20. All Stock Pickings & Moves (Deliveries)
        try:
            # Fetch all pickings of the last 30 days to ensure offline database tables are fully populated
            picking_domain = [
                '|', '|',
                ('sales_rep_id', '=', sales_rep.id),
                ('created_sales_rep_id', '=', sales_rep.id),
                ('sale_id.sales_rep_id', '=', sales_rep.id)
            ]
            picking_domain = ['&', ('write_date', '>=', thirty_days_ago)] + picking_domain
            
            all_pickings = request.env['stock.picking'].with_user(user).search(picking_domain)
            pickings_list = []
            moves_list = []
            
            for picking in all_pickings:
                pick_date = (picking.date_done or picking.scheduled_date or picking.date or fields.Datetime.now())
                if hasattr(pick_date, 'strftime'):
                    pick_date_str = pick_date.strftime('%Y-%m-%d %H:%M:%S')
                else:
                    pick_date_str = str(pick_date)
                    
                pickings_list.append({
                    'id': picking.id,
                    'name': picking.name,
                    'state': picking.state,
                    'location_name': picking.location_id.display_name or picking.location_id.name,
                    'location_dest_name': picking.location_dest_id.display_name or picking.location_dest_id.name,
                    'date': pick_date_str,
                    'origin': picking.origin or '',
                    'partner_id': picking.partner_id.id if picking.partner_id else False,
                    'partner_name': picking.partner_id.name if picking.partner_id else '',
                    'picking_type_code': picking.picking_type_code or ''
                })
                
                for move in picking.move_ids:
                    moves_list.append({
                        'id': move.id,
                        'picking_id': picking.id,
                        'product_id': move.product_id.id,
                        'product_name': move.product_id.display_name or move.product_id.name,
                        'product_uom_qty': move.product_uom_qty,
                        'quantity': move.quantity,
                        'state': move.state,
                        'product_uom': move.product_uom.name or ''
                    })
                    
            downloads['stock_pickings'] = pickings_list
            downloads['stock_moves'] = moves_list
            _logger.info(f"Sync: Downloaded {len(pickings_list)} pickings and {len(moves_list)} moves")
        except Exception as e:
            import traceback
            _logger.warning(f"Sync: Could not fetch stock pickings: {e}\n{traceback.format_exc()}")

        # 21. Product Stock levels for Sales Rep Locations
        try:
            location_ids = set()
            if sales_rep.default_location_id:
                location_ids.add(sales_rep.default_location_id.id)
            if sales_rep.default_location_ids:
                for loc in sales_rep.default_location_ids:
                    location_ids.add(loc.id)
            if sales_rep.return_location_id:
                location_ids.add(sales_rep.return_location_id.id)
            if sales_rep.return_location_ids:
                for loc in sales_rep.return_location_ids:
                    location_ids.add(loc.id)
            if hasattr(sales_rep, 'location_request_id') and sales_rep.location_request_id:
                location_ids.add(sales_rep.location_request_id.id)
            if hasattr(sales_rep, 'location_request_ids') and sales_rep.location_request_ids:
                for loc in sales_rep.location_request_ids:
                    location_ids.add(loc.id)

            if location_ids:
                quants = request.env['stock.quant'].sudo().search([
                    ('location_id', 'in', list(location_ids)),
                    ('product_id.active', '=', True)
                ])
                stock_list = []
                for q in quants:
                    stock_list.append({
                        'product_id': q.product_id.id,
                        'location_id': q.location_id.id,
                        'sales_rep_id': sales_rep.id,
                        'quantity': q.quantity or 0.0
                    })
                downloads['product_stock'] = stock_list
                _logger.info(f"Sync: Downloaded {len(stock_list)} product stock records for locations: {list(location_ids)}")
            else:
                downloads['product_stock'] = []
        except Exception as e:
            _logger.warning(f"Sync: Could not fetch product stock: {e}")

        return downloads

    def _action_upload_attachment(self, payload, user):
        res_model = payload.get('res_model', 'sale.order')
        res_id = payload.get('res_id')
        file_base64 = payload.get('file_base64')
        file_name = payload.get('file_name', 'attachment.jpg')

        if not res_id:
            raise ValueError("Missing 'res_id' in upload_attachment payload")
        if not file_base64:
            raise ValueError("Missing 'file_base64' in upload_attachment payload")

        # If res_id is a string (UUID/local_id), resolve the Odoo ID
        if isinstance(res_id, str) and res_model == 'sale.order':
            order = request.env['sale.order'].with_user(user).search([('mobile_local_id', '=', res_id)], limit=1)
            if not order.exists():
                return {'success': False, 'error': f"Order not found for local_id: {res_id}, retrying later."}
            res_id_resolved = order.id
        else:
            try:
                res_id_resolved = int(res_id)
            except ValueError:
                res_id_resolved = res_id

        # Check if attachment already exists to avoid duplicates
        existing = request.env['ir.attachment'].with_user(user).search([
            ('res_model', '=', res_model),
            ('res_id', '=', res_id_resolved),
            ('name', '=', file_name)
        ], limit=1)

        if existing:
            return {'success': True, 'attachment_id': existing.id, 'message': 'Attachment already exists'}

        attachment = request.env['ir.attachment'].with_user(user).create({
            'name': file_name,
            'datas': file_base64,
            'res_model': res_model,
            'res_id': res_id_resolved,
            'type': 'binary',
        })
        
        return {'success': True, 'attachment_id': attachment.id}

    def _action_delete_attachment(self, payload, user):
        res_model = payload.get('res_model', 'sale.order')
        res_id = payload.get('res_id')
        file_name = payload.get('file_name')

        if not res_id:
            raise ValueError("Missing 'res_id' in delete_attachment payload")
        if not file_name:
            raise ValueError("Missing 'file_name' in delete_attachment payload")

        # Resolve res_id
        if isinstance(res_id, str) and res_model == 'sale.order':
            order = request.env['sale.order'].with_user(user).search([('mobile_local_id', '=', res_id)], limit=1)
            if not order.exists():
                return {'success': False, 'error': f"Order not found for local_id: {res_id}"}
            res_id_resolved = order.id
        else:
            try:
                res_id_resolved = int(res_id)
            except ValueError:
                res_id_resolved = res_id

        # Find attachment
        attachment = request.env['ir.attachment'].with_user(user).search([
            ('res_model', '=', res_model),
            ('res_id', '=', res_id_resolved),
            ('name', '=', file_name)
        ], limit=1)

        if attachment.exists():
            attachment.unlink()
            return {'success': True, 'message': 'Attachment deleted successfully'}
        
        return {'success': True, 'message': 'Attachment did not exist on server'}

    def _action_reorder_route_customers(self, payload, user):
        route_id = payload.get('route_id')
        sequences = payload.get('sequences', [])
        _logger.info(f"Sync Action: Reordering route {route_id} customers: {sequences}")
        
        for seq_info in sequences:
            rc_id = seq_info.get('route_customer_id')
            local_rc_id = seq_info.get('local_route_customer_id')
            seq = seq_info.get('sequence')
            
            if seq is None:
                continue

            rc = request.env['sales.route.customer'].with_user(user)
            rc_record = False
            
            # 1. Try to resolve via Odoo ID
            if rc_id:
                try:
                    rc_record = rc.browse(int(rc_id))
                    if not rc_record.exists():
                        rc_record = False
                except (ValueError, TypeError):
                    rc_record = False
            
            # 2. Try to resolve via route_id and partner's mobile_local_id if partner was created offline
            if not rc_record:
                partner_local_id = seq_info.get('partner_local_id')
                if partner_local_id and route_id:
                    partner = request.env['res.partner'].sudo().search([('mobile_local_id', '=', partner_local_id)], limit=1)
                    if partner:
                        rc_record = rc.search([
                            ('route_id', '=', int(route_id)),
                            ('partner_id', '=', partner.id)
                        ], limit=1)
            
            if rc_record:
                rc_record.write({'sequence': seq})
                
        return {'success': True}



